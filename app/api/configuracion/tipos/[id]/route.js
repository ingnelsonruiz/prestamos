import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

// PUT — editar tipo
export async function PUT(request, { params }) {
  try {
    const u    = await getUsuarioDesdeRequest(request)
    const { id } = params
    const body = await request.json()
    const { label, icono, descripcion, comportamiento, activo, orden } = body

    const actual = await query(`SELECT * FROM ${S}.cred_tipos_prestamo WHERE id=$1`, [id])
    if (!actual.rows.length) return NextResponse.json({ error: 'Tipo no encontrado' }, { status: 404 })

    await query(
      `UPDATE ${S}.cred_tipos_prestamo
       SET label=$1, icono=$2, descripcion=$3, comportamiento=$4, activo=$5, orden=$6
       WHERE id=$7`,
      [
        label        ?? actual.rows[0].label,
        icono        ?? actual.rows[0].icono,
        descripcion  ?? actual.rows[0].descripcion,
        comportamiento ?? actual.rows[0].comportamiento,
        activo       ?? actual.rows[0].activo,
        orden        ?? actual.rows[0].orden,
        id
      ]
    )

    await auditar({
      ...u,
      accion:      'EDITAR TIPO DE PRÉSTAMO',
      modulo:      MODULOS.CONFIG ?? 'CONFIGURACION',
      descripcion: `Editó tipo "${actual.rows[0].label}"`,
      detalle:     { id, cambios: body }
    })

    const updated = await query(`SELECT * FROM ${S}.cred_tipos_prestamo WHERE id=$1`, [id])
    return NextResponse.json(updated.rows[0])
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE — desactivar (no eliminar si tiene productos asociados)
export async function DELETE(request, { params }) {
  try {
    const u    = await getUsuarioDesdeRequest(request)
    const { id } = params

    const tipo = await query(`SELECT * FROM ${S}.cred_tipos_prestamo WHERE id=$1`, [id])
    if (!tipo.rows.length) return NextResponse.json({ error: 'Tipo no encontrado' }, { status: 404 })

    if (tipo.rows[0].es_sistema)
      return NextResponse.json({ error: 'Los tipos del sistema no se pueden eliminar' }, { status: 403 })

    // Verificar si tiene productos activos
    const enUso = await query(
      `SELECT COUNT(*)::int AS n FROM ${S}.cred_productos WHERE tipo=$1 AND estado NOT IN ('saldado','decomisado')`,
      [tipo.rows[0].codigo]
    )

    if (enUso.rows[0].n > 0) {
      // Solo desactivar, no borrar
      await query(`UPDATE ${S}.cred_tipos_prestamo SET activo=FALSE WHERE id=$1`, [id])
      await auditar({
        ...u,
        accion:      'DESACTIVAR TIPO DE PRÉSTAMO',
        modulo:      MODULOS.CONFIG ?? 'CONFIGURACION',
        descripcion: `Desactivó tipo "${tipo.rows[0].label}" (tiene ${enUso.rows[0].n} productos activos)`,
        detalle:     { id }
      })
      return NextResponse.json({ ok: true, mensaje: `Tipo desactivado. Tiene ${enUso.rows[0].n} producto(s) activo(s) con ese tipo.` })
    }

    await query(`DELETE FROM ${S}.cred_tipos_prestamo WHERE id=$1`, [id])
    await auditar({
      ...u,
      accion:      'ELIMINAR TIPO DE PRÉSTAMO',
      modulo:      MODULOS.CONFIG ?? 'CONFIGURACION',
      descripcion: `Eliminó tipo "${tipo.rows[0].label}"`,
      detalle:     { id }
    })
    return NextResponse.json({ ok: true, mensaje: 'Tipo eliminado correctamente.' })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
