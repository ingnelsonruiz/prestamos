import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

const CUOTAS_POR_MES = { diario: 30, semanal: 4, quincenal: 2, mensual: 1, anual: 1 / 12 }

async function recalcularCuotasPlano(productoId, snapshotInfo = null) {
  const prodRes = await query(
    `SELECT monto_capital, tasa_interes, periodo_tasa, frecuencia_cobro, metodo_calculo
     FROM ${S}.cred_productos WHERE id = $1`, [productoId]
  )
  const prod = prodRes.rows[0]
  if (!prod || prod.metodo_calculo !== 'plano') return

  const capRes = await query(
    `SELECT COALESCE(SUM(GREATEST(0, monto_pagado::numeric - abono_interes::numeric)), 0) AS capital_pagado
     FROM ${S}.cred_cuotas WHERE producto_id = $1`, [productoId]
  )
  const capitalPagado = parseFloat(capRes.rows[0].capital_pagado)
  const saldoCapital  = Math.round(parseFloat(prod.monto_capital) - capitalPagado)
  if (saldoCapital <= 0) return

  const pendRes = await query(
    `SELECT id, numero_cuota, monto_pagado, abono_interes, abono_capital, monto_cuota
     FROM ${S}.cred_cuotas
     WHERE producto_id = $1 AND estado != 'pagada'
     ORDER BY numero_cuota ASC`, [productoId]
  )
  let pending = pendRes.rows
  if (!pending.length) return

  const totalCuotasRes = await query(
    `SELECT COUNT(*) AS total FROM ${S}.cred_cuotas WHERE producto_id = $1`, [productoId]
  )
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

    for (const c of toMark) {
      const mpagado = parseFloat(c.monto_pagado || 0)
      const aCap    = Math.max(0, mpagado - parseFloat(c.abono_interes || 0))
      await query(
        `UPDATE ${S}.cred_cuotas
         SET monto_cuota=$1, abono_capital=$2, saldo_pendiente=0, estado='pagada'
         WHERE id=$3`,
        [mpagado, aCap, c.id]
      )
    }
    pending = pending.filter(c => !toMark.some(m => m.id === c.id))
  }

  // Actualizar cuotas pendientes con valores recalculados
  let saldoAcum = saldoCapital
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
    await query(
      `UPDATE ${S}.cred_cuotas
       SET abono_capital=$1, abono_interes=$2, monto_cuota=$3,
           saldo_pendiente=$4, estado=$5
       WHERE id=$6`,
      [newCap, newInt, newMonto, Math.max(0, saldoAcum), nuevoEst, c.id]
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

    const modoPruebaRes = await query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='modo_prueba'`)
    const modoPrueba    = modoPruebaRes.rows[0]?.valor === 'true'
    if (!modoPrueba && fecha_pago && fecha_pago > new Date().toISOString().split('T')[0])
      return NextResponse.json({ error: 'La fecha del pago no puede ser mayor a la fecha actual' }, { status: 400 })

    const pendientesRes = await query(
      `SELECT * FROM ${S}.cred_cuotas
       WHERE producto_id = $1 AND estado != 'pagada'
       ORDER BY numero_cuota ASC`,
      [cuotaRef.producto_id]
    )
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

    const confRes      = await query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='recibo_consecutivo'`)
    const consecutivo  = parseInt(confRes.rows[0]?.valor || '1')
    const numeroRecibo = 'REC-' + String(consecutivo).padStart(6, '0')

    let restante = montoNum
    let capitalAbonado = 0
    const cuotasAplicadas = []

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
      await query(
        `UPDATE ${S}.cred_cuotas SET monto_pagado=$1, estado=$2, dias_mora=0 WHERE id=$3`,
        [nuevoP, estadoC, c.id]
      )
      cuotasAplicadas.push({ numero: c.numero_cuota, aplicado: aplicar, estado: estadoC })
      restante -= aplicar
    }

    const interesAbonado    = Math.round(montoNum - capitalAbonado)
    const capitalAbonadoRnd = Math.round(capitalAbonado)

    const fechaReal  = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()
    const u          = await getUsuarioDesdeRequest(request)
    const pagoId     = uuidv4()
    const cuotasDesc = cuotasAplicadas.length > 1
      ? 'Cuotas #' + cuotasAplicadas[0].numero + '-#' + cuotasAplicadas[cuotasAplicadas.length - 1].numero
      : 'Cuota #' + (cuotasAplicadas[0]?.numero ?? cuotaRef.numero_cuota)

    await query(
      `INSERT INTO ${S}.cred_pagos
        (id, cuota_id, producto_id, cliente_id, monto, monto_interes, monto_capital,
         fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [pagoId, cuota_id, cuotaRef.producto_id, cuotaRef.cliente_id,
       montoNum, interesAbonado, capitalAbonadoRnd, fechaReal,
       metodo_pago || 'efectivo', notas || null, numeroRecibo, u.nombre]
    )

    const saldoRes = await query(`SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 1`)
    const saldoAnt = parseFloat(saldoRes.rows[0]?.saldo_acumulado || 0)
    await query(
      `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
       VALUES ($1,'cobro_capital',$2,$3,$4,$5)`,
      [uuidv4(), montoNum, numeroRecibo + ' — ' + cuotasDesc, pagoId, saldoAnt + montoNum]
    )

    await query(
      `UPDATE ${S}.cred_configuracion SET valor=$1, actualizado_en=NOW() WHERE clave='recibo_consecutivo'`,
      [String(consecutivo + 1)]
    )

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

    await auditar({
      ...u, accion: ACCIONES.REGISTRAR_PAGO, modulo: MODULOS.COBROS,
      descripcion: 'Pago ' + numeroRecibo + ': $' + montoNum.toLocaleString('es-CO') + ' — ' + cuotasDesc + ' (' + cuotasAplicadas.length + ' cuota' + (cuotasAplicadas.length > 1 ? 's' : '') + ')',
      detalle: { pagoId, cuota_id, monto: montoNum, monto_interes: interesAbonado, monto_capital: capitalAbonadoRnd, metodo_pago, numero_recibo: numeroRecibo, cuotas_aplicadas: cuotasAplicadas }
    })

    return NextResponse.json({
      ok: true,
      numero_recibo:    numeroRecibo,
      cuotas_aplicadas: cuotasAplicadas.length,
      estado_cuota:     cuotasAplicadas[0]?.estado,
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
    sql += ` ORDER BY pg.fecha_pago DESC`

    const result = await query(sql, values)
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
