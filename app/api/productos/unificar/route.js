import { NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { generarCuotas } from '@/lib/calculos'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

// ─────────────────────────────────────────────────────────────────────────
// Unificar Créditos: consolida VARIOS créditos activos de un mismo cliente
// en UN solo crédito nuevo con condiciones propias. A diferencia de la
// refinanciación normal (es_refinanciacion_de, relación 1:1), aquí puede
// haber N créditos de origen — la traza vive en cred_unificaciones
// (ver 23_unificacion_creditos.sql y CLAUDE.md §21).
//
// Regla de negocio (igual que "Refinanciar + prestar más", CLAUDE.md §19):
// solo se consolida el CAPITAL PENDIENTE REAL de cada crédito de origen
// (nunca el interés de cuotas aún no vencidas, que no está causado todavía).
// El capital resultante es "limpio" — por eso este crédito SÍ cuenta
// normalmente en los KPIs de capital (a diferencia de "congelación", cuyo
// monto_capital mezcla interés viejo).
// ─────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const [body, u] = await Promise.all([
      request.json(),
      getUsuarioDesdeRequest(request),
    ])

    const {
      cliente_id, credito_ids,
      tipo, tasa_interes, periodo_tasa, frecuencia_cobro,
      num_cuotas, fecha_primer_pago, metodo_calculo, interes_fijo,
      metodo_desembolso, entidad_desembolso, referencia_desembolso,
      monto_inyectado, notas, fecha_desembolso,
    } = body

    if (!cliente_id) return NextResponse.json({ error: 'Falta el cliente' }, { status: 400 })
    if (!Array.isArray(credito_ids) || credito_ids.length < 2)
      return NextResponse.json({ error: 'Selecciona al menos 2 créditos para unificar' }, { status: 400 })
    if (!num_cuotas || !fecha_primer_pago)
      return NextResponse.json({ error: 'Faltan campos obligatorios del nuevo crédito' }, { status: 400 })

    // ── Validar créditos de origen ───────────────────────────────────────
    const prods = await query(
      `SELECT * FROM ${S}.cred_productos WHERE id = ANY($1::text[])`,
      [credito_ids]
    )
    if (prods.rows.length !== credito_ids.length)
      return NextResponse.json({ error: 'Alguno de los créditos seleccionados no existe' }, { status: 404 })

    for (const p of prods.rows) {
      if (p.cliente_id !== cliente_id)
        return NextResponse.json({ error: `El crédito ${p.referencia || p.id} no pertenece a este cliente` }, { status: 400 })
      if (['saldado', 'refinanciado'].includes(p.estado))
        return NextResponse.json({ error: `El crédito ${p.referencia || p.id} ya está ${p.estado} y no se puede unificar` }, { status: 400 })
    }
    // Nota: los créditos "credito_libre" (Créditos Sin Cuotas Futuras) SÍ son
    // elegibles. Su capital pendiente se calcula con la misma fórmula
    // genérica de abajo (interés primero): la cuota placeholder de ese
    // módulo tiene abono_interes=0 fijo y monto_pagado solo acumula abonos
    // a capital (ver app/api/creditos-libres/[id]/abonar/route.js), así que
    // el resultado coincide exactamente con monto_capital - capital_pagado
    // (la fórmula propia del módulo). Al unificarse, quedan estado
    // 'refinanciado' igual que cualquier otro origen — el módulo de
    // créditos libres los excluye de "Activos" con ese mismo campo.

    // ── Capital pendiente REAL por crédito de origen (server-side, no se
    //    confía en cifras que pudiera mandar el cliente) ─────────────────
    // Misma fórmula que saldoCapitalPendiente en el frontend: el pago cubre
    // primero el interés del período, todo lo que falta encima es capital
    // puro (ver CLAUDE.md convención de cálculo).
    const cuotasRes = await query(
      `SELECT * FROM ${S}.cred_cuotas WHERE producto_id = ANY($1::text[]) AND estado != 'pagada'`,
      [credito_ids]
    )
    const capitalPorCredito = Object.fromEntries(credito_ids.map(id => [id, 0]))
    for (const c of cuotasRes.rows) {
      const montoPagado   = parseFloat(c.monto_pagado || 0)
      const abonoCapital  = parseFloat(c.abono_capital || 0)
      const abonoInteres  = parseFloat(c.abono_interes || 0)
      const capitalPagado = Math.max(0, montoPagado - abonoInteres)
      capitalPorCredito[c.producto_id] = (capitalPorCredito[c.producto_id] || 0) + Math.max(0, abonoCapital - capitalPagado)
    }
    const capitalTotalOrigenes = Object.values(capitalPorCredito).reduce((s, v) => s + v, 0)
    if (capitalTotalOrigenes <= 0.5)
      return NextResponse.json({ error: 'Los créditos seleccionados no tienen capital pendiente para unificar' }, { status: 400 })

    const montoInyectadoSeguro = Math.max(0, parseFloat(monto_inyectado) || 0)
    const capitalFinanciar = capitalTotalOrigenes + montoInyectadoSeguro

    const tipoSeguro          = tipo || 'prestamo'
    const tasaSegura          = parseFloat(tasa_interes) || 0
    const metodoCalculoSeguro = metodo_calculo || 'plano'
    // Interés fijo solo tiene sentido en método plano (igual regla que en
    // POST /api/productos — ver CLAUDE.md §17).
    const interesFijoSeguro = metodoCalculoSeguro === 'plano' ? interes_fijo === true : false

    const MEDIOS = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'llave_breb', 'otro']
    const medioDesemb   = MEDIOS.includes(metodo_desembolso) ? metodo_desembolso : 'efectivo'
    const entidadDesemb = medioDesemb === 'efectivo' ? null : (entidad_desembolso?.trim() || null)
    const refDesemb     = medioDesemb === 'efectivo' ? null : (referencia_desembolso?.trim() || null)
    if (['transferencia', 'nequi', 'daviplata', 'llave_breb'].includes(medioDesemb) && !refDesemb)
      return NextResponse.json({ error: 'Falta el número de cuenta / celular / llave del desembolso' }, { status: 400 })

    const fechaDesembolsoSegura = fecha_desembolso || new Date().toISOString().split('T')[0]
    const referenciasOrigen = prods.rows.map(p => p.referencia || p.id).join(', ')
    const notasFinal = notas?.trim() || `Unificación de ${credito_ids.length} créditos (${referenciasOrigen})`

    const id = uuidv4()

    const { prodRow, cuotas } = await withTransaction(async (q) => {
      const confRef = await q(
        `UPDATE ${S}.cred_configuracion
         SET valor = (valor::int + 1)::text
         WHERE clave = 'credito_consecutivo'
         RETURNING (valor::int - 1) AS num`
      )
      const referencia = 'CRED-' + String(parseInt(confRef.rows[0]?.num ?? '1')).padStart(6, '0')

      const prod = await q(
        `INSERT INTO ${S}.cred_productos (
          id,referencia,cliente_id,tipo,monto_capital,tasa_interes,periodo_tasa,
          frecuencia_cobro,num_cuotas,fecha_primer_pago,con_interes,
          metodo_calculo,cuota_inicial,notas,
          metodo_desembolso,entidad_desembolso,referencia_desembolso,interes_fijo,
          monto_inyectado,fecha_desembolso
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,0,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [id, referencia, cliente_id, tipoSeguro, capitalFinanciar,
         tasaSegura, periodo_tasa || 'mensual', frecuencia_cobro || 'mensual',
         num_cuotas, fecha_primer_pago, metodoCalculoSeguro, notasFinal,
         medioDesemb, entidadDesemb, refDesemb, interesFijoSeguro,
         montoInyectadoSeguro, fechaDesembolsoSegura]
      )

      // Marcar cada crédito de origen como refinanciado hacia el nuevo —
      // mismo mecanismo que la refinanciación normal, para que todos los
      // filtros/KPIs existentes (dashboard, listados) dejen de contarlos.
      await q(
        `UPDATE ${S}.cred_productos SET estado='refinanciado', refinanciado_por=$1 WHERE id = ANY($2::text[])`,
        [id, credito_ids]
      )

      // Traza de unificación: un renglón por cada crédito de origen, con el
      // capital que aportó puntualmente.
      for (const origId of credito_ids) {
        await q(
          `INSERT INTO ${S}.cred_unificaciones (id, credito_nuevo_id, credito_origen_id, capital_aportado)
           VALUES ($1,$2,$3,$4)`,
          [uuidv4(), id, origId, capitalPorCredito[origId] || 0]
        )
      }

      const prod0 = { ...prod.rows[0], cliente_id }
      if (prod0.fecha_primer_pago instanceof Date) {
        const d = prod0.fecha_primer_pago
        prod0.fecha_primer_pago = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      } else if (prod0.fecha_primer_pago && typeof prod0.fecha_primer_pago !== 'string') {
        prod0.fecha_primer_pago = String(prod0.fecha_primer_pago).split('T')[0]
      }
      const cuotasGen = generarCuotas(prod0)

      if (cuotasGen.length > 0) {
        const vals = cuotasGen.map((_, i) => {
          const b = i * 11
          return '($' + (b + 1) + ',$' + (b + 2) + ',$' + (b + 3) + ',$' + (b + 4) + ',$' + (b + 5) + ',$' + (b + 6) + ',$' + (b + 7) + ',$' + (b + 8) + ',$' + (b + 9) + ',$' + (b + 10) + ',$' + (b + 11) + ')'
        }).join(',')
        const params = cuotasGen.flatMap(c => [
          c.id, c.producto_id, c.cliente_id, c.numero_cuota,
          c.fecha_vencimiento, c.monto_cuota, c.abono_interes,
          c.abono_capital, c.saldo_pendiente, c.monto_pagado, c.estado
        ])

        const interesTotal = cuotasGen.reduce((s, c) => s + (c.abono_interes || 0), 0)
        const totalAPagar  = cuotasGen.reduce((s, c) => s + (c.monto_cuota || 0), 0)
        const montoPrimera = cuotasGen[0]?.monto_cuota || 0

        await q(
          `INSERT INTO ${S}.cred_cuotas
           (id,producto_id,cliente_id,numero_cuota,fecha_vencimiento,monto_cuota,
            abono_interes,abono_capital,saldo_pendiente,monto_pagado,estado)
           VALUES ${vals}`, params
        )
        // Movimiento de caja: mismo criterio que cualquier refinanciación
        // (se registra el capital total como "desembolso", aunque la mayor
        // parte sea deuda consolidada y no dinero nuevo — consistente con
        // cómo ya se comporta "Refinanciar saldo" en todo el sistema).
        await q(
          `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
           VALUES ($1,'desembolso',$2,$3,$4,
             COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                       ORDER BY fecha DESC LIMIT 1), 0) + $2)`,
          [uuidv4(), -capitalFinanciar, `Unificación de ${credito_ids.length} créditos — ${cliente_id}`, id]
        )
        await q(
          `INSERT INTO ${S}.cred_historial_recalculos
             (id, producto_id, tipo, capital_original,
              capital_saldo_antes, capital_saldo_despues, capital_abonado,
              interes_pendiente_antes, interes_pendiente_despues,
              num_cuotas_total, num_cuotas_antes, num_cuotas_despues,
              monto_cuota_antes, monto_cuota_despues,
              total_pendiente_antes, total_pendiente_despues)
           VALUES ($1,$2,'creacion',$3,$3,$3,0,$4,$4,$5,$5,$5,$6,$6,$7,$7)`,
          [uuidv4(), id, capitalFinanciar, interesTotal, cuotasGen.length, montoPrimera, totalAPagar]
        )
      } else {
        await q(
          `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
           VALUES ($1,'desembolso',$2,$3,$4,
             COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                       ORDER BY fecha DESC LIMIT 1), 0) + $2)`,
          [uuidv4(), -capitalFinanciar, `Unificación de ${credito_ids.length} créditos — ${cliente_id}`, id]
        )
      }

      return { prodRow: prod.rows[0], cuotas: cuotasGen }
    })

    auditar({
      ...u, accion: ACCIONES.UNIFICAR_CREDITOS, modulo: MODULOS.PRESTAMOS,
      descripcion: `Unificó ${credito_ids.length} créditos (${referenciasOrigen}) en ${prodRow.referencia}: $${capitalFinanciar.toLocaleString()} — cliente ${cliente_id}`,
      detalle: { id, credito_ids, capital_total: capitalFinanciar, capital_por_credito: capitalPorCredito, monto_inyectado: montoInyectadoSeguro, cliente_id },
    }).catch(err => console.error('[auditoría]', err.message))

    return NextResponse.json({ producto: prodRow, cuotas_generadas: cuotas.length }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
