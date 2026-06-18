import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

let _ok = false
async function setup() {
  if (_ok) return
  // Tabla empresas
  await query(`
    CREATE TABLE IF NOT EXISTS ${S}.cred_empresas_propias (
      id TEXT PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  // El índice único se omite intencionalmente aquí; la validación es por código en POST
  // Columnas en cred_productos (idempotente)
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='${S}' AND table_name='cred_productos' AND column_name='es_prestamo_interno')
      THEN ALTER TABLE ${S}.cred_productos ADD COLUMN es_prestamo_interno BOOLEAN NOT NULL DEFAULT FALSE; END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='${S}' AND table_name='cred_productos' AND column_name='empresa_id')
      THEN ALTER TABLE ${S}.cred_productos ADD COLUMN empresa_id TEXT REFERENCES ${S}.cred_empresas_propias(id); END IF;
    END$$
  `)
  _ok = true
}

export async function GET() {
  try {
    await setup()
    const r = await query(
      `SELECT ep.*,
         -- Subqueries independientes evitan fan-out al cruzar varias tablas 1→N
         COALESCE((
           SELECT SUM(p.monto_capital)
           FROM ${S}.cred_productos p
           WHERE p.empresa_id = ep.id
             AND p.es_prestamo_interno = TRUE
             AND p.estado NOT IN ('saldado','decomisado','refinanciado')
         ), 0) AS saldo_prestamos,
         COALESCE((
           SELECT SUM(g.monto)
           FROM ${S}.cred_gastos g
           WHERE g.empresa_id = ep.id
         ), 0) AS total_gastos,
         COALESCE((
           SELECT SUM(r.monto_capital)
           FROM ${S}.cred_retornos_empresa r
           WHERE r.empresa_id = ep.id
         ), 0) AS total_retornos_capital,
         COALESCE((
           SELECT SUM(r.monto_interes)
           FROM ${S}.cred_retornos_empresa r
           WHERE r.empresa_id = ep.id
         ), 0) AS total_retornos_interes,
         COALESCE((
           SELECT SUM(r.monto_total)
           FROM ${S}.cred_retornos_empresa r
           WHERE r.empresa_id = ep.id
         ), 0) AS total_retornos
       FROM ${S}.cred_empresas_propias ep
       ORDER BY ep.nombre ASC`
    )
    return NextResponse.json(r.rows)
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(request) {
  try {
    await setup()
    const { nombre, descripcion, nit } = await request.json()
    if (!nombre?.trim()) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })

    // Verificar duplicado por nombre
    const dup = await query(
      `SELECT id FROM ${S}.cred_empresas_propias WHERE UPPER(nombre)=UPPER($1)`,
      [nombre.trim()]
    )
    if (dup.rows.length) return NextResponse.json({ error: 'Ya existe una empresa con ese nombre' }, { status: 409 })

    // Verificar duplicado por NIT (si se proporcionó)
    if (nit?.trim()) {
      const dupNit = await query(
        `SELECT id FROM ${S}.cred_empresas_propias WHERE nit=$1`, [nit.trim()]
      )
      if (dupNit.rows.length) return NextResponse.json({ error: 'Ya existe una empresa con ese NIT' }, { status: 409 })
    }

    // Generar código autonumérico (EMPRE-001)
    const confRes = await query(
      `INSERT INTO ${S}.cred_configuracion (id, clave, valor)
       VALUES (gen_random_uuid()::text, 'empresa_consecutivo', '2')
       ON CONFLICT (clave) DO UPDATE
         SET valor = (${S}.cred_configuracion.valor::int + 1)::text
       RETURNING (valor::int - 1) AS num`
    )
    const num    = parseInt(confRes.rows[0]?.num ?? '1')
    const codigo = 'EMPRE-' + String(num).padStart(3, '0')

    const id = uuidv4()
    const r = await query(
      `INSERT INTO ${S}.cred_empresas_propias (id,codigo,nombre,nit,descripcion)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, codigo, nombre.trim().toUpperCase(), nit?.trim()||null, descripcion?.trim()||null]
    )
    const u = await getUsuarioDesdeRequest(request)
    auditar({ ...u, accion: 'Crear empresa', modulo: MODULOS.CLIENTES||'Empresas',
      descripcion: `Nueva empresa: ${nombre} (${codigo})`, detalle: { id, codigo } })
    return NextResponse.json(r.rows[0], { status: 201 })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(request) {
  try {
    await setup()
    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    // Verificar si tiene préstamos o gastos
    const uso = await query(
      `SELECT (SELECT COUNT(*) FROM ${S}.cred_productos WHERE empresa_id=$1)::int AS prestamos,
              (SELECT COUNT(*) FROM ${S}.cred_gastos    WHERE empresa_id=$1)::int AS gastos`,
      [id]
    )
    const { prestamos, gastos } = uso.rows[0]
    if (Number(prestamos) > 0 || Number(gastos) > 0)
      return NextResponse.json({ error: `No se puede eliminar: tiene ${prestamos} préstamo(s) y ${gastos} gasto(s) asociado(s)` }, { status: 409 })
    await query(`DELETE FROM ${S}.cred_empresas_propias WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
