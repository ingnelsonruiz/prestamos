/**
 * GET /api/creditos-libres/[id]
 * Detalle completo de un crédito sin cuotas futuras:
 *  - datos del producto y cliente
 *  - capital pendiente real
 *  - historial de pagos (con fecha_corte_interes)
 */
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

async function autoMigrar() {
  await query(`ALTER TABLE ${S}.cred_pagos ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`)
}

export async function GET(request, { params }) {
  try {
    await autoMigrar()
    const { id } = await params

    // Producto
    const prodRes = await query(
      `SELECT p.*,
              -- fecha_inicio real = fecha_primer_pago (lo que ingresó el usuario en el form)
              COALESCE(p.fecha_primer_pago, p.fecha_creacion::DATE) AS fecha_inicio_credito,
              c.nombre AS nombre_cliente, c.documento, c.telefono, c.direccion
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
       WHERE p.id = $1 AND p.tipo = 'credito_libre'`,
      [id]
    )
    if (!prodRes.rows.length)
      return NextResponse.json({ error: 'Crédito no encontrado' }, { status: 404 })

    const prod = prodRes.rows[0]

    // Historial de pagos
    const pagosRes = await query(
      `SELECT id, monto, monto_interes, monto_capital, fecha_pago,
              fecha_corte_interes, metodo_pago, notas, numero_recibo, usuario_nombre
       FROM ${S}.cred_pagos
       WHERE producto_id = $1
       ORDER BY fecha_pago DESC`,
      [id]
    )

    // Métricas calculadas
    const capitalPagado     = pagosRes.rows.reduce((s, r) => s + parseFloat(r.monto_capital || 0), 0)
    const interesesPagados  = pagosRes.rows.reduce((s, r) => s + parseFloat(r.monto_interes || 0), 0)
    const capitalPendiente  = parseFloat(prod.monto_capital) - capitalPagado
    const ultimaFechaCorte  = pagosRes.rows
      .filter(r => r.fecha_corte_interes)
      .sort((a, b) => new Date(b.fecha_corte_interes) - new Date(a.fecha_corte_interes))[0]?.fecha_corte_interes || null

    // Normalizar fecha_corte_interes a YYYY-MM-DD y calcular fecha_desde_periodo
    // Ordenar cronológicamente (ASC) para calcular el "desde" de cada pago de interés
    const toYMDlocal = v => !v ? null
      : typeof v === 'string' ? v.slice(0, 10)
      : new Date(v).toISOString().slice(0, 10)

    const fechaInicioCredito = toYMDlocal(prod.fecha_primer_pago || prod.fecha_creacion)

    // Pagos con fecha de corte normalizados, ordenados cronológicamente para calcular "desde"
    const pagosAsc = [...pagosRes.rows]
      .map(r => ({ ...r, fecha_corte_interes: toYMDlocal(r.fecha_corte_interes) }))
      .sort((a, b) => new Date(a.fecha_pago) - new Date(b.fecha_pago))

    // Calcular fecha_desde_periodo: es la fecha_corte del pago de interés ANTERIOR,
    // o la fecha_inicio del crédito si es el primer cobro de intereses
    let ultimoCorteVisto = fechaInicioCredito
    const desdeMap = {}
    for (const p of pagosAsc) {
      if (p.fecha_corte_interes) {
        desdeMap[p.id] = ultimoCorteVisto
        ultimoCorteVisto = p.fecha_corte_interes
      }
    }

    // Construcción final: orden DESC (más reciente primero) para mostrar en UI
    const pagosNorm = pagosRes.rows.map(r => ({
      ...r,
      fecha_corte_interes:  toYMDlocal(r.fecha_corte_interes),
      fecha_desde_periodo:  r.fecha_corte_interes ? desdeMap[r.id] || fechaInicioCredito : null,
    }))

    // Normalizar fecha_inicio_credito a YYYY-MM-DD para evitar desfase UTC en el frontend
    const toYMD = v => !v ? null
      : typeof v === 'string' ? v.slice(0, 10)
      : new Date(v).toISOString().slice(0, 10)

    // Si este crédito fue absorbido en una "Unificar Créditos" (ver
    // CLAUDE.md §21): a qué crédito nuevo, y cuánto capital aportó.
    const unifDestino = await query(
      `SELECT u.credito_nuevo_id, u.capital_aportado, u.fecha_creacion, p.referencia
       FROM ${S}.cred_unificaciones u
       JOIN ${S}.cred_productos p ON p.id = u.credito_nuevo_id
       WHERE u.credito_origen_id = $1
       LIMIT 1`,
      [id]
    ).catch(() => ({ rows: [] }))

    return NextResponse.json({
      ...prod,
      fecha_inicio_credito: toYMD(prod.fecha_inicio_credito || prod.fecha_primer_pago || prod.fecha_creacion),
      capital_pagado:    capitalPagado,
      intereses_pagados: interesesPagados,
      capital_pendiente: capitalPendiente,
      ultima_fecha_corte: ultimaFechaCorte
        ? (typeof ultimaFechaCorte === 'string'
            ? ultimaFechaCorte.slice(0, 10)
            : new Date(ultimaFechaCorte).toISOString().slice(0, 10))
        : null,
      pagos: pagosNorm,
      unificado_en: unifDestino.rows[0] || null,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
