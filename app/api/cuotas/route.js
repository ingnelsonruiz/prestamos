import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const estado     = searchParams.get('estado') || 'pendiente'  // 'todas' → sin filtro
    const clienteId  = searchParams.get('cliente_id')
    const productoId = searchParams.get('producto_id')
    const hoy        = new Date().toISOString().split('T')[0]

    const segmento = searchParams.get('segmento') // 'clientes' | 'empresas' | null=todos

    let sql = `
      SELECT cu.*,
             c.nombre    AS nombre_cliente,
             c.telefono  AS telefono_cliente,
             p.tipo      AS tipo_producto,
             p.descripcion_bien,
             p.fecha_creacion   AS fecha_prestamo,
             p.monto_capital    AS capital_producto,
             p.referencia       AS referencia_producto,
             p.tasa_interes     AS tasa_interes_producto,
             p.periodo_tasa     AS periodo_tasa_producto,
             p.frecuencia_cobro AS frecuencia_cobro_producto,
             p.num_cuotas       AS num_cuotas_producto,
             p.metodo_calculo   AS metodo_calculo_producto,
             COALESCE(p.fecha_desembolso, p.fecha_primer_pago, p.fecha_creacion::DATE) AS fecha_desembolso_real,
             -- 2026-08-11: columnas separadas para distinguir en la UI "fecha de
             -- desembolso" (dinero entregado) de "fecha de pago" (cuota vencida/por
             -- vencer). `fecha_desembolso_real` (arriba) mezcla ambos conceptos vía
             -- COALESCE — correcto para la regla de 30 días de créditos libres (§24
             -- CLAUDE.md, no tocar), pero ambiguo si se muestra tal cual para un
             -- préstamo normal (mostraría la fecha de la primera cuota, no cuándo se
             -- entregó el dinero). Ver /prestamos/[id] para la misma prioridad
             -- (fecha_desembolso > fecha_creacion, sin fecha_primer_pago de por medio).
             COALESCE(p.fecha_desembolso, p.fecha_creacion::DATE) AS fecha_desembolso_mostrar,
             p.fecha_primer_pago AS fecha_primer_pago_producto,
             p.empresa_id       AS empresa_id,
             ep.nombre          AS empresa_nombre,
             GREATEST(0, CURRENT_DATE - cu.fecha_vencimiento) AS dias_mora
      FROM ${S}.cred_cuotas cu
      LEFT JOIN ${S}.cred_clientes       c  ON c.id  = cu.cliente_id
      JOIN      ${S}.cred_productos      p  ON p.id  = cu.producto_id
      LEFT JOIN ${S}.cred_empresas_propias ep ON ep.id = p.empresa_id
      WHERE p.estado != 'refinanciado'
    `
    const values = []

    if (estado === 'todas') {
      // Sin filtro de estado — devuelve pagadas + parciales + pendientes
    } else if (estado === 'mora') {
      sql += ` AND cu.fecha_vencimiento < $${values.length+1} AND cu.monto_pagado < cu.monto_cuota AND cu.estado != 'pagada'`
      values.push(hoy)
    } else {
      sql += ` AND cu.estado = $${values.length+1}`
      values.push(estado)
    }

    if (segmento === 'clientes')  sql += ` AND p.empresa_id IS NULL`
    if (segmento === 'empresas')  sql += ` AND p.empresa_id IS NOT NULL`
    if (clienteId)  { sql += ` AND cu.cliente_id=$${values.length+1}`;  values.push(clienteId) }
    if (productoId) { sql += ` AND cu.producto_id=$${values.length+1}`; values.push(productoId) }
    sql += ` ORDER BY cu.fecha_vencimiento ASC`

    const result = await query(sql, values)
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
