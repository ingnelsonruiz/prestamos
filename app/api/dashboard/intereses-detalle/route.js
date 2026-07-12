import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

// Convención 30/360 (igual que en /api/creditos-libres)
const DIAS_BASE_CL = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }
function diasD360(ini, fin) {
  const [y1, m1, d1] = ini.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = fin.slice(0, 10).split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}
function calcInteresCL(capital, tasa, periodTasa, inicioStr, hastaStr) {
  if (capital <= 0 || !inicioStr || !hastaStr) return 0
  const dias = diasD360(inicioStr, hastaStr)
  if (dias <= 0) return 0
  const diasBase = DIAS_BASE_CL[periodTasa] || 30
  return capital * (tasa / 100 / diasBase) * dias
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const rangoValido = /^\d{4}-\d{2}-\d{2}$/
    let desde = searchParams.get('desde')
    let hasta = searchParams.get('hasta')
    desde = rangoValido.test(desde || '') ? desde : null
    hasta = rangoValido.test(hasta || '') ? hasta : null
    const hayRango = Boolean(desde && hasta)

    const filtroRango = hayRango
      ? `AND cu.fecha_vencimiento BETWEEN $1 AND $2`
      : ''
    const params = hayRango ? [desde, hasta] : []

    const [normalesResult, libresResult] = await Promise.all([
      // Créditos normales (con cuotas programadas)
      query(`
        SELECT
          c.id                AS cliente_id,
          c.nombre            AS nombre_cliente,
          c.documento,
          p.id                AS producto_id,
          p.referencia,
          p.tipo              AS tipo_producto,
          p.monto_capital,
          COUNT(cu.id)::int   AS cuotas_pendientes,
          MIN(cu.fecha_vencimiento)::text AS proxima_fecha,
          COALESCE(SUM(
            cu.abono_interes * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
          ), 0) AS interes_proyectado
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        JOIN ${S}.cred_clientes  c ON c.id = p.cliente_id
        WHERE cu.estado IN ('pendiente','parcial')
          AND p.estado IN ('activo','al_dia','en_mora')
          AND p.tipo <> 'congelacion'
          AND cu.fecha_vencimiento != '2099-12-31'
          ${filtroRango}
        GROUP BY c.id, c.nombre, c.documento, p.id, p.referencia, p.tipo, p.monto_capital
        ORDER BY interes_proyectado DESC
      `, params),

      // Créditos libres — datos para calcular interés 30/360 hasta `hasta`
      // inicio_periodo = último corte registrado, o fecha_primer_pago si no hay cortes
      query(`
        SELECT
          p.id,
          p.referencia,
          p.tasa_interes,
          p.periodo_tasa,
          c.nombre            AS nombre_cliente,
          c.id                AS cliente_id,
          c.documento,
          (p.monto_capital - COALESCE(cap.capital_pagado, 0)) AS capital_pendiente,
          COALESCE(
            MAX(pg.fecha_corte_interes)::text,
            p.fecha_primer_pago::text
          ) AS inicio_periodo
        FROM ${S}.cred_productos p
        LEFT JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
        LEFT JOIN (
          SELECT producto_id, SUM(monto_capital) AS capital_pagado
          FROM ${S}.cred_pagos WHERE monto_capital > 0 GROUP BY producto_id
        ) cap ON cap.producto_id = p.id
        LEFT JOIN ${S}.cred_pagos pg
          ON pg.producto_id = p.id AND pg.fecha_corte_interes IS NOT NULL
        WHERE p.tipo = 'credito_libre'
          AND p.estado NOT IN ('saldado','refinanciado','decomisado')
        GROUP BY p.id, p.referencia, p.tasa_interes, p.periodo_tasa,
                 c.nombre, c.id, c.documento, p.monto_capital, cap.capital_pagado, p.fecha_primer_pago
        ORDER BY nombre_cliente
      `),
    ])

    // Créditos normales
    const normales = normalesResult.rows.map(r => ({
      cliente_id:         r.cliente_id,
      nombre_cliente:     r.nombre_cliente,
      documento:          r.documento,
      producto_id:        r.producto_id,
      referencia:         r.referencia,
      tipo_producto:      r.tipo_producto,
      monto_capital:      parseFloat(r.monto_capital),
      cuotas_pendientes:  r.cuotas_pendientes,
      proxima_fecha:      r.proxima_fecha,
      interes_proyectado: parseFloat(r.interes_proyectado),
    }))

    // Créditos libres — interés calculado en JS con 30/360 si hay fecha hasta
    const libres = hasta
      ? libresResult.rows.map(r => {
          const capital = parseFloat(r.capital_pendiente)
          const interes = calcInteresCL(
            capital,
            parseFloat(r.tasa_interes),
            r.periodo_tasa,
            r.inicio_periodo,
            hasta
          )
          return {
            cliente_id:         r.cliente_id,
            nombre_cliente:     r.nombre_cliente || '—',
            documento:          r.documento || '—',
            producto_id:        r.id,
            referencia:         r.referencia,
            tasa_interes:       parseFloat(r.tasa_interes),
            periodo_tasa:       r.periodo_tasa,
            capital_pendiente:  capital,
            inicio_periodo:     r.inicio_periodo,
            fecha_corte:        hasta,
            dias_calculados:    Math.max(0, diasD360(r.inicio_periodo, hasta)),
            interes_proyectado: interes,
          }
        }).filter(r => r.interes_proyectado > 0)
      : []   // sin fecha hasta → no se puede calcular

    return NextResponse.json({
      normales,
      libres,
      totales: {
        interes_normales: normales.reduce((s, r) => s + r.interes_proyectado, 0),
        interes_libres:   libres.reduce((s, r)   => s + r.interes_proyectado, 0),
        total:            normales.reduce((s, r) => s + r.interes_proyectado, 0) +
                          libres.reduce((s, r)   => s + r.interes_proyectado, 0),
        fecha_corte_libres: hasta,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
