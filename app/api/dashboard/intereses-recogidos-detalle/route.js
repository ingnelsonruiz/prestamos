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

    const filtroRangoNormales = hayRango
      ? `AND pg.fecha_pago::date BETWEEN $1 AND $2`
      : ''
    const filtroRangoLibres = hayRango
      ? `AND pg.fecha_pago::date BETWEEN $1 AND $2`
      : ''
    const params = hayRango ? [desde, hasta] : []

    // ── Créditos normales (préstamo, venta, empeño, fiado, adelanto, congelación) ──
    // El interés cobrado se prorratea desde la cuota (cu.abono_interes / cu.monto_cuota),
    // que sí refleja el interés real de estos productos.
    // Excluye 'credito_libre' explícitamente: su cuota es un placeholder con
    // abono_interes=0 fijo (nunca se actualiza al abonar), así que esta fórmula
    // siempre daría 0 para ese tipo — ver Query separada abajo.
    // LEFT JOIN a cred_clientes (no INNER): cliente_id es nullable desde la
    // migración 25 en préstamos internos de empresas propias; se resuelve el
    // nombre a la empresa dueña del préstamo en ese caso.
    const normalesResult = await query(`
      SELECT
        COALESCE(c.id, ep.id)             AS cliente_id,
        COALESCE(c.nombre, ep.nombre)     AS nombre_cliente,
        COALESCE(c.documento, ep.codigo)  AS documento,
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
      JOIN ${S}.cred_cuotas    cu ON cu.id = pg.cuota_id
      JOIN ${S}.cred_productos p  ON p.id  = pg.producto_id
      LEFT JOIN ${S}.cred_clientes c  ON c.id  = pg.cliente_id
      LEFT JOIN ${S}.cred_empresas_propias ep ON ep.id = p.empresa_id AND p.es_prestamo_interno = TRUE
      WHERE p.tipo != 'credito_libre'
        ${filtroRangoNormales}
      GROUP BY COALESCE(c.id, ep.id), COALESCE(c.nombre, ep.nombre), COALESCE(c.documento, ep.codigo),
               p.id, p.referencia, p.tipo, p.monto_capital
      HAVING SUM(LEAST(pg.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0)) > 0
      ORDER BY interes_cobrado DESC
    `, params)

    // ── Créditos Sin Cuotas Futuras (créditos libres) ──
    // El interés cobrado NO se puede derivar de la cuota (placeholder,
    // abono_interes=0 fijo) — se toma directamente de cred_pagos.monto_interes,
    // igual que ya hace GET /api/dashboard (ver comentario ahí, query "16").
    const librestResult = await query(`
      SELECT
        COALESCE(c.id, ep.id)             AS cliente_id,
        COALESCE(c.nombre, ep.nombre)     AS nombre_cliente,
        COALESCE(c.documento, ep.codigo)  AS documento,
        p.id                AS producto_id,
        p.referencia,
        p.tipo              AS tipo_producto,
        p.monto_capital,
        COUNT(pg.id)::int   AS num_pagos,
        MAX(pg.fecha_pago::date)::text AS ultimo_pago,
        COALESCE(SUM(pg.monto_interes), 0) AS interes_cobrado
      FROM ${S}.cred_pagos pg
      JOIN ${S}.cred_productos p  ON p.id  = pg.producto_id
      LEFT JOIN ${S}.cred_clientes c  ON c.id  = pg.cliente_id
      LEFT JOIN ${S}.cred_empresas_propias ep ON ep.id = p.empresa_id AND p.es_prestamo_interno = TRUE
      WHERE p.tipo = 'credito_libre'
        AND pg.monto_interes > 0
        ${filtroRangoLibres}
      GROUP BY COALESCE(c.id, ep.id), COALESCE(c.nombre, ep.nombre), COALESCE(c.documento, ep.codigo),
               p.id, p.referencia, p.tipo, p.monto_capital
      ORDER BY interes_cobrado DESC
    `, params)

    const mapRow = r => ({
      cliente_id:      r.cliente_id,
      nombre_cliente:  r.nombre_cliente,
      documento:       r.documento,
      producto_id:     r.producto_id,
      referencia:      r.referencia,
      tipo_producto:   r.tipo_producto,
      monto_capital:   parseFloat(r.monto_capital),
      num_pagos:       r.num_pagos,
      ultimo_pago:     r.ultimo_pago,
      interes_cobrado: parseFloat(r.interes_cobrado),
    })

    const normales = normalesResult.rows.map(mapRow)
    const libres    = librestResult.rows.map(mapRow)
    const interesNormales = normales.reduce((s, d) => s + d.interes_cobrado, 0)
    const interesLibres   = libres.reduce((s, d) => s + d.interes_cobrado, 0)

    return NextResponse.json({
      normales,
      libres,
      totales: {
        interes_normales: interesNormales,
        interes_libres:   interesLibres,
        total:             interesNormales + interesLibres,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
