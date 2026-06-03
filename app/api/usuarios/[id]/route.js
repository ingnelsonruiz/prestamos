import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

// PUT — editar usuario o cambiar contraseña
export async function PUT(request, { params }) {
  try {
    const { id } = params
    const { nombre, rol, activo, password } = await request.json()

    const u = await getUsuarioDesdeRequest(request)

    if (password) {
      const hash = await bcrypt.hash(password, 10)
      await query(`UPDATE ${S}.cred_usuarios SET password_hash=$1 WHERE id=$2`, [hash, id])
      await auditar({ ...u, accion: ACCIONES.CAMBIAR_CLAVE, modulo: MODULOS.USUARIOS,
        descripcion: `Cambió contraseña del usuario ID: ${id}`, detalle: { id } })
    }

    const res = await query(
      `UPDATE ${S}.cred_usuarios
       SET nombre=COALESCE($1,nombre), rol=COALESCE($2,rol),
           activo=COALESCE($3,activo)
       WHERE id=$4 RETURNING id, nombre, usuario, rol, activo`,
      [nombre||null, rol||null, activo??null, id]
    )
    return NextResponse.json(res.rows[0])
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE — desactivar usuario
export async function DELETE(request, { params }) {
  try {
    const { id } = params
    await query(`UPDATE ${S}.cred_usuarios SET activo=false WHERE id=$1`, [id])
    const u = await getUsuarioDesdeRequest(request)
    await auditar({ ...u, accion: ACCIONES.DESACTIVAR_USUARIO, modulo: MODULOS.USUARIOS,
      descripcion: `Desactivó usuario ID: ${id}`, detalle: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
