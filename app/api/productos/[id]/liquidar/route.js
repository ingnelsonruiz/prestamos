import { NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function POST(request, { params }) {
  try {
    const { id } = params
    const { monto_acordado, monto_interes, metodo_pago, notas, fecha_pago, recoger_credito } = await request.json()

    if (!monto_acordado || parseFloat(monto_acordado) <= 0)
      return NextResponse.json({ error: 'El monto acordado debe ser mayor a cero' }, { status: 400 })

    // ── RTT 1: producto + cuotas + usuario en paralelo ────────────────────
    const [ctxRes, u] = await Promise.all([
      query(
        `SELECT
           (SELECT row_to_json(p) FROM (
              SELECT pr.*, c.nombre AS nombre_cliente, ep.nombre AS nombre_empresa
              FROM ${S}.cred_productos pr
              LEFT JOIN ${S}.cred_clientes c         ON c.id  = pr.cliente_id
              LEFT JOIN ${S}.cred_empresas_propias ep ON ep.id = pr.empresa_id
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

    // ── Cierre de cuotas COHERENTE con el historial de pagos ──────────────
    // Aplica IGUAL para "recoger crédito" y "liquidar", sin importar en qué
    // cuota del plan ocurra la liquidación:
    //   1. La cuota de referencia (primera pendiente) consolida TODO lo cobrado
    //      en esta operación: lo que ya tenía abonado + el monto acordado.
    //      abono_capital = capital ya pagado en esa cuota + capital pendiente total.
    //      abono_interes = el resto (interés realmente cobrado; el futuro se perdona).
    //   2. Las demás cuotas con pagos parciales se cierran por lo REALMENTE pagado
    //      (monto_cuota = monto_pagado, capital/interés prorrateados).
    //   3. Las cuotas sin ningún pago se ELIMINAN (su capital quedó absorbido
    //      en la cuota de referencia).
    // Resultado: Σ monto_pagado de cuotas === Σ pagos del historial (diff = 0)
    // y no quedan cuotas futuras "pagadas" con dinero que nunca entró.
    //
    // IMPORTANTE: estas queries se ejecutan EN SECUENCIA. Antes iban dentro de
    // Promise.all y el UPDATE de cierre podía ejecutarse antes que el DELETE
    // (race condition del pool): la cuota futura quedaba marcada 'pagada' y el
    // DELETE ya no la encontraba → tabla incoherente e indicadores inflados.

    const montoCuotaRefOrig    = parseFloat(cuotaRef.monto_cuota || 0)
    const pagadoPrevioRef      = parseFloat(cuotaRef.monto_pagado || 0)
    const capitalPrevioRef     = montoCuotaRefOrig > 0
      ? parseFloat(cuotaRef.abono_capital || 0) * Math.min(1, pagadoPrevioRef / montoCuotaRefOrig)
      : 0
    const totalCuotaRef   = Math.round(pagadoPrevioRef + montoAcordado)
    const capitalCuotaRef = Math.min(totalCuotaRef, Math.round(capitalPrevioRef + saldoCapitalPendiente))
    const interesCuotaRef = Math.max(0, totalCuotaRef - capitalCuotaRef)

    // ── TRANSACCIÓN: consecutivo + cuotas + pago + producto + caja ────────
    // Todo o nada: si cualquier paso falla → ROLLBACK (no quedan cuotas
    // cerradas sin pago, ni caja sin recibo, ni consecutivo consumido).
    const { numeroRecibo } = await withTransaction(async (q) => {

      // 0. Consecutivo atómico — el UPDATE bloquea la fila hasta el COMMIT,
      //    serializando liquidaciones concurrentes sin saltos de numeración.
      const consRes = await q(
        `UPDATE ${S}.cred_configuracion
         SET valor = (valor::int + 1)::text, actualizado_en = NOW()
         WHERE clave = 'recibo_consecutivo'
         RETURNING (valor::int - 1) AS consecutivo`
      )
      const consecutivo = parseInt(consRes.rows[0]?.consecutivo ?? '1')
      const numRecibo   = 'REC-' + String(consecutivo).padStart(6, '0')

      // 1. Consolidar lo cobrado en la cuota de referencia
      await q(
        `UPDATE ${S}.cred_cuotas
         SET estado          = 'pagada',
             monto_cuota     = $2,
             monto_pagado    = $2,
             abono_capital   = $3,
             abono_interes   = $4,
             saldo_pendiente = 0,
             dias_mora       = 0
         WHERE id = $1`,
        [cuotaRef.id, totalCuotaRef, capitalCuotaRef, interesCuotaRef]
      )

      // 2. Cerrar otras cuotas parciales por lo realmente pagado (prorrateo capital/interés)
      await q(
        `UPDATE ${S}.cred_cuotas
         SET estado          = 'pagada',
             abono_capital   = ROUND(COALESCE(abono_capital * monto_pagado / NULLIF(monto_cuota, 0), 0)),
             abono_interes   = monto_pagado - ROUND(COALESCE(abono_capital * monto_pagado / NULLIF(monto_cuota, 0), 0)),
             monto_cuota     = monto_pagado,
             saldo_pendiente = 0,
             dias_mora       = 0
         WHERE producto_id = $1 AND id != $2 AND estado != 'pagada'
           AND COALESCE(monto_pagado, 0) > 0`,
        [id, cuotaRef.id]
      )

      // 3. Eliminar cuotas futuras sin ningún pago (absorbidas en la cuota de referencia)
      await q(
        `DELETE FROM ${S}.cred_cuotas
         WHERE producto_id = $1 AND id != $2 AND estado != 'pagada'
           AND COALESCE(monto_pagado, 0) = 0`,
        [id, cuotaRef.id]
      )

      // 4. Registrar el pago de la liquidación
      await q(
        `INSERT INTO ${S}.cred_pagos
          (id, cuota_id, producto_id, cliente_id, monto, fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [pagoId, cuotaRef.id, id, prod.cliente_id,
         montoAcordado, fechaReal, metodo_pago || 'efectivo', notaPago, numRecibo, u.nombre]
      )

      // 5. Saldar el producto
      await q(`UPDATE ${S}.cred_productos SET estado='saldado' WHERE id=$1`, [id])

      // 6. Movimiento de caja con saldo acumulado (subquery inline)
      await q(
        `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
         VALUES ($1,'cobro_capital',$2,$3,$4,
           COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                     ORDER BY fecha DESC LIMIT 1), 0) + $2)`,
        [uuidv4(), montoAcordado,
         `${numRecibo} — Liquidación anticipada ${prod.nombre_cliente || prod.nombre_empresa || 'Inversión interna'}`,
         pagoId]
      )

      return { numeroRecibo: numRecibo }
    })

    // ── Registrar retorno con interés si aplica (inversión interna) ──────
    const interesNum = parseFloat(monto_interes || 0)
    if (interesNum > 0 && prod.empresa_id) {
      await query(
        `INSERT INTO ${S}.cred_retornos_empresa
           (id, empresa_id, producto_id, monto_capital, monto_interes, fecha_retorno, notas, usuario_nombre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uuidv4(), prod.empresa_id, id,
         montoAcordado, interesNum,
         fechaReal,
         `COBRO FINAL${notas ? ' — ' + notas : ''}`,
         u.nombre]
      ).catch(err => console.error('[retorno_liquidar]', err.message))
    }

    // ── Auditoría fire-and-forget — no bloquea la respuesta ───────────────
    auditar({
      ...u,
      accion:      'Liquidación anticipada',
      modulo:      MODULOS.COBROS,
      descripcion: `Liquidó crédito de ${prod.nombre_cliente}: acordado ${new Intl.NumberFormat('es-CO').format(montoAcordado)}, saldo real ${new Intl.NumberFormat('es-CO').format(saldoReal)}, descuento ${new Intl.NumberFormat('es-CO').format(descuento)}`,
      detalle:     { productoId: id, montoAcordado, saldoReal, descuento, cuotasCerradas: cuotasPendientes.length, numeroRecibo, recogerCredito: !!recoger_credito }
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
