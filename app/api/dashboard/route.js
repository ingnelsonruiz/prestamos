import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET() {
  try {
    const hoy = new Date().toISOString().split('T')[0]

    const [
      capitalCalle,
      interesesGanados,
      clientesMora,
      recaudoHoy,
      carteraVencida,
      totalInvertido,
      totalRecuperado,
      cuotasHoy,
      cuotasSemana,
      empenosVencer,
      movimientosCaja
    ] = await Promise.all([
      query(`SELECT COALESCE(SUM(saldo_pendiente),0) AS total
             FROM ${S}.cred_cuotas WHERE estado IN ('pendiente','parcial','mora')`),

      query(`SELECT COALESCE(SUM(abono_interes),0) AS total
             FROM ${S}.cred_cuotas WHERE estado = 'pagada'`),

      query(`SELECT COUNT(DISTINCT cliente_id) AS total
             FROM ${S}.cred_cuotas WHERE estado='mora'`),

      query(`SELECT COALESCE(SUM(monto),0) AS total
             FROM ${S}.cred_pagos WHERE fecha_pago::date = $1`, [hoy]),

      query(`SELECT COALESCE(SUM(monto_cuota - monto_pagado),0) AS total
             FROM ${S}.cred_cuotas
             WHERE estado='mora' AND ($1::date - fecha_vencimiento) > 30`, [hoy]),

      // Total histórico invertido (todos los desembolsos)
      query(`SELECT COALESCE(SUM(monto_capital),0) AS total,
                    COUNT(*) AS num_creditos
             FROM ${S}.cred_productos
             WHERE tipo NOT IN ('fiado','adelanto')`),

      // Total recuperado (todo lo cobrado históricamente)
      query(`SELECT COALESCE(SUM(monto),0) AS total FROM ${S}.cred_pagos`),

      query(`SELECT cu.*, c.nombre AS nombre_cliente, p.tipo
             FROM ${S}.cred_cuotas cu
             JOIN ${S}.cred_clientes  c ON c.id = cu.cliente_id
             JOIN ${S}.cred_productos p ON p.id = cu.producto_id
             WHERE cu.fecha_vencimiento = $1 AND cu.estado IN ('pendiente','parcial')
             ORDER BY c.nombre`, [hoy]),

      query(`SELECT cu.*, c.nombre AS nombre_cliente
             FROM ${S}.cred_cuotas cu
             JOIN ${S}.cred_clientes c ON c.id = cu.cliente_id
             WHERE cu.fecha_vencimiento BETWEEN $1 AND $1::date + 7
               AND cu.estado IN ('pendiente','parcial')
             ORDER BY cu.fecha_vencimiento`, [hoy]),

      query(`SELECT p.*, c.nombre AS nombre_cliente
             FROM ${S}.cred_productos p
             JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
             WHERE p.tipo='empeno' AND p.estado='activo'
               AND p.fecha_limite_rescate BETWEEN $1 AND $1::date + 15
             ORDER BY p.fecha_limite_rescate`, [hoy]),

      query(`SELECT * FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 10`),
    ])

    return NextResponse.json({
      kpis: {
        capital_en_calle:    parseFloat(capitalCalle.rows[0].total),
        intereses_ganados:   parseFloat(interesesGanados.rows[0].total),
        clientes_en_mora:    parseInt(clientesMora.rows[0].total),
        recaudo_hoy:         parseFloat(recaudoHoy.rows[0].total),
        cartera_vencida_30d: parseFloat(carteraVencida.rows[0].total),
        total_invertido:     parseFloat(totalInvertido.rows[0].total),
        num_creditos:        parseInt(totalInvertido.rows[0].num_creditos),
        total_recuperado:    parseFloat(totalRecuperado.rows[0].total),
      },
      cuotas_hoy:       cuotasHoy.rows,
      cuotas_semana:    cuotasSemana.rows,
      empenos_vencer:   empenosVencer.rows,
      movimientos_caja: movimientosCaja.rows,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
