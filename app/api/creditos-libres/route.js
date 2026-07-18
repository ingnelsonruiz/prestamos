/**
 * GET  /api/creditos-libres  — Lista créditos sin cuotas futuras
 * POST /api/creditos-libres  — Crea un crédito sin cuotas futuras
 *
 * MÓDULO INDEPENDIENTE: ningún cálculo de este archivo toca lib/calculos.js
 * ni los endpoints de créditos normales (/api/pagos, /api/productos).
 */
import { NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

const MEDIOS_VALIDOS = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'llave_breb', 'otro']
const LABEL_MEDIO   = { efectivo: 'Efectivo', transferencia: 'Transferencia', nequi: 'Nequi', daviplata: 'Daviplata', llave_breb: 'Llave Bre-B', otro: 'Otro' }

// ─────────────────────────────────────────────────────────────────────────────
// Auto-migración: garantiza que la columna y el tipo existen antes de operar.
// Idempotente — usa IF NOT EXISTS / ON CONFLICT DO NOTHING.
// ─────────────────────────────────────────────────────────────────────────────
async function autoMigrar() {
  // 1. Columna fecha_corte_interes en cred_pagos
  await query(`
    ALTER TABLE ${S}.cred_pagos
      ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL
  `)

  // 2. Tipo credito_libre en cred_tipos_prestamo (si la tabla ya existe)
  const tiposExiste = await query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = '${S}' AND table_name = 'cred_tipos_prestamo'
  `)
  if (tiposExiste.rows.length) {
    // Eliminar el CHECK constraint de comportamiento si existe,
    // para que acepte el nuevo valor 'sin_cuotas_futuras'
    await query(`
      ALTER TABLE ${S}.cred_tipos_prestamo
        DROP CONSTRAINT IF EXISTS cred_tipos_prestamo_comportamiento_check
    `)
    await query(`
      INSERT INTO ${S}.cred_tipos_prestamo
        (id, codigo, label, icono, descripcion, comportamiento, activo, es_sistema, orden)
      VALUES (
        'tipo-credito-libre', 'credito_libre', 'Crédito Sin Cuotas', '📅',
        'Crédito con interés calculado por período según fecha de corte. Sin cuotas fijas.',
        'sin_cuotas_futuras', TRUE, TRUE, 7
      )
      ON CONFLICT (codigo) DO NOTHING
    `)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — listar créditos de tipo credito_libre con métricas calculadas
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    await autoMigrar()
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get('cliente_id')

    let sql = `
      SELECT
        p.id, p.referencia, p.cliente_id, p.monto_capital, p.tasa_interes,
        p.periodo_tasa, p.estado, p.fecha_creacion, p.descripcion_bien, p.notas,
        p.metodo_desembolso, p.entidad_desembolso, p.referencia_desembolso,
        -- fecha_inicio real = fecha_primer_pago (lo que ingresó el usuario en el form)
        COALESCE(p.fecha_primer_pago, p.fecha_creacion::DATE) AS fecha_inicio_credito,
        c.nombre  AS nombre_cliente,
        c.documento,
        c.telefono,
        -- Capital pagado (suma de abonos a capital registrados en pagos)
        COALESCE((
          SELECT SUM(pg.monto_capital)
          FROM ${S}.cred_pagos pg
          WHERE pg.producto_id = p.id AND pg.monto_capital > 0
        ), 0) AS capital_pagado,
        -- Intereses pagados totales
        COALESCE((
          SELECT SUM(pg.monto_interes)
          FROM ${S}.cred_pagos pg
          WHERE pg.producto_id = p.id AND pg.monto_interes > 0
        ), 0) AS intereses_pagados,
        -- Última fecha de corte de intereses registrada
        (
          SELECT MAX(pg.fecha_corte_interes)
          FROM ${S}.cred_pagos pg
          WHERE pg.producto_id = p.id AND pg.fecha_corte_interes IS NOT NULL
        ) AS ultima_fecha_corte,
        -- Días desde el último corte (o desde la creación si nunca se cobró interés)
        CURRENT_DATE - COALESCE(
          (SELECT MAX(pg.fecha_corte_interes) FROM ${S}.cred_pagos pg
           WHERE pg.producto_id = p.id AND pg.fecha_corte_interes IS NOT NULL),
          COALESCE(p.fecha_primer_pago, p.fecha_creacion::DATE)
        ) AS dias_sin_corte
      FROM ${S}.cred_productos p
      LEFT JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
      WHERE p.tipo = 'credito_libre'
    `
    const values = []
    if (clienteId) {
      sql += ` AND p.cliente_id = $1`
      values.push(clienteId)
    }
    sql += ` ORDER BY p.fecha_creacion DESC`

    const result = await query(sql, values)
    // Calcular capital_pendiente en JS (monto_capital - capital_pagado)
    const rows = result.rows.map(r => ({
      ...r,
      capital_pendiente: parseFloat(r.monto_capital) - parseFloat(r.capital_pagado),
    }))
    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — crear crédito sin cuotas futuras
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    await autoMigrar()
    const [body, u] = await Promise.all([
      request.json(),
      getUsuarioDesdeRequest(request),
    ])

    const {
      cliente_id,
      monto_capital,
      tasa_interes,
      periodo_tasa,
      fecha_inicio,       // Opcional: si no se indica, se usa la fecha actual
      descripcion_bien,
      notas,
      metodo_desembolso,
      entidad_desembolso,
      referencia_desembolso,
    } = body

    // Validaciones básicas
    if (!cliente_id)    return NextResponse.json({ error: 'Selecciona un cliente' }, { status: 400 })
    if (!monto_capital) return NextResponse.json({ error: 'El capital es obligatorio' }, { status: 400 })
    if (!tasa_interes)  return NextResponse.json({ error: 'La tasa de interés es obligatoria' }, { status: 400 })
    if (!periodo_tasa)  return NextResponse.json({ error: 'El período de la tasa es obligatorio' }, { status: 400 })

    const PERIODOS_VALIDOS = ['diario', 'semanal', 'quincenal', 'mensual', 'anual']
    if (!PERIODOS_VALIDOS.includes(periodo_tasa))
      return NextResponse.json({ error: 'Período de tasa inválido' }, { status: 400 })

    const capital = parseFloat(monto_capital)
    const tasa    = parseFloat(tasa_interes)
    if (capital <= 0) return NextResponse.json({ error: 'El capital debe ser mayor a cero' }, { status: 400 })
    if (tasa    <  0) return NextResponse.json({ error: 'La tasa no puede ser negativa' }, { status: 400 })

    // Medio de desembolso
    const medio     = MEDIOS_VALIDOS.includes(metodo_desembolso) ? metodo_desembolso : 'efectivo'
    const entidad   = medio === 'efectivo' ? null : (entidad_desembolso?.trim() || null)
    const refDesemb = medio === 'efectivo' ? null : (referencia_desembolso?.trim() || null)
    if (['transferencia', 'nequi', 'daviplata', 'llave_breb'].includes(medio) && !refDesemb)
      return NextResponse.json({ error: 'Falta el número de cuenta / celular / llave del desembolso' }, { status: 400 })

    const conceptoMedio = medio === 'efectivo'
      ? 'Efectivo'
      : LABEL_MEDIO[medio] + (entidad ? ' ' + entidad : '') + (refDesemb ? ' -> ' + refDesemb : '')

    const fechaInicio = fecha_inicio || new Date().toISOString().split('T')[0]
    const id          = uuidv4()
    const cuotaId     = uuidv4()

    // ── Transacción: consecutivo + producto + cuota placeholder ────────────
    const prodRow = await withTransaction(async (q) => {
      // Consecutivo CRED-XXXXXX
      const confRef = await q(
        `UPDATE ${S}.cred_configuracion
         SET valor = (valor::int + 1)::text
         WHERE clave = 'credito_consecutivo'
         RETURNING (valor::int - 1) AS num`
      )
      const referencia = 'CRED-' + String(parseInt(confRef.rows[0]?.num ?? '1')).padStart(6, '0')

      // Insertar producto
      const prod = await q(
        `INSERT INTO ${S}.cred_productos
          (id, referencia, cliente_id, tipo, monto_capital, tasa_interes, periodo_tasa,
           num_cuotas, fecha_primer_pago, con_interes, metodo_calculo,
           descripcion_bien, notas,
           metodo_desembolso, entidad_desembolso, referencia_desembolso,
           estado)
         VALUES ($1,$2,$3,'credito_libre',$4,$5,$6,
                 1,$7,true,'plano',
                 $8,$9,
                 $10,$11,$12,
                 'activo')
         RETURNING *`,
        [id, referencia, cliente_id, capital, tasa, periodo_tasa,
         fechaInicio,
         descripcion_bien || null, notas || null,
         medio, entidad, refDesemb]
      )

      // Cuota placeholder: no se usa para calcular — solo para trazabilidad en pagos
      // monto_cuota = capital total; fecha_vencimiento = abierta (2099)
      await q(
        `INSERT INTO ${S}.cred_cuotas
          (id, producto_id, cliente_id, numero_cuota, fecha_vencimiento,
           monto_cuota, abono_capital, abono_interes, saldo_pendiente,
           monto_pagado, dias_mora, estado)
         VALUES ($1,$2,$3,1,'2099-12-31',$4,$4,0,$4,0,0,'pendiente')`,
        [cuotaId, id, cliente_id, capital]
      )

      // Registro de desembolso en caja (negativo = salida de dinero)
      const cajaRes = await q(
        `SELECT COALESCE(saldo_acumulado, 0) AS saldo
         FROM ${S}.cred_movimientos_caja ORDER BY fecha DESC LIMIT 1`
      )
      const saldoAnterior = parseFloat(cajaRes.rows[0]?.saldo ?? '0')
      await q(
        `INSERT INTO ${S}.cred_movimientos_caja
          (id, tipo, monto, concepto, referencia_id, saldo_acumulado, fecha)
         VALUES ($1,'desembolso',$2,$3,$4,$5,NOW())`,
        [uuidv4(), -capital,
         `Desembolso crédito sin cuotas ${referencia} — ${conceptoMedio}`,
         id, saldoAnterior - capital]
      )

      return prod.rows[0]
    })

    await auditar({
      usuarioId:    u?.id,
      usuarioNombre: u?.nombre,
      accion:       ACCIONES.CREAR,
      modulo:       'creditos_libres',
      descripcion:  `Crédito sin cuotas ${prodRow.referencia} — ${capital} COP`,
      detalle:      { id: prodRow.id, capital, tasa, periodo_tasa },
      request,
    })

    return NextResponse.json(prodRow, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
