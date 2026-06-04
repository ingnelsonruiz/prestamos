import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'

export async function POST(request) {
  try {
    const { registros } = await request.json()
    if (!registros?.length)
      return NextResponse.json({ error: 'Sin registros para importar' }, { status: 400 })

    const u = await getUsuarioDesdeRequest(request)
    const resultados = { creados: 0, actualizados: 0, errores: [] }

    for (const r of registros) {
      try {
        // ── 1. Upsert cliente ──────────────────────────────────────────────
        const documento = String(r.documento || '').trim()
        const nombre    = String(r.nombre     || '').trim().toUpperCase()
        if (!documento || !nombre) {
          resultados.errores.push(`Fila ${r._fila}: documento y nombre son obligatorios`)
          continue
        }

        let clienteId
        const clienteExiste = await query(
          `SELECT id FROM ${S}.cred_clientes WHERE documento=$1`, [documento]
        )

        if (clienteExiste.rows.length) {
          // Actualizar datos si hay campos nuevos
          clienteId = clienteExiste.rows[0].id
          await query(
            `UPDATE ${S}.cred_clientes
             SET nombre=$1,
                 telefono = COALESCE(NULLIF($2,''), telefono),
                 direccion = COALESCE(NULLIF($3,''), direccion),
                 email = COALESCE(NULLIF($4,''), email)
             WHERE id=$5`,
            [nombre, r.telefono||'', r.direccion||'', r.email||'', clienteId]
          )
          resultados.actualizados++
        } else {
          clienteId = uuidv4()
          await query(
            `INSERT INTO ${S}.cred_clientes (id,documento,nombre,telefono,direccion,email)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [clienteId, documento, nombre,
             r.telefono||null, r.direccion||null, r.email||null]
          )
          resultados.creados++
        }

        // ── 2. Si hay saldo, crear producto como cuenta abierta ───────────
        const saldo = parseFloat(r.saldo_actual || 0)
        if (saldo > 0) {
          const tipo = String(r.tipo || 'prestamo').toLowerCase().trim()
          const tiposValidos = ['prestamo','venta','empeno','fiado','adelanto']
          const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'prestamo'

          const prodId   = uuidv4()
          const cuotaId  = uuidv4()
          const fechaHoy = new Date().toISOString().split('T')[0]

          await query(
            `INSERT INTO ${S}.cred_productos
              (id,cliente_id,tipo,monto_capital,tasa_interes,num_cuotas,
               fecha_primer_pago,con_interes,metodo_calculo,descripcion_bien,notas)
             VALUES ($1,$2,$3,$4,0,1,$5,false,'plano',$6,$7)`,
            [prodId, clienteId, tipoFinal, saldo, fechaHoy,
             r.descripcion||null,
             `MIGRADO desde cuaderno${r.notas ? ' — ' + r.notas : ''}`]
          )

          // Una cuota abierta con el saldo actual
          await query(
            `INSERT INTO ${S}.cred_cuotas
              (id,producto_id,cliente_id,numero_cuota,fecha_vencimiento,
               monto_cuota,abono_interes,abono_capital,saldo_pendiente,monto_pagado,estado)
             VALUES ($1,$2,$3,1,'2099-12-31',$4,0,$4,$4,0,'pendiente')`,
            [cuotaId, prodId, clienteId, saldo]
          )
        }
      } catch (e) {
        resultados.errores.push(`Fila ${r._fila}: ${e.message}`)
      }
    }

    await auditar({
      ...u, accion: 'Migración masiva', modulo: MODULOS.CLIENTES,
      descripcion: `Importó ${registros.length} registros: ${resultados.creados} nuevos, ${resultados.actualizados} actualizados, ${resultados.errores.length} errores`,
      detalle: resultados
    })

    return NextResponse.json(resultados)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
