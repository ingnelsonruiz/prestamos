import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function GET(request, { params }) {
  try {
    const { id } = params
    const cliente = await query(`SELECT * FROM ${S}.cred_clientes WHERE id=$1`, [id])
    if (!cliente.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const productos = await query(
      `SELECT p.*, COUNT(cu.id) AS total_cuotas,
              COUNT(cu.id) FILTER (WHERE cu.estado='mora') AS cuotas_mora,
              COALESCE(SUM(cu.monto_cuota - cu.monto_pagado) FILTER (WHERE cu.estado != 'pagada'),0) AS saldo_total
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id
       WHERE p.cliente_id=$1
       GROUP BY p.id ORDER BY p.fecha_creacion DESC`, [id]
    )
    return NextResponse.json({ ...cliente.rows[0], productos: productos.rows })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = params
    const { nombre, telefono, direccion, email } = await request.json()
    const result = await query(
      `UPDATE ${S}.cred_clientes SET nombre=$1,telefono=$2,direccion=$3,email=$4 WHERE id=$5 RETURNING *`,
      [nombre, telefono||null, direccion||null, email||null, id]
    )
    if (!result.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json(result.rows[0])
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params
    const tiene = await query(
      `SELECT 1 FROM ${S}.cred_productos WHERE cliente_id=$1 AND estado NOT IN ('saldado','decomisado') LIMIT 1`, [id]
    )
    if (tiene.rows.length)
      return NextResponse.json({ error: 'El cliente tiene productos activos' }, { status: 400 })
    await query(`DELETE FROM ${S}.cred_clientes WHERE id=$1`, [id])
    const u = await getUsuarioDesdeRequest(request)
    await auditar({ ...u, accion: ACCIONES.ELIMINAR_CLIENTE, modulo: MODULOS.CLIENTES,
      descripcion: `Eliminó cliente ID: ${id}`, detalle: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
