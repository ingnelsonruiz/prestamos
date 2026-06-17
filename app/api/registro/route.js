import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

const S = 'administrativo'

let _ok = false
async function setup() {
  if (_ok) return
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='${S}' AND table_name='cred_clientes' AND column_name='telefono2')
      THEN ALTER TABLE ${S}.cred_clientes ADD COLUMN telefono2 TEXT; END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='${S}' AND table_name='cred_clientes' AND column_name='es_prueba')
      THEN ALTER TABLE ${S}.cred_clientes ADD COLUMN es_prueba BOOLEAN NOT NULL DEFAULT FALSE; END IF;
    END$$
  `)
  _ok = true
}

// ── Validaciones reutilizables ──────────────────────────────────────────────
function validarCampos({ nombre, documento, telefono, telefono2, email }) {
  const errores = {}

  // Nombre: solo letras, espacios y tildes, mínimo 3 chars
  const nomL = nombre?.trim() || ''
  if (!nomL) errores.nombre = 'El nombre es obligatorio.'
  else if (nomL.length < 3) errores.nombre = 'El nombre debe tener al menos 3 caracteres.'
  else if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(nomL))
    errores.nombre = 'El nombre solo puede contener letras.'

  // Documento: solo dígitos, entre 5 y 12 caracteres
  const docL = documento?.trim() || ''
  if (!docL) errores.documento = 'La cédula es obligatoria.'
  else if (!/^\d+$/.test(docL)) errores.documento = 'La cédula solo debe contener números.'
  else if (docL.length < 5)  errores.documento = 'La cédula debe tener al menos 5 dígitos.'
  else if (docL.length > 12) errores.documento = 'La cédula no puede tener más de 12 dígitos.'

  // Teléfono: solo dígitos, entre 7 y 10 caracteres
  const telL = telefono?.trim() || ''
  if (!telL) errores.telefono = 'El teléfono es obligatorio.'
  else if (!/^\d+$/.test(telL)) errores.telefono = 'El teléfono solo debe contener números.'
  else if (telL.length < 7)  errores.telefono = 'El teléfono debe tener al menos 7 dígitos.'
  else if (telL.length > 10) errores.telefono = 'El teléfono no puede tener más de 10 dígitos.'

  // Teléfono 2 (opcional, mismas reglas si se ingresa)
  const tel2L = telefono2?.trim() || ''
  if (tel2L) {
    if (!/^\d+$/.test(tel2L)) errores.telefono2 = 'Solo debe contener números.'
    else if (tel2L.length < 7)  errores.telefono2 = 'Debe tener al menos 7 dígitos.'
    else if (tel2L.length > 10) errores.telefono2 = 'No puede tener más de 10 dígitos.'
  }

  // Email (opcional, formato básico si se ingresa)
  const emailL = email?.trim() || ''
  if (emailL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailL))
    errores.email = 'El correo no tiene un formato válido.'

  return errores
}

// GET — verifica en tiempo real si una cédula ya existe
// ?documento=1067712345
export async function GET(request) {
  try {
    await setup()
    const { searchParams } = new URL(request.url)
    const documento = searchParams.get('documento')?.trim()
    if (!documento) return NextResponse.json({ existe: false })

    const r = await query(
      `SELECT 1 FROM ${S}.cred_clientes WHERE documento=$1 LIMIT 1`, [documento]
    )
    return NextResponse.json({ existe: r.rows.length > 0 })
  } catch {
    return NextResponse.json({ existe: false })
  }
}

// POST — registra nuevo cliente
export async function POST(request) {
  try {
    await setup()
    const body = await request.json()
    const { nombre, documento, telefono, telefono2, direccion, email } = body

    // Validaciones de formato
    const errores = validarCampos({ nombre, documento, telefono, telefono2, email })
    if (Object.keys(errores).length > 0)
      return NextResponse.json({ error: 'Datos inválidos.', errores }, { status: 400 })

    // Verificar duplicado explícitamente (antes del INSERT, mensaje más claro)
    const dup = await query(
      `SELECT nombre FROM ${S}.cred_clientes WHERE documento=$1 LIMIT 1`,
      [documento.trim()]
    )
    if (dup.rows.length > 0)
      return NextResponse.json({
        error: 'Esa cédula ya está registrada. Si crees que es un error, comunícate con nosotros.',
        errores: { documento: 'Cédula ya registrada.' }
      }, { status: 409 })

    const id = uuidv4()
    const result = await query(
      `INSERT INTO ${S}.cred_clientes
         (id, documento, nombre, telefono, telefono2, direccion, email, es_prueba)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)
       RETURNING id, nombre, documento`,
      [id, documento.trim(), nombre.trim(),
       telefono.trim(), telefono2?.trim()||null,
       direccion?.trim()||null, email?.trim()||null]
    )

    return NextResponse.json({ ok: true, cliente: result.rows[0] }, { status: 201 })
  } catch (error) {
    if (error.code === '23505')
      return NextResponse.json({
        error: 'Esa cédula ya está registrada.',
        errores: { documento: 'Cédula ya registrada.' }
      }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
