import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function POST(request, { params }) {
  try {
    const { id } = params
    const { monto_acordado, metodo_pago, notas, fecha_pago, recoger_credito } = await request.json()

    if (!monto_acordado || parseFloat(monto_acordado) <= 0)
      return NextResponse.json({ error: 'El monto acordado debe ser mayor a cero' }, { status: 400 })

    // Verificar que el producto existe y es liquidable
    const prodRes = await query(
      `SELECT p.*, c.nombre AS nombre_cliente
       FROM ${S}.cred_productos p
       JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
       WHERE p.id = $1`, [id]
    )
    if (!prodRes.rows.length)
      return NextResponse.json({ error: 'Crédito no encontrado' }, { status: 404 })

    const prod = prodRes.rows[0]
    if (['saldado', 'refinanciado', 'decomisado'].includes(prod.estado))
      return NextResponse.json({ error: `El crédito ya está en estado "${prod.estado}"` }, { status: 400 })

    // Cuotas pendientes
    const cuotasRes = await query(
      `SELECT * FROM ${S}.cred_cuotas
       WHERE producto_id = $1 AND estado != 'pagada'
       ORDER BY numero_cuota ASC`, [id]
    )
    const cuotasPendientes = cuotasRes.rows
    if (!cuotasPendientes.length)
      return NextResponse.json({ error: 'No hay cuotas pendientes — el crédito ya está saldado' }, { status: 400 })

    // Calcular saldo real pendiente
    const saldoReal = cuotasPendientes.reduce((s, c) =>
      s + parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado || 0), 0)

    // Saldo solo capital — proporcional para cuotas parciales
    // (misma lógica que el frontend para evitar discrepancias)
    const saldoCapitalPendiente = cuotasPendientes.reduce((s, c) => {
      const montoCuota   = parseFloat(c.monto_cuota || 0)
      const montoPagado  = parseFloat(c.monto_pagado || 0)
      const abonoCapital = parseFloat(c.abono_capital || 0)
      if (montoCuota <= 0) return s
      const proporcionPendiente = Math.max(0, (montoCuota - montoPagado) / montoCuota)
      return s + (abonoCapital * proporcionPendiente)
    }, 0)

    const montoAcordado = parseFloat(monto_acordado)

    // Validación: el monto acordado no puede ser menor al capital pendiente
    if (montoAcordado < saldoCapitalPendiente) {
      return NextResponse.json({
        error: `El valor acordado (${new Intl.NumberFormat('es-CO').format(montoAcordado)}) no puede ser menor al saldo de capital pendiente (${new Intl.NumberFormat('es-CO').format(saldoCapitalPendiente)}). Puede perdonar intereses, pero no el capital prestado.`
      }, { status: 400 })
    }

    const descuento = Math.max(0, saldoReal - montoAcordado)

    // ── Generar número de recibo ──────────────────────────────────────────
    const confRes    = await query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='recibo_consecutivo'`)
    const consecutivo = parseInt(confRes.rows[0]?.valor || '1')
    const numeroRecibo = `REC-${String(consecutivo).padStart(6, '0')}`

    // ── Registrar el pago de liquidación ─────────────────────────────────
    const pagoId    = uuidv4()
    const fechaReal = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()
    const u         = await getUsuarioDesdeRequest(request)

    // Asociar el pago a la primera cuota pendiente
    const cuotaRef = cuotasPendientes[0]
    await query(
      `INSERT INTO ${S}.cred_pagos
        (id, cuota_id, producto_id, cliente_id, monto, fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [pagoId, cuotaRef.id, id, prod.cliente_id,
       montoAcordado, fechaReal, metodo_pago || 'efectivo',
       `LIQUIDACIÓN ANTICIPADA${notas ? ' — ' + notas : ''}${descuento > 0 ? ` | Descuento aplicado: ${new Intl.NumberFormat('es-CO').format(descuento)}` : ''}`,
       numeroRecibo, u.nombre]
    )

    // ── Cerrar cuotas pendientes ──────────────────────────────────────────
    if (recoger_credito) {
      // Marcar como pagada solo la primera cuota (la que recibió el pago real)
      await query(
        `UPDATE ${S}.cred_cuotas
         SET estado='pagada', monto_pagado=monto_cuota, dias_mora=0
         WHERE id=$1`, [cuotaRef.id]
      )
      // Eliminar las cuotas restantes que nunca recibieron ningún pago
      await query(
        `DELETE FROM ${S}.cred_cuotas
         WHERE producto_id=$1 AND estado != 'pagada' AND (monto_pagado IS NULL OR monto_pagado = 0)`,
        [id]
      )
      // Las parciales (si las hay) también se cierran
      await query(
        `UPDATE ${S}.cred_cuotas
         SET estado='pagada', monto_pagado=monto_cuota, dias_mora=0
         WHERE producto_id=$1 AND estado != 'pagada'`, [id]
      )
    } else {
      // Liquidación anticipada normal: marcar todas como pagadas
      await query(
        `UPDATE ${S}.cred_cuotas
         SET estado='pagada', monto_pagado=monto_cuota, dias_mora=0
         WHERE producto_id=$1 AND estado != 'pagada'`, [id]
      )
    }

    // ── Marcar producto como saldado ─────────────────────────────────────
    await query(
      `UPDATE ${S}.cred_productos SET estado='saldado' WHERE id=$1`, [id]
    )

    // ── Movimiento de caja ────────────────────────────────────────────────
    const saldoRes = await query(`SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 1`)
    const saldoAnt = parseFloat(saldoRes.rows[0]?.saldo_acumulado || 0)
    await query(
      `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
       VALUES ($1,'cobro_capital',$2,$3,$4,$5)`,
      [uuidv4(), montoAcordado,
       `${numeroRecibo} — Liquidación anticipada ${prod.nombre_cliente}`,
       pagoId, saldoAnt + montoAcordado]
    )

    // ── Actualizar consecutivo de recibo ──────────────────────────────────
    await query(
      `UPDATE ${S}.cred_configuracion SET valor=$1, actualizado_en=NOW() WHERE clave='recibo_consecutivo'`,
      [String(consecutivo + 1)]
    )

    // ── Auditoría ─────────────────────────────────────────────────────────
    await auditar({
      ...u,
      accion:      'Liquidación anticipada',
      modulo:      MODULOS.COBROS,
      descripcion: `Liquidó crédito de ${prod.nombre_cliente}: acordado ${new Intl.NumberFormat('es-CO').format(montoAcordado)}, saldo real ${new Intl.NumberFormat('es-CO').format(saldoReal)}, descuento ${new Intl.NumberFormat('es-CO').format(descuento)}`,
      detalle:     { productoId: id, montoAcordado, saldoReal, descuento, cuotasCerradas: cuotasPendientes.length, numeroRecibo }
    })

    return NextResponse.json({
      ok: true,
      numero_recibo:    numeroRecibo,
      monto_acordado:   montoAcordado,
      saldo_real:       saldoReal,
      descuento:        descuento,
      cuotas_cerradas:  cuotasPendientes.length,
    }, { status: 200 })

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
