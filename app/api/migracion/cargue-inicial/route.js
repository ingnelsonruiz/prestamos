import { NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { generarCuotas } from '@/lib/calculos'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

// ──────────────────────────────────────────────────────────────────────────
// Cargue Inicial de Saldos
// Legaliza créditos antiguos: crea el producto con fecha de desembolso en el
// pasado, regenera el cronograma teórico (autoritativo en el servidor) y aplica
// los pagos históricos que el cobrador marcó, fijando fechas reales del pasado.
//
// El cliente SOLO envía qué cuotas se pagaron, cuánto y cuándo; el servidor
// recalcula montos/intereses de cada cuota con lib/calculos.js para no confiar
// en valores enviados desde el navegador (seguridad + consistencia).
// ──────────────────────────────────────────────────────────────────────────

const MEDIOS = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'llave_breb', 'otro']

// Días entre dos fechas 'YYYY-MM-DD' (>=0). Usa zona LOCAL con split('-')
// para mantener la convención del proyecto y evitar el desfase UTC.
function diasEntre(desdeStr, hastaStr) {
  if (!desdeStr || !hastaStr) return 0
  const [y1, m1, d1] = String(desdeStr).split('-').map(Number)
  const [y2, m2, d2] = String(hastaStr).split('-').map(Number)
  const a = new Date(y1, m1 - 1, d1)
  const b = new Date(y2, m2 - 1, d2)
  const diff = b - a
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0
}

// Normaliza 'YYYY-MM-DD' → TIMESTAMP a mediodía local (igual que /api/pagos),
// evitando que el cambio de huso "retroceda" la fecha un día.
function tsLocal(fechaStr) {
  return new Date(fechaStr + 'T12:00:00')
}

export async function POST(request) {
  try {
    const [body, u] = await Promise.all([
      request.json(),
      getUsuarioDesdeRequest(request),
    ])

    const { producto = {}, pagos = [] } = body
    const {
      cliente_id, tipo,
      monto_capital, tasa_interes, periodo_tasa, frecuencia_cobro,
      num_cuotas, metodo_calculo, con_interes,
      fecha_desembolso, fecha_primer_pago, fecha_corte,
      metodo_desembolso, entidad_desembolso, referencia_desembolso,
      descripcion_bien, valor_comercial_bien, fecha_limite_rescate, notas,
    } = producto

    // ── Validaciones de entrada ────────────────────────────────────────────
    if (!cliente_id || !tipo || !monto_capital)
      return NextResponse.json({ error: 'Faltan campos obligatorios (cliente, tipo, capital).' }, { status: 400 })

    const nCuotas = parseInt(num_cuotas)
    if (!nCuotas || nCuotas < 1)
      return NextResponse.json({ error: 'El número de cuotas debe ser mayor a 0.' }, { status: 400 })

    const metodo = metodo_calculo === 'frances' ? 'frances' : 'plano'

    const fDesembolso = fecha_desembolso || fecha_primer_pago
    const fPrimerPago = fecha_primer_pago || fecha_desembolso
    const fCorte      = fecha_corte || new Date().toISOString().split('T')[0]
    if (!fDesembolso || !fPrimerPago)
      return NextResponse.json({ error: 'La fecha de desembolso y la del primer pago son obligatorias.' }, { status: 400 })

    const medioDesemb   = MEDIOS.includes(metodo_desembolso) ? metodo_desembolso : 'efectivo'
    const entidadDesemb = medioDesemb === 'efectivo' ? null : (entidad_desembolso?.trim() || null)
    const refDesemb     = medioDesemb === 'efectivo' ? null : (referencia_desembolso?.trim() || null)

    const capital = parseFloat(monto_capital)

    // ── 1. Cronograma teórico (AUTORITATIVO en el servidor) ─────────────────
    const productoId = uuidv4()
    const cuotasGen = generarCuotas({
      id:                productoId,
      cliente_id,
      monto_capital:     capital,
      tasa_interes:      con_interes === false ? 0 : parseFloat(tasa_interes || 0),
      periodo_tasa:      periodo_tasa || 'mensual',
      frecuencia_cobro:  frecuencia_cobro || 'mensual',
      num_cuotas:        nCuotas,
      fecha_primer_pago: fPrimerPago,
      metodo_calculo:    metodo,
    })

    // Mapa de pagos enviados por el cliente, indexado por número de cuota
    const pagosPorCuota = new Map()
    for (const p of pagos) {
      const num = parseInt(p.numero_cuota)
      const monto = parseFloat(p.monto_pagado)
      if (!num || !(monto > 0) || !p.fecha_pago) continue
      pagosPorCuota.set(num, { monto, fecha_pago: p.fecha_pago })
    }

    // ── 2. Aplicar pagos históricos cuota por cuota (en memoria) ────────────
    const cuotasFinales = []   // filas para cred_cuotas
    const pagosFinales  = []   // filas para cred_pagos (con su cuota)
    let hayMora = false

    for (const c of cuotasGen) {
      const montoCuota = parseFloat(c.monto_cuota)
      const venc       = c.fecha_vencimiento
      const pago       = pagosPorCuota.get(c.numero_cuota)

      let monto_pagado = 0
      let estado       = 'pendiente'
      let dias_mora    = 0

      if (pago) {
        // Pago histórico: nunca aplicar más que el valor de la cuota
        monto_pagado = Math.min(pago.monto, montoCuota)
        estado = monto_pagado >= montoCuota - 0.5 ? 'pagada' : 'parcial'
        // Mora teórica: días entre vencimiento y la fecha real en que pagó
        dias_mora = diasEntre(venc, pago.fecha_pago)

        // Desglose interés/capital: el interés del período se cubre primero
        const interesAplicado = Math.min(monto_pagado, parseFloat(c.abono_interes))
        const capitalAplicado = Math.max(0, monto_pagado - interesAplicado)

        pagosFinales.push({
          cuota_id:      c.id,
          fecha_pago:    pago.fecha_pago,
          monto:         Math.round(monto_pagado),
          monto_interes: Math.round(interesAplicado),
          monto_capital: Math.round(capitalAplicado),
        })
      } else {
        // Sin pago: ¿venció antes de la fecha de corte? → mora ; si no → pendiente
        const moraCorte = diasEntre(venc, fCorte)
        if (moraCorte > 0) { estado = 'mora'; dias_mora = moraCorte; hayMora = true }
        else estado = 'pendiente'
      }

      cuotasFinales.push({
        id:                c.id,
        producto_id:       productoId,
        cliente_id,
        numero_cuota:      c.numero_cuota,
        fecha_vencimiento: venc,
        monto_cuota:       montoCuota,
        abono_interes:     parseFloat(c.abono_interes),
        abono_capital:     parseFloat(c.abono_capital),
        saldo_pendiente:   parseFloat(c.saldo_pendiente),
        monto_pagado:      Math.round(monto_pagado),
        dias_mora,
        estado,
      })
    }

    // ── 3. Estado final del crédito ─────────────────────────────────────────
    const sinPendientes = cuotasFinales.every(c => c.estado === 'pagada')
    const estadoFinal = sinPendientes ? 'saldado' : hayMora ? 'en_mora' : 'activo'

    // Recibos en orden cronológico real (recibos antiguos → números menores)
    pagosFinales.sort((a, b) =>
      a.fecha_pago === b.fecha_pago ? 0 : a.fecha_pago < b.fecha_pago ? -1 : 1
    )

    // Valores para el snapshot de creación
    const interesTotal = cuotasGen.reduce((s, c) => s + parseFloat(c.abono_interes || 0), 0)
    const totalAPagar  = cuotasGen.reduce((s, c) => s + parseFloat(c.monto_cuota  || 0), 0)
    const montoPrimera = parseFloat(cuotasGen[0]?.monto_cuota || 0)

    // ── 4. Persistencia (TODO o NADA en modo local; secuencial en proxy) ────
    const resultado = await withTransaction(async (q) => {
      // 4.1 Referencia consecutiva del crédito (CRED-XXXXXX)
      const confCred = await q(
        `UPDATE ${S}.cred_configuracion
         SET valor = (valor::int + 1)::text, actualizado_en = NOW()
         WHERE clave = 'credito_consecutivo'
         RETURNING (valor::int - 1) AS num`
      )
      const referencia = 'CRED-' + String(parseInt(confCred.rows[0]?.num ?? '1')).padStart(6, '0')

      // 4.2 Reservar consecutivo de recibos en bloque (uno por pago histórico)
      let reciboInicio = 0
      if (pagosFinales.length > 0) {
        const confRec = await q(
          `UPDATE ${S}.cred_configuracion
           SET valor = (valor::int + $1)::text, actualizado_en = NOW()
           WHERE clave = 'recibo_consecutivo'
           RETURNING (valor::int - $1) AS inicio`,
          [pagosFinales.length]
        )
        reciboInicio = parseInt(confRec.rows[0]?.inicio ?? '1')
      }

      // 4.3 Producto con fecha de desembolso en el pasado
      await q(
        `INSERT INTO ${S}.cred_productos (
           id, referencia, cliente_id, tipo, monto_capital, tasa_interes, periodo_tasa,
           frecuencia_cobro, num_cuotas, fecha_primer_pago, con_interes, metodo_calculo,
           cuota_inicial, descripcion_bien, valor_comercial_bien, fecha_limite_rescate,
           estado, notas, metodo_desembolso, entidad_desembolso, referencia_desembolso,
           fecha_creacion
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          productoId, referencia, cliente_id, tipo, capital,
          con_interes === false ? 0 : parseFloat(tasa_interes || 0),
          periodo_tasa || 'mensual', frecuencia_cobro || 'mensual', nCuotas,
          fPrimerPago, con_interes !== false, metodo,
          0, descripcion_bien || null, valor_comercial_bien || null, fecha_limite_rescate || null,
          estadoFinal, notas || null, medioDesemb, entidadDesemb, refDesemb,
          tsLocal(fDesembolso),
        ]
      )

      // 4.4 Cuotas históricas (batch)
      const vals = cuotasFinales.map((_, i) => {
        const b = i * 12
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`
      }).join(',')
      const params = cuotasFinales.flatMap(c => [
        c.id, c.producto_id, c.cliente_id, c.numero_cuota, c.fecha_vencimiento,
        c.monto_cuota, c.abono_interes, c.abono_capital, c.saldo_pendiente,
        c.monto_pagado, c.dias_mora, c.estado,
      ])
      await q(
        `INSERT INTO ${S}.cred_cuotas
          (id, producto_id, cliente_id, numero_cuota, fecha_vencimiento, monto_cuota,
           abono_interes, abono_capital, saldo_pendiente, monto_pagado, dias_mora, estado)
         VALUES ${vals}`,
        params
      )

      // 4.5 Saldo de caja actual (lo leemos UNA vez y avanzamos en memoria).
      //     Insertamos los movimientos del cargue al final del libro con su
      //     fecha real del pasado: NO se reescriben los saldos ya existentes
      //     (no destructivo), solo se anexan con saldo acumulado coherente.
      const saldoRes = await q(
        `SELECT COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                          ORDER BY fecha DESC LIMIT 1), 0) AS saldo`
      )
      let saldoAcum = parseFloat(saldoRes.rows[0]?.saldo || 0)

      const movimientos = []
      // Desembolso original (salida de caja, negativo) en la fecha del pasado
      saldoAcum -= capital
      movimientos.push({
        id: uuidv4(), tipo: 'desembolso', monto: -capital,
        concepto: 'Cargue inicial — desembolso ' + referencia,
        ref: productoId, saldo: saldoAcum, fecha: tsLocal(fDesembolso),
      })

      // 4.6 Pagos históricos + recibos + cobros de caja (cronológico)
      const pagoRows = []
      pagosFinales.forEach((pf, idx) => {
        const numeroRecibo = 'REC-' + String(reciboInicio + idx).padStart(6, '0')
        const pagoId = uuidv4()
        pagoRows.push({
          id: pagoId, ...pf, numero_recibo: numeroRecibo,
        })
        saldoAcum += pf.monto
        movimientos.push({
          id: uuidv4(), tipo: 'cobro_capital', monto: pf.monto,
          concepto: numeroRecibo + ' — cargue inicial',
          ref: pagoId, saldo: saldoAcum, fecha: tsLocal(pf.fecha_pago),
        })
      })

      if (pagoRows.length > 0) {
        const pv = pagoRows.map((_, i) => {
          const b = i * 12
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`
        }).join(',')
        const pp = pagoRows.flatMap(p => [
          p.id, p.cuota_id, productoId, cliente_id, p.monto, p.monto_interes,
          p.monto_capital, tsLocal(p.fecha_pago), medioDesemb,
          'Cargue inicial de saldos', p.numero_recibo, u.nombre,
        ])
        await q(
          `INSERT INTO ${S}.cred_pagos
            (id, cuota_id, producto_id, cliente_id, monto, monto_interes, monto_capital,
             fecha_pago, metodo_pago, notas, numero_recibo, usuario_nombre)
           VALUES ${pv}`,
          pp
        )
      }

      // 4.7 Movimientos de caja (batch, en orden cronológico)
      const mv = movimientos.map((_, i) => {
        const b = i * 7
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`
      }).join(',')
      const mp = movimientos.flatMap(m => [m.id, m.tipo, m.monto, m.concepto, m.ref, m.saldo, m.fecha])
      await q(
        `INSERT INTO ${S}.cred_movimientos_caja
          (id, tipo, monto, concepto, referencia_id, saldo_acumulado, fecha)
         VALUES ${mv}`,
        mp
      )

      // 4.8 Snapshot de creación
      await q(
        `INSERT INTO ${S}.cred_historial_recalculos
           (id, producto_id, tipo, capital_original,
            capital_saldo_antes, capital_saldo_despues, capital_abonado,
            interes_pendiente_antes, interes_pendiente_despues,
            num_cuotas_total, num_cuotas_antes, num_cuotas_despues,
            monto_cuota_antes, monto_cuota_despues,
            total_pendiente_antes, total_pendiente_despues)
         VALUES ($1,$2,'creacion',$3,$3,$3,0,$4,$4,$5,$5,$5,$6,$6,$7,$7)`,
        [uuidv4(), productoId, capital, Math.round(interesTotal), nCuotas, Math.round(montoPrimera), Math.round(totalAPagar)]
      )

      return { referencia, recibos: pagoRows.length }
    })

    // ── Auditoría (fire-and-forget) ─────────────────────────────────────────
    auditar({
      ...u, accion: 'Cargue inicial de saldos', modulo: MODULOS.PRESTAMOS,
      descripcion: `Cargue histórico ${resultado.referencia}: ${nCuotas} cuotas, ` +
        `${resultado.recibos} pago(s) histórico(s), estado ${estadoFinal} — cliente ${cliente_id}`,
      detalle: {
        producto_id: productoId, referencia: resultado.referencia, tipo,
        monto_capital: capital, metodo, num_cuotas: nCuotas,
        fecha_desembolso: fDesembolso, fecha_corte: fCorte,
        pagos_historicos: resultado.recibos, estado_final: estadoFinal,
      },
    }).catch(err => console.error('[auditoría cargue-inicial]', err.message))

    return NextResponse.json({
      ok:                true,
      producto_id:       productoId,
      referencia:        resultado.referencia,
      estado:            estadoFinal,
      cuotas_generadas:  cuotasFinales.length,
      pagos_registrados: resultado.recibos,
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
