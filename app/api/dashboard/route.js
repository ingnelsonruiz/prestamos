import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

const S = 'administrativo'

// `pg` devuelve las columnas DATE como objetos Date; al pasar por
// NextResponse.json() se serializan como ISO completo con hora ("...T00:00:00.000Z").
// El frontend (app/page.js) hace `new Date(fecha + 'T12:00:00')` esperando un
// simple "YYYY-MM-DD" — si ya trae hora, la concatenación produce "Invalid Date".
// Se normaliza aquí a "YYYY-MM-DD" en UTC (sin desfase, porque `pg` construye la
// fecha a medianoche UTC) antes de responder.
const fechaStr = (v) => {
  if (v instanceof Date) {
    return v.getUTCFullYear() + '-' + String(v.getUTCMonth() + 1).padStart(2, '0') + '-' + String(v.getUTCDate()).padStart(2, '0')
  }
  return v
}

// Convención 30/360 (igual que en /api/creditos-libres)
const DIAS_BASE_CL = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }
function diasD360(ini, fin) {
  const [y1, m1, d1] = ini.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = fin.slice(0, 10).split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}
function calcInteresCL(capitalPendiente, tasa, periodTasa, inicioStr, hastaStr) {
  if (capitalPendiente <= 0 || !inicioStr || !hastaStr) return 0
  const dias = diasD360(inicioStr, hastaStr)
  if (dias <= 0) return 0
  const diasBase = DIAS_BASE_CL[periodTasa] || 30
  return capitalPendiente * (tasa / 100 / diasBase) * dias
}

// Días calendario reales (no 30/360) entre dos fechas "YYYY-MM-DD..." — misma
// convención que ya usa GET /api/creditos-libres para "dias_sin_corte"
// (CURRENT_DATE - COALESCE(ultima_fecha_corte, fecha_primer_pago)).
const UMBRAL_MORA_LIBRES_DIAS = 30
function diasCalendario(desdeStr, hastaStr) {
  const d1 = new Date(desdeStr.slice(0, 10) + 'T00:00:00Z')
  const d2 = new Date(hastaStr.slice(0, 10) + 'T00:00:00Z')
  return Math.round((d2 - d1) / 86400000)
}

export async function GET(request) {
  try {
    const hoy = new Date().toISOString().split('T')[0]

    // Rango de fechas opcional (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD)
    const { searchParams } = new URL(request.url)
    const rangoValido = /^\d{4}-\d{2}-\d{2}$/
    let desde = searchParams.get('desde')
    let hasta = searchParams.get('hasta')
    desde = rangoValido.test(desde || '') ? desde : null
    hasta = rangoValido.test(hasta || '') ? hasta : null
    // Si solo viene uno, se ignora el rango (requiere ambos extremos)
    const hayRango = Boolean(desde && hasta)
    if (!hayRango) { desde = null; hasta = null }

    const [
      carteraEstados,
      interesesPeriodos,
      moraPeriodos,
      recaudoPeriodos,
      carteraVencida,
      capitalCalle,
      interesesProyectados,
      cuotasHoy,
      cuotasSemana,
      empenosVencer,
      interesesRetornos,
      otrosRubros,
      kpisGlobales,
      creditosLibresCapital,
      creditosLibresIntereses,
      creditosLibresDetalle,
    ] = await Promise.all([

      // 1. Capital y conteo por estado — mora detectada por fechas (no por campo estado)
      query(`
        WITH mora_por_producto AS (
          SELECT DISTINCT producto_id
          FROM ${S}.cred_cuotas
          WHERE fecha_vencimiento < CURRENT_DATE
            AND estado IN ('pendiente','parcial')
            AND fecha_vencimiento != '2099-12-31'
        )
        SELECT
          COALESCE(SUM(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NULL THEN p.monto_capital END), 0)       AS capital_activo,
          COALESCE(SUM(CASE WHEN p.estado = 'saldado'
            THEN p.monto_capital END), 0)                                   AS capital_saldado,
          COALESCE(SUM(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NOT NULL THEN p.monto_capital END), 0)   AS capital_mora,
          COALESCE(SUM(CASE WHEN p.estado = 'refinanciado'
            THEN p.monto_capital END), 0)                                   AS capital_refinanciado,
          COUNT(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NULL     THEN 1 END)::int                AS num_activos,
          COUNT(CASE WHEN p.estado = 'saldado'
            THEN 1 END)::int                                                AS num_saldados,
          COUNT(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
            AND mpm.producto_id IS NOT NULL THEN 1 END)::int                AS num_mora,
          COUNT(CASE WHEN p.estado = 'refinanciado'
            THEN 1 END)::int                                                AS num_refinanciados
        FROM ${S}.cred_productos p
        LEFT JOIN mora_por_producto mpm ON mpm.producto_id = p.id
        WHERE p.tipo NOT IN ('fiado','adelanto','congelacion')
      `),

      // 2. Intereses cobrados por período
      //    ⚠️ Fix 2026-08-16: antes esta query re-derivaba el interés desde
      //    LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / cu.monto_cuota — es decir,
      //    desde el ESTADO ACTUAL (mutable) de la cuota. Pero en método 'plano',
      //    recalcularCuotasPlano() reescribe cu.monto_cuota/abono_interes después de
      //    CADA pago del crédito: cuando una cuota se cierra "solo intereses" (Regla 2),
      //    el capital se redistribuye entre menos cuotas restantes, INFLANDO el
      //    monto_cuota de la cuota aún abierta. Como esta fórmula divide entre ese
      //    monto_cuota inflado, un pago que en realidad fue 100% interés terminaba
      //    prorrateado a una fracción mínima (caso real verificado: CRED-000309,
      //    pago de $1.000.000 100% interés mostrado como $130.435 — ver
      //    [[Incidentes y Bugs Conocidos]]). cred_pagos.monto_interes ya guarda el
      //    interés real "pactado al momento del cobro" y NO varía con recálculos
      //    posteriores (mismo campo que ya se usaba, correctamente, para credito_libre
      //    en la query de abajo) — se usa directo, sin prorratear desde la cuota.
      //    Ya no hace falta el JOIN a cred_cuotas (solo se usaba para esa fórmula).
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN p.fecha_pago::date = $1
            THEN p.monto_interes END), 0) AS hoy,
          COALESCE(SUM(CASE WHEN p.fecha_pago::date >= DATE_TRUNC('week',  $1::date)
            THEN p.monto_interes END), 0) AS semana,
          COALESCE(SUM(CASE WHEN p.fecha_pago::date >= DATE_TRUNC('month', $1::date)
            THEN p.monto_interes END), 0) AS mes,
          COALESCE(SUM(p.monto_interes), 0) AS total,
          COALESCE(SUM(CASE WHEN $2::date IS NOT NULL
            AND p.fecha_pago::date BETWEEN $2::date AND $3::date
            THEN p.monto_interes END), 0) AS rango
        FROM ${S}.cred_pagos p
        JOIN ${S}.cred_productos prod ON prod.id = p.producto_id
        WHERE prod.tipo != 'credito_libre'
      `, [hoy, desde, hasta]),

      // 3. Mora: clientes y montos por antigüedad
      //    Usa comparación de fechas — NO usa estado='mora' que no se auto-asigna
      //    ⚠️ Fix 2026-08-05: se agrega JOIN a cred_productos con dos exclusiones que
      //    faltaban (verificado en producción, ver [[Incidentes y Bugs Conocidos]]):
      //    (a) p.estado NOT IN ('saldado','decomisado','refinanciado') — las cuotas de
      //        créditos ya refinanciados/saldados NUNCA se cierran (quedan 'pendiente'
      //        como registro histórico, ver [[Base de Datos]]) y sin este filtro se
      //        contaban como mora vigente. Impacto medido: ~$35.6M de mora falsa.
      //    (b) p.tipo != 'credito_libre' — este módulo define su propia mora por "días
      //        sin corte" (ver creditos_libres_mora más abajo), no por fecha_vencimiento;
      //        varios créditos libres en producción tienen la cuota placeholder mal
      //        formada (fecha real en vez de 2099-12-31) y sin este filtro se contaban
      //        también como mora de cuotas. Impacto medido: ~$56M adicionales.
      query(`
        SELECT
          COUNT(DISTINCT CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            THEN cu.cliente_id END)::int                                               AS clientes_total,
          COUNT(DISTINCT CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) > 30
            THEN cu.cliente_id END)::int                                               AS clientes_30d,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_total,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) <= 30
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_0_30d,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) BETWEEN 31 AND 60
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_31_60d,
          COALESCE(SUM(CASE WHEN cu.fecha_vencimiento < $1::date
            AND cu.estado IN ('pendiente','parcial')
            AND ($1::date - cu.fecha_vencimiento) > 60
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS monto_mas60d
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        WHERE cu.fecha_vencimiento != '2099-12-31'
          AND p.estado NOT IN ('saldado','decomisado','refinanciado')
          AND p.tipo != 'credito_libre'
      `, [hoy]),

      // 4. Recaudo por período
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN fecha_pago::date = $1                             THEN monto END), 0) AS hoy,
          COALESCE(SUM(CASE WHEN fecha_pago::date >= DATE_TRUNC('week',  $1::date) THEN monto END), 0) AS semana,
          COALESCE(SUM(CASE WHEN fecha_pago::date >= DATE_TRUNC('month', $1::date) THEN monto END), 0) AS mes,
          COALESCE(SUM(monto), 0) AS total,
          COALESCE(SUM(CASE WHEN $2::date IS NOT NULL
            AND fecha_pago::date BETWEEN $2::date AND $3::date THEN monto END), 0) AS rango,
          COUNT(CASE WHEN $2::date IS NOT NULL
            AND fecha_pago::date BETWEEN $2::date AND $3::date THEN 1 END)::int AS rango_pagos
        FROM ${S}.cred_pagos
      `, [hoy, desde, hasta]),

      // 5. Cartera vencida por antigüedad (comparación de fechas — NO estado='mora')
      //    ⚠️ Fix 2026-08-05: mismo problema y mismo fix que la query 3 de arriba —
      //    faltaba excluir productos ya cerrados y créditos libres. Ver comentario
      //    detallado en la query 3 y en [[Incidentes y Bugs Conocidos]].
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento = $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS vencio_hoy,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento >= DATE_TRUNC('week',  $1::date)
            AND cu.fecha_vencimiento <  $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS vencio_semana,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento >= DATE_TRUNC('month', $1::date)
            AND cu.fecha_vencimiento <  $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS vencio_mes,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento < $1::date - INTERVAL '30 days'
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS mas_30d,
          COALESCE(SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
            AND cu.fecha_vencimiento < $1::date
            THEN cu.monto_cuota - cu.monto_pagado END), 0)                             AS total
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        WHERE cu.fecha_vencimiento != '2099-12-31'
          AND p.estado NOT IN ('saldado','decomisado','refinanciado')
          AND p.tipo != 'credito_libre'
      `, [hoy]),

      // 6. Capital en la calle: suma de abono_capital pendiente en productos activos
      query(`
        SELECT COALESCE(SUM(
          cu.abono_capital * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
        ), 0) AS total
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        WHERE cu.estado IN ('pendiente','parcial')
          AND p.estado IN ('activo','al_dia','en_mora')
          AND p.tipo <> 'congelacion'
          AND cu.fecha_vencimiento != '2099-12-31'
      `),

      // 7. Intereses proyectados — si hay rango filtra por fecha_vencimiento de la cuota
      hayRango
        ? query(`
            SELECT COALESCE(SUM(
              cu.abono_interes * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
            ), 0) AS total
            FROM ${S}.cred_cuotas cu
            JOIN ${S}.cred_productos p ON p.id = cu.producto_id
            WHERE cu.estado IN ('pendiente','parcial')
              AND p.estado IN ('activo','al_dia','en_mora')
              AND p.tipo <> 'congelacion'
              AND cu.fecha_vencimiento != '2099-12-31'
              AND cu.fecha_vencimiento BETWEEN $1 AND $2
          `, [desde, hasta])
        : query(`
            SELECT COALESCE(SUM(
              cu.abono_interes * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
            ), 0) AS total
            FROM ${S}.cred_cuotas cu
            JOIN ${S}.cred_productos p ON p.id = cu.producto_id
            WHERE cu.estado IN ('pendiente','parcial')
              AND p.estado IN ('activo','al_dia','en_mora')
              AND p.tipo <> 'congelacion'
              AND cu.fecha_vencimiento != '2099-12-31'
          `),

      // 8. Cuotas que vencen HOY (pendientes/parciales)
      query(`
        SELECT cu.*, c.nombre AS nombre_cliente, p.tipo
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_clientes  c ON c.id = cu.cliente_id
        JOIN ${S}.cred_productos p ON p.id = cu.producto_id
        WHERE cu.fecha_vencimiento = $1 AND cu.estado IN ('pendiente','parcial')
        ORDER BY c.nombre
      `, [hoy]),

      // 10. Cuotas próximos 7 días
      query(`
        SELECT cu.*, c.nombre AS nombre_cliente
        FROM ${S}.cred_cuotas cu
        JOIN ${S}.cred_clientes c ON c.id = cu.cliente_id
        WHERE cu.fecha_vencimiento BETWEEN $1::date + 1 AND $1::date + 7
          AND cu.estado IN ('pendiente','parcial')
        ORDER BY cu.fecha_vencimiento
      `, [hoy]),

      // 11. Empeños próximos a vencer (15 días)
      query(`
        SELECT p.*, c.nombre AS nombre_cliente
        FROM ${S}.cred_productos p
        JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
        WHERE p.tipo = 'empeno' AND p.estado = 'activo'
          AND p.fecha_limite_rescate BETWEEN $1 AND $1::date + 15
        ORDER BY p.fecha_limite_rescate
      `, [hoy]),

      // 12. Intereses de retornos empresa (no pasan por cred_pagos)
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN r.fecha_retorno = $1::date THEN r.monto_interes END), 0) AS hoy,
          COALESCE(SUM(CASE WHEN r.fecha_retorno >= DATE_TRUNC('week',  $1::date) THEN r.monto_interes END), 0) AS semana,
          COALESCE(SUM(CASE WHEN r.fecha_retorno >= DATE_TRUNC('month', $1::date) THEN r.monto_interes END), 0) AS mes,
          COALESCE(SUM(r.monto_interes), 0) AS total,
          COALESCE(SUM(CASE WHEN $2::date IS NOT NULL
            AND r.fecha_retorno BETWEEN $2::date AND $3::date THEN r.monto_interes END), 0) AS rango
        FROM ${S}.cred_retornos_empresa r
      `, [hoy, desde, hasta]).catch(() => ({ rows: [{ hoy:0, semana:0, mes:0, total:0, rango:0 }] })),

      // 13. Otros rubros activos por tipo (fiado, adelanto, venta, empeno)
      query(`
        SELECT
          p.tipo,
          COUNT(*)::int                                                   AS cantidad,
          COALESCE(SUM(p.monto_capital), 0)                               AS capital_total,
          COALESCE(SUM(
            (SELECT SUM(cu.monto_cuota - cu.monto_pagado)
             FROM ${S}.cred_cuotas cu
             WHERE cu.producto_id = p.id AND cu.estado != 'pagada')
          ), 0)                                                           AS saldo_pendiente
        FROM ${S}.cred_productos p
        WHERE p.tipo IN ('fiado','adelanto','venta','empeno','congelacion')
          AND p.estado NOT IN ('saldado','decomisado','refinanciado')
        GROUP BY p.tipo
        ORDER BY p.tipo
      `),

      // 14. KPIs históricos globales (consumidos por /informes).
      //     Excluye fiado/adelanto (cuentas abiertas) y congelacion (su
      //     monto_capital incluye interés viejo, no es capital real desembolsado).
      //     total_invertido / num_creditos: créditos reales no refinanciados
      //     (el refinanciado original se omite para no duplicar con su sucesor).
      //     Excluye fiado/adelanto (cuentas abiertas) y congelacion (su
      //     monto_capital incluye interés viejo, no es capital real desembolsado).
      //     total_invertido / num_creditos: créditos reales no refinanciados
      //     (el refinanciado original se omite para no duplicar con su sucesor).
      query(`
        SELECT
          COALESCE(SUM(p.monto_capital) FILTER (WHERE p.estado <> 'refinanciado'), 0) AS total_invertido,
          COUNT(*) FILTER (WHERE p.estado <> 'refinanciado')::int                      AS num_creditos,
          COALESCE((
            SELECT SUM(pg.monto)
            FROM ${S}.cred_pagos pg
            JOIN ${S}.cred_productos pp ON pp.id = pg.producto_id
            WHERE pp.tipo NOT IN ('fiado','adelanto','congelacion')
          ), 0)                                                                        AS total_recuperado
        FROM ${S}.cred_productos p
        WHERE p.tipo NOT IN ('fiado','adelanto','congelacion')
      `),

      // 15. Capital pendiente real de Créditos Sin Cuotas Futuras (activos)
      //     NO se puede derivar de cred_cuotas (placeholder tiene abono_capital=0),
      //     se calcula directamente: monto_capital − suma de abonos a capital en pagos.
      query(`
        SELECT
          COALESCE(SUM(
            p.monto_capital - COALESCE(cap.capital_pagado, 0)
          ), 0) AS capital_pendiente,
          COUNT(*)::int AS cantidad
        FROM ${S}.cred_productos p
        LEFT JOIN (
          SELECT producto_id, SUM(monto_capital) AS capital_pagado
          FROM ${S}.cred_pagos
          WHERE monto_capital > 0
          GROUP BY producto_id
        ) cap ON cap.producto_id = p.id
        WHERE p.tipo = 'credito_libre'
          AND p.estado NOT IN ('saldado','refinanciado','decomisado')
      `),

      // 16. Intereses ya cobrados de Créditos Sin Cuotas Futuras por período
      //     La fórmula estándar (Query 2) da 0 para estos pagos porque usa
      //     cu.abono_interes / cu.monto_cuota, y el placeholder tiene abono_interes=0.
      //     Se toma directamente de cred_pagos.monto_interes.
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN pg.fecha_pago::date = $1
            THEN pg.monto_interes END), 0) AS hoy,
          COALESCE(SUM(CASE WHEN pg.fecha_pago::date >= DATE_TRUNC('week',  $1::date)
            THEN pg.monto_interes END), 0) AS semana,
          COALESCE(SUM(CASE WHEN pg.fecha_pago::date >= DATE_TRUNC('month', $1::date)
            THEN pg.monto_interes END), 0) AS mes,
          COALESCE(SUM(pg.monto_interes), 0) AS total,
          COALESCE(SUM(CASE WHEN $2::date IS NOT NULL
            AND pg.fecha_pago::date BETWEEN $2::date AND $3::date
            THEN pg.monto_interes END), 0) AS rango
        FROM ${S}.cred_pagos pg
        JOIN ${S}.cred_productos p ON p.id = pg.producto_id
        WHERE p.tipo = 'credito_libre'
          AND pg.monto_interes > 0
      `, [hoy, desde, hasta]),

      // 17. Detalle por crédito libre para cálculo 30/360 de interés proyectado.
      //     Se usa cuando hay fecha "hasta" seleccionada.
      //     inicio_periodo = último fecha_corte_interes registrado, o fecha_primer_pago si no hay cortes.
      query(`
        SELECT
          p.id,
          p.referencia,
          p.tasa_interes,
          p.periodo_tasa,
          c.nombre            AS nombre_cliente,
          c.id                AS cliente_id,
          c.documento,
          (p.monto_capital - COALESCE(cap.capital_pagado, 0)) AS capital_pendiente,
          COALESCE(
            MAX(pg.fecha_corte_interes)::text,
            p.fecha_primer_pago::text,
            p.fecha_creacion::date::text
          ) AS inicio_periodo
        FROM ${S}.cred_productos p
        LEFT JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
        LEFT JOIN (
          SELECT producto_id, SUM(monto_capital) AS capital_pagado
          FROM ${S}.cred_pagos WHERE monto_capital > 0 GROUP BY producto_id
        ) cap ON cap.producto_id = p.id
        LEFT JOIN ${S}.cred_pagos pg
          ON pg.producto_id = p.id AND pg.fecha_corte_interes IS NOT NULL
        WHERE p.tipo = 'credito_libre'
          AND p.estado NOT IN ('saldado','refinanciado','decomisado')
        GROUP BY p.id, p.referencia, p.tasa_interes, p.periodo_tasa,
                 c.nombre, c.id, c.documento, p.monto_capital, cap.capital_pagado,
                 p.fecha_primer_pago, p.fecha_creacion
        ORDER BY nombre_cliente
      `),
    ])

    const ce = carteraEstados.rows[0]
    const ip = interesesPeriodos.rows[0]
    const ir = interesesRetornos.rows[0]
    const mp = moraPeriodos.rows[0]
    const rp = recaudoPeriodos.rows[0]
    const cv = carteraVencida.rows[0]
    const cl = creditosLibresCapital.rows[0]
    const il = creditosLibresIntereses.rows[0]

    // ── Créditos Sin Cuotas Futuras EN MORA ─────────────────────────────────
    // Este módulo no tiene fecha de vencimiento (cuota placeholder a 2099-12-31),
    // así que la mora NO se puede detectar por fecha_vencimiento como los créditos
    // normales (Query 1/3/5). Se usa la misma convención que ya expone
    // GET /api/creditos-libres y el alertado de /creditos-libres (CLAUDE.md §18):
    // "días sin corte" = hoy − (última fecha_corte_interes registrada, o el inicio
    // del crédito si nunca se ha cobrado interés). Umbral de mora: > 30 días sin
    // corte — el mismo que ya usa la alerta visual de la lista, para no introducir
    // un criterio de negocio nuevo.
    // "Total que deben" = capital pendiente + interés causado (30/360) desde ese
    // punto de partida hasta HOY — no hasta una fecha final (el crédito no tiene),
    // igual fórmula que usa calcInteresCL para proyecciones, solo que aquí el
    // corte es siempre "hoy" en vez de un rango elegido por el usuario.
    const creditosLibresMora = { cantidad: 0, capital_pendiente: 0, interes_causado: 0, total_adeudado: 0, umbral_dias: UMBRAL_MORA_LIBRES_DIAS, detalle: [] }
    for (const row of creditosLibresDetalle.rows) {
      const capital = parseFloat(row.capital_pendiente)
      if (capital <= 0.5 || !row.inicio_periodo) continue
      const diasSinCorte = diasCalendario(row.inicio_periodo, hoy)
      if (diasSinCorte <= UMBRAL_MORA_LIBRES_DIAS) continue
      const tasa = parseFloat(row.tasa_interes)
      const interesCausado = calcInteresCL(capital, tasa, row.periodo_tasa, row.inicio_periodo, hoy)
      const totalAdeudado = capital + interesCausado
      creditosLibresMora.cantidad += 1
      creditosLibresMora.capital_pendiente += capital
      creditosLibresMora.interes_causado += interesCausado
      creditosLibresMora.total_adeudado += totalAdeudado
      creditosLibresMora.detalle.push({
        producto_id:      row.id,
        referencia:       row.referencia,
        nombre_cliente:   row.nombre_cliente,
        cliente_id:       row.cliente_id,
        documento:        row.documento,
        tasa_interes:     tasa,
        periodo_tasa:     row.periodo_tasa,
        dias_sin_corte:   diasSinCorte,
        inicio_periodo:   row.inicio_periodo,
        capital_pendiente: capital,
        interes_causado:  interesCausado,
        total_adeudado:   totalAdeudado,
      })
    }
    creditosLibresMora.detalle.sort((a, b) => b.dias_sin_corte - a.dias_sin_corte)

    // Calcular interés proyectado de créditos libres usando 30/360.
    // Requiere AMBAS fechas: usa `desde` como inicio del período (no el último corte
    // ni la fecha de desembolso) para que el cálculo refleje exactamente el rango
    // seleccionado en el dashboard — más dinámico y controlado por el usuario.
    let interesesLibresProyectados = 0
    const detalleLibresProyectados = []
    if (hayRango) {
      for (const row of creditosLibresDetalle.rows) {
        const capital = parseFloat(row.capital_pendiente)
        const interes = calcInteresCL(
          capital,
          parseFloat(row.tasa_interes),
          row.periodo_tasa,
          desde,   // ← fecha DESDE del selector (no el último corte)
          hasta
        )
        interesesLibresProyectados += interes
        detalleLibresProyectados.push({
          producto_id:    row.id,
          referencia:     row.referencia,
          nombre_cliente: row.nombre_cliente,
          cliente_id:     row.cliente_id,
          capital_pendiente: capital,
          tasa_interes:   parseFloat(row.tasa_interes),
          periodo_tasa:   row.periodo_tasa,
          inicio_periodo: desde,   // ← refleja el inicio real del cálculo
          fecha_corte:    hasta,
          dias_calculados: Math.max(0, diasD360(desde, hasta)),
          interes_proyectado: interes,
        })
      }
    }

    return NextResponse.json({
      cartera: {
        capital_activo:        parseFloat(ce.capital_activo),
        capital_saldado:       parseFloat(ce.capital_saldado),
        capital_mora:          parseFloat(ce.capital_mora),
        capital_refinanciado:  parseFloat(ce.capital_refinanciado),
        num_activos:           ce.num_activos,
        num_saldados:          ce.num_saldados,
        num_mora:              ce.num_mora,
        num_refinanciados:     ce.num_refinanciados,
      },
      intereses: {
        hoy:    parseFloat(ip.hoy)    + parseFloat(ir.hoy    || 0) + parseFloat(il.hoy    || 0),
        semana: parseFloat(ip.semana) + parseFloat(ir.semana || 0) + parseFloat(il.semana || 0),
        mes:    parseFloat(ip.mes)    + parseFloat(ir.mes    || 0) + parseFloat(il.mes    || 0),
        total:  parseFloat(ip.total)  + parseFloat(ir.total  || 0) + parseFloat(il.total  || 0),
        rango:  parseFloat(ip.rango)  + parseFloat(ir.rango  || 0) + parseFloat(il.rango  || 0),
        // Desglose para trazabilidad (histórico, sin filtro de rango)
        intereses_prestamos:      parseFloat(ip.total),
        intereses_retornos:       parseFloat(ir.total || 0),
        intereses_creditos_libres: parseFloat(il.total || 0),
        // Desglose del RANGO seleccionado — para poder comparar 1:1 contra el
        // modal de "Detalle de intereses recogidos" (normales/libres/retornos)
        // categoría por categoría, no solo el total combinado. Agregado
        // 2026-08-05 para diagnosticar diferencias entre el KPI y el detalle.
        rango_prestamos:       parseFloat(ip.rango),
        rango_retornos:        parseFloat(ir.rango || 0),
        rango_creditos_libres: parseFloat(il.rango || 0),
      },
      mora: {
        clientes_total: mp.clientes_total,
        clientes_30d:   mp.clientes_30d,
        monto_total:    parseFloat(mp.monto_total),
        monto_0_30d:    parseFloat(mp.monto_0_30d),
        monto_31_60d:   parseFloat(mp.monto_31_60d),
        monto_mas60d:   parseFloat(mp.monto_mas60d),
      },
      recaudo: {
        hoy:    parseFloat(rp.hoy),
        semana: parseFloat(rp.semana),
        mes:    parseFloat(rp.mes),
        total:  parseFloat(rp.total),
        rango:  parseFloat(rp.rango),
        rango_pagos: rp.rango_pagos,
      },
      cartera_vencida: {
        vencio_hoy:    parseFloat(cv.vencio_hoy),
        vencio_semana: parseFloat(cv.vencio_semana),
        vencio_mes:    parseFloat(cv.vencio_mes),
        mas_30d:       parseFloat(cv.mas_30d),
        total:         parseFloat(cv.total),
      },
      capital: {
        // Capital en la calle: créditos normales + créditos libres
        en_calle:              parseFloat(capitalCalle.rows[0].total) + parseFloat(cl.capital_pendiente || 0),
        // Intereses proyectados créditos normales (cuotas futuras)
        intereses_proyectados: parseFloat(interesesProyectados.rows[0].total),
        // Intereses proyectados créditos libres (30/360 hasta la fecha seleccionada)
        // Solo disponible cuando hay fecha "hasta". Sin fecha → 0 (no se puede proyectar)
        intereses_libres_proyectados: interesesLibresProyectados,
        // Fecha de corte usada para el cálculo (null si no hay rango seleccionado)
        intereses_libres_fecha_corte: hasta,
        // Total combinado para mostrar en el KPI
        intereses_proyectados_total: parseFloat(interesesProyectados.rows[0].total) + interesesLibresProyectados,
        // Detalle por crédito libre (para el modal de doble clic)
        detalle_libres_proyectados: detalleLibresProyectados,
      },
      creditos_libres: {
        cantidad:          cl.cantidad,
        capital_pendiente: parseFloat(cl.capital_pendiente || 0),
        intereses_cobrados: parseFloat(il.total || 0),
      },
      // Créditos Sin Cuotas Futuras en mora (> 30 días sin corte de intereses).
      // Ver nota arriba: no existe fecha de vencimiento en este módulo, por eso
      // la mora se define por "días sin corte", no por fecha.
      creditos_libres_mora: creditosLibresMora,
      // KPIs históricos globales (informes). Congelación excluida del capital.
      kpis: {
        total_invertido:  parseFloat(kpisGlobales.rows[0].total_invertido),
        num_creditos:     kpisGlobales.rows[0].num_creditos,
        total_recuperado: parseFloat(kpisGlobales.rows[0].total_recuperado),
        capital_en_calle: parseFloat(capitalCalle.rows[0].total),
      },
      rango: hayRango ? { desde, hasta } : null,
      cuotas_hoy:     cuotasHoy.rows.map(r => ({ ...r, fecha_vencimiento: fechaStr(r.fecha_vencimiento) })),
      cuotas_semana:  cuotasSemana.rows.map(r => ({ ...r, fecha_vencimiento: fechaStr(r.fecha_vencimiento) })),
      empenos_vencer: empenosVencer.rows.map(r => ({ ...r, fecha_limite_rescate: fechaStr(r.fecha_limite_rescate) })),
      otros_rubros:   otrosRubros.rows.map(r => ({
        tipo:            r.tipo,
        cantidad:        r.cantidad,
        capital_total:   parseFloat(r.capital_total),
        saldo_pendiente: parseFloat(r.saldo_pendiente),
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
