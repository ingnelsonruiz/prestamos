import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function POST(request) {
  try {
    const { cuota_id, monto, metodo_pago, notas, fecha_pago } = await request.json()
    if (!cuota_id || !monto || monto <= 0)
      return NextResponse.json({ error: 'cuota_id y monto son obligatorios' }, { status: 400 })

    const cuotaRes = await query(
      `SELECT cu.*, p.cliente_id FROM ${S}.cred_cuotas cu
       JOIN ${S}.cred_productos p ON p.id = cu.producto_id WHERE cu.id=$1`, [cuota_id]
    )
    if (!cuotaRes.rows.length) return NextResponse.json({ error: 'Cuota no encontrada' }, { status: 404 })

    const cuota           = cuotaRes.rows[0]
    const pendienteEnCuota = parseFloat(cuota.monto_cuota) - parseFloat(cuota.monto_pagado)

    // Validar que el monto no exceda el saldo pendiente de la cuota
    if (parseFloat(monto) > pendienteEnCuota + 1) {
      const fmtCOP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
      return NextResponse.json({
        error: `El monto ingresado (${fmtCOP(monto)}) supera el saldo pendiente de la cuota (${fmtCOP(pendienteEnCuota)}). Para pagar varias cuotas a la vez registre cada una por separado.`
      }, { status: 400 })
    }

    const nuevoPagado = parseFloat(cuota.monto_pagado) + parseFloat(monto)
    const pagado      = Math.min(nuevoPagado, parseFloat(cuota.monto_cuota))
    const estadoCuota = pagado >= parseFloat(cuota.monto_cuota) ? 'pagada' : 'parcial'

    const confRes = await query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='recibo_consecutivo'`)
    const consecutivo = parseInt(confRes.rows[0]?.valor || '1')
    const numeroRecibo = `REC-${String(consecutivo).padStart(6,'0')}`

    await query(
      `UPDATE ${S}.cred_cuotas SET monto_pagado=$1, estado=$2, dias_mora=0 WHERE id=$3`,
      [pagado, estadoCuota, cuota_id]
    )

    const pagoId   = uuidv4()
    // Verificar modo prueba desde BD
    const modoPruebaRes = await query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='modo_prueba'`)
    const modoPrueba    = modoPruebaRes.rows[0]?.valor === 'true'
    if (!modoPrueba && fecha_pago && fecha_pago > new Date().toISOString().split('T')[0])
      return NextResponse.json({ error: 'La fecha del pago no puede ser mayor a la fecha actual' }, { status: 400 })
    const fechaReal = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()
    const u = await getUsuarioDesdeRequest(request)
    // u se reutiliza más abajo para auditoría — no redeclarar
    await query(
      `INSERT INTO ${S}.cred_pagos (id,cuota_id,producto_id,cliente_id,monto,fecha_pago,metodo_pago,notas,numero_recibo,usuario_nombre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [pagoId, cuota_id, cuota.producto_id, cuota.cliente_id,
       monto, fechaReal, metodo_pago||'efectivo', notas||null, numeroRecibo, u.nombre]
    )

    const saldoRes = await query(`SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 1`)
    const saldoAnt = parseFloat(saldoRes.rows[0]?.saldo_acumulado || 0)
    await query(
      `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
       VALUES ($1,'cobro_capital',$2,$3,$4,$5)`,
      [uuidv4(), monto, `${numeroRecibo} — Cuota ${cuota.numero_cuota}`, pagoId, saldoAnt + parseFloat(monto)]
    )

    await query(
      `UPDATE ${S}.cred_configuracion SET valor=$1, actualizado_en=NOW() WHERE clave='recibo_consecutivo'`,
      [String(consecutivo + 1)]
    )

    const pendientes = await query(
      `SELECT 1 FROM ${S}.cred_cuotas WHERE producto_id=$1 AND estado != 'pagada' LIMIT 1`,
      [cuota.producto_id]
    )
    if (!pendientes.rows.length)
      await query(`UPDATE ${S}.cred_productos SET estado='saldado' WHERE id=$1`, [cuota.producto_id])

    await auditar({ ...u, accion: ACCIONES.REGISTRAR_PAGO, modulo: MODULOS.COBROS,
      descripcion: `Pago ${numeroRecibo}: $${parseFloat(monto).toLocaleString()} — cuota #${cuota.numero_cuota}`,
      detalle: { pagoId, cuota_id, monto, metodo_pago, numero_recibo: numeroRecibo, fecha_pago: fechaReal } })

    return NextResponse.json({ ok: true, numero_recibo: numeroRecibo, estado_cuota: estadoCuota })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const productoId = searchParams.get('producto_id')
    const clienteId  = searchParams.get('cliente_id')
    const fecha      = searchParams.get('fecha') // YYYY-MM-DD para filtrar por día

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
