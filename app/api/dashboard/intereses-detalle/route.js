import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const rangoValido = /^\d{4}-\d{2}-\d{2}$/
    let desde = searchParams.get('desde')
    let hasta = searchParams.get('hasta')
    desde = rangoValido.test(desde || '') ? desde : null
    hasta = rangoValido.test(hasta || '') ? hasta : null
    const hayRango = Boolean(desde && hasta)

    const filtroRango = hayRango
      ? `AND cu.fecha_vencimiento BETWEEN $1 AND $2`
      : ''
    const params = hayRango ? [desde, hasta] : []

    const result = await query(`
      SELECT
        c.id                AS cliente_id,
        c.nombre            AS nombre_cliente,
        c.documento,
        p.id                AS producto_id,
        p.referencia,
        p.tipo              AS tipo_producto,
        p.monto_capital,
        COUNT(cu.id)::int   AS cuotas_pendientes,
        MIN(cu.fecha_vencimiento)::text AS proxima_fecha,
        COALESCE(SUM(
          cu.abono_interes * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
        ), 0) AS interes_proyectado
      FROM ${S}.cred_cuotas cu
      JOIN ${S}.cred_productos p ON p.id = cu.producto_id
      JOIN ${S}.cred_clientes  c ON c.id = p.cliente_id
      WHERE cu.estado IN ('pendiente','parcial')
        AND p.estado IN ('activo','al_dia','en_mora')
        AND p.tipo <> 'congelacion'
        AND cu.fecha_vencimiento != '2099-12-31'
        ${filtroRango}
      GROUP BY c.id, c.nombre, c.documento, p.id, p.referencia, p.tipo, p.monto_capital
      ORDER BY interes_proyectado DESC
    `, params)

    return NextResponse.json(result.rows.map(r => ({
      cliente_id:        r.cliente_id,
      nombre_cliente:    r.nombre_cliente,
      documento:         r.documento,
      producto_id:       r.producto_id,
      referencia:        r.referencia,
      tipo_producto:     r.tipo_producto,
      monto_capital:     parseFloat(r.monto_capital),
      cuotas_pendientes: r.cuotas_pendientes,
      proxima_fecha:     r.proxima_fecha,
      interes_proyectado: parseFloat(r.interes_proyectado),
    })))
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
