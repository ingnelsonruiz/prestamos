import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function PUT(request, { params }) {
  try {
    const { id } = params
    const { nombre, activo } = await request.json()
    const r = await query(
      `UPDATE ${S}.cred_tipos_gasto SET nombre=$1, activo=$2 WHERE id=$3 AND es_sistema=FALSE RETURNING *`,
      [nombre?.trim().toUpperCase(), activo !== false, id]
    )
    if (!r.rows.length) return NextResponse.json({ error: 'No encontrado o es tipo de sistema' }, { status: 404 })
    return NextResponse.json(r.rows[0])
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params
    const sist = await query(`SELECT es_sistema FROM ${S}.cred_tipos_gasto WHERE id=$1`, [id])
    if (!sist.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    if (sist.rows[0].es_sistema) return NextResponse.json({ error: 'No se puede eliminar un tipo de sistema' }, { status: 403 })
    const uso = await query(`SELECT 1 FROM ${S}.cred_gastos WHERE tipo_gasto_id=$1 LIMIT 1`, [id])
    if (uso.rows.length) {
      await query(`UPDATE ${S}.cred_tipos_gasto SET activo=FALSE WHERE id=$1`, [id])
      return NextResponse.json({ ok: true, desactivado: true })
    }
    await query(`DELETE FROM ${S}.cred_tipos_gasto WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
