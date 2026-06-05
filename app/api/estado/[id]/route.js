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
      `SELECT
         p.id, p.tipo, p.monto_capital, p.descripcion_bien, p.estado,
         p.fecha_primer_pago, p.tasa_interes, p.periodo_tasa,
         p.frecuencia_cobro, p.metodo_calculo, p.num_cuotas, p.fecha_creacion,
         -- totales
         COUNT(cu.id)                                                          AS total_cuotas,
         COUNT(cu.id) FILTER (WHERE cu.estado = 'pagada')                      AS cuotas_pagadas,
         COUNT(cu.id) FILTER (WHERE cu.estado IN ('pendiente','parcial'))       AS cuotas_pendientes,
         COUNT(cu.id) FILTER (WHERE cu.fecha_vencimiento < CURRENT_DATE AND cu.estado != 'pagada') AS cuotas_mora,
         -- montos
         COALESCE(SUM(cu.monto_cuota), 0)                                      AS total_proyectado,
         COALESCE(SUM(cu.monto_pagado), 0)                                     AS total_pagado,
         COALESCE(SUM(cu.monto_cuota - cu.monto_pagado) FILTER (WHERE cu.estado != 'pagada'), 0) AS saldo_total,
         COALESCE(SUM(cu.abono_interes), 0)                                    AS total_intereses,
         -- próxima cuota
         MIN(cu.fecha_vencimiento) FILTER (WHERE cu.estado IN ('pendiente','parcial')) AS proxima_fecha,
         MIN(cu.monto_cuota - cu.monto_pagado) FILTER (WHERE cu.estado IN ('pendiente','parcial')) AS proxima_valor
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id
       WHERE p.cliente_id = $1
         AND p.estado NOT IN ('saldado','decomisado','refinanciado')
       GROUP BY p.id
       ORDER BY p.fecha_creacion DESC`,
      [id]
    )

    // Todos los productos (incluyendo saldados y refinanciados)
    const historial = await query(
      `SELECT
         p.id, p.tipo, p.monto_capital, p.descripcion_bien, p.estado,
         p.fecha_primer_pago, p.tasa_interes, p.periodo_tasa,
         p.frecuencia_cobro, p.num_cuotas, p.fecha_creacion,
         COUNT(cu.id) AS total_cuotas,
         COUNT(cu.id) FILTER (WHERE cu.estado = 'pagada') AS cuotas_pagadas,
         COALESCE(SUM(cu.monto_cuota), 0) AS total_proyectado,
         COALESCE(SUM(cu.monto_pagado), 0) AS total_pagado
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id
       WHERE p.cliente_id = $1
         AND p.estado IN ('saldado','refinanciado','decomisado')
       GROUP BY p.id
       ORDER BY p.fecha_creacion DESC`,
      [id]
    )

    // Cuotas de productos activos (para mostrar plan de pagos)
    const cuotasRes = await query(
      `SELECT cu.producto_id, cu.numero_cuota, cu.fecha_vencimiento,
              cu.monto_cuota, cu.monto_pagado, cu.abono_capital,
              cu.abono_interes, cu.estado
       FROM ${S}.cred_cuotas cu
       JOIN ${S}.cred_productos p ON p.id = cu.producto_id
       WHERE p.cliente_id = $1
         AND p.estado NOT IN ('saldado','decomisado','refinanciado')
         AND cu.fecha_vencimiento != '2099-12-31'
       ORDER BY cu.producto_id, cu.numero_cuota`,
      [id]
    )

    // Agrupar cuotas por producto_id
    const cuotasPorProducto = {}
    for (const c of cuotasRes.rows) {
      if (!cuotasPorProducto[c.producto_id]) cuotasPorProducto[c.producto_id] = []
      cuotasPorProducto[c.producto_id].push(c)
    }

    // Historial de últimos pagos (últimos 10)
    const pagosRes = await query(
      `SELECT pg.numero_recibo, pg.monto, pg.fecha_pago, pg.metodo_pago,
              cu.numero_cuota, pg.producto_id
       FROM ${S}.cred_pagos pg
       JOIN ${S}.cred_cuotas cu ON cu.id = pg.cuota_id
       WHERE pg.cliente_id = $1
       ORDER BY pg.fecha_pago DESC
       LIMIT 10`,
      [id]
    )

    return NextResponse.json({
      nombre:    cliente.rows[0].nombre,
      documento: cliente.rows[0].documento,
      productos: productos.rows,
      historial: historial.rows,
      cuotas:    cuotasPorProducto,
      ultimos_pagos: pagosRes.rows,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
