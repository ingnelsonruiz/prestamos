import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function GET(request, { params }) {
  try {
    const { id } = params
    const cliente = await query(`SELECT * FROM ${S}.cred_clientes WHERE id=$1`, [id])
    if (!cliente.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const productos = await query(
      `SELECT p.*, COUNT(cu.id) AS total_cuotas,
              COUNT(cu.id) FILTER (WHERE cu.estado = 'pagada') AS cuotas_pagadas,
              COUNT(cu.id) FILTER (WHERE cu.estado IN ('pendiente','parcial')) AS cuotas_pendientes,
              COUNT(cu.id) FILTER (WHERE cu.fecha_vencimiento < CURRENT_DATE AND cu.estado != 'pagada' AND cu.fecha_vencimiento <> DATE '2099-12-31') AS cuotas_mora,
              COALESCE(SUM(cu.monto_cuota - cu.monto_pagado) FILTER (WHERE cu.estado != 'pagada'),0) AS saldo_total
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id
       WHERE p.cliente_id=$1
       GROUP BY p.id ORDER BY p.fecha_creacion DESC`, [id]
    )
    return NextResponse.json({ ...cliente.rows[0], productos: productos.rows })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = params
    const { nombre, telefono, direccion, email, es_prueba } = await request.json()
    if (!nombre?.trim()) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })

    const [result, u] = await Promise.all([
      query(
        `UPDATE ${S}.cred_clientes
         SET nombre=$1, telefono=$2, direccion=$3, email=$4,
             es_prueba=COALESCE($5, es_prueba)
         WHERE id=$6 RETURNING *`,
        [nombre.trim(), telefono||null, direccion||null, email||null,
         typeof es_prueba === 'boolean' ? es_prueba : null, id]
      ),
      getUsuarioDesdeRequest(request),
    ])
    if (!result.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    auditar({ ...u, accion: ACCIONES.EDITAR_CLIENTE || 'Editar cliente', modulo: MODULOS.CLIENTES,
      descripcion: `Editó datos de cliente: ${nombre.trim()}`,
      detalle: { id, nombre: nombre.trim(), telefono, direccion, email, es_prueba }
    }).catch(err => console.error('[auditoría editar cliente]', err.message))

    return NextResponse.json(result.rows[0])
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params

    // Verificar que el cliente exista y obtener su nombre para auditoría
    const cli = await query(`SELECT nombre, es_prueba FROM ${S}.cred_clientes WHERE id=$1`, [id])
    if (!cli.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // Contar movimientos: productos (cualquier estado) + pagos
    const movimientos = await query(
      `SELECT
         (SELECT COUNT(*) FROM ${S}.cred_productos WHERE cliente_id=$1) AS num_productos,
         (SELECT COUNT(*) FROM ${S}.cred_pagos    WHERE cliente_id=$1) AS num_pagos`,
      [id]
    )
    const { num_productos, num_pagos } = movimientos.rows[0]

    if (Number(num_productos) > 0 || Number(num_pagos) > 0) {
      return NextResponse.json({
        error: `No se puede eliminar: el cliente tiene ${num_productos} producto(s) y ${num_pagos} pago(s) registrados.`
      }, { status: 400 })
    }

    await query(`DELETE FROM ${S}.cred_clientes WHERE id=$1`, [id])

    const u = await getUsuarioDesdeRequest(request)
    await auditar({ ...u, accion: ACCIONES.ELIMINAR_CLIENTE, modulo: MODULOS.CLIENTES,
      descripcion: `Eliminó cliente: ${cli.rows[0].nombre} (${cli.rows[0].es_prueba ? 'prueba' : 'real'})`,
      detalle: { id, es_prueba: cli.rows[0].es_prueba }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
