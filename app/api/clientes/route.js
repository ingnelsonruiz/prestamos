import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const buscar = searchParams.get('q') || ''

    const sql = `
      SELECT c.*,
        COUNT(DISTINCT p.id) FILTER (WHERE p.estado NOT IN ('saldado','decomisado','refinanciado')) AS productos_activos,
        -- Mora derivada por fecha (no por estado persistido): cuota vencida y no pagada,
        -- excluyendo cuentas abiertas (fiado/adelanto, vencen 2099-12-31).
        COUNT(DISTINCT cu.id) FILTER (
          WHERE cu.fecha_vencimiento < CURRENT_DATE
            AND cu.estado != 'pagada'
            AND cu.fecha_vencimiento <> DATE '2099-12-31'
        ) AS cuotas_en_mora,
        CASE
          WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.estado NOT IN ('saldado','decomisado','refinanciado')) = 0 THEN 'sin_prestamos'
          WHEN COUNT(DISTINCT cu.id) FILTER (
            WHERE cu.fecha_vencimiento < CURRENT_DATE
              AND cu.estado != 'pagada'
              AND cu.fecha_vencimiento <> DATE '2099-12-31'
          ) > 0 THEN 'en_mora'
          WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.estado NOT IN ('saldado','decomisado','refinanciado')) > 0 THEN 'activo'
          ELSE 'sin_prestamos'
        END AS estado_calculado
      FROM ${S}.cred_clientes c
      LEFT JOIN ${S}.cred_productos p  ON p.cliente_id = c.id
      LEFT JOIN ${S}.cred_cuotas   cu ON cu.cliente_id = c.id AND cu.producto_id = p.id
      WHERE ($1 = '' OR c.nombre ILIKE $2 OR c.documento ILIKE $2)
      GROUP BY c.id
      ORDER BY c.nombre ASC
    `
    const result = await query(sql, [buscar, `%${buscar}%`])
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { documento, nombre, telefono, direccion, email } = await request.json()
    if (!documento || !nombre)
      return NextResponse.json({ error: 'documento y nombre son obligatorios' }, { status: 400 })

    const id = uuidv4()
    const [result, u] = await Promise.all([
      query(
        `INSERT INTO ${S}.cred_clientes (id,documento,nombre,telefono,direccion,email)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, documento, nombre, telefono||null, direccion||null, email||null]
      ),
      getUsuarioDesdeRequest(request),
    ])
    // Auditoría fire-and-forget — no bloquea la respuesta
    auditar({ ...u, accion: ACCIONES.CREAR_CLIENTE, modulo: MODULOS.CLIENTES,
      descripcion: `Nuevo cliente: ${nombre} (${documento})`,
      detalle: { id, documento, nombre } })

    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (error) {
    if (error.code === '23505')
      return NextResponse.json({ error: 'El documento ya existe' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
