import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

// Endpoint PÚBLICO — solo muestra saldo del cliente, sin datos sensibles
export async function GET(request, { params }) {
  try {
    const { id } = params

    const cliente = await query(
      `SELECT nombre, documento FROM ${S}.cred_clientes WHERE id=$1`, [id]
    )
    if (!cliente.rows.length)
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const productos = await query(
      `SELECT p.id, p.tipo, p.monto_capital, p.descripcion_bien, p.estado,
              p.fecha_primer_pago, p.tasa_interes, p.num_cuotas,
              COUNT(cu.id) AS total_cuotas,
              COUNT(cu.id) FILTER (WHERE cu.estado='mora') AS cuotas_mora,
              COALESCE(SUM(cu.monto_cuota - cu.monto_pagado) FILTER (WHERE cu.estado != 'pagada'),0) AS saldo_total
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id
       WHERE p.cliente_id = $1
         AND p.estado NOT IN ('saldado','decomisado','refinanciado')
       GROUP BY p.id
       ORDER BY p.fecha_creacion DESC`,
      [id]
    )

    return NextResponse.json({
      nombre:   cliente.rows[0].nombre,
      documento: cliente.rows[0].documento,
      productos: productos.rows,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
