/**
 * POST /api/creditos-libres/[id]/abonar
 *
 * Registra un abono en un crédito sin cuotas futuras.
 * El cobrador elige la fecha de corte y el tipo de abono:
 *   - 'interes'  → solo interés del período (requiere fecha_corte)
 *   - 'capital'  → solo abono a capital
 *   - 'ambos'    → parte a intereses y parte a capital
 *
 * MÓDULO INDEPENDIENTE — no llama ni modifica /api/pagos ni recalcularCuotasPlano.
 * Tiene su propio consecutivo de recibo (comparte el mismo contador para consistencia).
 */
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES } from '@/lib/auditoria'

const S = 'administrativo'

async function autoMigrar() {
  await query(`ALTER TABLE ${S}.cred_pagos ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`)
}

export async function POST(request, { params }) {
  try {
    await autoMigrar()
    const { id }  = await params
    const [body, u, modoPruebaRes] = await Promise.all([
      request.json(),
      getUsuarioDesdeRequest(request),
      query(`SELECT valor FROM ${S}.cred_configuracion WHERE clave='modo_prueba'`),
    ])
    const modoPrueba = modoPruebaRes.rows[0]?.valor === 'true'

    const {
      tipo_abono,        // 'interes' | 'capital' | 'ambos'
      fecha_corte,       // YYYY-MM-DD — requerido cuando tipo_abono incluye interés (calcula el interés)
      fecha_pago,        // YYYY-MM-DD — fecha real en que se recibe el pago (independiente de fecha_corte)
      monto_interes,     // número ≥ 0
      monto_capital,     // número ≥ 0
      metodo_pago,
      notas,
    } = body

    // ── Validaciones básicas ─────────────────────────────────────────────────
    const tiposValidos = ['interes', 'capital', 'ambos']
    if (!tiposValidos.includes(tipo_abono))
      return NextResponse.json({ error: 'tipo_abono debe ser interes, capital o ambos' }, { status: 400 })

    const metodosValidos = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'otro']
    const metodo = metodosValidos.includes(metodo_pago) ? metodo_pago : 'efectivo'

    const montoInt = parseFloat(monto_interes ?? 0)
    const montoCap = parseFloat(monto_capital ?? 0)

    if (tipo_abono === 'interes' && montoInt <= 0)
      return NextResponse.json({ error: 'El monto de interés debe ser mayor a cero' }, { status: 400 })
    if (tipo_abono === 'capital' && montoCap <= 0)
      return NextResponse.json({ error: 'El monto de capital debe ser mayor a cero' }, { status: 400 })
    if (tipo_abono === 'ambos' && (montoInt <= 0 || montoCap <= 0))
      return NextResponse.json({ error: 'Cuando el abono es "ambos", tanto el monto de interés como el de capital deben ser mayores a cero' }, { status: 400 })
    if ((tipo_abono === 'interes' || tipo_abono === 'ambos') && !fecha_corte)
      return NextResponse.json({ error: 'La fecha de corte es requerida para abonar a intereses' }, { status: 400 })
    if (fecha_corte && !/^\d{4}-\d{2}-\d{2}$/.test(fecha_corte))
      return NextResponse.json({ error: 'Formato de fecha_corte inválido. Use YYYY-MM-DD' }, { status: 400 })
    if (fecha_pago && !/^\d{4}-\d{2}-\d{2}$/.test(fecha_pago))
      return NextResponse.json({ error: 'Formato de fecha_pago inválido. Use YYYY-MM-DD' }, { status: 400 })
    if (!modoPrueba && fecha_pago && fecha_pago > new Date().toISOString().split('T')[0])
      return NextResponse.json({ error: 'La fecha de abono no puede ser mayor a la fecha actual' }, { status: 400 })

    // ── Verificar producto ───────────────────────────────────────────────────
    const prodRes = await query(
      `SELECT p.id, p.monto_capital, p.tasa_interes, p.periodo_tasa, p.estado, p.referencia,
              cu.id AS cuota_placeholder_id
       FROM ${S}.cred_productos p
       LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id AND cu.numero_cuota = 1
       WHERE p.id = $1 AND p.tipo = 'credito_libre'`,
      [id]
    )
    if (!prodRes.rows.length)
      return NextResponse.json({ error: 'Crédito no encontrado' }, { status: 404 })

    const prod = prodRes.rows[0]
    if (prod.estado === 'saldado')
      return NextResponse.json({ error: 'El crédito ya está saldado' }, { status: 400 })
    // Si este crédito fue absorbido por "Unificar Créditos" (ver CLAUDE.md
    // §21), su capital pendiente ya se trasladó a un crédito nuevo — no se
    // puede seguir abonando aquí, se duplicaría el cobro.
    if (prod.estado === 'refinanciado')
      return NextResponse.json({ error: 'Este crédito ya fue unificado en otro crédito — los abonos se registran allá' }, { status: 400 })

    // Capital pendiente actual
    const capRes = await query(
      `SELECT COALESCE(SUM(monto_capital), 0) AS capital_pagado
       FROM ${S}.cred_pagos WHERE producto_id = $1 AND monto_capital > 0`,
      [id]
    )
    const capitalPagado   = parseFloat(capRes.rows[0].capital_pagado)
    const capitalPendiente = parseFloat(prod.monto_capital) - capitalPagado

    if ((tipo_abono === 'capital' || tipo_abono === 'ambos') && montoCap > capitalPendiente)
      return NextResponse.json({
        error: `El abono a capital (${montoCap}) supera el capital pendiente (${capitalPendiente})`
      }, { status: 400 })

    // Validar que la fecha_corte sea posterior a la última fecha de corte
    if (fecha_corte && (tipo_abono === 'interes' || tipo_abono === 'ambos')) {
      const corteAnteriorRes = await query(
        `SELECT MAX(fecha_corte_interes) AS ultimo FROM ${S}.cred_pagos
         WHERE producto_id = $1 AND fecha_corte_interes IS NOT NULL`,
        [id]
      )
      const anterior = corteAnteriorRes.rows[0]?.ultimo
      if (anterior) {
        const anteriorStr = typeof anterior === 'string' ? anterior.slice(0, 10)
          : new Date(anterior).toISOString().slice(0, 10)
        if (fecha_corte <= anteriorStr)
          return NextResponse.json({
            error: `La fecha de corte (${fecha_corte}) debe ser posterior al último corte registrado (${anteriorStr})`
          }, { status: 400 })
      }
    }

    // ── Consecutivo de recibo (atómico) ──────────────────────────────────────
    const reciboRes = await query(
      `UPDATE ${S}.cred_configuracion
       SET valor = (valor::int + 1)::text
       WHERE clave = 'recibo_consecutivo'
       RETURNING (valor::int - 1) AS consecutivo`
    )
    const numRecibo   = parseInt(reciboRes.rows[0]?.consecutivo ?? '1')
    const numeroRecibo = 'REC-' + String(numRecibo).padStart(6, '0')

    const pagoId    = uuidv4()
    const montoTotal = montoInt + montoCap
    // Fecha real del abono (independiente de fecha_corte). Convención del sistema:
    // forzar mediodía local para evitar desfase UTC-5 (ver CLAUDE.md §10/§18).
    const fechaReal = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()

    // Descripción del abono para notas automáticas
    const tipoDesc = tipo_abono === 'interes' ? 'Abono a intereses'
      : tipo_abono === 'capital' ? 'Abono a capital'
      : 'Abono a intereses y capital'

    const notasCompletas = [
      tipoDesc,
      fecha_corte ? `Período hasta: ${fecha_corte}` : null,
      notas || null,
    ].filter(Boolean).join(' | ')

    // ── Insertar pago ────────────────────────────────────────────────────────
    await query(
      `INSERT INTO ${S}.cred_pagos
        (id, cuota_id, producto_id, cliente_id, monto, monto_interes, monto_capital,
         fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre,
         fecha_corte_interes)
       VALUES ($1,$2,$3,
               (SELECT cliente_id FROM ${S}.cred_productos WHERE id=$3),
               $4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        pagoId,
        prod.cuota_placeholder_id,
        id,
        montoTotal, montoInt, montoCap,
        fechaReal,
        metodo,
        notasCompletas,
        numeroRecibo,
        u?.nombre || 'sistema',
        (tipo_abono === 'interes' || tipo_abono === 'ambos') ? fecha_corte : null,
      ]
    )

    // ── Actualizar cuota placeholder (solo por abono a capital) ─────────────
    if (montoCap > 0) {
      await query(
        `UPDATE ${S}.cred_cuotas
         SET monto_pagado = LEAST(monto_pagado + $1, monto_cuota),
             estado = CASE
               WHEN monto_pagado + $1 >= monto_cuota THEN 'pagada'
               WHEN monto_pagado + $1 > 0 THEN 'parcial'
               ELSE estado
             END
         WHERE id = $2`,
        [montoCap, prod.cuota_placeholder_id]
      )
    }

    // ── Verificar si el crédito queda saldado ────────────────────────────────
    const nuevoCapitalPagado = capitalPagado + montoCap
    const nuevoCapitalPend   = parseFloat(prod.monto_capital) - nuevoCapitalPagado
    if (nuevoCapitalPend <= 0.5) {
      // Capital completamente pagado → saldado
      await query(
        `UPDATE ${S}.cred_productos SET estado = 'saldado' WHERE id = $1`,
        [id]
      )
      await query(
        `UPDATE ${S}.cred_cuotas SET estado = 'pagada', saldo_pendiente = 0
         WHERE producto_id = $1 AND estado != 'pagada'`,
        [id]
      )
    }

    // ── Movimiento en caja (cobro) ────────────────────────────────────────────
    const cajaRes = await query(
      `SELECT COALESCE(saldo_acumulado, 0) AS saldo
       FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 1`
    )
    const saldoAnterior = parseFloat(cajaRes.rows[0]?.saldo ?? '0')
    await query(
      `INSERT INTO ${S}.cred_movimientos_caja
        (id, tipo, monto, concepto, referencia_id, saldo_acumulado, fecha)
       VALUES ($1,'cobro_capital',$2,$3,$4,$5,NOW())`,
      [uuidv4(), montoTotal,
       `${tipoDesc} crédito libre ${prod.referencia} — ${numeroRecibo}`,
       pagoId, saldoAnterior + montoTotal]
    )

    await auditar({
      usuarioId:     u?.id,
      usuarioNombre: u?.nombre,
      accion:        ACCIONES.PAGAR,
      modulo:        'creditos_libres',
      descripcion:   `${tipoDesc} ${prod.referencia} — ${numeroRecibo} — $${montoTotal}`,
      detalle:       { pagoId, tipo_abono, montoInt, montoCap, fecha_corte, fecha_pago },
      request,
    })

    return NextResponse.json({
      ok:              true,
      numero_recibo:   numeroRecibo,
      monto_interes:   montoInt,
      monto_capital:   montoCap,
      monto_total:     montoTotal,
      capital_pendiente_nuevo: Math.max(0, nuevoCapitalPend),
      saldado:         nuevoCapitalPend <= 0.5,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
