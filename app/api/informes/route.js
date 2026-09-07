import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const desde  = searchParams.get('desde') || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
    const hasta  = searchParams.get('hasta') || new Date().toISOString().split('T')[0]
    const tipo   = searchParams.get('tipo') || 'intereses'

    if (tipo === 'intereses') {
      // Intereses cobrados por período.
      // Fix 2026-09-07: antes se re-derivaba el interés desde el ESTADO ACTUAL
      // (mutable) de cred_cuotas — LEAST(p.monto, cu.monto_cuota) * cu.abono_interes
      // / cu.monto_cuota. En método 'plano', recalcularCuotasPlano() reescribe
      // monto_cuota/abono_interes tras CADA pago, inflando el monto_cuota de
      // cuotas aún abiertas y sub-valorando pagos que fueron 100% interés (mismo
      // bug ya corregido en /api/dashboard el 2026-08-16, caso real CRED-000309:
      // pago de $1.000.000 100% interés mostrado como $130.435). cred_pagos.monto_interes
      // ya guarda el interés real pactado al momento del cobro y no varía con
      // recálculos posteriores — se usa directo, igual que en el Dashboard.
      const resumen = await query(`
        SELECT
          DATE_TRUNC('month', p.fecha_pago)::date          AS mes,
          COUNT(DISTINCT p.id)                              AS num_pagos,
          COUNT(DISTINCT p.cliente_id)                      AS num_clientes,
          SUM(p.monto)                                      AS total_recaudado,
          SUM(p.monto_interes) AS intereses_estimados,
          SUM(p.monto) - SUM(p.monto_interes) AS capital_recuperado
        FROM ${S}.cred_pagos p
        JOIN ${S}.cred_cuotas cu ON cu.id = p.cuota_id
        WHERE p.fecha_pago::date BETWEEN $1 AND $2
        GROUP BY DATE_TRUNC('month', p.fecha_pago)
        ORDER BY mes ASC
      `, [desde, hasta])

      const detalle = await query(`
        SELECT
          p.fecha_pago::date                    AS fecha,
          p.numero_recibo,
          c.nombre                              AS cliente,
          c.documento,
          pr.tipo                               AS tipo_producto,
          pr.descripcion_bien,
          cu.numero_cuota,
          p.monto                               AS total_pago,
          p.monto_interes AS interes_cobrado,
          p.monto - p.monto_interes AS capital_cobrado,
          p.metodo_pago,
          p.usuario_nombre                      AS registrado_por,
          p.notas
        FROM ${S}.cred_pagos p
        JOIN ${S}.cred_cuotas cu   ON cu.id  = p.cuota_id
        JOIN ${S}.cred_clientes c  ON c.id   = p.cliente_id
        JOIN ${S}.cred_productos pr ON pr.id = p.producto_id
        WHERE p.fecha_pago::date BETWEEN $1 AND $2
        ORDER BY p.fecha_pago DESC
      `, [desde, hasta])

      const totales = await query(`
        SELECT
          COUNT(DISTINCT p.id)                              AS num_pagos,
          COUNT(DISTINCT p.cliente_id)                      AS num_clientes,
          SUM(p.monto)                                      AS total_recaudado,
          SUM(p.monto_interes) AS total_intereses,
          SUM(p.monto) - SUM(p.monto_interes) AS total_capital
        FROM ${S}.cred_pagos p
        JOIN ${S}.cred_cuotas cu ON cu.id = p.cuota_id
        WHERE p.fecha_pago::date BETWEEN $1 AND $2
      `, [desde, hasta])

      return NextResponse.json({
        desde, hasta,
        totales: totales.rows[0],
        resumen_mensual: resumen.rows,
        detalle: detalle.rows,
      })
    }

    return NextResponse.json({ error: 'Tipo de informe no válido' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
