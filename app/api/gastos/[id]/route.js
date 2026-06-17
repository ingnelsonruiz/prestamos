import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function DELETE(request, { params }) {
  try {
    const { id } = params
    const r = await query(`DELETE FROM ${S}.cred_gastos WHERE id=$1 RETURNING id`, [id])
    if (!r.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
