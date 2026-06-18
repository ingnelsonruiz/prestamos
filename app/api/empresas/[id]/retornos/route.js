import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { getUsuarioDesdeRequest } from '@/lib/auditoria'

const S = 'administrativo'

async function setup() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${S}.cred_retornos_empresa (
      id             TEXT PRIMARY KEY,
      empresa_id     TEXT NOT NULL REFERENCES ${S}.cred_empresas_propias(id),
      producto_id    TEXT,
      monto_capital  NUMERIC NOT NULL CHECK (monto_capital > 0),
      monto_interes  NUMERIC NOT NULL DEFAULT 0 CHECK (monto_interes >= 0),
      monto_total    NUMERIC GENERATED ALWAYS AS (monto_capital + monto_interes) STORED,
      fecha_retorno  DATE NOT NULL DEFAULT CURRENT_DATE,
      notas          TEXT,
      usuario_nombre TEXT,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_cred_retornos_empresa ON ${S}.cred_retornos_empresa(empresa_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_cred_retornos_fecha   ON ${S}.cred_retornos_empresa(fecha_retorno DESC)`)
}

export async function GET(request, { params }) {
  try {
    await setup()
    const { id } = params
    const r = await query(
      `SELECT * FROM ${S}.cred_retornos_empresa
       WHERE empresa_id = $1
       ORDER BY fecha_retorno DESC, fecha_creacion DESC`,
      [id]
    )
    return NextResponse.json(r.rows)
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    await setup()
    const { id } = params
    const { monto_capital, monto_interes = 0, fecha_retorno, notas, producto_id } = await request.json()

    if (!monto_capital || Number(monto_capital) <= 0)
      return NextResponse.json({ error: 'El monto de capital es obligatorio y debe ser mayor a 0' }, { status: 400 })
    if (Number(monto_interes) < 0)
      return NextResponse.json({ error: 'El interés no puede ser negativo' }, { status: 400 })

    // Verificar que la empresa existe
    const emp = await query(`SELECT id FROM ${S}.cred_empresas_propias WHERE id = $1`, [id])
    if (!emp.rows.length)
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const u = await getUsuarioDesdeRequest(request)
    const retornoId = uuidv4()

    const r = await query(
      `INSERT INTO ${S}.cred_retornos_empresa
         (id, empresa_id, producto_id, monto_capital, monto_interes, fecha_retorno, notas, usuario_nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        retornoId,
        id,
        producto_id || null,
        Number(monto_capital),
        Number(monto_interes),
        fecha_retorno || new Date().toISOString().split('T')[0],
        notas?.trim() || null,
        u?.usuario_nombre || 'admin',
      ]
    )
    return NextResponse.json(r.rows[0], { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params
    const { retorno_id } = await request.json()
    if (!retorno_id)
      return NextResponse.json({ error: 'retorno_id requerido' }, { status: 400 })
    await query(
      `DELETE FROM ${S}.cred_retornos_empresa WHERE id = $1 AND empresa_id = $2`,
      [retorno_id, id]
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
