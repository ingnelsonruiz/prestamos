import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { auditar, getUsuarioDesdeRequest, ACCIONES, MODULOS } from '@/lib/auditoria'

const S = 'administrativo'
const VERSION_BACKUP = '1.0'

// ─── Solo administradores ────────────────────────────────────────────────────
async function verificarAdmin(request) {
  const u = await getUsuarioDesdeRequest(request)
  if (!u?.rol || u.rol !== 'admin') return null
  return u
}

// ─── GET /api/backup — Generar y devolver JSON de respaldo ───────────────────
export async function GET(request) {
  try {
    const u = await getUsuarioDesdeRequest(request)

    const [
      clientes, productos, cuotas, pagos,
      caja, historial, config, usuarios,
    ] = await Promise.all([
      query(`SELECT * FROM ${S}.cred_clientes            ORDER BY nombre ASC`),
      query(`SELECT * FROM ${S}.cred_productos           ORDER BY fecha_creacion ASC`),
      query(`SELECT * FROM ${S}.cred_cuotas              ORDER BY producto_id, numero_cuota ASC`),
      query(`SELECT * FROM ${S}.cred_pagos               ORDER BY fecha_pago ASC`),
      query(`SELECT * FROM ${S}.cred_movimientos_caja    ORDER BY fecha ASC`),
      query(`SELECT * FROM ${S}.cred_historial_recalculos ORDER BY fecha ASC`),
      query(`SELECT * FROM ${S}.cred_configuracion`),
      query(`SELECT id, nombre, usuario, password_hash, rol, activo, ultimo_acceso FROM ${S}.cred_usuarios`),
    ])

    const backup = {
      version:   VERSION_BACKUP,
      fecha:     new Date().toISOString(),
      sistema:   'Inversiones Tata Liñán',
      generado_por: u?.nombre || 'Sistema',
      conteos: {
        clientes:   clientes.rows.length,
        productos:  productos.rows.length,
        cuotas:     cuotas.rows.length,
        pagos:      pagos.rows.length,
        caja:       caja.rows.length,
        historial:  historial.rows.length,
        config:     config.rows.length,
        usuarios:   usuarios.rows.length,
      },
      tablas: {
        clientes:    clientes.rows,
        productos:   productos.rows,
        cuotas:      cuotas.rows,
        pagos:       pagos.rows,
        caja:        caja.rows,
        historial:   historial.rows,
        config:      config.rows,
        usuarios:    usuarios.rows,
      },
    }

    const json     = JSON.stringify(backup, null, 2)
    const tamKb    = parseFloat((Buffer.byteLength(json, 'utf8') / 1024).toFixed(1))
    const fecha    = new Date().toISOString().slice(0, 10)
    const filename = `backup-itl-${fecha}.json`

    // Registrar en historial
    await query(
      `INSERT INTO ${S}.cred_backups
         (id, usuario_nombre, tipo, num_clientes, num_productos, num_pagos, num_cuotas, tamanio_kb)
       VALUES ($1,$2,'exportacion',$3,$4,$5,$6,$7)`,
      [uuidv4(), u?.nombre || 'Sistema',
       clientes.rows.length, productos.rows.length,
       pagos.rows.length, cuotas.rows.length, tamKb]
    )

    auditar({ ...u, accion: 'Exportar backup', modulo: 'Backup',
      descripcion: `Backup exportado: ${tamKb} KB — ${clientes.rows.length} clientes, ${pagos.rows.length} pagos`,
      detalle: backup.conteos })

    return new Response(json, {
      status: 200,
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('[BACKUP GET ERROR]', error.message, error.stack)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ─── POST /api/backup — Restaurar desde JSON ─────────────────────────────────
export async function POST(request) {
  try {
    const u = await getUsuarioDesdeRequest(request)
    if (!u?.id) return NextResponse.json({ error: 'Solo administradores pueden restaurar' }, { status: 403 })

    const body = await request.json()
    const { tablas, conteos, version } = body

    if (!tablas || !version)
      return NextResponse.json({ error: 'Archivo de backup inválido o corrupto' }, { status: 400 })

    // ── Limpiar tablas con CASCADE para respetar FK ───────────────────
    await query(`TRUNCATE ${S}.cred_pagos, ${S}.cred_historial_recalculos, ${S}.cred_cuotas, ${S}.cred_movimientos_caja, ${S}.cred_productos, ${S}.cred_clientes, ${S}.cred_configuracion CASCADE`)
    // Usuarios: no truncar — solo restaurar los del backup sin eliminar al actual
    // (evita quedarse sin acceso si el backup no tiene el usuario actual)

    // ── Helper: insertar filas en batch ──────────────────────────────────
    const insertBatch = async (tabla, filas, columnas) => {
      if (!filas?.length) return
      const CHUNK = 200
      for (let i = 0; i < filas.length; i += CHUNK) {
        const chunk  = filas.slice(i, i + CHUNK)
        const places = chunk.map((_, ri) =>
          '(' + columnas.map((_, ci) => `$${ri * columnas.length + ci + 1}`).join(',') + ')'
        ).join(',')
        const values = chunk.flatMap(row => columnas.map(c => row[c] ?? null))
        await query(`INSERT INTO ${S}.${tabla} (${columnas.join(',')}) VALUES ${places} ON CONFLICT (id) DO NOTHING`, values)
      }
    }

    // ── Restaurar cada tabla ──────────────────────────────────────────────
    await insertBatch('cred_clientes', tablas.clientes, [
      'id','documento','nombre','telefono','direccion','email'
    ])

    await insertBatch('cred_productos', tablas.productos, [
      'id','referencia','cliente_id','tipo','monto_capital','tasa_interes','periodo_tasa',
      'frecuencia_cobro','num_cuotas','fecha_primer_pago','con_interes','metodo_calculo',
      'cuota_inicial','descripcion_bien','valor_comercial_bien','fecha_limite_rescate',
      'notas','es_refinanciacion_de','refinanciado_por','estado','fecha_creacion'
    ])

    await insertBatch('cred_cuotas', tablas.cuotas, [
      'id','producto_id','cliente_id','numero_cuota','fecha_vencimiento',
      'monto_cuota','abono_interes','abono_capital','saldo_pendiente',
      'monto_pagado','dias_mora','estado'
    ])

    await insertBatch('cred_pagos', tablas.pagos, [
      'id','cuota_id','producto_id','cliente_id','monto','monto_interes','monto_capital',
      'fecha_pago','metodo_pago','notas','numero_recibo','usuario_nombre'
    ])

    await insertBatch('cred_movimientos_caja', tablas.caja, [
      'id','tipo','monto','concepto','referencia_id','saldo_acumulado','fecha'
    ])

    await insertBatch('cred_historial_recalculos', tablas.historial, [
      'id','producto_id','tipo','capital_original','capital_saldo_antes','capital_saldo_despues',
      'capital_abonado','interes_pendiente_antes','interes_pendiente_despues',
      'num_cuotas_total','num_cuotas_antes','num_cuotas_despues',
      'monto_cuota_antes','monto_cuota_despues','total_pendiente_antes','total_pendiente_despues',
      'fecha','pago_id','numero_recibo'
    ])

    // Config: restaurar solo las claves que existen en el backup
    if (tablas.config?.length) {
      for (const row of tablas.config) {
        await query(
          `INSERT INTO ${S}.cred_configuracion (id,clave,valor,actualizado_en)
           VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET valor=$3, actualizado_en=$4`,
          [row.id, row.clave, row.valor, row.actualizado_en || new Date()]
        )
      }
    }

    // Usuarios del backup (sin sobreescribir al usuario actual)
    if (tablas.usuarios?.length) {
      for (const row of tablas.usuarios) {
        if (row.id === u.id) continue  // nunca sobreescribir al usuario que restaura
        await query(
          `INSERT INTO ${S}.cred_usuarios (id,nombre,usuario,password_hash,rol,activo,ultimo_acceso)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT DO NOTHING`,
          [row.id, row.nombre, row.usuario, row.password_hash,
           row.rol, row.activo, row.ultimo_acceso || null]
        )
      }
    }

    // Registrar restauración en historial
    await query(
      `INSERT INTO ${S}.cred_backups
         (id, usuario_nombre, tipo, num_clientes, num_productos, num_pagos, num_cuotas, notas)
       VALUES ($1,$2,'restauracion',$3,$4,$5,$6,$7)`,
      [uuidv4(), u.nombre,
       conteos?.clientes || 0, conteos?.productos || 0,
       conteos?.pagos || 0, conteos?.cuotas || 0,
       `Restaurado desde backup del ${body.fecha?.slice(0, 10) || 'fecha desconocida'}`]
    )

    await auditar({ ...u, accion: 'Restaurar backup', modulo: 'Backup',
      descripcion: `Base de datos restaurada desde backup del ${body.fecha?.slice(0, 10)}`,
      detalle: conteos || {} })

    return NextResponse.json({ ok: true, mensaje: 'Restauración completada exitosamente' })
  } catch (error) {
    console.error('[BACKUP POST ERROR]', error.message, error.stack)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
