import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

/**
 * GET /api/historial?producto_id=xxx
 * Devuelve el historial completo de un crédito:
 *   - recalculos: snapshots (creación + cada abono a capital)
 *   - pagos: todos los pagos del producto
 *   - cuotasTodas: todas las cuotas (pagadas + pendientes)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const productoId = searchParams.get('producto_id')
    if (!productoId)
      return NextResponse.json({ error: 'producto_id requerido' }, { status: 400 })

    const [recalcRes, pagosRes, cuotasRes] = await Promise.all([
      query(
        `SELECT * FROM ${S}.cred_historial_recalculos
         WHERE producto_id = $1
         ORDER BY fecha ASC`,
        [productoId]
      ),
      query(
        `SELECT pg.*, cu.numero_cuota, cu.monto_cuota,
                c.nombre AS nombre_cliente, c.documento
         FROM ${S}.cred_pagos pg
         JOIN ${S}.cred_cuotas  cu ON cu.id = pg.cuota_id
         JOIN ${S}.cred_clientes c  ON c.id = pg.cliente_id
         WHERE pg.producto_id = $1
         ORDER BY cu.numero_cuota ASC, pg.numero_recibo ASC`,
        [productoId]
      ),
      query(
        `SELECT cu.*,
                p.tasa_interes AS tasa_interes_producto,
                p.periodo_tasa AS periodo_tasa_producto,
                p.frecuencia_cobro AS frecuencia_cobro_producto,
                p.num_cuotas AS num_cuotas_producto,
                p.metodo_calculo AS metodo_calculo_producto
         FROM ${S}.cred_cuotas cu
         JOIN ${S}.cred_productos p ON p.id = cu.producto_id
         WHERE cu.producto_id = $1
         ORDER BY cu.numero_cuota ASC`,
        [productoId]
      ),
    ])

    return NextResponse.json({
      recalculos:  recalcRes.rows,
      pagos:       pagosRes.rows,
      cuotasTodas: cuotasRes.rows,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
