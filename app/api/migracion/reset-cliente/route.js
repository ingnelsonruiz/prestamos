import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function POST(request) {
  try {
    const u = await getUsuarioDesdeRequest(request)
    const { clienteId, productoIds: productoIdsBody } = await request.json()

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

    // Todos los créditos del cliente (para validar la selección y detectar "sin movimientos")
    const { rows: productosCliente } = await query(
      `SELECT id, referencia FROM ${S}.cred_productos WHERE cliente_id = $1`,
      [clienteId]
    )
    const idsCliente = productosCliente.map(p => p.id)

    // productoIds: si el cliente elige créditos específicos, solo se borran esos.
    // Si no se envía nada (o llega vacío), se conserva el comportamiento anterior: TODOS.
    let productoIds = idsCliente
    let esSeleccionParcial = false
    if (Array.isArray(productoIdsBody) && productoIdsBody.length > 0) {
      productoIds = productoIdsBody.filter(id => idsCliente.includes(id))
      if (productoIds.length === 0) {
        return NextResponse.json({ error: 'Los créditos seleccionados no pertenecen a este cliente.' }, { status: 400 })
      }
      esSeleccionParcial = productoIds.length < idsCliente.length
    }
    const referenciasBorradas = productosCliente
      .filter(p => productoIds.includes(p.id))
      .map(p => p.referencia)

    // Contadores para el reporte
    let pagos = 0, cuotas = 0, prods = 0, movimientos = 0, recalculos = 0

    // Si el cliente no tiene créditos que borrar, informar sin borrar ni auditar
    if (productoIds.length === 0) {
      return NextResponse.json({
        ok: true,
        sinMovimientos: true,
        cliente: { nombre: cliente.nombre, documento: cliente.documento },
        eliminado: { prods: 0, cuotas: 0, pagos: 0, movimientos: 0, recalculos: 0 }
      })
    }

    if (productoIds.length > 0) {
      // Todo se filtra por producto_id (no por cliente_id) para poder borrar
      // solo los créditos seleccionados y dejar el resto del cliente intacto.
      const placeholders = productoIds.map((_, i) => `$${i + 1}`).join(',')

      const rMov = await query(
        `DELETE FROM ${S}.cred_movimientos_caja WHERE referencia_id IN (${placeholders})`,
        productoIds
      )
      movimientos = rMov.rowCount ?? 0

      const rPag = await query(
        `DELETE FROM ${S}.cred_pagos WHERE producto_id IN (${placeholders})`,
        productoIds
      )
      pagos = rPag.rowCount ?? 0

      const rRec = await query(
        `DELETE FROM ${S}.cred_historial_recalculos WHERE producto_id IN (${placeholders})`,
        productoIds
      )
      recalculos = rRec.rowCount ?? 0

      const rCuo = await query(
        `DELETE FROM ${S}.cred_cuotas WHERE producto_id IN (${placeholders})`,
        productoIds
      )
      cuotas = rCuo.rowCount ?? 0

      const rPro = await query(
        `DELETE FROM ${S}.cred_productos WHERE id IN (${placeholders})`,
        productoIds
      )
      prods = rPro.rowCount ?? 0
    }

    await auditar({
      ...u,
      accion:      'RESET DE CLIENTE ESPECÍFICO',
      modulo:      MODULOS.AUTH,
      descripcion: `⚠️ ${u.nombre} eliminó ${esSeleccionParcial ? `${prods} crédito(s) (${referenciasBorradas.join(', ')})` : 'TODOS los créditos'} de ${cliente.nombre} (CC ${cliente.documento}): ${prods} préstamo(s), ${cuotas} cuota(s), ${pagos} pago(s), ${movimientos} mov. de caja.`,
      detalle:     { clienteId, nombre: cliente.nombre, documento: cliente.documento, productoIds, referenciasBorradas, esSeleccionParcial, prods, cuotas, pagos, movimientos, recalculos }
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
