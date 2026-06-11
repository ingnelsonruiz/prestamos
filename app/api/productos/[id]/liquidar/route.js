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

    // ── RTT 1: producto + cuotas + usuario en paralelo ────────────────────
    const [ctxRes, u] = await Promise.all([
      query(
        `SELECT
           (SELECT row_to_json(p) FROM (
              SELECT pr.*, c.nombre AS nombre_cliente
              FROM ${S}.cred_productos pr
              JOIN ${S}.cred_clientes c ON c.id = pr.cliente_id
              WHERE pr.id = $1) p)                                         AS prod,
           (SELECT COALESCE(json_agg(cu.* ORDER BY cu.numero_cuota), '[]'::json)
              FROM ${S}.cred_cuotas cu
              WHERE cu.producto_id = $1 AND cu.estado != 'pagada')        AS cuotas`,
        [id]
      ),
      getUsuarioDesdeRequest(request),
    ])

    const ctx = ctxRes.rows[0]
    const prod = typeof ctx.prod === 'string' ? JSON.parse(ctx.prod) : ctx.prod
    if (!prod)
      return NextResponse.json({ error: 'Crédito no encontrado' }, { status: 404 })
    if (['saldado', 'refinanciado', 'decomisado'].includes(prod.estado))
      return NextResponse.json({ error: `El crédito ya está en estado "${prod.estado}"` }, { status: 400 })

    const cuotasPendientes = typeof ctx.cuotas === 'string' ? JSON.parse(ctx.cuotas) : ctx.cuotas
    if (!cuotasPendientes.length)
      return NextResponse.json({ error: 'No hay cuotas pendientes — el crédito ya está saldado' }, { status: 400 })

    // Calcular saldos en memoria (sin queries adicionales)
    const saldoReal = cuotasPendientes.reduce((s, c) =>
      s + parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado || 0), 0)

    const saldoCapitalPendiente = cuotasPendientes.reduce((s, c) => {
      const montoCuota   = parseFloat(c.monto_cuota || 0)
      const montoPagado  = parseFloat(c.monto_pagado || 0)
      const abonoCapital = parseFloat(c.abono_capital || 0)
      if (montoCuota <= 0) return s
      const proporcionPendiente = Math.max(0, (montoCuota - montoPagado) / montoCuota)
      return s + (abonoCapital * proporcionPendiente)
    }, 0)

    const montoAcordado = parseFloat(monto_acordado)

    if (montoAcordado < saldoCapitalPendiente) {
      return NextResponse.json({
        error: `El valor acordado (${new Intl.NumberFormat('es-CO').format(montoAcordado)}) no puede ser menor al saldo de capital pendiente (${new Intl.NumberFormat('es-CO').format(saldoCapitalPendiente)}). Puede perdonar intereses, pero no el capital prestado.`
      }, { status: 400 })
    }

    const descuento = Math.max(0, saldoReal - montoAcordado)
    const cuotaRef  = cuotasPendientes[0]
    const pagoId    = uuidv4()
    const fechaReal = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()
    const notaPago  = `LIQUIDACIÓN ANTICIPADA${notas ? ' — ' + notas : ''}${descuento > 0 ? ` | Descuento aplicado: ${new Intl.NumberFormat('es-CO').format(descuento)}` : ''}`

    // ── RTT 2: consecutivo atómico — evita race condition y un round trip ─
    const consRes = await query(
      `UPDATE ${S}.cred_configuracion
       SET valor = (valor::int + 1)::text, actualizado_en = NOW()
       WHERE clave = 'recibo_consecutivo'
       RETURNING (valor::int - 1) AS consecutivo`
    )
    const consecutivo  = parseInt(consRes.rows[0]?.consecutivo ?? '1')
    const numeroRecibo = 'REC-' + String(consecutivo).padStart(6, '0')

    // ── RTT 3: todo en paralelo ───────────────────────────────────────────
    // INSERT pago, cierre de cuotas, UPDATE producto y caja con subquery inline
    const cuotasQueries = recoger_credito
      ? [
          // Cerrar primera cuota (la que recibió el pago)
          query(
            `UPDATE ${S}.cred_cuotas
             SET estado='pagada', monto_pagado=monto_cuota, dias_mora=0
             WHERE id=$1`, [cuotaRef.id]
          ),
          // Eliminar cuotas futuras sin ningún pago (excluye la primera)
          query(
            `DELETE FROM ${S}.cred_cuotas
             WHERE producto_id=$1 AND id != $2
               AND estado != 'pagada'
               AND (monto_pagado IS NULL OR monto_pagado = 0)`,
            [id, cuotaRef.id]
          ),
          // Cerrar cuotas parciales restantes (excluye la primera ya cerrada)
          query(
            `UPDATE ${S}.cred_cuotas
             SET estado='pagada', monto_pagado=monto_cuota, dias_mora=0
             WHERE producto_id=$1 AND id != $2 AND estado != 'pagada'`,
            [id, cuotaRef.id]
          ),
        ]
      : [
          query(
            `UPDATE ${S}.cred_cuotas
             SET estado='pagada', monto_pagado=monto_cuota, dias_mora=0
             WHERE producto_id=$1 AND estado != 'pagada'`, [id]
          ),
        ]

    await Promise.all([
      query(
        `INSERT INTO ${S}.cred_pagos
          (id, cuota_id, producto_id, cliente_id, monto, fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [pagoId, cuotaRef.id, id, prod.cliente_id,
         montoAcordado, fechaReal, metodo_pago || 'efectivo', notaPago, numeroRecibo, u.nombre]
      ),
      query(`UPDATE ${S}.cred_productos SET estado='saldado' WHERE id=$1`, [id]),
      // Saldo de caja con subquery inline — elimina SELECT previo
      query(
        `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
         VALUES ($1,'cobro_capital',$2,$3,$4,
           COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                     ORDER BY fecha DESC LIMIT 1), 0) + $2)`,
        [uuidv4(), montoAcordado,
         `${numeroRecibo} — Liquidación anticipada ${prod.nombre_cliente}`,
         pagoId]
      ),
      ...cuotasQueries,
    ])

    // ── Auditoría fire-and-forget — no bloquea la respuesta ───────────────
    auditar({
      ...u,
      accion:      'Liquidación anticipada',
      modulo:      MODULOS.COBROS,
      descripcion: `Liquidó crédito de ${prod.nombre_cliente}: acordado ${new Intl.NumberFormat('es-CO').format(montoAcordado)}, saldo real ${new Intl.NumberFormat('es-CO').format(saldoReal)}, descuento ${new Intl.NumberFormat('es-CO').format(descuento)}`,
      detalle:     { productoId: id, montoAcordado, saldoReal, descuento, cuotasCerradas: cuotasPendientes.length, numeroRecibo }
    }).catch(err => console.error('[auditoría liquidar]', err.message))

    return NextResponse.json({
      ok: true,
      numero_recibo:   numeroRecibo,
      monto_acordado:  montoAcordado,
      saldo_real:      saldoReal,
      descuento:       descuento,
      cuotas_cerradas: cuotasPendientes.length,
    }, { status: 200 })

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
