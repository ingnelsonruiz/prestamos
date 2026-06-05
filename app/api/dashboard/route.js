import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET() {
  try {
    const hoy = new Date().toISOString().split('T')[0]

    const [
      carteraEstados,
      interesesPeriodos,
      moraPeriodos,
      recaudoPeriodos,
      carteraVencida,
      capitalCalle,
      interesesProyectados,
      saldoCaja,
      cuotasHoy,
      cuotasSemana,
      empenosVencer,
      otrosRubros,
    ] = await Promise.all([

      // 1. Capital y conteo por estado — mora detectada por fechas (no por campo estado)
      query(`
        WITH mora_por_producto AS (
          SELECT DISTINCT producto_id
          FROM ${S}.cred_cuotas
          WHERE fecha_vencimiento < CURRENT_DATE
            AND estado IN ('pendiente','parcial')
            AND fecha_vencimiento != '2099-12-31'
        )
        SELECT
          COALESCE(SUM(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NULL THEN p.monto_capital END), 0)       AS capital_activo,
          COALESCE(SUM(CASE WHEN p.estado = 'saldado'
            THEN p.monto_capital END), 0)                                   AS capital_saldado,
          COALESCE(SUM(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NOT NULL THEN p.monto_capital END), 0)   AS capital_mora,
          COALESCE(SUM(CASE WHEN p.estado = 'refinanciado'
            THEN p.monto_capital END), 0)                                   AS capital_refinanciado,
          COUNT(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NULL     THEN 1 END)::int                AS num_activos,
          COUNT(CASE WHEN p.estado = 'saldado'
            THEN 1 END)::int                                                AS num_saldados,
          COUNT(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NOT NULL THEN 1 END)::int                AS num_mora,
          COUNT(CASE WHEN p.estado = 'refinanciado'
            THEN 1 END)::int                                                AS num_refinanciados
        FROM ${S}.cred_productos p
        LEFT JOIN mora_por_producto mpm ON mpm.producto_id = p.id
        WHERE p.tipo NOT IN ('fiado','adelanto')
      `),

      // 2. Intereses cobrados por período
      //    LEAST(p.monto, cu.monto_cuota) evita sobrecontar en casos de sobrepago
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN p.fecha_pago::date = $1
            THEN LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0) END), 0) AS hoy,
          COALESCE(SUM(CASE WHEN p.fecha_pago::date >= DATE_TRUNC('week',  $1::date)
            THEN LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0) END), 0) AS semana,
          COALESCE(SUM(CASE WHEN p.fecha_pago::date >= DATE_TRUNC('month', $1::date)
            THEN LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0) END), 0) AS mes,
          COALESCE(SUM(LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0)), 0) AS total
        FROM ${S}.cred_pagos p
        JOIN ${S}.cred_cuotas cu ON cu.id = p.cuota_id
      `, [hoy]),

      // 3. Mora: clientes y montos por antigüedad
      //    Usa comparación de fechas — NO usa estado='mora' que no se auto-asigna
      query(`
        SELECT
          COUNT(DISTINCT CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            THEN cu.cliente_id END)::int                                               AS clientes_total,
          COUNT(DISTINCT CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) > 30
            THEN cu.cliente_id END)::int                                               AS clientes_30d,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_total,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) <= 30
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_0_30d,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) BETWEEN 31 AND 60
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_31_60d,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) > 60
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_mas60d
        FROM ${S}.cred_cuotas cu
        WHERE cu.fecha_vencimiento != '2099-12-31'
      `, [hoy]),

      // 4. Recaudo por período
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN fecha_pago::date = $1                             THEN monto END), 0) AS hoy,
          COALESCE(SUM(CASE WHEN fecha_pago::date >= DATE_TRUNC('week',  $1::date) THEN monto END), 0) AS semana,
          COALESCE(SUM(CASE WHEN fecha_pago::date >= DATE_TRUNC('month', $1::date) THEN monto END), 0) AS mes,
          COALESCE(SUM(monto), 0) AS total
        FROM ${S}.cred_pagos
      `, [hoy]),

      // 5. Cartera vencida por antigüedad (comparación de fechas — NO estado='mora')
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento = $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS vencio_hoy,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento >= DATE_TRUNC('week',  $1::date)
            AND cu.fecha_vencimiento <  $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS vencio_semana,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento >= DATE_TRUNC('month', $1::date)
            AND cu.fecha_vencimiento <  $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS vencio_mes,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento < $1::date - INTERVAL '30 days'
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS mas_30d,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento < $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS total
        FROM ${S}.cred_cuotas cu
        WHERE cu.fecha_vencimiento != '2099-12-31'
      `, [hoy]),

      // 6. Capital en la calle: suma de abono_capital pendiente en productos activos
      query(`
        SELECT COALESCE(SUM(
          cu.abono_capital * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
        ), 0) AS total
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        WHERE cu.estado IN ('pendiente','parcial')
          AND p.estado IN ('activo','al_dia','en_mora')
          AND cu.fecha_vencimiento != '2099-12-31'
      `),

      // 7. Intereses proyectados: suma de abono_interes pendiente en productos activos
      query(`
        SELECT COALESCE(SUM(
          cu.abono_interes * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
        ), 0) AS total
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        WHERE cu.estado IN ('pendiente','parcial')
          AND p.estado IN ('activo','al_dia','en_mora')
          AND cu.fecha_vencimiento != '2099-12-31'
      `),

      // 8. Saldo actual de caja
      query(`
        SELECT COALESCE(
          (SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 1),
          0
        ) AS saldo
      `),

      // 9. Cuotas que vencen HOY (pendientes/parciales)
      query(`
        SELECT cu.*, c.nombre AS nombre_cliente, p.tipo
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_clientes  c ON c.id = cu.cliente_id
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        WHERE cu.fecha_vencimiento = $1 AND cu.estado IN ('pendiente','parcial')
        ORDER BY c.nombre
      `, [hoy]),

      // 10. Cuotas próximos 7 días
      query(`
        SELECT cu.*, c.nombre AS nombre_cliente
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_clientes c ON c.id = cu.cliente_id
        WHERE cu.fecha_vencimiento BETWEEN $1::date + 1 AND $1::date + 7
          AND cu.estado IN ('pendiente','parcial')
        ORDER BY cu.fecha_vencimiento
      `, [hoy]),

      // 11. Empeños próximos a vencer (15 días)
      query(`
        SELECT p.*, c.nombre AS nombre_cliente
        FROM ${S}.cred_productos p
        JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
        WHERE p.tipo = 'empeno' AND p.estado = 'activo'
          AND p.fecha_limite_rescate BETWEEN $1 AND $1::date + 15
        ORDER BY p.fecha_limite_rescate
      `, [hoy]),

      // 12. Otros rubros activos por tipo (fiado, adelanto, venta, empeno)
      query(`
        SELECT
          p.tipo,
          COUNT(*)::int                                                   AS cantidad,
          COALESCE(SUM(p.monto_capital), 0)                               AS capital_total,
          COALESCE(SUM(
            (SELECT SUM(cu.monto_cuota - cu.monto_pagado)
             FROM ${S}.cred_cuotas cu
             WHERE cu.producto_id = p.id AND cu.estado != 'pagada')
          ), 0)                                                           AS saldo_pendiente
        FROM ${S}.cred_productos p
        WHERE p.tipo IN ('fiado','adelanto','venta','empeno')
          AND p.estado NOT IN ('saldado','decomisado','refinanciado')
        GROUP BY p.tipo
        ORDER BY p.tipo
      `),
    ])

    const ce = carteraEstados.rows[0]
    const ip = interesesPeriodos.rows[0]
    const mp = moraPeriodos.rows[0]
    const rp = recaudoPeriodos.rows[0]
    const cv = carteraVencida.rows[0]

    return NextResponse.json({
      cartera: {
        capital_activo:        parseFloat(ce.capital_activo),
        capital_saldado:       parseFloat(ce.capital_saldado),
        capital_mora:          parseFloat(ce.capital_mora),
        capital_refinanciado:  parseFloat(ce.capital_refinanciado),
        num_activos:           ce.num_activos,
        num_saldados:          ce.num_saldados,
        num_mora:              ce.num_mora,
        num_refinanciados:     ce.num_refinanciados,
      },
      intereses: {
        hoy:    parseFloat(ip.hoy),
        semana: parseFloat(ip.semana),
        mes:    parseFloat(ip.mes),
        total:  parseFloat(ip.total),
      },
      mora: {
        clientes_total: mp.clientes_total,
        clientes_30d:   mp.clientes_30d,
        monto_total:    parseFloat(mp.monto_total),
        monto_0_30d:    parseFloat(mp.monto_0_30d),
        monto_31_60d:   parseFloat(mp.monto_31_60d),
        monto_mas60d:   parseFloat(mp.monto_mas60d),
      },
      recaudo: {
        hoy:    parseFloat(rp.hoy),
        semana: parseFloat(rp.semana),
        mes:    parseFloat(rp.mes),
        total:  parseFloat(rp.total),
      },
      cartera_vencida: {
        vencio_hoy:    parseFloat(cv.vencio_hoy),
        vencio_semana: parseFloat(cv.vencio_semana),
        vencio_mes:    parseFloat(cv.vencio_mes),
        mas_30d:       parseFloat(cv.mas_30d),
        total:         parseFloat(cv.total),
      },
      capital: {
        en_calle:              parseFloat(capitalCalle.rows[0].total),
        intereses_proyectados: parseFloat(interesesProyectados.rows[0].total),
        saldo_caja:            parseFloat(saldoCaja.rows[0].saldo),
      },
      cuotas_hoy:     cuotasHoy.rows,
      cuotas_semana:  cuotasSemana.rows,
      empenos_vencer: empenosVencer.rows,
      otros_rubros:   otrosRubros.rows.map(r => ({
        tipo:            r.tipo,
        cantidad:        r.cantidad,
        capital_total:   parseFloat(r.capital_total),
        saldo_pendiente: parseFloat(r.saldo_pendiente),
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
