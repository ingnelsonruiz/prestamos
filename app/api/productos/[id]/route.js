import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { generarCuotas } from '@/lib/calculos'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function GET(request, { params }) {
  try {
    const { id } = params
    const prod = await query(
      `SELECT p.*,
              c.nombre AS nombre_cliente, c.documento,
              orig.id   AS refinancia_origen_id,
              nuevo.id  AS refinancia_nuevo_id
       FROM ${S}.cred_productos p
       JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
       LEFT JOIN ${S}.cred_productos orig  ON orig.id = p.es_refinanciacion_de
       LEFT JOIN ${S}.cred_productos nuevo ON nuevo.id = p.refinanciado_por
       WHERE p.id=$1`, [id]
    )
    if (!prod.rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const cuotas = await query(
      `SELECT * FROM ${S}.cred_cuotas WHERE producto_id=$1 ORDER BY numero_cuota`, [id]
    )
    const hoy = new Date()
    const cuotasConMora = cuotas.rows.map(c => {
      const vence = new Date(c.fecha_vencimiento)
      const dias  = c.estado !== 'pagada' && hoy > vence
        ? Math.floor((hoy - vence) / (1000*60*60*24)) : 0
      return { ...c, dias_mora: dias }
    })

    // Verificar si tiene pagos registrados
    const pagos = await query(
      `SELECT COUNT(*) AS total FROM ${S}.cred_pagos WHERE producto_id=$1`, [id]
    )
    const tiene_pagos = parseInt(pagos.rows[0].total) > 0

    return NextResponse.json({ ...prod.rows[0], cuotas: cuotasConMora, tiene_pagos })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = params
    const body = await request.json()
    const { _recalcular, estado, notas, ...campos } = body

    // Si viene _recalcular=true, editar el préstamo y regenerar cuotas
    if (_recalcular) {
      // Verificar que no tenga pagos
      const pagos = await query(
        `SELECT COUNT(*) AS total FROM ${S}.cred_pagos WHERE producto_id=$1`, [id]
      )
      if (parseInt(pagos.rows[0].total) > 0)
        return NextResponse.json({ error: 'No se puede editar: ya tiene pagos registrados' }, { status: 400 })

      const {
        monto_capital, tasa_interes, periodo_tasa, frecuencia_cobro,
        num_cuotas, fecha_primer_pago, con_interes, metodo_calculo,
        cuota_inicial, descripcion_bien, valor_comercial_bien,
        fecha_limite_rescate, notas: notasEdit
      } = campos

      const capitalFinanciar = parseFloat(monto_capital) - parseFloat(cuota_inicial || 0)

      // Actualizar producto
      const prod = await query(
        `UPDATE ${S}.cred_productos SET
          monto_capital=$1, tasa_interes=$2, periodo_tasa=$3, frecuencia_cobro=$4,
          num_cuotas=$5, fecha_primer_pago=$6, con_interes=$7, metodo_calculo=$8,
          cuota_inicial=$9, descripcion_bien=$10, valor_comercial_bien=$11,
          fecha_limite_rescate=$12, notas=$13
         WHERE id=$14 RETURNING *`,
        [capitalFinanciar, tasa_interes||0, periodo_tasa||'mensual',
         frecuencia_cobro||'mensual', num_cuotas, fecha_primer_pago,
         con_interes !== false, metodo_calculo||'plano',
         cuota_inicial||0, descripcion_bien||null,
         valor_comercial_bien||null, fecha_limite_rescate||null,
         notasEdit||null, id]
      )

      // Borrar cuotas anteriores y regenerar
      await query(`DELETE FROM ${S}.cred_cuotas WHERE producto_id=$1`, [id])

      const cuotas = generarCuotas({ ...prod.rows[0] })
      if (cuotas.length > 0) {
        const vals = cuotas.map((_,i) => {
          const b = i*11
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`
        }).join(',')
        const prms = cuotas.flatMap(c => [
          c.id,c.producto_id,c.cliente_id,c.numero_cuota,
          c.fecha_vencimiento,c.monto_cuota,c.abono_interes,
          c.abono_capital,c.saldo_pendiente,c.monto_pagado,c.estado
        ])
        await query(
          `INSERT INTO ${S}.cred_cuotas
           (id,producto_id,cliente_id,numero_cuota,fecha_vencimiento,monto_cuota,
            abono_interes,abono_capital,saldo_pendiente,monto_pagado,estado)
           VALUES ${vals}`, prms
        )
      }

      // Corregir movimiento de desembolso
      await query(
        `UPDATE ${S}.cred_movimientos_caja SET monto=$1, saldo_acumulado=$2
         WHERE referencia_id=$3 AND tipo='desembolso'`,
        [-capitalFinanciar, -capitalFinanciar, id]
      )

      const u = await getUsuarioDesdeRequest(request)
      await auditar({ ...u, accion: ACCIONES.EDITAR_PRESTAMO, modulo: MODULOS.PRESTAMOS,
        descripcion: `Editó y recalculó préstamo ID: ${id}`,
        detalle: { id, monto_capital, num_cuotas } })
      return NextResponse.json({ ok: true, cuotas_generadas: cuotas.length })
    }

    // Edición simple de estado/notas
    const result = await query(
      `UPDATE ${S}.cred_productos SET
        estado=COALESCE($1,estado), notas=COALESCE($2,notas)
       WHERE id=$3 RETURNING *`,
      [estado||null, notas||null, id]
    )
    return NextResponse.json(result.rows[0])
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params
    const pagos = await query(
      `SELECT COUNT(*) AS total FROM ${S}.cred_pagos WHERE producto_id=$1`, [id]
    )
    if (parseInt(pagos.rows[0].total) > 0)
      return NextResponse.json({ error: 'No se puede eliminar: ya tiene pagos' }, { status: 400 })

    await query(`DELETE FROM ${S}.cred_cuotas WHERE producto_id=$1`, [id])
    await query(`DELETE FROM ${S}.cred_movimientos_caja WHERE referencia_id=$1`, [id])
    await query(`DELETE FROM ${S}.cred_productos WHERE id=$1`, [id])
    const u = await getUsuarioDesdeRequest(request)
    await auditar({ ...u, accion: ACCIONES.ELIMINAR_PRESTAMO, modulo: MODULOS.PRESTAMOS,
      descripcion: `Eliminó préstamo ID: ${id}`, detalle: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
