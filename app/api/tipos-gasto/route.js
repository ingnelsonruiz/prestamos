import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

const S = 'administrativo'

const TIPOS_BASE = [
  { id:'tg-nomina',      nombre:'Nómina',              orden:1 },
  { id:'tg-materiales',  nombre:'Compra de materiales', orden:2 },
  { id:'tg-imprevistos', nombre:'Imprevistos',          orden:3 },
  { id:'tg-servicios',   nombre:'Servicios públicos',   orden:4 },
  { id:'tg-transporte',  nombre:'Transporte',           orden:5 },
  { id:'tg-alimentacion',nombre:'Alimentación',         orden:6 },
  { id:'tg-personal',    nombre:'Gasto personal',       orden:7 },
]

let _ok = false
async function setup() {
  if (_ok) return
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='${S}' AND table_name='cred_tipos_gasto')
      THEN
        CREATE TABLE ${S}.cred_tipos_gasto (
          id TEXT PRIMARY KEY, nombre TEXT NOT NULL,
          es_sistema BOOLEAN NOT NULL DEFAULT FALSE,
          activo BOOLEAN NOT NULL DEFAULT TRUE,
          orden INTEGER DEFAULT 99,
          fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      END IF;
    END$$
  `)
  for (const t of TIPOS_BASE) {
    await query(
      `INSERT INTO ${S}.cred_tipos_gasto (id,nombre,es_sistema,orden) VALUES ($1,$2,TRUE,$3) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.nombre, t.orden]
    )
  }
  _ok = true
}

export async function GET() {
  try {
    await setup()
    const r = await query(`SELECT * FROM ${S}.cred_tipos_gasto ORDER BY orden ASC, nombre ASC`)
    return NextResponse.json(r.rows)
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(request) {
  try {
    await setup()
    const { nombre } = await request.json()
    if (!nombre?.trim()) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })
    const id = uuidv4()
    const r = await query(
      `INSERT INTO ${S}.cred_tipos_gasto (id,nombre,es_sistema) VALUES ($1,$2,FALSE) RETURNING *`,
      [id, nombre.trim().toUpperCase()]
    )
    return NextResponse.json(r.rows[0], { status: 201 })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
