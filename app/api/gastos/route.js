import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { getUsuarioDesdeRequest } from '@/lib/auditoria'

const S = 'administrativo'

let _ok = false
async function setup() {
  if (_ok) return
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='${S}' AND table_name='cred_gastos')
      THEN
        CREATE TABLE ${S}.cred_gastos (
          id TEXT PRIMARY KEY, empresa_id TEXT, producto_id TEXT,
          tipo_gasto_id TEXT NOT NULL, descripcion TEXT NOT NULL,
          monto NUMERIC NOT NULL, fecha_gasto DATE NOT NULL DEFAULT CURRENT_DATE,
          es_personal BOOLEAN NOT NULL DEFAULT FALSE,
          usuario_nombre TEXT, notas TEXT,
          fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      END IF;
      -- Columna cubierto (idempotente)
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='${S}' AND table_name='cred_gastos' AND column_name='cubierto')
      THEN
        ALTER TABLE ${S}.cred_gastos ADD COLUMN cubierto BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE ${S}.cred_gastos ADD COLUMN fecha_cubierto TIMESTAMP;
      END IF;
      -- Columna referencia GASTO-000001 (idempotente)
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='${S}' AND table_name='cred_gastos' AND column_name='referencia')
      THEN
        ALTER TABLE ${S}.cred_gastos ADD COLUMN referencia TEXT;
      END IF;
    END$$
  `)
  _ok = true
}

export async function GET(request) {
  try {
    await setup()
    const { searchParams } = new URL(request.url)
    const empresa_id  = searchParams.get('empresa_id')
    const fecha_desde = searchParams.get('fecha_desde')
    const fecha_hasta = searchParams.get('fecha_hasta')
    const personal    = searchParams.get('personal') // 'true' → solo personales

    let conditions = []
    let vals = []
    let i = 1

    if (personal === 'true') {
      conditions.push(`g.es_personal = TRUE`)
    } else if (empresa_id) {
      conditions.push(`g.empresa_id = $${i++}`)
      vals.push(empresa_id)
    }
    if (fecha_desde) { conditions.push(`g.fecha_gasto >= $${i++}`); vals.push(fecha_desde) }
    if (fecha_hasta) { conditions.push(`g.fecha_gasto <= $${i++}`); vals.push(fecha_hasta) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const r = await query(`
      SELECT g.*, g.fecha_gasto::text AS fecha_gasto, tg.nombre AS tipo_nombre, ep.nombre AS empresa_nombre
      FROM ${S}.cred_gastos g
      LEFT JOIN ${S}.cred_tipos_gasto      tg ON tg.id = g.tipo_gasto_id
      LEFT JOIN ${S}.cred_empresas_propias ep ON ep.id = g.empresa_id
      ${where}
      ORDER BY g.fecha_gasto DESC, g.referencia DESC NULLS LAST, g.fecha_creacion DESC
    `, vals)

    return NextResponse.json(r.rows)
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(request) {
  try {
    await setup()
    const u = await getUsuarioDesdeRequest(request)
    const { empresa_id, producto_id, tipo_gasto_id, descripcion, monto, fecha_gasto, es_personal, notas } = await request.json()

    if (!tipo_gasto_id) return NextResponse.json({ error: 'El tipo de gasto es obligatorio' }, { status: 400 })
    if (!descripcion?.trim()) return NextResponse.json({ error: 'La descripción es obligatoria' }, { status: 400 })
    if (!monto || Number(monto) <= 0) return NextResponse.json({ error: 'El monto debe ser mayor a 0' }, { status: 400 })
    if (!es_personal && !empresa_id) return NextResponse.json({ error: 'Indica la empresa o marca como gasto personal' }, { status: 400 })

    // Consecutivo atómico GASTO-000001
    const confRes = await query(
      `INSERT INTO ${S}.cred_configuracion (id, clave, valor)
       VALUES (gen_random_uuid()::text, 'gasto_consecutivo', '2')
       ON CONFLICT (clave) DO UPDATE
         SET valor = (${S}.cred_configuracion.valor::int + 1)::text
       RETURNING (valor::int - 1) AS num`
    )
    const num = parseInt(confRes.rows[0]?.num ?? '1')
    const referencia = 'GASTO-' + String(num).padStart(6, '0')

    const id = uuidv4()
    const r = await query(`
      INSERT INTO ${S}.cred_gastos
        (id, referencia, empresa_id, producto_id, tipo_gasto_id, descripcion, monto, fecha_gasto, es_personal, usuario_nombre, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [id, referencia, empresa_id||null, producto_id||null, tipo_gasto_id,
       descripcion.trim().toUpperCase(), Number(monto),
       fecha_gasto || new Date().toISOString().split('T')[0],
       es_personal === true, u?.nombre||null, notas?.trim()||null]
    )
    return NextResponse.json(r.rows[0], { status: 201 })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

// PATCH /api/gastos — marcar/desmarcar cubierto
export async function PATCH(request) {
  try {
    await setup()
    const { id, cubierto } = await request.json()
    if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    const r = await query(
      `UPDATE ${S}.cred_gastos
       SET cubierto=$2, fecha_cubierto=CASE WHEN $2 THEN NOW() ELSE NULL END
       WHERE id=$1 RETURNING *`,
      [id, Boolean(cubierto)]
    )
    if (!r.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json(r.rows[0])
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
