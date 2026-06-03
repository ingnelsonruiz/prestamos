import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verificarToken, COOKIE } from '@/lib/auth'

export async function GET() {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return NextResponse.json({ user: null })
  const payload = await verificarToken(token)
  if (!payload) return NextResponse.json({ user: null })
  return NextResponse.json({ user: { nombre: payload.nombre, usuario: payload.usuario, rol: payload.rol } })
}
