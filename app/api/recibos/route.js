import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim().toUpperCase()

    if (!q) return NextResponse.json([])

    // Normalizar: si escriben solo el número (ej: "1" o "000001"), completar con prefijo
    const termino = q.startsWith('REC-') ? `%${q}%` : `%REC-%${q}%`

    const result = await query(`
      SELECT
        pg.id,
        pg.numero_recibo,
        pg.monto,
        pg.fecha_pago,
        pg.metodo_pago,
        pg.notas,
        pg.usuario_nombre,
        cu.numero_cuota,
        cu.monto_cuota,
        cu.monto_pagado,
        cu.abono_capital,
        cu.abono_interes,
        cu.fecha_vencimiento,
        c.id          AS cliente_id,
        c.nombre      AS nombre_cliente,
        c.documento,
        c.telefono,
        p.id          AS producto_id,
        p.tipo        AS tipo_producto,
        p.descripcion_bien,
        p.num_cuotas,
        p.monto_capital,
        p.tasa_interes,
        p.periodo_tasa,
        p.frecuencia_cobro,
        p.metodo_calculo,
        p.estado AS estado_producto,
        -- Saldo pendiente actual: cuotas no saldadas del producto
        COALESCE((
          SELECT SUM(GREATEST(cu2.monto_cuota - cu2.monto_pagado, 0))
          FROM ${S}.cred_cuotas cu2
          WHERE cu2.producto_id = p.id
            AND cu2.estado IN ('pendiente','parcial')
            AND cu2.fecha_vencimiento != '2099-12-31'
        ), 0) AS saldo_pendiente,
        COALESCE((
          SELECT COUNT(*)
          FROM ${S}.cred_cuotas cu3
          WHERE cu3.producto_id = p.id
            AND cu3.estado IN ('pendiente','parcial')
            AND cu3.fecha_vencimiento != '2099-12-31'
        ), 0) AS cuotas_pendientes
      FROM ${S}.cred_pagos pg
      JOIN ${S}.cred_cuotas   cu ON cu.id = pg.cuota_id
      JOIN ${S}.cred_clientes c  ON c.id  = pg.cliente_id
      JOIN ${S}.cred_productos p ON p.id  = pg.producto_id
      WHERE pg.numero_recibo ILIKE $1
      ORDER BY pg.fecha_pago DESC
      LIMIT 20
    `, [termino])

    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
