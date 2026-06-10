import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { auditar, getUsuarioDesdeRequest } from '@/lib/auditoria'

// ─────────────────────────────────────────────────────────────────────────────
// SQL de toda la estructura — usa IF NOT EXISTS en todo para ser idempotente.
// Se puede ejecutar sobre una BD vacía o una con tablas ya existentes.
// ─────────────────────────────────────────────────────────────────────────────
const SENTENCIAS = [

  // ── 0. Esquema ──────────────────────────────────────────────────────────
  `CREATE SCHEMA IF NOT EXISTS administrativo`,

  // ── 1. Clientes ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_clientes (
    id             TEXT PRIMARY KEY,
    documento      TEXT UNIQUE NOT NULL,
    nombre         TEXT NOT NULL,
    telefono       TEXT,
    direccion      TEXT,
    email          TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // ── 2. Productos ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_productos (
    id                   TEXT PRIMARY KEY,
    cliente_id           TEXT NOT NULL,
    tipo                 TEXT NOT NULL DEFAULT 'prestamo',
    monto_capital        NUMERIC NOT NULL DEFAULT 0,
    tasa_interes         NUMERIC NOT NULL DEFAULT 0,
    periodo_tasa         TEXT NOT NULL DEFAULT 'mensual',
    frecuencia_cobro     TEXT NOT NULL DEFAULT 'mensual',
    num_cuotas           INTEGER NOT NULL DEFAULT 1,
    fecha_primer_pago    DATE,
    con_interes          BOOLEAN DEFAULT TRUE,
    metodo_calculo       TEXT DEFAULT 'plano',
    cuota_inicial        NUMERIC DEFAULT 0,
    descripcion_bien     TEXT,
    valor_comercial_bien NUMERIC,
    fecha_limite_rescate DATE,
    estado               TEXT NOT NULL DEFAULT 'activo',
    es_refinanciacion_de TEXT DEFAULT NULL,
    refinanciado_por     TEXT DEFAULT NULL,
    referencia           TEXT DEFAULT NULL,
    notas                TEXT,
    fecha_creacion       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_productos_cliente     ON administrativo.cred_productos(cliente_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_productos_estado      ON administrativo.cred_productos(estado)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_productos_estado_tipo ON administrativo.cred_productos(estado, tipo)`,

  // ── 3. Cuotas ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_cuotas (
    id                TEXT PRIMARY KEY,
    producto_id       TEXT NOT NULL,
    cliente_id        TEXT NOT NULL,
    numero_cuota      INTEGER NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    monto_cuota       NUMERIC NOT NULL DEFAULT 0,
    abono_interes     NUMERIC NOT NULL DEFAULT 0,
    abono_capital     NUMERIC NOT NULL DEFAULT 0,
    saldo_pendiente   NUMERIC NOT NULL DEFAULT 0,
    monto_pagado      NUMERIC NOT NULL DEFAULT 0,
    dias_mora         INTEGER DEFAULT 0,
    estado            TEXT NOT NULL DEFAULT 'pendiente'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_cuotas_producto         ON administrativo.cred_cuotas(producto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_cuotas_cliente          ON administrativo.cred_cuotas(cliente_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_cuotas_estado           ON administrativo.cred_cuotas(estado)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_cuotas_producto_estado  ON administrativo.cred_cuotas(producto_id, estado)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_cuotas_cliente_estado   ON administrativo.cred_cuotas(cliente_id, estado)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_cuotas_vencimiento_estado ON administrativo.cred_cuotas(fecha_vencimiento, estado)`,

  // ── 4. Pagos ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_pagos (
    id             TEXT PRIMARY KEY,
    cuota_id       TEXT NOT NULL,
    producto_id    TEXT NOT NULL,
    cliente_id     TEXT NOT NULL,
    monto          NUMERIC NOT NULL DEFAULT 0,
    monto_interes  NUMERIC NOT NULL DEFAULT 0,
    monto_capital  NUMERIC NOT NULL DEFAULT 0,
    fecha_pago     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metodo_pago    TEXT DEFAULT 'efectivo',
    notas          TEXT,
    numero_recibo  TEXT,
    usuario_nombre TEXT DEFAULT 'Sistema'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_pagos_producto ON administrativo.cred_pagos(producto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_pagos_cliente  ON administrativo.cred_pagos(cliente_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_pagos_fecha    ON administrativo.cred_pagos(fecha_pago DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_pagos_recibo   ON administrativo.cred_pagos(numero_recibo)`,

  // ── 5. Caja ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_movimientos_caja (
    id              TEXT PRIMARY KEY,
    tipo            TEXT NOT NULL,
    monto           NUMERIC NOT NULL DEFAULT 0,
    concepto        TEXT,
    referencia_id   TEXT,
    saldo_acumulado NUMERIC NOT NULL DEFAULT 0,
    fecha           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_caja_fecha       ON administrativo.cred_movimientos_caja(fecha DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_caja_fecha_saldo ON administrativo.cred_movimientos_caja(fecha DESC) INCLUDE (saldo_acumulado)`,

  // ── 6. Configuración ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_configuracion (
    id             TEXT PRIMARY KEY,
    clave          TEXT UNIQUE NOT NULL,
    valor          TEXT NOT NULL,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_configuracion_clave ON administrativo.cred_configuracion(clave)`,

  `INSERT INTO administrativo.cred_configuracion (id, clave, valor)
   VALUES (gen_random_uuid()::text, 'recibo_consecutivo',  '1'),
          (gen_random_uuid()::text, 'credito_consecutivo', '1'),
          (gen_random_uuid()::text, 'modo_prueba',         'false')
   ON CONFLICT (clave) DO NOTHING`,

  // ── 7. Usuarios ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_usuarios (
    id             TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    usuario        TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    rol            TEXT DEFAULT 'operador',
    activo         BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultimo_acceso  TIMESTAMP
  )`,

  // Admin inicial — contraseña: admin123
  `INSERT INTO administrativo.cred_usuarios (id, nombre, usuario, password_hash, rol)
   VALUES (gen_random_uuid()::text, 'Administrador', 'admin',
           '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
   ON CONFLICT (usuario) DO NOTHING`,

  // ── 8. Auditoría ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_auditoria (
    id             TEXT PRIMARY KEY,
    usuario_id     TEXT,
    usuario_nombre TEXT NOT NULL,
    accion         TEXT NOT NULL,
    modulo         TEXT NOT NULL,
    descripcion    TEXT,
    detalle        JSONB,
    ip             TEXT,
    fecha          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_auditoria_fecha   ON administrativo.cred_auditoria(fecha DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_auditoria_usuario ON administrativo.cred_auditoria(usuario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cred_auditoria_modulo  ON administrativo.cred_auditoria(modulo)`,

  // ── 9. Historial de recálculos ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_historial_recalculos (
    id                        TEXT PRIMARY KEY,
    producto_id               TEXT NOT NULL,
    tipo                      TEXT NOT NULL,
    fecha                     TIMESTAMP NOT NULL DEFAULT NOW(),
    capital_original          NUMERIC NOT NULL DEFAULT 0,
    capital_saldo_antes       NUMERIC NOT NULL DEFAULT 0,
    capital_saldo_despues     NUMERIC NOT NULL DEFAULT 0,
    capital_abonado           NUMERIC NOT NULL DEFAULT 0,
    interes_pendiente_antes   NUMERIC NOT NULL DEFAULT 0,
    interes_pendiente_despues NUMERIC NOT NULL DEFAULT 0,
    num_cuotas_total          INTEGER NOT NULL DEFAULT 0,
    num_cuotas_antes          INTEGER NOT NULL DEFAULT 0,
    num_cuotas_despues        INTEGER NOT NULL DEFAULT 0,
    monto_cuota_antes         NUMERIC NOT NULL DEFAULT 0,
    monto_cuota_despues       NUMERIC NOT NULL DEFAULT 0,
    total_pendiente_antes     NUMERIC NOT NULL DEFAULT 0,
    total_pendiente_despues   NUMERIC NOT NULL DEFAULT 0,
    pago_id                   TEXT,
    numero_recibo             TEXT,
    notas                     TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_hist_producto_fecha ON administrativo.cred_historial_recalculos(producto_id, fecha)`,

  // ── 10. Tipos de préstamo ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_tipos_prestamo (
    id             TEXT PRIMARY KEY,
    codigo         TEXT UNIQUE NOT NULL,
    label          TEXT NOT NULL,
    icono          TEXT NOT NULL DEFAULT '📄',
    descripcion    TEXT,
    comportamiento TEXT NOT NULL DEFAULT 'prestamo_normal',
    activo         BOOLEAN NOT NULL DEFAULT TRUE,
    es_sistema     BOOLEAN NOT NULL DEFAULT FALSE,
    orden          INTEGER NOT NULL DEFAULT 99,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
  )`,

  `INSERT INTO administrativo.cred_tipos_prestamo
     (id, codigo, label, icono, descripcion, comportamiento, activo, es_sistema, orden)
   VALUES
     ('tipo-prestamo', 'prestamo', 'Préstamo',       '💰', 'Crédito con cuotas, tasa e intereses.',             'prestamo_normal', TRUE, TRUE, 1),
     ('tipo-venta',    'venta',    'Venta a crédito', '🛍️','Venta financiada con plan de cuotas.',              'prestamo_normal', TRUE, TRUE, 2),
     ('tipo-empeno',   'empeno',   'Empeño',          '🔒', 'Artículo en garantía con fecha límite de rescate.','empeno',          TRUE, TRUE, 3),
     ('tipo-fiado',    'fiado',    'Fiado',            '🌿', 'Cuenta abierta sin interés ni cuotas fijas.',     'cuenta_abierta',  TRUE, TRUE, 4),
     ('tipo-adelanto', 'adelanto', 'Adelanto',         '⚡', 'Anticipo sin interés (empleados, emergencias).', 'cuenta_abierta',  TRUE, TRUE, 5)
   ON CONFLICT (codigo) DO NOTHING`,

  // ── 11. Historial de backups ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS administrativo.cred_backups (
    id             TEXT PRIMARY KEY,
    fecha          TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_nombre TEXT,
    tipo           TEXT NOT NULL,
    num_clientes   INTEGER DEFAULT 0,
    num_productos  INTEGER DEFAULT 0,
    num_pagos      INTEGER DEFAULT 0,
    num_cuotas     INTEGER DEFAULT 0,
    tamanio_kb     NUMERIC(10,1) DEFAULT 0,
    notas          TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cred_backups_fecha ON administrativo.cred_backups(fecha DESC)`,

  // ── 12. Columnas de migraciones ──────────────────────────────────────────
  // (ALTER ADD COLUMN IF NOT EXISTS es idempotente desde PG 9.6)
  `ALTER TABLE administrativo.cred_productos ADD COLUMN IF NOT EXISTS refinanciado_por     TEXT DEFAULT NULL`,
  `ALTER TABLE administrativo.cred_productos ADD COLUMN IF NOT EXISTS es_refinanciacion_de TEXT DEFAULT NULL`,
  `ALTER TABLE administrativo.cred_productos ADD COLUMN IF NOT EXISTS referencia            TEXT DEFAULT NULL`,
  `ALTER TABLE administrativo.cred_pagos     ADD COLUMN IF NOT EXISTS monto_interes         NUMERIC NOT NULL DEFAULT 0`,
  `ALTER TABLE administrativo.cred_pagos     ADD COLUMN IF NOT EXISTS monto_capital          NUMERIC NOT NULL DEFAULT 0`,
  `ALTER TABLE administrativo.cred_pagos     ADD COLUMN IF NOT EXISTS usuario_nombre         TEXT DEFAULT 'Sistema'`,
]

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/backup/estructura
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const u = await getUsuarioDesdeRequest(request)
    if (!u?.id) return NextResponse.json({ error: 'Solo administradores pueden ejecutar esta acción' }, { status: 403 })

    const resultados = []
    let errores = 0

    for (const sql of SENTENCIAS) {
      const label = sql.trim().split('\n')[0].slice(0, 80)
      try {
        await query(sql)
        resultados.push({ ok: true, sql: label })
      } catch (e) {
        // Ignorar errores de "ya existe" (código 42P07 duplicate_table, 42701 duplicate_column)
        if (['42P07', '42701', '42710', '23505'].includes(e.code)) {
          resultados.push({ ok: true, sql: label, nota: 'ya existía' })
        } else {
          resultados.push({ ok: false, sql: label, error: e.message })
          errores++
        }
      }
    }

    auditar({ ...u, accion: 'Recrear estructura BD', modulo: 'Backup',
      descripcion: `Estructura recreada: ${SENTENCIAS.length} sentencias, ${errores} errores`,
      detalle: { total: SENTENCIAS.length, errores } })

    return NextResponse.json({
      ok:          errores === 0,
      total:       SENTENCIAS.length,
      exitosos:    SENTENCIAS.length - errores,
      errores,
      resultados,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
