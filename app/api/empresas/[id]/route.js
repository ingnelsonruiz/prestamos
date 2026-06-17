import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function PUT(request, { params }) {
  try {
    const { id } = params
    const { nombre, descripcion, activo } = await request.json()
    const r = await query(
      `UPDATE ${S}.cred_empresas_propias SET nombre=$1, descripcion=$2, activo=$3 WHERE id=$4 RETURNING *`,
      [nombre?.trim().toUpperCase(), descripcion?.trim()||null, activo !== false, id]
    )
    if (!r.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json(r.rows[0])
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params
    const uso = await query(
      `SELECT 1 FROM ${S}.cred_gastos WHERE empresa_id=$1 LIMIT 1`, [id]
    )
    if (uso.rows.length)
      return NextResponse.json({ error: 'La empresa tiene gastos registrados. Solo puedes desactivarla.' }, { status: 400 })
    await query(`DELETE FROM ${S}.cred_empresas_propias WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
