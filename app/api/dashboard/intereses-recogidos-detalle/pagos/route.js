import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

// GET /api/dashboard/intereses-recogidos-detalle/pagos
//
// Drill-down de UNA fila del modal "Detalle de intereses recogidos"
// (ver ../route.js). Esa ruta hermana agrega el interés cobrado por
// crédito/empresa con Promise.all + GROUP BY; esta ruta responde al doble
// clic sobre una fila y devuelve los pagos/retornos individuales que
// suman ese `interes_cobrado`, usando exactamente la misma fórmula de
// prorrateo — así el total de este detalle SIEMPRE cuadra con la fila que
// lo originó. Ver [[Dashboard y KPIs]] / [[API Endpoints]].
//
// Query params:
//   tipo         'normal' | 'libre' | 'retorno'   (obligatorio)
//   producto_id  UUID del crédito                 (obligatorio si tipo=normal|libre;
//                                                   opcional si tipo=retorno)
//   empresa_id   UUID de la empresa propia         (obligatorio si tipo=retorno)
//   desde, hasta YYYY-MM-DD                        (opcionales — mismo rango del dashboard)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const tipo = searchParams.get('tipo')
    const productoId = searchParams.get('producto_id')
    const empresaId = searchParams.get('empresa_id')

    const rangoValido = /^\d{4}-\d{2}-\d{2}$/
    let desde = searchParams.get('desde')
    let hasta = searchParams.get('hasta')
    desde = rangoValido.test(desde || '') ? desde : null
    hasta = rangoValido.test(hasta || '') ? hasta : null
    const hayRango = Boolean(desde && hasta)

    if (!['normal', 'libre', 'retorno'].includes(tipo)) {
      return NextResponse.json(
        { error: "Parámetro 'tipo' inválido — use normal, libre o retorno" },
        { status: 400 }
      )
    }
    if (tipo !== 'retorno' && !productoId) {
      return NextResponse.json({ error: 'Falta producto_id' }, { status: 400 })
    }
    if (tipo === 'retorno' && !empresaId) {
      return NextResponse.json({ error: 'Falta empresa_id' }, { status: 400 })
    }

    let pagos = []

    if (tipo === 'normal') {
      // Misma fórmula de prorrateo que la query "normales" de la ruta hermana,
      // aquí por pago individual (una fila por recibo) en vez de agregada.
      const params = [productoId]
      let filtroRango = ''
      if (hayRango) {
        params.push(desde, hasta)
        filtroRango = `AND pg.fecha_pago::date BETWEEN $2 AND $3`
      }
      const res = await query(`
        SELECT pg.id, pg.numero_recibo, pg.fecha_pago::date::text AS fecha_pago,
               pg.monto AS monto_pago, pg.metodo_pago, pg.usuario_nombre, pg.notas,
               cu.numero_cuota, cu.monto_cuota, cu.abono_interes AS abono_interes_cuota,
               cu.estado AS estado_cuota,
               ROUND((LEAST(pg.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0))::numeric, 2)
                 AS interes_prorrateado
        FROM ${S}.cred_pagos pg
        JOIN ${S}.cred_cuotas cu ON cu.id = pg.cuota_id
        WHERE pg.producto_id = $1
          ${filtroRango}
        ORDER BY pg.fecha_pago
      `, params)
      pagos = res.rows.map(r => ({
        id: r.id,
        numero_recibo: r.numero_recibo,
        fecha_pago: r.fecha_pago,
        numero_cuota: r.numero_cuota,
        monto_cuota: parseFloat(r.monto_cuota),
        abono_interes_cuota: parseFloat(r.abono_interes_cuota),
        monto_pago: parseFloat(r.monto_pago),
        interes_prorrateado: parseFloat(r.interes_prorrateado || 0),
        estado_cuota: r.estado_cuota,
        metodo_pago: r.metodo_pago,
        usuario_nombre: r.usuario_nombre,
        notas: r.notas,
      }))
    }

    if (tipo === 'libre') {
      // Créditos Sin Cuotas Futuras: la cuota es un placeholder con
      // abono_interes=0 fijo — el interés real se lee directo de
      // pg.monto_interes, igual que la query "libres" de la ruta hermana.
      const params = [productoId]
      let filtroRango = ''
      if (hayRango) {
        params.push(desde, hasta)
        filtroRango = `AND pg.fecha_pago::date BETWEEN $2 AND $3`
      }
      const res = await query(`
        SELECT pg.id, pg.numero_recibo, pg.fecha_pago::date::text AS fecha_pago,
               pg.monto AS monto_pago, pg.monto_interes, pg.monto_capital,
               pg.fecha_corte_interes::text AS fecha_corte_interes,
               pg.metodo_pago, pg.usuario_nombre, pg.notas
        FROM ${S}.cred_pagos pg
        WHERE pg.producto_id = $1
          AND pg.monto_interes > 0
          ${filtroRango}
        ORDER BY pg.fecha_pago
      `, params)
      pagos = res.rows.map(r => ({
        id: r.id,
        numero_recibo: r.numero_recibo,
        fecha_pago: r.fecha_pago,
        monto_pago: parseFloat(r.monto_pago),
        interes_prorrateado: parseFloat(r.monto_interes || 0),
        monto_capital: parseFloat(r.monto_capital || 0),
        fecha_corte_interes: r.fecha_corte_interes,
        metodo_pago: r.metodo_pago,
        usuario_nombre: r.usuario_nombre,
        notas: r.notas,
      }))
    }

    if (tipo === 'retorno') {
      // No pasan por cred_pagos: son filas de cred_retornos_empresa. Si la
      // fila del modal no tiene crédito asociado (producto_id null en el
      // agregado), replicamos ese mismo filtro aquí (IS NULL), no un match
      // por igualdad que nunca encontraría nada.
      const params = [empresaId]
      let condProducto
      if (productoId) {
        params.push(productoId)
        condProducto = `AND r.producto_id = $${params.length}`
      } else {
        condProducto = 'AND r.producto_id IS NULL'
      }
      let filtroRango = ''
      if (hayRango) {
        params.push(desde, hasta)
        filtroRango = `AND r.fecha_retorno BETWEEN $${params.length - 1} AND $${params.length}`
      }
      const res = await query(`
        SELECT r.id, r.fecha_retorno::text AS fecha_retorno, r.monto_capital,
               r.monto_interes, r.monto_total, r.usuario_nombre, r.notas
        FROM ${S}.cred_retornos_empresa r
        WHERE r.empresa_id = $1
          ${condProducto}
          ${filtroRango}
        ORDER BY r.fecha_retorno
      `, params)
      pagos = res.rows.map(r => ({
        id: r.id,
        numero_recibo: null,
        fecha_pago: r.fecha_retorno,
        monto_pago: parseFloat(r.monto_total),
        monto_capital: parseFloat(r.monto_capital),
        interes_prorrateado: parseFloat(r.monto_interes || 0),
        usuario_nombre: r.usuario_nombre,
        notas: r.notas,
      }))
    }

    const totalInteres = pagos.reduce((s, p) => s + (p.interes_prorrateado || 0), 0)

    return NextResponse.json({ tipo, pagos, total_interes: totalInteres })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
