import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

let _ok = false
async function setup() {
  if (_ok) return
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='${S}' AND table_name='cred_empresas_propias')
      THEN
        CREATE TABLE ${S}.cred_empresas_propias (
          id TEXT PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT,
          activo BOOLEAN NOT NULL DEFAULT TRUE,
          fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      END IF;
    END$$
  `)
  _ok = true
}

export async function GET() {
  try {
    await setup()
    const r = await query(
      `SELECT ep.*,
         COALESCE(SUM(p.monto_capital) FILTER (WHERE p.es_prestamo_interno AND p.estado NOT IN ('saldado','decomisado','refinanciado')), 0) AS saldo_prestamos,
         COALESCE(SUM(g.monto), 0) AS total_gastos
       FROM ${S}.cred_empresas_propias ep
       LEFT JOIN ${S}.cred_productos p ON p.empresa_id = ep.id
       LEFT JOIN ${S}.cred_gastos g    ON g.empresa_id = ep.id
       GROUP BY ep.id
       ORDER BY ep.nombre ASC`
    )
    return NextResponse.json(r.rows)
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(request) {
  try {
    await setup()
    const { nombre, descripcion } = await request.json()
    if (!nombre?.trim()) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })
    const id = uuidv4()
    const r = await query(
      `INSERT INTO ${S}.cred_empresas_propias (id,nombre,descripcion) VALUES ($1,$2,$3) RETURNING *`,
      [id, nombre.trim().toUpperCase(), descripcion?.trim()||null]
    )
    const u = await getUsuarioDesdeRequest(request)
    auditar({ ...u, accion: 'Crear empresa', modulo: MODULOS.CLIENTES||'Empresas',
      descripcion: `Nueva empresa: ${nombre}`, detalle: { id } })
    return NextResponse.json(r.rows[0], { status: 201 })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
