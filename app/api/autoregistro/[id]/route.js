import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

// Auto-migración: agrega telefono2 si no existe
let _t2Verificado = false
async function asegurarTelefono2() {
  if (_t2Verificado) return
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='${S}' AND table_name='cred_clientes' AND column_name='telefono2'
      ) THEN
        ALTER TABLE ${S}.cred_clientes ADD COLUMN telefono2 TEXT;
      END IF;
    END$$
  `)
  _t2Verificado = true
}

// GET público — carga los datos del cliente para mostrar en el formulario
export async function GET(request, { params }) {
  try {
    await asegurarTelefono2()
    const { id } = params
    const r = await query(
      `SELECT id, nombre, documento, telefono, telefono2, direccion, email FROM ${S}.cred_clientes WHERE id=$1`,
      [id]
    )
    if (!r.rows.length) return NextResponse.json({ error: 'Enlace no válido' }, { status: 404 })
    return NextResponse.json(r.rows[0])
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST público — el cliente actualiza sus propios datos de contacto
export async function POST(request, { params }) {
  try {
    await asegurarTelefono2()
    const { id } = params
    const { documento, telefono, telefono2, direccion, email } = await request.json()

    // Verificar que el cliente exista
    const existe = await query(`SELECT id, documento FROM ${S}.cred_clientes WHERE id=$1`, [id])
    if (!existe.rows.length) return NextResponse.json({ error: 'Enlace no válido' }, { status: 404 })

    // Validar: el documento solo se puede actualizar si actualmente está vacío o es un placeholder
    const docActual = existe.rows[0].documento
    const docEsPlaceholder = !docActual || docActual.trim() === '' || /^[0-9]{1,3}$/.test(docActual.trim())
    const nuevoDoc = documento?.trim() || null

    if (nuevoDoc && !docEsPlaceholder) {
      // Si ya tiene documento real, verificar que no cambie a uno diferente (conflicto)
      if (nuevoDoc !== docActual) {
        return NextResponse.json({ error: 'El documento ya está registrado y no puede modificarse aquí.' }, { status: 400 })
      }
    }

    // Verificar unicidad del documento si va a cambiar
    if (nuevoDoc && nuevoDoc !== docActual) {
      const dup = await query(
        `SELECT 1 FROM ${S}.cred_clientes WHERE documento=$1 AND id!=$2 LIMIT 1`,
        [nuevoDoc, id]
      )
      if (dup.rows.length) return NextResponse.json({ error: 'Ese número de documento ya pertenece a otro cliente.' }, { status: 409 })
    }

    const result = await query(
      `UPDATE ${S}.cred_clientes
       SET documento  = COALESCE(NULLIF($1,''), documento),
           telefono   = COALESCE(NULLIF($2,''), telefono),
           telefono2  = COALESCE(NULLIF($3,''), telefono2),
           direccion  = COALESCE(NULLIF($4,''), direccion),
           email      = COALESCE(NULLIF($5,''), email)
       WHERE id=$6
       RETURNING id, nombre, documento, telefono, telefono2, direccion, email`,
      [nuevoDoc, telefono?.trim()||null, telefono2?.trim()||null,
       direccion?.trim()||null, email?.trim()||null, id]
    )

    return NextResponse.json({ ok: true, cliente: result.rows[0] })
  } catch (error) {
    if (error.code === '23505')
      return NextResponse.json({ error: 'Ese número de documento ya está registrado.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
