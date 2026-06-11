import { NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { generarCuotas } from '@/lib/calculos'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get('cliente_id')

    let sql = `
      SELECT p.*, c.nombre AS nombre_cliente, c.documento, c.telefono, c.direccion,
             COUNT(cu.id) AS total_cuotas,
             COUNT(cu.id) FILTER (WHERE cu.estado IN ('pendiente','parcial','mora')) AS cuotas_pendientes,
             COUNT(cu.id) FILTER (WHERE cu.estado = 'mora') AS cuotas_mora,
             COALESCE(SUM(cu.monto_cuota - cu.monto_pagado) FILTER (WHERE cu.estado != 'pagada'),0) AS capital_pendiente,
             por.referencia  AS ref_nuevo,
             orig.referencia AS ref_origen
      FROM ${S}.cred_productos p
      JOIN ${S}.cred_clientes c ON c.id = p.cliente_id
      LEFT JOIN ${S}.cred_cuotas cu ON cu.producto_id = p.id
      LEFT JOIN ${S}.cred_productos por  ON por.id  = p.refinanciado_por
      LEFT JOIN ${S}.cred_productos orig ON orig.id = p.es_refinanciacion_de
    `
    const values = []
    if (clienteId) { sql += ` WHERE p.cliente_id=$1`; values.push(clienteId) }
    sql += ` GROUP BY p.id, c.nombre, c.documento, c.telefono, c.direccion, por.referencia, orig.referencia ORDER BY p.fecha_creacion DESC`

    const result = await query(sql, values)
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const [body, u] = await Promise.all([
      request.json(),
      getUsuarioDesdeRequest(request),
    ])
    const {
      cliente_id, tipo, monto_capital, tasa_interes, periodo_tasa,
      frecuencia_cobro, num_cuotas, fecha_primer_pago, con_interes,
      metodo_calculo, cuota_inicial, descripcion_bien,
      valor_comercial_bien, fecha_limite_rescate, notas,
      es_refinanciacion_de
    } = body

    if (!cliente_id || !tipo || !monto_capital)
      return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 })

    // Consecutivo de referencia (CRED-XXXXXX) — se incrementa DENTRO de cada
    // transacción: si algo falla, el número no se consume (sin saltos).

    if (tipo === 'fiado' || tipo === 'adelanto') {
      const id = uuidv4()
      const cuotaId = uuidv4()
      const capital = parseFloat(monto_capital)
      const fechaUso = fecha_primer_pago || new Date().toISOString().split('T')[0]

      // ── TRANSACCIÓN: consecutivo + producto + cuota abierta ─────────────
      const prodRow = await withTransaction(async (q) => {
        const confRef = await q(
          `UPDATE ${S}.cred_configuracion
           SET valor = (valor::int + 1)::text
           WHERE clave = 'credito_consecutivo'
           RETURNING (valor::int - 1) AS num`
        )
        const referencia = 'CRED-' + String(parseInt(confRef.rows[0]?.num ?? '1')).padStart(6, '0')

        const prod = await q(
          `INSERT INTO ${S}.cred_productos
            (id,referencia,cliente_id,tipo,monto_capital,tasa_interes,num_cuotas,
             fecha_primer_pago,con_interes,metodo_calculo,descripcion_bien,notas)
           VALUES ($1,$2,$3,$4,$5,0,1,$6,false,'plano',$7,$8) RETURNING *`,
          [id, referencia, cliente_id, tipo, capital, fechaUso, descripcion_bien||null, notas||null]
        )
        await q(
          `INSERT INTO ${S}.cred_cuotas
            (id,producto_id,cliente_id,numero_cuota,fecha_vencimiento,
             monto_cuota,abono_interes,abono_capital,saldo_pendiente,monto_pagado,estado)
           VALUES ($1,$2,$3,1,'2099-12-31',$4,0,$4,$4,0,'pendiente')`,
          [cuotaId, id, cliente_id, capital]
        )
        return prod.rows[0]
      })

      // Auditoría fire-and-forget
      auditar({ ...u, accion: ACCIONES.CREAR_PRESTAMO, modulo: MODULOS.PRESTAMOS,
        descripcion: `Creo ${tipo}: $${capital.toLocaleString()} — cliente ${cliente_id}`,
        detalle: { id, tipo, monto: capital, cliente_id } })
        .catch(err => console.error('[auditoría]', err.message))

      return NextResponse.json({ producto: prodRow, cuotas_generadas: 1 }, { status: 201 })
    }

    const id = uuidv4()
    const capitalFinanciar = parseFloat(monto_capital) - parseFloat(cuota_inicial || 0)

    // ── TRANSACCIÓN: consecutivo + producto + refinanciación + cuotas +
    //    caja + historial. Todo o nada: si la generación de cuotas o el
    //    desembolso fallan, no queda un producto sin plan de pagos ni un
    //    crédito original marcado 'refinanciado' sin su reemplazo.
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
          metodo_calculo,cuota_inicial,descripcion_bien,
          valor_comercial_bien,fecha_limite_rescate,notas,es_refinanciacion_de
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [id, referencia, cliente_id, tipo, capitalFinanciar,
         tasa_interes||0, periodo_tasa||'mensual',
         frecuencia_cobro||'mensual', num_cuotas, fecha_primer_pago,
         con_interes !== false, metodo_calculo||'plano',
         cuota_inicial||0, descripcion_bien||null,
         valor_comercial_bien||null, fecha_limite_rescate||null, notas||null,
         es_refinanciacion_de||null]
      )

      if (es_refinanciacion_de) {
        await q(
          `UPDATE ${S}.cred_productos SET estado='refinanciado', refinanciado_por=$1 WHERE id=$2`,
          [id, es_refinanciacion_de]
        )
      }

      const prod0 = { ...prod.rows[0], cliente_id }
      if (prod0.fecha_primer_pago instanceof Date) {
        const d = prod0.fecha_primer_pago
        prod0.fecha_primer_pago = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
      } else if (prod0.fecha_primer_pago && typeof prod0.fecha_primer_pago !== 'string') {
        prod0.fecha_primer_pago = String(prod0.fecha_primer_pago).split('T')[0]
      }
      const cuotasGen = generarCuotas(prod0)

      if (cuotasGen.length > 0) {
        const vals = cuotasGen.map((_,i) => {
          const b = i*11
          return '($'+(b+1)+',$'+(b+2)+',$'+(b+3)+',$'+(b+4)+',$'+(b+5)+',$'+(b+6)+',$'+(b+7)+',$'+(b+8)+',$'+(b+9)+',$'+(b+10)+',$'+(b+11)+')'
        }).join(',')
        const params = cuotasGen.flatMap(c => [
          c.id,c.producto_id,c.cliente_id,c.numero_cuota,
          c.fecha_vencimiento,c.monto_cuota,c.abono_interes,
          c.abono_capital,c.saldo_pendiente,c.monto_pagado,c.estado
        ])

        const interesTotal = cuotasGen.reduce((s, c) => s + (c.abono_interes || 0), 0)
        const totalAPagar  = cuotasGen.reduce((s, c) => s + (c.monto_cuota  || 0), 0)
        const montoPrimera = cuotasGen[0]?.monto_cuota || 0

        await q(
          `INSERT INTO ${S}.cred_cuotas
           (id,producto_id,cliente_id,numero_cuota,fecha_vencimiento,monto_cuota,
            abono_interes,abono_capital,saldo_pendiente,monto_pagado,estado)
           VALUES ${vals}`, params
        )
        await q(
          `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
           VALUES ($1,'desembolso',$2,$3,$4,
             COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                       ORDER BY fecha DESC LIMIT 1), 0) + $2)`,
          [uuidv4(), -capitalFinanciar, 'Desembolso — ' + cliente_id, id]
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
        // Sin cuotas (edge case): solo mover caja — saldo calculado en SQL
        await q(
          `INSERT INTO ${S}.cred_movimientos_caja (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
           VALUES ($1,'desembolso',$2,$3,$4,
             COALESCE((SELECT saldo_acumulado FROM ${S}.cred_movimientos_caja
                       ORDER BY fecha DESC LIMIT 1), 0) + $2)`,
          [uuidv4(), -capitalFinanciar, 'Desembolso — ' + cliente_id, id]
        )
      }

      return { prodRow: prod.rows[0], cuotas: cuotasGen }
    })

    // Auditoría fire-and-forget — no retrasa la respuesta al cliente
    const accion = es_refinanciacion_de ? ACCIONES.REFINANCIAR : ACCIONES.CREAR_PRESTAMO
    auditar({ ...u, accion, modulo: MODULOS.PRESTAMOS,
      descripcion: (es_refinanciacion_de ? 'Refinancio' : 'Creo') + ' ' + tipo + ': $' + capitalFinanciar.toLocaleString() + ' — cliente ' + cliente_id,
      detalle: { id, tipo, monto: capitalFinanciar, cliente_id, es_refinanciacion_de } })
      .catch(err => console.error('[auditoría]', err.message))

    return NextResponse.json({ producto: prodRow, cuotas_generadas: cuotas.length }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
