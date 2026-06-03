import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { crearToken, COOKIE } from '@/lib/auth'
import { auditar, ACCIONES, MODULOS } from '@/lib/auditoria'
import bcrypt from 'bcryptjs'

export async function POST(request) {
  try {
    const { usuario, password } = await request.json()
    if (!usuario || !password)
      return NextResponse.json({ error: 'Usuario y contraseña requeridos' }, { status: 400 })

    const res = await query(
      `SELECT * FROM administrativo.cred_usuarios WHERE usuario=$1 AND activo=true`, [usuario]
    )
    const user = res.rows[0]
    if (!user)
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 })

    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok)
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 })

    // Actualizar último acceso
    await query(`UPDATE administrativo.cred_usuarios SET ultimo_acceso=NOW() WHERE id=$1`, [user.id])

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'local'
    await auditar({
      usuario_id: user.id, usuario_nombre: user.nombre,
      accion: ACCIONES.LOGIN, modulo: MODULOS.AUTH,
      descripcion: `Inicio de sesión: ${user.usuario}`, ip
    })

    const token = await crearToken({ id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol })

    const response = NextResponse.json({ ok: true, nombre: user.nombre, rol: user.rol })
    response.cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 horas
      path: '/',
    })
    return response
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
