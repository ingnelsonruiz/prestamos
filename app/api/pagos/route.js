import { NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

const CUOTAS_POR_MES = { diario: 30, semanal: 4, quincenal: 2, mensual: 1, anual: 1 / 12 }

// `q` permite ejecutar dentro de una transacción (cliente único del pool);
// por defecto usa la query global (sin transacción).
async function recalcularCuotasPlano(productoId, snapshotInfo = null, q = query) {
  // 1 solo round trip a la BD: producto + capital pagado + pendientes + total
  const ctxRes = await q(
    `SELECT
       (SELECT row_to_json(pr) FROM (
          SELECT monto_capital, tasa_interes, periodo_tasa, frecuencia_cobro, metodo_calculo
          FROM ${S}.cred_productos WHERE id = $1) pr)                          AS prod,
       (SELECT COALESCE(SUM(monto_capital::numeric), 0)
          FROM ${S}.cred_pagos WHERE producto_id = $1)                         AS capital_pagado,
       (SELECT COALESCE(json_agg(json_build_object(
            'id', id, 'numero_cuota', numero_cuota, 'monto_pagado', monto_pagado,
            'abono_interes', abono_interes, 'abono_capital', abono_capital,
            'monto_cuota', monto_cuota) ORDER BY numero_cuota), '[]'::json)
          FROM ${S}.cred_cuotas
          WHERE producto_id = $1 AND estado != 'pagada')                       AS pendientes,
       (SELECT COUNT(*) FROM ${S}.cred_cuotas WHERE producto_id = $1)          AS total_cuotas`,
    [productoId]
  )

  const ctx  = ctxRes.rows[0]
  const prod = typeof ctx.prod === 'string' ? JSON.parse(ctx.prod) : ctx.prod
  if (!prod || prod.metodo_calculo !== 'plano') return

  const capitalPagado = parseFloat(ctx.capital_pagado)
  const saldoCapital  = Math.round(parseFloat(prod.monto_capital) - capitalPagado)
  if (saldoCapital <= 0) return

  let pending = typeof ctx.pendientes === 'string' ? JSON.parse(ctx.pendientes) : ctx.pendientes
  if (!pending.length) return

  const numCuotasTotal = parseInt(ctx.total_cuotas)

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
    await q(
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
    await q(
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
    await q(
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

    // ── 1 solo round trip: cuota + pendientes + configuración ────────────
    const [ctxRes, u] = await Promise.all([
      query(
        `WITH ref AS (
           SELECT cu.* FROM ${S}.cred_cuotas cu
           JOIN ${S}.cred_productos p ON p.id = cu.producto_id
           WHERE cu.id = $1
         )
         SELECT
           (SELECT row_to_json(ref.*) FROM ref)                              AS cuota,
           (SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.numero_cuota), '[]'::json)
              FROM ${S}.cred_cuotas c
              WHERE c.producto_id = (SELECT producto_id FROM ref)
                AND c.estado != 'pagada')                                    AS pendientes,
           (SELECT valor FROM ${S}.cred_configuracion
             WHERE clave='modo_prueba' LIMIT 1)                              AS modo_prueba
        `, [cuota_id]
      ),
      getUsuarioDesdeRequest(request),
    ])

    const ctx = ctxRes.rows[0]
    const cuotaRef = typeof ctx?.cuota === 'string' ? JSON.parse(ctx.cuota) : ctx?.cuota
    if (!cuotaRef)
      return NextResponse.json({ error: 'Cuota no encontrada' }, { status: 404 })

    const pendientesRows = typeof ctx.pendientes === 'string' ? JSON.parse(ctx.pendientes) : ctx.pendientes
    const modoPrueba = ctx.modo_prueba === 'true'
    if (!modoPrueba && fecha_pago && fecha_pago > new Date().toISOString().split('T')[0])
      return NextResponse.json({ error: 'La fecha del pago no puede ser mayor a la fecha actual' }, { status: 400 })

    const cuotasPendientes = pendientesRows
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

    // ── Calcular distribución del pago (sin queries) ──────────────────────
    let restante = montoNum
    let capitalAbonado = 0
    const cuotasAplicadas = []
    const batchUpdates = []   // acumular para un solo UPDATE en batch

    for (let i = 0; i < cuotasPendientes.length; i++) {
      const c = cuotasPendientes[i]
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
      // Si la cuota quedó pagada y hay sobrante que NO cubre el total restante de cuotas
      // siguientes, ese sobrante es abono puro a capital: no se distribuye en intereses futuros.
      if (estadoC === 'pagada' && restante > 0.5) {
        const totalSiguientes = cuotasPendientes.slice(i + 1).reduce(
          (s, cx) => s + parseFloat(cx.monto_cuota) - parseFloat(cx.monto_pagado || 0), 0
        )
        if (restante < totalSiguientes - 0.5) {
          capitalAbonado += restante
          restante = 0
          break
        }
      }
    }

    const interesAbonado    = Math.round(montoNum - capitalAbonado)
    const capitalAbonadoRnd = Math.round(capitalAbonado)
    const fechaReal  = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()
    const pagoId     = uuidv4()
    const cuotasDesc = cuotasAplicadas.length > 1
      ? 'Cuotas #' + cuotasAplicadas[0].numero + '-#' + cuotasAplicadas[cuotasAplicadas.length - 1].numero
      : 'Cuota #' + (cuotasAplicadas[0]?.numero ?? cuotaRef.numero_cuota)

    // ── TRANSACCIÓN: consecutivo + cuotas + pago + caja + recálculo ───────
    // Todo o nada: si cualquier paso falla → ROLLBACK (no quedan cuotas
    // abonadas sin pago, ni recibo sin movimiento de caja, ni consecutivo
    // consumido con saltos de numeración).
    const { numeroRecibo, fin } = await withTransaction(async (q) => {

      // 0. Consecutivo atómico: lee e incrementa en una sola query.
      //    El bloqueo de fila serializa pagos concurrentes hasta el COMMIT.
      const consRes = await q(
        `UPDATE ${S}.cred_configuracion
         SET valor = (valor::int + 1)::text, actualizado_en = NOW()
         WHERE clave = 'recibo_consecutivo'
         RETURNING (valor::int - 1) AS consecutivo`
      )
      const consecutivo = parseInt(consRes.rows[0]?.consecutivo ?? '1')
      const numRecibo   = 'REC-' + String(consecutivo).padStart(6, '0')

      // 1. Batch UPDATE: todas las cuotas en una sola query
      if (batchUpdates.length > 0) {
        const placeholders = batchUpdates.map((_, i) =>
          `($${i*3+1}::numeric, $${i*3+2}::text, $${i*3+3}::text)`
        ).join(',')
        const params = batchUpdates.flatMap(b => [b.monto_pagado, b.estado, b.id])
        await q(
          `UPDATE ${S}.cred_cuotas AS cu
           SET monto_pagado = v.monto_pagado, estado = v.estado, dias_mora = 0
           FROM (VALUES ${placeholders}) AS v(monto_pagado, estado, id)
           WHERE cu.id = v.id`,
          params
        )
      }

      // 2. INSERT pago + INSERT caja (saldo_acumulado calculado en SQL)
      await q(
        `INSERT INTO ${S}.cred_pagos
          (id, cuota_id, producto_id, cliente_id, monto, monto_interes, monto_capital,
           fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [pagoId, cuota_id, cuotaRef.producto_id, cuotaRef.cliente_id,
         montoNum, interesAbonado, capitalAbonadoRnd, fechaReal,
         metodo_pago || 'efectivo', notas || null, numRecibo, u.nombre]
      )
      await q(
        `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
         VALUES ($1,'cobro_capital',$2,$3,$4,
           COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                     ORDER BY fecha DESC LIMIT 1), 0) + $2)`,
        [uuidv4(), montoNum, numRecibo + ' — ' + cuotasDesc, pagoId]
      )

      // 3. Recalcular cuotas (método plano) dentro de la misma transacción:
      //    sus lecturas ven las cuotas ya actualizadas por este mismo cliente.
      await recalcularCuotasPlano(cuotaRef.producto_id, {
        pagoId,
        numeroRecibo: numRecibo,
        capitalAbonado,
        totalPendienteAntesPago: totalPendiente,
      }, q)

      // 4. Cierre + chequeo de refinanciación en UNA sola query (CTE)
      const finRes = await q(
        `WITH stats AS (
           SELECT COUNT(*) FILTER (WHERE estado != 'pagada')::int               AS pendientes,
                  MAX(numero_cuota)                                             AS max_cuota,
                  COALESCE(SUM(GREATEST(0, monto_pagado::numeric - abono_interes::numeric)), 0) AS capital_pagado
           FROM ${S}.cred_cuotas WHERE producto_id = $1
         ), upd AS (
           UPDATE ${S}.cred_productos SET estado='saldado'
           WHERE id = $1 AND (SELECT pendientes FROM stats) = 0
           RETURNING 1
         )
         SELECT s.pendientes, s.max_cuota,
                (SELECT monto_capital::numeric FROM ${S}.cred_productos WHERE id = $1)
                  - s.capital_pagado AS capital_pendiente
         FROM stats s`,
        [cuotaRef.producto_id]
      )

      return { numeroRecibo: numRecibo, fin: finRes.rows[0] }
    })

    // Detectar si se pagaron intereses de la ÚLTIMA cuota pero queda capital pendiente
    // → solo aplica cuando la cuota que se acaba de pagar ES la última del crédito
    // → NO debe dispararse al pagar cuotas intermedias aunque la última siga pendiente
    let requiereRefinanciacion = false
    let capitalPendiente = 0
    if (parseInt(fin?.pendientes || 0) > 0) {
      // La cuota procesada debe SER la última del crédito (no solo que la última esté pendiente)
      const cuotaEsUltima = fin.max_cuota !== null &&
        parseInt(cuotaRef.numero_cuota) === parseInt(fin.max_cuota)
      if (cuotaEsUltima) {
        capitalPendiente = Math.round(parseFloat(fin.capital_pendiente || 0))
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
