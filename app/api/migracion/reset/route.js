import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function POST(request) {
  try {
    const u = await getUsuarioDesdeRequest(request)

    // Borrar en orden correcto (FK constraints)
    await query(`DELETE FROM ${S}.cred_movimientos_caja`)
    await query(`DELETE FROM ${S}.cred_pagos`)
    await query(`DELETE FROM ${S}.cred_cuotas`)
    await query(`DELETE FROM ${S}.cred_productos`)
    await query(`UPDATE ${S}.cred_configuracion SET valor='1', actualizado_en=NOW() WHERE clave='recibo_consecutivo'`)

    await auditar({
      ...u,
      accion:      'RESET DE DATOS DE PRUEBA',
      modulo:      MODULOS.AUTH,
      descripcion: `⚠️ ${u.nombre} eliminó todos los movimientos, productos, cuotas y pagos. Solo se conservaron clientes y usuarios.`,
      detalle:     { fecha: new Date().toISOString() }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
