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
      ? `AND pg.fecha_pago::date BETWEEN $1 AND $2`
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
        COUNT(pg.id)::int   AS num_pagos,
        MAX(pg.fecha_pago::date)::text AS ultimo_pago,
        COALESCE(SUM(
          LEAST(pg.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0)
        ), 0) AS interes_cobrado
      FROM ${S}.cred_pagos pg
      JOIN ${S}.cred_cuotas   cu ON cu.id = pg.cuota_id
      JOIN ${S}.cred_productos p  ON p.id  = pg.producto_id
      JOIN ${S}.cred_clientes  c  ON c.id  = pg.cliente_id
      WHERE 1=1
        ${filtroRango}
      GROUP BY c.id, c.nombre, c.documento, p.id, p.referencia, p.tipo, p.monto_capital
      HAVING SUM(LEAST(pg.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0)) > 0
      ORDER BY interes_cobrado DESC
    `, params)

    return NextResponse.json(result.rows.map(r => ({
      cliente_id:     r.cliente_id,
      nombre_cliente: r.nombre_cliente,
      documento:      r.documento,
      producto_id:    r.producto_id,
      referencia:     r.referencia,
      tipo_producto:  r.tipo_producto,
      monto_capital:  parseFloat(r.monto_capital),
      num_pagos:      r.num_pagos,
      ultimo_pago:    r.ultimo_pago,
      interes_cobrado: parseFloat(r.interes_cobrado),
    })))
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
