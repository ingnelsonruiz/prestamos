import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'
const CUOTAS_POR_MES = { diario: 30, semanal: 4, quincenal: 2, mensual: 1, anual: 1 / 12 }

// ─────────────────────────────────────────────────────────────────────────────
// recalcularCuotasPlano  —  copia fiel del original en /api/pagos/route.js
// Aquí se invoca con interes_fijo=FALSE ya actualizado en BD, por lo que
// baseInteres = saldoCapital (interés decreciente correcto).
// No se genera snapshot (snapshotInfo = null) para no contaminar el historial
// con un evento artificial sin recibo real.
// ─────────────────────────────────────────────────────────────────────────────
async function recalcularCuotasPlano(productoId) {
  const [prodRes, capRes, pendRes] = await Promise.all([
    query(
      `SELECT monto_capital, tasa_interes, periodo_tasa, frecuencia_cobro, metodo_calculo, interes_fijo
       FROM ${S}.cred_productos WHERE id = $1`, [productoId]
    ),
    query(
      `SELECT COALESCE(SUM(GREATEST(0, monto_pagado::numeric - abono_interes::numeric)), 0) AS capital_pagado
       FROM ${S}.cred_cuotas WHERE producto_id = $1`, [productoId]
    ),
    query(
      `SELECT id, numero_cuota, monto_pagado, abono_interes, abono_capital, monto_cuota
       FROM ${S}.cred_cuotas
       WHERE producto_id = $1 AND estado != 'pagada'
       ORDER BY numero_cuota ASC`, [productoId]
    ),
  ])

  const prod = prodRes.rows[0]
  if (!prod || prod.metodo_calculo !== 'plano') return

  const capitalPagado = parseFloat(capRes.rows[0].capital_pagado)
  const saldoCapital  = Math.round(parseFloat(prod.monto_capital) - capitalPagado)

  if (saldoCapital <= 0) {
    await query(
      `UPDATE ${S}.cred_cuotas SET estado = 'pagada', saldo_pendiente = 0
       WHERE producto_id = $1 AND estado != 'pagada'`, [productoId]
    )
    return
  }

  let pending = pendRes.rows
  if (!pending.length) return

  const cpmO    = CUOTAS_POR_MES[prod.periodo_tasa]    || 1
  const cpmD    = CUOTAS_POR_MES[prod.frecuencia_cobro] || 1
  const tasaPer = (parseFloat(prod.tasa_interes) / 100) * cpmO / cpmD

  // Con interes_fijo=FALSE (ya aplicado en BD), baseInteres = saldoCapital decreciente
  const baseInteres = prod.interes_fijo ? parseFloat(prod.monto_capital) : saldoCapital

  // ── Pre-filtro iterativo (idéntico al original) ──────────────────────────
  let n, interesTotal, totalAPagar, cuotaBase, cuotaResiduo, capBase, capResiduo

  while (true) {
    n = pending.length
    if (n === 0) return
    interesTotal = Math.round(baseInteres * tasaPer * n)
    totalAPagar  = saldoCapital + interesTotal
    cuotaBase    = Math.floor(totalAPagar / n)
    cuotaResiduo = totalAPagar - cuotaBase * n
    capBase      = Math.floor(saldoCapital / n)
    capResiduo   = saldoCapital - capBase * n

    const toMarkOverpaid = pending.filter((c, i) => {
      const isLast = i === pending.length - 1
      if (isLast && pending.length === 1 && saldoCapital > 0.5) return false
      const newMonto = isLast ? cuotaBase + cuotaResiduo : cuotaBase
      return parseFloat(c.monto_pagado || 0) >= newMonto
    })

    const toMarkInterest = pending.filter((c, i) => {
      const isLast = i === pending.length - 1
      if (isLast) return false
      return (
        parseFloat(c.monto_pagado || 0) >= parseFloat(c.abono_interes || 0) &&
        parseFloat(c.monto_pagado || 0) > 0.5 &&
        !toMarkOverpaid.find(m => m.id === c.id)
      )
    })

    const toMark = [...toMarkOverpaid, ...toMarkInterest]
    if (toMark.length === 0) break

    const ph = toMark.map((_, i) => `($${i*3+1}::numeric, $${i*3+2}::numeric, $${i*3+3}::text)`).join(',')
    const pm = toMark.flatMap(c => {
      const mpagado = parseFloat(c.monto_pagado || 0)
      const aCap    = Math.max(0, mpagado - parseFloat(c.abono_interes || 0))
      return [mpagado, aCap, c.id]
    })
    await query(
      `UPDATE ${S}.cred_cuotas AS cu
       SET monto_cuota = v.monto_cuota, abono_capital = v.abono_capital,
           saldo_pendiente = 0, estado = 'pagada'
       FROM (VALUES ${ph}) AS v(monto_cuota, abono_capital, id)
       WHERE cu.id = v.id`, pm
    )
    pending = pending.filter(c => !toMark.some(m => m.id === c.id))
  }

  // ── Batch UPDATE de cuotas pendientes (idéntico al original) ────────────
  let saldoAcum = saldoCapital
  const batchPend = []

  for (let i = 0; i < pending.length; i++) {
    const c        = pending[i]
    const isLast   = i === pending.length - 1
    const yaPagado = parseFloat(c.monto_pagado || 0)

    if (isLast && pending.length === 1 && saldoCapital > 0.5) {
      const periodInt    = Math.round(baseInteres * tasaPer)
      const intYaPagado  = Math.min(yaPagado, parseFloat(c.abono_interes || 0))
      const intPendiente = Math.max(0, periodInt - intYaPagado)
      const saldoPend    = saldoCapital + intPendiente
      const newMonto     = yaPagado + saldoPend
      const newInt       = intYaPagado + intPendiente
      const newCap       = newMonto - newInt
      const estado       = yaPagado > 0.5 ? 'parcial' : 'pendiente'
      batchPend.push({ id: c.id, newCap, newInt, newMonto, saldo: saldoPend, estado })
      continue
    }

    const newCap   = isLast ? capBase + capResiduo : capBase
    const newMonto = isLast ? cuotaBase + cuotaResiduo : cuotaBase
    const newInt   = newMonto - newCap
    saldoAcum     -= newCap
    const saldoPend = Math.max(0, newMonto - yaPagado)
    const nuevoEst  = saldoPend <= 0 ? 'pagada' : yaPagado > 0 ? 'parcial' : 'pendiente'
    batchPend.push({ id: c.id, newCap, newInt, newMonto, saldo: Math.max(0, saldoAcum), estado: nuevoEst })
  }

  if (batchPend.length > 0) {
    const ph2 = batchPend.map((_, i) => {
      const b = i * 6
      return `($${b+1}::numeric,$${b+2}::numeric,$${b+3}::numeric,$${b+4}::numeric,$${b+5}::text,$${b+6}::text)`
    }).join(',')
    const pm2 = batchPend.flatMap(r => [r.newCap, r.newInt, r.newMonto, r.saldo, r.estado, r.id])
    await query(
      `UPDATE ${S}.cred_cuotas AS cu
       SET abono_capital    = v.abono_capital,
           abono_interes    = v.abono_interes,
           monto_cuota      = v.monto_cuota,
           saldo_pendiente  = v.saldo_pendiente,
           estado           = v.estado
       FROM (VALUES ${ph2}) AS v(abono_capital, abono_interes, monto_cuota, saldo_pendiente, estado, id)
       WHERE cu.id = v.id`, pm2
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  — Lista créditos con interes_fijo=TRUE que pueden ser revertidos
// Excluye: congelaciones (tasa=0 siempre), créditos libres (motor propio),
//          saldados / refinanciados / decomisados
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const res = await query(
      `SELECT
         p.id,
         p.referencia,
         p.tipo,
         p.monto_capital,
         p.tasa_interes,
         p.periodo_tasa,
         p.frecuencia_cobro,
         p.num_cuotas,
         p.metodo_calculo,
         p.estado,
         p.fecha_creacion,
         COALESCE(c.nombre, '— préstamo interno —') AS nombre_cliente,
         c.documento,
         -- Cuotas pendientes de recibir
         COUNT(cu.id) FILTER (WHERE cu.estado != 'pagada') AS cuotas_pendientes,
         -- Capital pendiente real (abono_capital de cuotas no pagadas)
         COALESCE(
           SUM(cu.abono_capital) FILTER (WHERE cu.estado != 'pagada'), 0
         ) AS capital_pendiente,
         -- Interés pendiente
         COALESCE(
           SUM(
             GREATEST(0, cu.abono_interes - LEAST(cu.monto_pagado, cu.abono_interes))
           ) FILTER (WHERE cu.estado != 'pagada'), 0
         ) AS interes_pendiente
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_clientes c  ON c.id = p.cliente_id
       LEFT JOIN ${S}.cred_cuotas   cu ON cu.producto_id = p.id
       WHERE p.interes_fijo = TRUE
         AND p.tipo         != 'congelacion'
         AND p.tipo         != 'credito_libre'
         AND p.metodo_calculo = 'plano'
         AND p.estado NOT IN ('saldado','decomisado','refinanciado')
       GROUP BY p.id, c.nombre, c.documento
       ORDER BY p.fecha_creacion ASC`,
      []
    )

    return NextResponse.json({
      total: res.rows.length,
      creditos: res.rows,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST  — Ejecuta el reverso: interes_fijo=FALSE + recalcularCuotasPlano
// Body: { productoIds: string[] }   — uno o varios IDs a corregir
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const u = await getUsuarioDesdeRequest(request)
    const { productoIds } = await request.json()

    if (!Array.isArray(productoIds) || productoIds.length === 0)
      return NextResponse.json({ error: 'productoIds debe ser un array no vacío' }, { status: 400 })

    // Verificar que todos existen y son elegibles (seguridad extra)
    const placeholders = productoIds.map((_, i) => `$${i + 1}`).join(',')
    const elegiblesRes = await query(
      `SELECT id, referencia FROM ${S}.cred_productos
       WHERE id IN (${placeholders})
         AND interes_fijo     = TRUE
         AND tipo            != 'congelacion'
         AND tipo            != 'credito_libre'
         AND metodo_calculo   = 'plano'
         AND estado NOT IN ('saldado','decomisado','refinanciado')`,
      productoIds
    )

    const elegibles = elegiblesRes.rows
    if (elegibles.length === 0)
      return NextResponse.json({ error: 'Ninguno de los créditos indicados es elegible para reverso' }, { status: 400 })

    const idsElegibles = elegibles.map(r => r.id)
    const refs = elegibles.map(r => r.referencia).join(', ')

    // 1. Apagar el flag en batch
    const phIds = idsElegibles.map((_, i) => `$${i + 1}`).join(',')
    await query(
      `UPDATE ${S}.cred_productos SET interes_fijo = FALSE WHERE id IN (${phIds})`,
      idsElegibles
    )

    // 2. Recalcular cuotas pendientes para cada crédito (secuencial, seguro)
    const resultados = []
    for (const id of idsElegibles) {
      try {
        await recalcularCuotasPlano(id)
        resultados.push({ id, ok: true })
      } catch (err) {
        resultados.push({ id, ok: false, error: err.message })
      }
    }

    const corregidos = resultados.filter(r => r.ok).length
    const errores    = resultados.filter(r => !r.ok).length

    // Auditoría
    await auditar({
      ...u,
      accion:      ACCIONES.ACTUALIZAR || 'actualizar',
      modulo:      MODULOS.CONFIGURACION || 'configuracion',
      descripcion: `Reverso masivo interes_fijo: ${corregidos} crédito(s) corregido(s) — ${refs}`,
      detalle:     { productoIds: idsElegibles, corregidos, errores, resultados }
    }).catch(err => console.error('[auditoría fix-interes-fijo]', err.message))

    return NextResponse.json({
      ok:         errores === 0,
      corregidos,
      errores,
      resultados,
      refs,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
