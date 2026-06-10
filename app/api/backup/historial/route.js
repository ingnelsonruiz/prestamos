import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

export async function GET() {
  try {
    const res = await query(
      `SELECT * FROM ${S}.cred_backups ORDER BY fecha DESC LIMIT 50`
    )
    return NextResponse.json(res.rows)
  } catch (error) {
    // Si la tabla aún no existe (migración pendiente), devolver vacío
    if (error.message?.includes('does not exist')) return NextResponse.json([])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
