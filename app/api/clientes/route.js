import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

// Auto-migraciones (corren una sola vez por proceso de Node)
let _migracionesOk = false
async function asegurarColumnaEsPrueba() {
  if (_migracionesOk) return
  await query(`
    DO $$ BEGIN
      -- Columna es_prueba
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = '${S}' AND table_name = 'cred_clientes' AND column_name = 'es_prueba'
      ) THEN
        ALTER TABLE ${S}.cred_clientes ADD COLUMN es_prueba BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;
      -- Columna telefono2
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = '${S}' AND table_name = 'cred_clientes' AND column_name = 'telefono2'
      ) THEN
        ALTER TABLE ${S}.cred_clientes ADD COLUMN telefono2 TEXT;
      END IF;
    END$$
  `)
  // Normalizar nombre y dirección existentes a mayúsculas (one-shot)
  await query(`
    UPDATE ${S}.cred_clientes
    SET nombre    = UPPER(nombre),
        direccion = UPPER(direccion)
    WHERE nombre <> UPPER(nombre)
       OR (direccion IS NOT NULL AND direccion <> UPPER(direccion))
  `)
  _migracionesOk = true
}

export async function GET(request) {
  try {
    await asegurarColumnaEsPrueba()

    const { searchParams } = new URL(request.url)
    const buscar     = searchParams.get('q') || ''
    const soloPrueba = searchParams.get('solo_prueba') // 'true' | 'false' | null

    const filtrosPrueba = soloPrueba === 'true'  ? 'AND c.es_prueba = TRUE'
                        : soloPrueba === 'false' ? 'AND c.es_prueba = FALSE'
                        : ''

    const sql = `
      SELECT c.*,
        COUNT(DISTINCT p.id) FILTER (WHERE p.estado NOT IN ('saldado','decomisado','refinanciado')) AS productos_activos,
        COUNT(DISTINCT p.id)  AS total_productos,
        COUNT(DISTINCT pg.id) AS total_pagos,
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
      LEFT JOIN ${S}.cred_pagos    pg ON pg.cliente_id = c.id
      WHERE ($1 = '' OR c.nombre ILIKE $2 OR c.documento ILIKE $2)
        ${filtrosPrueba}
      GROUP BY c.id
      ORDER BY c.es_prueba ASC, c.nombre ASC
    `
    const result = await query(sql, [buscar, `%${buscar}%`])
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    await asegurarColumnaEsPrueba()

    const { documento, nombre, telefono, direccion, email, es_prueba } = await request.json()
    if (!documento || !nombre)
      return NextResponse.json({ error: 'documento y nombre son obligatorios' }, { status: 400 })

    const id = uuidv4()
    const [result, u] = await Promise.all([
      query(
        `INSERT INTO ${S}.cred_clientes (id,documento,nombre,telefono,direccion,email,es_prueba)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, documento, nombre, telefono||null, direccion||null, email||null, es_prueba === true]
      ),
      getUsuarioDesdeRequest(request),
    ])
    auditar({ ...u, accion: ACCIONES.CREAR_CLIENTE, modulo: MODULOS.CLIENTES,
      descripcion: `Nuevo cliente: ${nombre} (${documento})${es_prueba ? ' [PRUEBA]' : ''}`,
      detalle: { id, documento, nombre, es_prueba: es_prueba === true } })

    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (error) {
    if (error.code === '23505')
      return NextResponse.json({ error: 'El documento ya existe' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
