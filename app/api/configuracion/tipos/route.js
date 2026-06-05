import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'
import { v4 as uuidv4 } from 'uuid'

const S = 'administrativo'

const TIPOS_BASE = [
  { id:'tipo-prestamo', codigo:'prestamo', label:'Préstamo',        icono:'💰', descripcion:'Crédito con cuotas, tasa e intereses.',         comportamiento:'prestamo_normal', orden:1 },
  { id:'tipo-venta',    codigo:'venta',    label:'Venta a crédito', icono:'🛍️', descripcion:'Venta financiada con plan de cuotas.',          comportamiento:'prestamo_normal', orden:2 },
  { id:'tipo-empeno',   codigo:'empeno',   label:'Empeño',          icono:'🔒', descripcion:'Artículo en garantía con fecha límite rescate.', comportamiento:'empeno',          orden:3 },
  { id:'tipo-fiado',    codigo:'fiado',    label:'Fiado',           icono:'🌿', descripcion:'Cuenta abierta sin interés ni cuotas fijas.',    comportamiento:'cuenta_abierta',  orden:4 },
  { id:'tipo-adelanto', codigo:'adelanto', label:'Adelanto',        icono:'⚡', descripcion:'Anticipo sin interés (emergencias, empleados).', comportamiento:'cuenta_abierta',  orden:5 },
]

async function inicializar() {
  // Quitar CHECK fijo si aún existe
  await query(`ALTER TABLE ${S}.cred_productos DROP CONSTRAINT IF EXISTS cred_productos_tipo_check`)

  // Crear tabla si no existe
  await query(`
    CREATE TABLE IF NOT EXISTS ${S}.cred_tipos_prestamo (
      id             TEXT      PRIMARY KEY,
      codigo         TEXT      UNIQUE NOT NULL,
      label          TEXT      NOT NULL,
      icono          TEXT      NOT NULL DEFAULT '📄',
      descripcion    TEXT,
      comportamiento TEXT      NOT NULL DEFAULT 'prestamo_normal',
      activo         BOOLEAN   NOT NULL DEFAULT TRUE,
      es_sistema     BOOLEAN   NOT NULL DEFAULT FALSE,
      orden          INTEGER   NOT NULL DEFAULT 99,
      fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)

  // Insertar tipos base (idempotente)
  for (const t of TIPOS_BASE) {
    await query(
      `INSERT INTO ${S}.cred_tipos_prestamo (id,codigo,label,icono,descripcion,comportamiento,activo,es_sistema,orden)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE,$7)
       ON CONFLICT (codigo) DO NOTHING`,
      [t.id, t.codigo, t.label, t.icono, t.descripcion, t.comportamiento, t.orden]
    )
  }
}

// GET — listar todos los tipos (auto-inicializa la tabla si no existe)
export async function GET() {
  try {
    // Verificar si la tabla existe; si no, crearla con los tipos base
    const existe = await query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='${S}' AND table_name='cred_tipos_prestamo'
    `)
    if (!existe.rows.length) await inicializar()

    const res = await query(
      `SELECT id, codigo, label, icono, descripcion, comportamiento, activo, es_sistema, orden
       FROM ${S}.cred_tipos_prestamo
       ORDER BY orden, label`
    )

    // Si la tabla existe pero está vacía (ej: migración parcial), reinsertar base
    if (!res.rows.length) {
      await inicializar()
      const res2 = await query(
        `SELECT id, codigo, label, icono, descripcion, comportamiento, activo, es_sistema, orden
         FROM ${S}.cred_tipos_prestamo ORDER BY orden, label`
      )
      return NextResponse.json(res2.rows)
    }

    return NextResponse.json(res.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST — crear nuevo tipo
export async function POST(request) {
  try {
    const u    = await getUsuarioDesdeRequest(request)
    const body = await request.json()
    const { label, icono = '📄', descripcion = '', comportamiento = 'prestamo_normal', orden = 99 } = body

    if (!label?.trim()) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })

    // Generar código único desde el label (slug)
    const codigo = label.trim()
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40)

    // Verificar que el código no exista
    const existe = await query(
      `SELECT id FROM ${S}.cred_tipos_prestamo WHERE codigo = $1`, [codigo]
    )
    if (existe.rows.length) return NextResponse.json({ error: `Ya existe un tipo con código "${codigo}"` }, { status: 409 })

    const id = uuidv4()
    await query(
      `INSERT INTO ${S}.cred_tipos_prestamo (id, codigo, label, icono, descripcion, comportamiento, activo, es_sistema, orden)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,FALSE,$7)`,
      [id, codigo, label.trim(), icono, descripcion, comportamiento, parseInt(orden)]
    )

    await auditar({
      ...u,
      accion:      'CREAR TIPO DE PRÉSTAMO',
      modulo:      MODULOS.CONFIG ?? 'CONFIGURACION',
      descripcion: `Creó tipo "${label}" (código: ${codigo})`,
      detalle:     { id, codigo, label, comportamiento }
    })

    const nuevo = await query(`SELECT * FROM ${S}.cred_tipos_prestamo WHERE id=$1`, [id])
    return NextResponse.json(nuevo.rows[0], { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
