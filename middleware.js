import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose/jwt/verify'

const SECRET  = new TextEncoder().encode(process.env.JWT_SECRET || 'inversiones-tata-linan-secret-2026')
const COOKIE  = 'itl_session'

// Rutas que NO requieren login
const PUBLICAS = ['/login', '/estado', '/api/auth']

export async function middleware(request) {
  const { pathname } = request.nextUrl

  // Permitir rutas públicas
  if (PUBLICAS.some(r => pathname.startsWith(r))) return NextResponse.next()

  const token = request.cookies.get(COOKIE)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    await jwtVerify(token, SECRET)
    return NextResponse.next()
  } catch {
    const res = NextResponse.redirect(new URL('/login', request.url))
    res.cookies.delete(COOKIE)
    return res
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
