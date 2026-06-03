import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const modulo  = searchParams.get('modulo') || ''
    const usuario = searchParams.get('usuario') || ''
    const fecha   = searchParams.get('fecha') || ''
    const limite  = parseInt(searchParams.get('limite') || '100')

    let sql = `SELECT * FROM administrativo.cred_auditoria WHERE 1=1`
    const values = []

    if (modulo)  { sql += ` AND modulo=$${values.length+1}`;              values.push(modulo) }
    if (usuario) { sql += ` AND usuario_nombre ILIKE $${values.length+1}`; values.push(`%${usuario}%`) }
    if (fecha)   { sql += ` AND fecha::date = $${values.length+1}`;        values.push(fecha) }

    sql += ` ORDER BY fecha DESC LIMIT $${values.length+1}`
    values.push(limite)

    const res = await query(sql, values)
    return NextResponse.json(res.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
