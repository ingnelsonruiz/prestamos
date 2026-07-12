/**
 * GET /api/creditos-libres/[id]/calcular?fecha_corte=YYYY-MM-DD
 *
 * Calcula el interés generado desde la última fecha de corte (o la fecha de
 * creación del crédito si nunca se ha cobrado interés) hasta la fecha_corte
 * que el cobrador seleccione con el selector de fecha.
 *
 * CÁLCULO NUEVO — INDEPENDIENTE de lib/calculos.js y de /api/pagos.
 * No modifica ningún dato en la base; es solo una consulta de proyección.
 */
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

// Días base por período
const DIAS_PERIODO = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }

/**
 * Convención 30/360: cada mes cuenta exactamente 30 días,
 * sin importar si el mes tiene 28, 29, 30 o 31 días.
 * Fórmula: (Y2-Y1)*360 + (M2-M1)*30 + (D2-D1)
 * Ejemplo: 01/05/2026 → 01/07/2026 = 0*360 + 2*30 + 0 = 60 días (no 61).
 */
function diasD360(inicioStr, finStr) {
  const [y1, m1, d1] = inicioStr.split('-').map(Number)
  const [y2, m2, d2] = finStr.split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}

async function autoMigrar() {
  await query(`ALTER TABLE ${S}.cred_pagos ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`)
}

export async function GET(request, { params }) {
  try {
    await autoMigrar()
    const { id }          = await params
    const { searchParams } = new URL(request.url)
    const fechaCorteStr   = searchParams.get('fecha_corte')

    if (!fechaCorteStr)
      return NextResponse.json({ error: 'Parámetro fecha_corte requerido (YYYY-MM-DD)' }, { status: 400 })

    // Validar formato fecha
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCorteStr))
      return NextResponse.json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' }, { status: 400 })

    // Producto
    const prodRes = await query(
      `SELECT id, monto_capital, tasa_interes, periodo_tasa, estado, fecha_creacion, fecha_primer_pago
       FROM ${S}.cred_productos
       WHERE id = $1 AND tipo = 'credito_libre'`,
      [id]
    )
    if (!prodRes.rows.length)
      return NextResponse.json({ error: 'Crédito no encontrado' }, { status: 404 })

    const prod = prodRes.rows[0]

    if (prod.estado === 'saldado')
      return NextResponse.json({ error: 'El crédito ya está saldado' }, { status: 400 })

    // Capital pendiente = capital original − suma de abonos a capital
    const capRes = await query(
      `SELECT COALESCE(SUM(monto_capital), 0) AS capital_pagado
       FROM ${S}.cred_pagos
       WHERE producto_id = $1 AND monto_capital > 0`,
      [id]
    )
    const capitalPagado   = parseFloat(capRes.rows[0].capital_pagado)
    const capitalPendiente = parseFloat(prod.monto_capital) - capitalPagado

    if (capitalPendiente <= 0)
      return NextResponse.json({ error: 'El capital ya ha sido pagado en su totalidad' }, { status: 400 })

    // Fecha de inicio del período de interés:
    //   = última fecha_corte_interes registrada en pagos
    //   = fecha_creacion::DATE si nunca se ha cobrado interés
    const corteRes = await query(
      `SELECT MAX(fecha_corte_interes) AS ultimo_corte
       FROM ${S}.cred_pagos
       WHERE producto_id = $1 AND fecha_corte_interes IS NOT NULL`,
      [id]
    )
    const ultimoCorteRaw = corteRes.rows[0]?.ultimo_corte

    // Normalizar a YYYY-MM-DD
    let fechaInicioStr
    if (ultimoCorteRaw) {
      fechaInicioStr = typeof ultimoCorteRaw === 'string'
        ? ultimoCorteRaw.slice(0, 10)
        : new Date(ultimoCorteRaw).toISOString().slice(0, 10)
    } else {
      // Usar fecha_primer_pago (fecha de inicio del crédito ingresada por el usuario)
      // Si no existe, caer a fecha_creacion como último recurso
      const fc = prod.fecha_primer_pago || prod.fecha_creacion
      fechaInicioStr = typeof fc === 'string'
        ? fc.slice(0, 10)
        : new Date(fc).toISOString().slice(0, 10)
    }

    // Días en convención 30/360: cada mes = 30 días exactos
    const dias = diasD360(fechaInicioStr, fechaCorteStr)

    if (dias < 1)
      return NextResponse.json({
        error: `La fecha de corte (${fechaCorteStr}) debe ser estrictamente posterior al último corte registrado (${fechaInicioStr}). No se puede cobrar interés del mismo día.`
      }, { status: 400 })

    const tasa         = parseFloat(prod.tasa_interes)
    const periodoTasa  = prod.periodo_tasa
    const diasBase     = DIAS_PERIODO[periodoTasa] ?? 30
    const tasaDiaria   = (tasa / 100) / diasBase
    const interesCalc  = capitalPendiente * tasaDiaria * dias

    return NextResponse.json({
      capital_original:   parseFloat(prod.monto_capital),
      capital_pagado:     capitalPagado,
      capital_pendiente:  capitalPendiente,
      fecha_inicio:       fechaInicioStr,
      fecha_corte:        fechaCorteStr,
      dias_transcurridos: dias,   // convención 30/360 (meses de 30 días exactos)
      convencion:         '30/360',
      tasa_interes:       tasa,
      periodo_tasa:       periodoTasa,
      dias_base_periodo:  diasBase,
      tasa_diaria:        tasaDiaria,
      interes_calculado:  Math.round(interesCalc),   // redondeado a entero
      interes_calculado_exacto: interesCalc,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
