import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function GET() {
  try {
    const res = await query(
      `SELECT id, nombre, usuario, rol, activo, fecha_creacion, ultimo_acceso
       FROM ${S}.cred_usuarios ORDER BY fecha_creacion`
    )
    return NextResponse.json(res.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { nombre, usuario, password, rol } = await request.json()
    if (!nombre || !usuario || !password)
      return NextResponse.json({ error: 'Nombre, usuario y contraseña son obligatorios' }, { status: 400 })

    const hash = await bcrypt.hash(password, 10)
    const id   = uuidv4()

    const res = await query(
      `INSERT INTO ${S}.cred_usuarios (id, nombre, usuario, password_hash, rol)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, usuario, rol, activo`,
      [id, nombre, usuario, hash, rol || 'operador']
    )
    const u = await getUsuarioDesdeRequest(request)
    await auditar({ ...u, accion: ACCIONES.CREAR_USUARIO, modulo: MODULOS.USUARIOS,
      descripcion: `Creó usuario: ${usuario} (${rol})`, detalle: { id, usuario, rol } })

    return NextResponse.json(res.rows[0], { status: 201 })
  } catch (error) {
    if (error.code === '23505')
      return NextResponse.json({ error: 'El usuario ya existe' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
