import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const estado     = searchParams.get('estado') || 'pendiente'
    const clienteId  = searchParams.get('cliente_id')
    const productoId = searchParams.get('producto_id')
    const hoy        = new Date().toISOString().split('T')[0]

    let sql = `
      SELECT cu.*,
             c.nombre    AS nombre_cliente,
             c.telefono  AS telefono_cliente,
             p.tipo      AS tipo_producto,
             p.descripcion_bien,
             p.fecha_creacion AS fecha_prestamo,
             p.monto_capital  AS capital_producto,
             GREATEST(0, CURRENT_DATE - cu.fecha_vencimiento) AS dias_mora
      FROM ${S}.cred_cuotas cu
      JOIN ${S}.cred_clientes  c ON c.id = cu.cliente_id
      JOIN ${S}.cred_productos p ON p.id = cu.producto_id
      WHERE p.estado != 'refinanciado'
    `
    const values = []

    if (estado === 'mora') {
      sql += ` AND cu.fecha_vencimiento < $${values.length+1} AND cu.monto_pagado < cu.monto_cuota AND cu.estado != 'pagada'`
      values.push(hoy)
    } else {
      sql += ` AND cu.estado = $${values.length+1}`
      values.push(estado)
    }

    if (clienteId)  { sql += ` AND cu.cliente_id=$${values.length+1}`;  values.push(clienteId) }
    if (productoId) { sql += ` AND cu.producto_id=$${values.length+1}`; values.push(productoId) }
    sql += ` ORDER BY cu.fecha_vencimiento ASC`

    const result = await query(sql, values)
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
