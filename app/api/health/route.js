import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET() {
  const inicio = Date.now()
  try {
    await query('SELECT 1')
    return NextResponse.json({ ok: true, ms: Date.now() - inicio })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 503 })
  }
}
