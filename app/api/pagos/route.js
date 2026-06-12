import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'
const CUOTAS_POR_MES = { diario: 30, semanal: 4, quincenal: 2, mensual: 1, anual: 1 / 12 }

async function recalcularCuotasPlano(productoId, snapshotInfo = null) {
  // Paralelo: las 4 queries iniciales al mismo tiempo
  const [prodRes, capRes, pendRes, totalCuotasRes] = await Promise.all([
    query(
      `SELECT monto_capital, tasa_interes, periodo_tasa, frecuencia_cobro, metodo_calculo
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
    query(
      `SELECT COUNT(*) AS total FROM ${S}.cred_cuotas WHERE producto_id = $1`, [productoId]
    ),
  ])

  const prod = prodRes.rows[0]
  if (!prod || prod.metodo_calculo !== 'plano') return

  const capitalPagado = parseFloat(capRes.rows[0].capital_pagado)
  const saldoCapital  = Math.round(parseFloat(prod.monto_capital) - capitalPagado)
  if (saldoCapital <= 0) return

  let pending = pendRes.rows
  if (!pending.length) return

  const numCuotasTotal = parseInt(totalCuotasRes.rows[0].total)

  const cpmO    = CUOTAS_POR_MES[prod.periodo_tasa]    || 1
  const cpmD    = CUOTAS_POR_MES[prod.frecuencia_cobro] || 1
  const tasaPer = (parseFloat(prod.tasa_interes) / 100) * cpmO / cpmD

  const capitalAbonado      = snapshotInfo?.capitalAbonado || 0
  const debeSnapshot        = capitalAbonado > 0.5 && snapshotInfo
  const antesN              = pending.length
  const antesInteres        = pending.reduce((s, c) => s + parseFloat(c.abono_interes || 0), 0)
  const antesMontoCuota     = parseFloat(pending[0]?.monto_cuota || 0)
  const antesTotalPendiente = snapshotInfo?.totalPendienteAntesPago
    ?? pending.reduce((s, c) => s + Math.max(0, parseFloat(c.monto_cuota || 0) - parseFloat(c.monto_pagado || 0)), 0)
  const capitalSaldoAntes   = saldoCapital + capitalAbonado

  // ─────────────────────────────────────────────────────────────
  // Pre-filtro iterativo: cierra cuotas que ya cumplieron su ciclo
  //
  // Regla 1: monto_pagado >= nueva cuota recalculada (sobrepagada)
  //
  // Regla 2: monto_pagado >= abono_interes pactado (interés cobrado)
  //   El interés del período ya fue recogido → cuota se cierra y su
  //   capital pendiente se absorbe en el saldo global.
  //   IMPORTANTE: nunca se cierra la ÚLTIMA cuota por esta regla.
  //   Debe quedar al menos una cuota para representar el capital
  //   pendiente y evitar que el crédito se marque como saldado
  //   sin haber cobrado el capital.
  // ─────────────────────────────────────────────────────────────
  let n, interesTotal, totalAPagar, cuotaBase, cuotaResiduo, capBase, capResiduo

  while (true) {
    n = pending.length
    if (n === 0) return
    interesTotal = Math.round(saldoCapital * tasaPer * n)
    totalAPagar  = saldoCapital + interesTotal
    cuotaBase    = Math.floor(totalAPagar / n)
    cuotaResiduo = totalAPagar - cuotaBase * n
    capBase      = Math.floor(saldoCapital / n)
    capResiduo   = saldoCapital - capBase * n

    // Regla 1: sobrepagadas respecto a la nueva cuota recalculada
    const toMarkOverpaid = pending.filter((c, i) => {
      const isLast   = i === pending.length - 1
      const newMonto = isLast ? cuotaBase + cuotaResiduo : cuotaBase
      return parseFloat(c.monto_pagado || 0) >= newMonto
    })

    // Regla 2: interés cobrado → cerrar, salvo que sea la última cuota pendiente
    // (la última cuota nunca se cierra por interés solo; debe pagarse capital)
    const toMarkInterest = pending.filter((c, i) => {
      const isLast = i === pending.length - 1
      if (isLast) return false  // protege la última cuota de cierre prematuro
      return (
        parseFloat(c.monto_pagado || 0) >= parseFloat(c.abono_interes || 0) &&
        parseFloat(c.monto_pagado || 0) > 0.5 &&
        !toMarkOverpaid.find(m => m.id === c.id)
      )
    })

    const toMark = [...toMarkOverpaid, ...toMarkInterest]
    if (toMark.length === 0) break

    // Batch UPDATE: cerrar todas las cuotas marcadas en una sola query
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
       WHERE cu.id = v.id`,
      pm
    )
    pending = pending.filter(c => !toMark.some(m => m.id === c.id))
  }

  // Calcular todos los valores en memoria, luego un solo batch UPDATE
  let saldoAcum = saldoCapital
  const batchPend = []
  for (let i = 0; i < pending.length; i++) {
    const c      = pending[i]
    const isLast = i === pending.length - 1
    const newCap   = isLast ? capBase + capResiduo : capBase
    const newMonto = isLast ? cuotaBase + cuotaResiduo : cuotaBase
    const newInt   = newMonto - newCap
    saldoAcum     -= newCap
    const yaPagado  = parseFloat(c.monto_pagado || 0)
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
       WHERE cu.id = v.id`,
      pm2
    )
  }

  if (debeSnapshot) {
    await query(
      `INSERT INTO ${S}.cred_historial_recalculos
         (id, producto_id, tipo, capital_original,
          capital_saldo_antes, capital_saldo_despues, capital_abonado,
          interes_pendiente_antes, interes_pendiente_despues,
          num_cuotas_total, num_cuotas_antes, num_cuotas_despues,
          monto_cuota_antes, monto_cuota_despues,
          total_pendiente_antes, total_pendiente_despues,
          pago_id, numero_recibo)
       VALUES ($1,$2,'recalculo_capital',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        uuidv4(), productoId,
        parseFloat(prod.monto_capital),
        capitalSaldoAntes,
        saldoCapital,
        capitalAbonado,
        antesInteres,
        interesTotal,
        numCuotasTotal,
        antesN,
        n,
        antesMontoCuota,
        cuotaBase,
        antesTotalPendiente,
        totalAPagar,
        snapshotInfo.pagoId,
        snapshotInfo.numeroRecibo,
      ]
    )
  }
}

export async function POST(request) {
  try {
    const { cuota_id, monto, metodo_pago, notas, fecha_pago } = await request.json()
    if (!cuota_id || !monto || monto <= 0)
      return NextResponse.json({ error: 'cuota_id y monto son obligatorios' }, { status: 400 })

    const cuotaRes = await query(
      `SELECT cu.*, p.cliente_id FROM ${S}.cred_cuotas cu
       JOIN ${S}.cred_productos p ON p.id = cu.producto_id WHERE cu.id=$1`, [cuota_id]
    )
    if (!cuotaRes.rows.length)
      return NextResponse.json({ error: 'Cuota no encontrada' }, { status: 404 })
    const cuotaRef = cuotaRes.rows[0]

    // ── Paralelo 1: 3 queries independientes al mismo tiempo ─────────────
    const [modoPruebaRes, pendientesRes, confRes, u] = await Promise.all([
      query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='modo_prueba'`),
      query(
        `SELECT * FROM ${S}.cred_cuotas
         WHERE producto_id = $1 AND estado != 'pagada'
         ORDER BY numero_cuota ASC`,
        [cuotaRef.producto_id]
      ),
      query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='recibo_consecutivo'`),
      getUsuarioDesdeRequest(request),
    ])

    const modoPrueba = modoPruebaRes.rows[0]?.valor === 'true'
    if (!modoPrueba && fecha_pago && fecha_pago > new Date().toISOString().split('T')[0])
      return NextResponse.json({ error: 'La fecha del pago no puede ser mayor a la fecha actual' }, { status: 400 })

    const cuotasPendientes = pendientesRes.rows
    const totalPendiente = cuotasPendientes.reduce(
      (s, c) => s + parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado || 0), 0
    )
    const montoNum = parseFloat(monto)

    if (montoNum > totalPendiente + 1) {
      const fmtCOP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
      return NextResponse.json({
        error: 'El monto (' + fmtCOP(montoNum) + ') supera el saldo pendiente (' + fmtCOP(totalPendiente) + ').'
      }, { status: 400 })
    }

    const consecutivo  = parseInt(confRes.rows[0]?.valor || '1')
    const numeroRecibo = 'REC-' + String(consecutivo).padStart(6, '0')

    // ── Calcular distribución del pago (sin queries) ──────────────────────
    let restante = montoNum
    let capitalAbonado = 0
    const cuotasAplicadas = []
    const batchUpdates = []

    for (const c of cuotasPendientes) {
      if (restante <= 0) break
      const saldoC  = parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado || 0)
      const aplicar = Math.min(restante, saldoC)
      const nuevoP  = parseFloat(c.monto_pagado || 0) + aplicar
      const yaInteresAbonado    = Math.min(parseFloat(c.monto_pagado || 0), parseFloat(c.abono_interes || 0))
      const interesPendiente    = Math.max(0, parseFloat(c.abono_interes || 0) - yaInteresAbonado)
      const interesEnAplicacion = Math.min(aplicar, interesPendiente)
      capitalAbonado += Math.max(0, aplicar - interesEnAplicacion)
      const estadoC = nuevoP >= parseFloat(c.monto_cuota) ? 'pagada' : 'parcial'
      batchUpdates.push({ id: c.id, monto_pagado: nuevoP, estado: estadoC })
      cuotasAplicadas.push({ numero: c.numero_cuota, aplicado: aplicar, estado: estadoC })
      restante -= aplicar
    }

    // ── Batch UPDATE: todas las cuotas en una sola query ──────────────────
    if (batchUpdates.length > 0) {
      const placeholders = batchUpdates.map((_, i) =>
        `($${i*3+1}::numeric, $${i*3+2}::text, $${i*3+3}::text)`
      ).join(',')
      const params = batchUpdates.flatMap(b => [b.monto_pagado, b.estado, b.id])
      await query(
        `UPDATE ${S}.cred_cuotas AS cu
         SET monto_pagado = v.monto_pagado, estado = v.estado, dias_mora = 0
         FROM (VALUES ${placeholders}) AS v(monto_pagado, estado, id)
         WHERE cu.id = v.id`,
        params
      )
    }

    const interesAbonado    = Math.round(montoNum - capitalAbonado)
    const capitalAbonadoRnd = Math.round(capitalAbonado)
    const fechaReal  = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()
    const pagoId     = uuidv4()
    const cuotasDesc = cuotasAplicadas.length > 1
      ? 'Cuotas #' + cuotasAplicadas[0].numero + '-#' + cuotasAplicadas[cuotasAplicadas.length - 1].numero
      : 'Cuota #' + (cuotasAplicadas[0]?.numero ?? cuotaRef.numero_cuota)

    // ── Paralelo 2: INSERT pago + saldo caja + UPDATE consecutivo ─────────
    const [, saldoRes] = await Promise.all([
      query(
        `INSERT INTO ${S}.cred_pagos
          (id, cuota_id, producto_id, cliente_id, monto, monto_interes, monto_capital,
           fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [pagoId, cuota_id, cuotaRef.producto_id, cuotaRef.cliente_id,
         montoNum, interesAbonado, capitalAbonadoRnd, fechaReal,
         metodo_pago || 'efectivo', notas || null, numeroRecibo, u.nombre]
      ),
      query(`SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 1`),
    ])

    const saldoAnt = parseFloat(saldoRes.rows[0]?.saldo_acumulado || 0)

    // ── Paralelo 3: INSERT caja + UPDATE consecutivo ──────────────────────
    await Promise.all([
      query(
        `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
         VALUES ($1,'cobro_capital',$2,$3,$4,$5)`,
        [uuidv4(), montoNum, numeroRecibo + ' — ' + cuotasDesc, pagoId, saldoAnt + montoNum]
      ),
      query(
        `UPDATE ${S}.cred_configuracion SET valor=$1, actualizado_en=NOW() WHERE clave='recibo_consecutivo'`,
        [String(consecutivo + 1)]
      ),
    ])

    await recalcularCuotasPlano(cuotaRef.producto_id, {
      pagoId,
      numeroRecibo,
      capitalAbonado,
      totalPendienteAntesPago: totalPendiente,
    })

    const sinPendientes = await query(
      `SELECT 1 FROM ${S}.cred_cuotas WHERE producto_id=$1 AND estado != 'pagada' LIMIT 1`,
      [cuotaRef.producto_id]
    )
    if (!sinPendientes.rows.length)
      await query(`UPDATE ${S}.cred_productos SET estado='saldado' WHERE id=$1`, [cuotaRef.producto_id])

    // Detectar si se pagaron intereses de la ÚLTIMA cuota pero queda capital pendiente
    // → solo aplica cuando la cuota que se acaba de pagar ES la última del crédito
    // → NO debe dispararse al pagar cuotas intermedias aunque la última siga pendiente
    let requiereRefinanciacion = false
    let capitalPendiente = 0
    if (sinPendientes.rows.length > 0) {
      const maxRes = await query(
        `SELECT MAX(numero_cuota) AS max_total FROM ${S}.cred_cuotas WHERE producto_id = $1`,
        [cuotaRef.producto_id]
      )
      const { max_total } = maxRes.rows[0]
      const cuotaEsUltima = max_total !== null &&
        parseInt(cuotaRef.numero_cuota) === parseInt(max_total)
      if (cuotaEsUltima) {
        const capRes2 = await query(
          `SELECT p.monto_capital::numeric
                  - COALESCE(SUM(GREATEST(0, cu.monto_pagado::numeric - cu.abono_interes::numeric)), 0)
                  AS capital_pendiente
           FROM ${S}.cred_productos p
           LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id
           WHERE p.id = $1
           GROUP BY p.monto_capital`,
          [cuotaRef.producto_id]
        )
        capitalPendiente = Math.round(parseFloat(capRes2.rows[0]?.capital_pendiente || 0))
        requiereRefinanciacion = capitalPendiente > 1
      }
    }

    // Auditoría fire-and-forget — no retrasa la respuesta al cliente
    auditar({
      ...u, accion: ACCIONES.REGISTRAR_PAGO, modulo: MODULOS.COBROS,
      descripcion: 'Pago ' + numeroRecibo + ': $' + montoNum.toLocaleString('es-CO') + ' — ' + cuotasDesc + ' (' + cuotasAplicadas.length + ' cuota' + (cuotasAplicadas.length > 1 ? 's' : '') + ')',
      detalle: { pagoId, cuota_id, monto: montoNum, monto_interes: interesAbonado, monto_capital: capitalAbonadoRnd, metodo_pago, numero_recibo: numeroRecibo, cuotas_aplicadas: cuotasAplicadas }
    }).catch(err => console.error('[auditoría pago]', err.message))

    return NextResponse.json({
      ok: true,
      numero_recibo:           numeroRecibo,
      cuotas_aplicadas:        cuotasAplicadas.length,
      estado_cuota:            cuotasAplicadas[0]?.estado,
      requiere_refinanciacion: requiereRefinanciacion,
      capital_pendiente:       capitalPendiente,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const productoId = searchParams.get('producto_id')
    const clienteId  = searchParams.get('cliente_id')
    const fecha      = searchParams.get('fecha')

    let sql = `
      SELECT pg.*, cu.numero_cuota, cu.monto_cuota,
             c.nombre AS nombre_cliente, c.documento
      FROM ${S}.cred_pagos pg
      JOIN ${S}.cred_cuotas  cu ON cu.id  = pg.cuota_id
      JOIN ${S}.cred_clientes c  ON c.id  = pg.cliente_id
      WHERE 1=1`
    const values = []
    if (productoId) { sql += ` AND pg.producto_id=$${values.length+1}`; values.push(productoId) }
    if (clienteId)  { sql += ` AND pg.cliente_id=$${values.length+1}`;  values.push(clienteId) }
    if (fecha)      { sql += ` AND pg.fecha_pago::date=$${values.length+1}`; values.push(fecha) }
    sql += ` ORDER BY cu.numero_cuota ASC, pg.numero_recibo ASC`

    const result = await query(sql, values)
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
