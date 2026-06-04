import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

const S = 'administrativo'

export async function GET() {
  try {
    const res    = await query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='modo_prueba'`)
    const activo = res.rows[0]?.valor === 'true'
    return NextResponse.json({ activo })
  } catch {
    return NextResponse.json({ activo: false })
  }
}


export async function POST(request) {
  try {
    const { activo } = await request.json()
    const valor = activo ? 'true' : 'false'

    // Borrar si existe y reinsertar con id
    await query(`DELETE FROM ${S}.cred_configuracion WHERE clave='modo_prueba'`)
    await query(`INSERT INTO ${S}.cred_configuracion (id, clave, valor) VALUES ($1, 'modo_prueba', $2)`, [uuidv4(), valor])

    return NextResponse.json({ ok: true, activo })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
