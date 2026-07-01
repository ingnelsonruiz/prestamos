import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function POST(request) {
  try {
    const u = await getUsuarioDesdeRequest(request)
    const { clienteId } = await request.json()

    if (!clienteId) {
      return NextResponse.json({ error: 'clienteId es requerido' }, { status: 400 })
    }

    // Verificar que el cliente existe
    const { rows: clientes } = await query(
      `SELECT id, nombre, documento FROM ${S}.cred_clientes WHERE id = $1`,
      [clienteId]
    )
    if (clientes.length === 0) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }
    const cliente = clientes[0]

    // Obtener los productos del cliente para usarlos en filtros de movimientos
    const { rows: productos } = await query(
      `SELECT id FROM ${S}.cred_productos WHERE cliente_id = $1`,
      [clienteId]
    )
    const productoIds = productos.map(p => p.id)

    // Contadores para el reporte
    let pagos = 0, cuotas = 0, prods = 0, movimientos = 0, recalculos = 0

    // Si el cliente no tiene productos, informar sin borrar ni auditar
    if (productoIds.length === 0) {
      return NextResponse.json({
        ok: true,
        sinMovimientos: true,
        cliente: { nombre: cliente.nombre, documento: cliente.documento },
        eliminado: { prods: 0, cuotas: 0, pagos: 0, movimientos: 0, recalculos: 0 }
      })
    }

    if (productoIds.length > 0) {
      // Los movimientos de caja no tienen cliente_id directo, se filtran por referencia_id (= producto_id)
      const placeholders = productoIds.map((_, i) => `$${i + 1}`).join(',')

      const rMov = await query(
        `DELETE FROM ${S}.cred_movimientos_caja WHERE referencia_id IN (${placeholders})`,
        productoIds
      )
      movimientos = rMov.rowCount ?? 0

      const rPag = await query(
        `DELETE FROM ${S}.cred_pagos WHERE cliente_id = $1`,
        [clienteId]
      )
      pagos = rPag.rowCount ?? 0

      const rRec = await query(
        `DELETE FROM ${S}.cred_historial_recalculos WHERE producto_id IN (${placeholders})`,
        productoIds
      )
      recalculos = rRec.rowCount ?? 0

      const rCuo = await query(
        `DELETE FROM ${S}.cred_cuotas WHERE cliente_id = $1`,
        [clienteId]
      )
      cuotas = rCuo.rowCount ?? 0

      const rPro = await query(
        `DELETE FROM ${S}.cred_productos WHERE cliente_id = $1`,
        [clienteId]
      )
      prods = rPro.rowCount ?? 0
    }

    await auditar({
      ...u,
      accion:      'RESET DE CLIENTE ESPECÍFICO',
      modulo:      MODULOS.AUTH,
      descripcion: `⚠️ ${u.nombre} eliminó los datos de ${cliente.nombre} (CC ${cliente.documento}): ${prods} préstamo(s), ${cuotas} cuota(s), ${pagos} pago(s), ${movimientos} mov. de caja.`,
      detalle:     { clienteId, nombre: cliente.nombre, documento: cliente.documento, prods, cuotas, pagos, movimientos, recalculos }
    })

    return NextResponse.json({
      ok: true,
      cliente: { nombre: cliente.nombre, documento: cliente.documento },
      eliminado: { prods, cuotas, pagos, movimientos, recalculos }
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
