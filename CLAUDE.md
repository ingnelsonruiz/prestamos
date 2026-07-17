# CLAUDE.md — Base de Conocimiento: Programa Créditos

> Sistema web de gestión de créditos, empeños y fiados para una empresa prestamista.
> Stack: **Next.js 15** (App Router) + **PostgreSQL** + **Tailwind CSS**
> Nombre interno del sistema: **Inversiones Tata Liñán**

---

## 1. Visión General

Aplicación full-stack para administrar la cartera crediticia de una empresa prestamista. Permite:

- Registrar clientes y asociarles productos financieros (préstamos, empeños, ventas a crédito, fiados, adelantos, **créditos sin cuotas futuras**).
- Generar automáticamente el plan de cuotas según método de amortización seleccionado.
- Registrar pagos, emitir recibos numerados consecutivamente y actualizar el saldo de caja.
- Hacer seguimiento de mora, cartera vencida y empeños próximos a vencer.
- Auditar cada acción del sistema con usuario, fecha e IP.
- Consulta pública del estado de cuenta de un cliente (sin autenticación) con QR.
- Migración masiva desde Excel (plantillas descargables).
- Liquidación anticipada con valor acordado.
- Conversión de cuenta abierta a préstamo con cuotas.
- Módulo de recibos con búsqueda por número.
- Arqueo del día en cobros.
- Calificación del cliente (Bronce / Plata / Oro / Diamante).
- Modo prueba para fechas futuras en pagos (configurable desde Migración).
- **Tipos de préstamo dinámicos** gestionables desde Configuración (sin tocar código).
- **Referencia legible** de cada crédito (`CRED-000001`) y registro del **medio de desembolso** (efectivo, transferencia, Nequi, Daviplata, llave Bre-B).
- **Historial de recálculos**: snapshots del crédito en creación y en cada abono a capital (pactado vs. después del abono).
- **Copias de seguridad**: exportar/restaurar la base completa en JSON y recrear la estructura idempotente.
- **Despliegue en la nube** (Vercel) con proxy HTTP a PostgreSQL, además del modo local con conexión directa.
- **Créditos Sin Cuotas Futuras**: módulo independiente para créditos donde el interés se calcula por fecha de corte (convención 30/360), con abono libre a intereses, capital o ambos. No usa cuotas periódicas ni toca `lib/calculos.js`.

---

## 2. Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js ^15.3.3 (App Router, Server Components + Client Components) |
| Base de datos | PostgreSQL (esquema `administrativo`) |
| Acceso a BD | **Doble modo** en `lib/db.js`: pool `pg` directo (local) **o** proxy HTTP (`PROXY_URL`) para cloud/Vercel |
| Autenticación | JWT con `jose` v6, almacenado en cookie `itl_session` (8 h) |
| Estilos | Tailwind CSS v3 |
| Gráficas | Chart.js 4 + react-chartjs-2 |
| Exportación | xlsx (SheetJS) |
| IDs | UUID v4 (`uuid` ^11) |
| Hashing | bcryptjs ^3 |
| Middleware | Next.js Middleware (verificación JWT en cada ruta) |
| Despliegue | Vercel (`vercel.json`: `maxDuration` 60 s en `app/api/**`) |

### Acceso a la base de datos (`lib/db.js`)

- **Modo directo** (sin `PROXY_URL`): pool `pg` (`max: 10`, `keepAlive`, `connectionTimeoutMillis: 5000`). Usado en desarrollo local.
- **Modo proxy** (con `PROXY_URL` + `PROXY_API_KEY`): cada query se envía por `POST {PROXY_URL}/query`. Incluye resiliencia: timeout 90 s, 3 reintentos, manejo de *cold start* de Render (espera 35 s ante 502/503 con HTML).
- `withTransaction(fn)`: BEGIN/COMMIT/ROLLBACK sobre un único cliente del pool en modo directo. **En modo proxy NO hay atomicidad real** (sin sesión entre llamadas) → ejecuta `fn` secuencialmente (best effort) y deja advertencia en logs.

---

## 3. Estructura de Directorios

```
Programa_Creditos/
├── app/
│   ├── api/
│   │   ├── auth/login|logout|me/
│   │   ├── clientes/[id]/
│   │   ├── productos/[id]/
│   │   │   └── liquidar/          # POST liquidación anticipada
│   │   ├── cuotas/
│   │   ├── pagos/
│   │   ├── dashboard/
│   │   ├── estado/[id]/           # PÚBLICO
│   │   ├── informes/
│   │   ├── recibos/               # Búsqueda por número de recibo
│   │   ├── migracion/             # POST importación masiva
│   │   │   └── reset/             # POST limpiar datos de prueba
│   │   ├── config/modo-prueba/    # GET/POST toggle fechas futuras
│   │   ├── configuracion/tipos/   # GET/POST tipos de préstamo dinámicos
│   │   │   └── [id]/              # PUT/DELETE tipo
│   │   ├── backup/                # GET export JSON / POST restaurar
│   │   │   ├── estructura/        # POST recrear estructura BD (idempotente)
│   │   │   └── historial/         # GET historial de backups
│   │   ├── creditos-libres/       # Módulo Créditos Sin Cuotas Futuras
│   │   │   ├── route.js           # GET lista + POST crear
│   │   │   └── [id]/
│   │   │       ├── route.js       # GET detalle + métricas
│   │   │       ├── calcular/      # GET proyección de interés (sin escribir BD)
│   │   │       └── abonar/        # POST registrar abono (interés/capital/ambos)
│   │   ├── historial/             # GET ?producto_id= snapshots+pagos+cuotas
│   │   ├── health/                # GET healthcheck (SELECT 1)
│   │   ├── usuarios/[id]/
│   │   └── auditoria/
│   ├── login/
│   ├── clientes/[id]/
│   ├── prestamos/[id]/ nuevo/
│   ├── cobros/
│   ├── empenos/
│   ├── recibos/                   # Módulo búsqueda de recibos
│   ├── estado/[id]/               # PÚBLICO
│   ├── informes/
│   ├── migracion/                 # Migración masiva + zona desarrollo
│   ├── configuracion/             # Gestión de tipos de préstamo
│   ├── backup/                    # Copias de seguridad y estructura
│   ├── creditos-libres/           # Módulo Créditos Sin Cuotas Futuras
│   │   ├── page.js                # Lista con KPIs y filtros
│   │   ├── nuevo/page.js          # Formulario de creación
│   │   └── [id]/page.js           # Detalle + modal de abono
│   ├── usuarios/
│   ├── auditoria/
│   └── page.js                    # Dashboard principal
├── components/
│   ├── Sidebar.jsx
│   ├── BottomNav.jsx
│   ├── LayoutWrapper.jsx          # Banner modo prueba global
│   └── KPICard.jsx
├── lib/
│   ├── db.js                      # Doble modo: pg pool / proxy HTTP
│   ├── auth.js
│   ├── calculos.js
│   └── auditoria.js
├── middleware.js
├── next.config.js
├── vercel.json                    # maxDuration 60s en app/api/**
├── .env.local
├── 00_schema_completo.sql         # Estructura completa idempotente
└── *.sql                          # Migraciones 03..20
```

---

## 4. Base de Datos

### Esquema: `administrativo`

Todas las tablas usan el prefijo `cred_` y el esquema `administrativo`. En el código siempre se referencia como `const S = 'administrativo'`.

### Tablas Principales

#### `cred_clientes`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | UUID v4 |
| documento | TEXT UNIQUE | Cédula o NIT |
| nombre | TEXT | |
| telefono | TEXT | nullable |
| direccion | TEXT | nullable |
| email | TEXT | nullable |

#### `cred_productos`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | UUID v4 |
| referencia | TEXT | Referencia legible `CRED-000001` (consecutivo) |
| cliente_id | TEXT FK | |
| tipo | TEXT | Código de `cred_tipos_prestamo` (ya **sin CHECK fijo**). Base: `prestamo`, `venta`, `empeno`, `fiado`, `adelanto`, `credito_libre` |
| monto_capital | NUMERIC | Capital financiado |
| tasa_interes | NUMERIC | Tasa en % |
| periodo_tasa | TEXT | `diario`, `semanal`, `quincenal`, `mensual`, `anual` |
| frecuencia_cobro | TEXT | `diario`, `semanal`, `quincenal`, `mensual` |
| num_cuotas | INTEGER | |
| fecha_primer_pago | DATE | |
| con_interes | BOOLEAN | |
| metodo_calculo | TEXT | `plano` o `frances` |
| cuota_inicial | NUMERIC | |
| descripcion_bien | TEXT | |
| valor_comercial_bien | NUMERIC | Empeños |
| fecha_limite_rescate | DATE | Empeños |
| estado | TEXT | `activo`, `al_dia`, `en_mora`, `saldado`, `decomisado`, `refinanciado` |
| es_refinanciacion_de | TEXT | |
| refinanciado_por | TEXT | |
| metodo_desembolso | TEXT | `efectivo`, `transferencia`, `nequi`, `daviplata`, `llave_breb`, `otro` (CHECK `chk_metodo_desembolso`) |
| entidad_desembolso | TEXT | Banco o billetera. NULL en efectivo |
| referencia_desembolso | TEXT | N° de cuenta, celular o llave Bre-B. NULL en efectivo |
| notas | TEXT | |
| fecha_creacion | TIMESTAMP | |

**Tipos especiales:**
- `fiado` y `adelanto`: cuenta abierta, 1 cuota con `fecha_vencimiento='2099-12-31'`, tasa=0.
- `adelanto`: igual que fiado pero para anticipos sin interés (empleados, medicina, emergencias). La descripción_bien documenta el motivo.

#### `cred_cuotas`
| Campo | Tipo |
|-------|------|
| id | TEXT PK |
| producto_id | TEXT FK |
| cliente_id | TEXT FK |
| numero_cuota | INTEGER |
| fecha_vencimiento | DATE |
| monto_cuota | NUMERIC |
| abono_interes | NUMERIC |
| abono_capital | NUMERIC |
| saldo_pendiente | NUMERIC |
| monto_pagado | NUMERIC |
| dias_mora | INTEGER |
| estado | TEXT — `pendiente`, `parcial`, `pagada`, `mora` |

#### `cred_pagos`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| cuota_id | TEXT FK | |
| producto_id | TEXT FK | |
| cliente_id | TEXT FK | |
| monto | NUMERIC | |
| monto_interes | NUMERIC | Interés pactado al momento del cobro (no varía con recálculos) |
| monto_capital | NUMERIC | Capital abonado en el pago |
| fecha_pago | TIMESTAMP | Puede ser futura en modo prueba |
| metodo_pago | TEXT | `efectivo`, `transferencia`, `nequi`, `daviplata`, `otro` |
| notas | TEXT | |
| numero_recibo | TEXT | Formato `REC-000001` |
| usuario_nombre | TEXT | |
| fecha_corte_interes | DATE NULL | Solo en créditos libres: fecha hasta la cual se cobró interés en ese pago. Agregada por `autoMigrar()` en los endpoints del módulo (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). |

#### `cred_usuarios`
| Campo | Tipo |
|-------|------|
| id | TEXT PK |
| nombre | TEXT |
| usuario | TEXT UNIQUE |
| password_hash | TEXT |
| rol | TEXT — `admin` o `operador` |
| activo | BOOLEAN |
| ultimo_acceso | TIMESTAMP |

#### `cred_auditoria`
| Campo | Tipo |
|-------|------|
| id | TEXT PK |
| usuario_id | TEXT |
| usuario_nombre | TEXT |
| accion | TEXT |
| modulo | TEXT |
| descripcion | TEXT |
| detalle | JSONB |
| ip | TEXT |
| fecha | TIMESTAMP |

#### `cred_movimientos_caja`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| tipo | TEXT | `desembolso`, `cobro_capital` |
| monto | NUMERIC | Negativo en desembolso |
| concepto | TEXT | |
| referencia_id | TEXT | |
| saldo_acumulado | NUMERIC | |
| fecha | TIMESTAMP | |

#### `cred_configuracion`
| Campo | Tipo |
|-------|------|
| id | TEXT PK — UUID v4 |
| clave | TEXT |
| valor | TEXT |
| actualizado_en | TIMESTAMP |

**Claves registradas:**
| Clave | Uso |
|-------|-----|
| `recibo_consecutivo` | Contador de recibos (REC-XXXXXX) |
| `credito_consecutivo` | Contador de referencias de crédito (CRED-XXXXXX) |
| `modo_prueba` | `'true'`/`'false'` — permite fechas futuras en pagos |

#### `cred_tipos_prestamo`
Tipos de préstamo dinámicos (reemplaza el CHECK fijo de `cred_productos.tipo`). Gestionable desde `/configuracion`.

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| codigo | TEXT UNIQUE | Valor usado en `cred_productos.tipo` (slug generado del label) |
| label | TEXT | Nombre a mostrar |
| icono | TEXT | Emoji |
| descripcion | TEXT | |
| comportamiento | TEXT | `prestamo_normal`, `cuenta_abierta`, `empeno` |
| activo | BOOLEAN | |
| es_sistema | BOOLEAN | Los 5 base no se pueden eliminar |
| orden | INTEGER | |
| fecha_creacion | TIMESTAMP | |

**5 tipos base (`es_sistema=TRUE`)**: `prestamo` 💰, `venta` 🛍️, `empeno` 🔒, `fiado` 🌿, `adelanto` ⚡.
**6.º tipo de sistema**: `credito_libre` 📅 (`es_sistema=TRUE`, `comportamiento='sin_cuotas_futuras'`, `orden=7`). Insertado por `autoMigrar()` en los endpoints de `/api/creditos-libres/*` — sin necesidad de correr SQL manual.
**Comportamientos**: `prestamo_normal` (cuotas con tasa/interés), `cuenta_abierta` (1 cuota a 2099-12-31 sin interés), `empeno` (igual que normal + campos de bien y rescate), `sin_cuotas_futuras` (crédito libre — módulo propio, sin generación de cuotas futuras).

#### `cred_historial_recalculos`
Snapshots del estado del crédito en su creación y en cada abono a capital (para mostrar "pactado originalmente vs. después del abono").

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| producto_id | TEXT FK | |
| tipo | TEXT | `creacion`, `recalculo_capital` |
| fecha | TIMESTAMP | |
| capital_original / capital_saldo_antes / capital_saldo_despues / capital_abonado | NUMERIC | |
| interes_pendiente_antes / interes_pendiente_despues | NUMERIC | |
| num_cuotas_total / num_cuotas_antes / num_cuotas_despues | INTEGER | |
| monto_cuota_antes / monto_cuota_despues | NUMERIC | |
| total_pendiente_antes / total_pendiente_despues | NUMERIC | |
| pago_id / numero_recibo / notas | TEXT | Solo en `recalculo_capital` |

#### `cred_backups`
Historial de exportaciones y restauraciones de la base.

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| fecha | TIMESTAMP | |
| usuario_nombre | TEXT | |
| tipo | TEXT | `exportacion`, `restauracion` |
| num_clientes / num_productos / num_pagos / num_cuotas | INTEGER | |
| tamanio_kb | NUMERIC | |
| notas | TEXT | |

---

## 5. Lógica Financiera (`lib/calculos.js`)

```js
const DIAS = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }
```

### Método Plano
- Conversión proporcional: `tasa_periodo = (tasa% / 100) * (días_destino / días_origen)`
- Cuota constante, interés siempre sobre capital inicial.

### Método Francés
- Conversión efectiva compuesta: `(1 + i)^(d2/d1) - 1`
- Cuota fija: `P * i*(1+i)^n / ((1+i)^n - 1)`

### Fiado y Adelanto
- Sin interés, sin cuotas múltiples.
- 1 cuota con `fecha_vencimiento = '2099-12-31'`.

### Fechas de vencimiento
- Se usan fechas locales (no UTC) con `split('-')` para evitar desfase.
- **IMPORTANTE**: `fecha_primer_pago` viene de PostgreSQL como objeto `Date`. Se convierte a string `YYYY-MM-DD` antes de llamar `generarCuotas()`.

---

## 6. API Endpoints

### Autenticación
| Método | Ruta |
|--------|------|
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/me` |

### Clientes
| Método | Ruta |
|--------|------|
| GET | `/api/clientes?q=` |
| POST | `/api/clientes` |
| GET/PUT/DELETE | `/api/clientes/[id]` |

**La API `/api/clientes/[id]` GET devuelve** productos con: `total_cuotas`, `cuotas_pagadas`, `cuotas_pendientes`, `cuotas_mora`, `saldo_total`.

### Productos
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/productos?cliente_id=` | Incluye `telefono`, `direccion`, `ref_nuevo`, `ref_origen` (referencias de refinanciación). También `capital_pendiente_real` e `interes_pendiente` (desglose correcto; el `capital_pendiente` original mezcla capital+interés pese al nombre — ver §10 "Préstamos") |
| POST | `/api/productos` | Fiado/adelanto: cuenta abierta. Otros: genera cuotas. Asigna `referencia` (CRED-XXXXXX) y `metodo_desembolso`. Snapshot de creación en `cred_historial_recalculos`. Si `es_refinanciacion_de` viene con `monto_inyectado > 0` (refinanciación + dinero nuevo), lo persiste aparte del total (ver §19); se fuerza a 0 si el crédito no es una refinanciación. |
| GET/PUT | `/api/productos/[id]` | |
| POST | `/api/productos/[id]/liquidar` | Liquidación anticipada con valor acordado |

**GROUP BY en `/api/productos` GET**: `p.id, c.nombre, c.documento, c.telefono, c.direccion, por.referencia, orig.referencia`

### Cuotas
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/cuotas?estado=&cliente_id=&producto_id=` | Incluye `telefono_cliente`, `fecha_creacion`, `monto_capital` del producto |

### Pagos
| Método | Ruta | Notas |
|--------|------|-------|
| POST | `/api/pagos` | Valida fecha futura solo si `modo_prueba != 'true'` |
| GET | `/api/pagos?producto_id=&cliente_id=&fecha=` | `fecha=YYYY-MM-DD` para arqueo |

### Dashboard
`GET /api/dashboard` devuelve KPIs:
- `capital_en_calle`, `intereses_ganados`, `clientes_en_mora`, `recaudo_hoy`, `cartera_vencida_30d`
- `total_invertido`, `num_creditos`, `total_recuperado` ← **KPIs históricos**
- `cuotas_hoy`, `cuotas_semana`, `empenos_vencer`, `movimientos_caja`

### Recibos
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/recibos?q=REC-000001` | Búsqueda flexible por número |

### Migración
| Método | Ruta | Notas |
|--------|------|-------|
| POST | `/api/migracion` | Importación masiva. Crea clientes + saldos como cuentas abiertas |
| POST | `/api/migracion/reset` | Borra préstamos, cuotas, pagos y caja. Conserva clientes y usuarios |
| POST | `/api/migracion/reset-cliente` | Borra créditos de **un** cliente. Body: `{ clienteId, productoIds? }`. Si `productoIds` viene vacío/ausente borra TODOS los créditos del cliente (compat. hacia atrás); si trae ids, borra **solo esos** créditos (y sus cuotas/pagos/movimientos/recálculos), dejando el resto del cliente intacto. Filtra siempre por `producto_id`, nunca por `cliente_id`, para permitir borrado parcial |

### Config
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/config/modo-prueba` | Devuelve `{ activo: bool }` |
| POST | `/api/config/modo-prueba` | Body: `{ activo: bool }`. DELETE + INSERT con UUID |

### Tipos de préstamo (Configuración)
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/configuracion/tipos` | Lista tipos. **Auto-inicializa** la tabla con los 5 base si no existe/está vacía |
| POST | `/api/configuracion/tipos` | Crea tipo; genera `codigo` (slug) desde el `label`. 409 si el código existe |
| PUT | `/api/configuracion/tipos/[id]` | Edita label/icono/descripción/comportamiento/activo/orden |
| DELETE | `/api/configuracion/tipos/[id]` | Tipos `es_sistema` → 403. Con productos activos → solo desactiva. Sin uso → elimina |

### Backup
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/backup` | Exporta JSON completo (8 tablas) + registra en `cred_backups` |
| POST | `/api/backup` | Restaura desde JSON (TRUNCATE + INSERT batch). **No sobreescribe** al usuario actual |
| POST | `/api/backup/estructura` | Recrea toda la estructura (SQL idempotente). Solo admin |
| GET | `/api/backup/historial` | Últimos 50 backups. Devuelve `[]` si la tabla no existe |

### Créditos Sin Cuotas Futuras
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/creditos-libres` | Lista todos los `credito_libre`. Retorna `capital_pagado`, `capital_pendiente`, `intereses_pagados`, `ultima_fecha_corte`, `dias_sin_corte`. Ejecuta `autoMigrar()` en cada llamada. |
| POST | `/api/creditos-libres` | Crea crédito libre: producto + 1 cuota placeholder (`fecha_vencimiento='2099-12-31'`) + desembolso en caja. Guarda `fecha_inicio` del usuario en `fecha_primer_pago`. |
| GET | `/api/creditos-libres/[id]` | Detalle: producto, pagos con `fecha_corte_interes` y `fecha_desde_periodo` calculado cronológicamente. Normaliza todas las fechas a `YYYY-MM-DD`. |
| GET | `/api/creditos-libres/[id]/calcular?fecha_corte=YYYY-MM-DD` | Proyecta interés (sin escribir BD). Usa convención 30/360. Retorna: `capital_pendiente`, `dias_transcurridos`, `tasa_diaria`, `interes_calculado`. Rechaza si `dias < 1`. |
| POST | `/api/creditos-libres/[id]/abonar` | Registra abono. Body: `{ tipo_abono, fecha_corte, monto_interes, monto_capital, metodo_pago, notas }`. Valida que `fecha_corte > último corte`. Usa consecutivo de recibo compartido. Marca `saldado` si capital queda en 0. |

### Historial del crédito
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/historial?producto_id=` | Devuelve `{ recalculos, pagos, cuotasTodas }` de un crédito |

### Health
`GET /api/health` — ejecuta `SELECT 1`, devuelve `{ ok, ms }` o 503.

### Estado (PÚBLICO)
`GET /api/estado/[id]` — devuelve: nombre, documento, productos con métricas completas, últimos 10 pagos.

---

## 7. Autenticación y Seguridad

- JWT HS256 con `jose`, cookie HttpOnly `itl_session` (8h).
- Rutas públicas: `/login`, `/estado/*`, `/api/auth/*`, `/api/estado/*`.
- Roles: `admin` (acceso total) / `operador` (operación diaria). `/backup` y `/configuracion` (mutaciones) requieren `admin`.
- Variables `.env.local` (modo directo, valor real de producción): `DB_HOST=aws-1-us-east-2.pooler.supabase.com`, `DB_PORT=6543`, `DB_NAME=postgres`, `DB_USER=postgres.fecnicckenqlmpqefkth`, `DB_PASSWORD`, `DB_SCHEMA=administrativo`, `JWT_SECRET`. La BD es un proyecto **Supabase** propio de Programa_Creditos (distinto de `base_sie_dusakawi` que usa Proyecto RCV).
- Variables modo cloud/proxy: `PROXY_URL`, `PROXY_API_KEY` (si están definidas, `lib/db.js` usa el proxy HTTP en lugar del pool directo). Actualmente **no está en uso** para este proyecto — se conecta directo al pooler de Supabase.

### ⚠️ Incidente 2026-07-02 — `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`

**Síntoma:** login y todas las páginas mostraban "Sin conexión a la base de datos" con ese error en rojo, en producción (Vercel).

**Causa:** `DB_PORT=5432` apunta al pooler de Supabase en **modo "Session"** (Supavisor), que en el plan de este proyecto tiene `pool_size: 15`. En modo Session cada conexión retiene un backend de Postgres dedicado durante toda su vida (hasta `idleTimeoutMillis`). Como la app corre en **Vercel serverless**, cada invocación fría crea su propio `Pool` (`max: 3`, singleton solo dentro de esa instancia vía `globalThis.__pg_pool` — no es global entre instancias). Con varias invocaciones concurrentes (dashboard + prestamos + cobros en paralelo, o varios usuarios a la vez) se agotan los 15 backends casi de inmediato.

**Fix:** cambiar `DB_PORT` a **`6543`** (pooler de Supabase en modo **"Transaction"**). En ese modo PgBouncer devuelve la conexión al pool apenas termina cada transacción en vez de retenerla toda la sesión del cliente, permitiendo muchas invocaciones cortas concurrentes sobre un pool pequeño. Es la recomendación oficial de Supabase para entornos serverless/edge. No rompe `withTransaction()` (lib/db.js): ese código usa `pool.connect()` con un único cliente dedicado durante todo el `BEGIN…COMMIT`, que es justo el patrón que el modo transacción soporta.

**Acción pendiente:** el cambio en `.env.local` solo afecta desarrollo local. **Hay que actualizar `DB_PORT=6543` en las variables de entorno del proyecto en Vercel (Settings → Environment Variables) y volver a desplegar** para que tome efecto en producción.

**Si vuelve a ocurrir** tras el cambio de puerto: bajar `max` en `createPool()` (lib/db.js, hoy en `3`), o migrar este proyecto al modo proxy HTTP (`PROXY_URL`) como ya hace Proyecto RCV — desacopla las conexiones de Postgres del escalado serverless de Vercel por completo.

---

## 8. Flujos de Negocio

### Crear préstamo
`POST /api/productos` → genera cuotas → registra desembolso en caja.

### Fiado / Adelanto
`POST /api/productos` con `tipo='fiado'` o `tipo='adelanto'` → 1 cuota abierta `2099-12-31`.

### Registrar pago
`POST /api/pagos` — flujo en bloques paralelos:
1. **Paralelo 1**: modo_prueba + cuotas pendientes + consecutivo atómico (`UPDATE RETURNING`) + capital pagado previo + usuario.
2. **Tope de pago** (solo `plano`): el monto no puede superar `capital_pendiente + interés del período actual` (lo máximo que se debe HOY). Para saldar todo el crédito se usa "Recoger crédito" (liquidación). En `frances` el tope es el total pendiente del cronograma.
3. Calcular distribución en memoria:
   - **`plano` (REGLA DE NEGOCIO)**: se cobra **únicamente el interés del período actual** (el de la cuota más antigua pendiente) y **todo el excedente se abona a CAPITAL**. NO se cobra por adelantado el interés de cuotas futuras; al bajar el capital, `recalcularCuotasPlano` recomputa el interés de las cuotas restantes sobre el nuevo saldo (interés decreciente). Aplicar interés de varias cuotas en un mismo pago **sobre-cobraría** al cliente.
   - **`frances`**: distribución clásica cuota por cuota (interés de cada cuota, luego su capital), pues el cronograma es fijo y no se redistribuye.
5. **Batch UPDATE** cuotas (`monto_pagado`, `estado`, `dias_mora=0`).
6. **Paralelo 2**: INSERT `cred_pagos` + SELECT último saldo de caja.
7. INSERT `cred_movimientos_caja` con saldo acumulado calculado.
8. `recalcularCuotasPlano(productoId, snapshotInfo)` — redistribuye cuotas restantes con nuevo saldo capital. Si el capital queda en 0 cierra todas las cuotas pendientes (crédito `saldado`). Si hubo abono a capital (`capitalAbonado > 0.5`) inserta un snapshot `recalculo_capital` en `cred_historial_recalculos`.
9. Verificar si quedan pendientes → marcar producto `saldado` si no quedan.
10. Detectar si cuota pagada era la última y queda capital → `requiere_refinanciacion`.

El pago guarda el desglose exacto en `cred_pagos.monto_interes` y `cred_pagos.monto_capital` (interés pactado al cobro), independiente de recálculos posteriores.

**`capital_pendiente` para refinanciación**: usa `SUM(cred_pagos.monto_capital)` excluyendo el pago actual (`pg.id != pagoId`). El capital del pago actual NO se descuenta porque ese excedente se convierte en el primer abono del préstamo refinanciado. NO se usa la fórmula derivada de `cred_cuotas` porque `recalcularCuotasPlano` altera `abono_interes` y distorsiona el cálculo histórico.

**`capital_pagado` en `recalcularCuotasPlano`**: se calcula desde `cred_cuotas` como `SUM(GREATEST(0, monto_pagado - abono_interes))` (capital efectivamente absorbido por cada cuota).

**`recalcularCuotasPlano`**: después de cada pago redistribuye las cuotas pendientes:
- `saldoCapital = monto_capital - capital_pagado`
- `tasaPer = (tasa% / 100) × (cpmO / cpmD)` (CUOTAS_POR_MES proporcional)
- `interesTotal = saldoCapital × tasaPer × n_cuotas_pendientes`
- `cuotaBase = floor((saldoCapital + interesTotal) / n)`
- Pre-filtro iterativo cierra cuotas cuyo `monto_pagado >= cuotaBase` (Regla 1) o `>= abono_interes` (Regla 2, nunca la última).
- Batch UPDATE final con nuevos `abono_capital`, `abono_interes`, `monto_cuota`, `saldo_pendiente`, `estado`.

### Liquidación anticipada
`POST /api/productos/[id]/liquidar` con `{ monto_acordado, metodo_pago, notas, fecha_pago, recoger_credito }`:
- Valida `monto_acordado >= saldo_capital_pendiente` (no se puede condonar capital).
- **Cierre coherente con el historial** (sin importar en qué cuota se liquide): la cuota de referencia (primera pendiente) consolida lo realmente cobrado (capital pendiente total + interés del período + abonos previos de esa cuota); las otras cuotas parciales se cierran por lo realmente pagado (capital/interés prorrateados); las cuotas futuras sin pago se ELIMINAN. Garantiza Σ `monto_pagado` de cuotas == Σ pagos.
- Todo dentro de `withTransaction` (incluido el consecutivo del recibo) → producto `saldado` → recibo con nota "LIQUIDACIÓN ANTICIPADA".

### Convertir cuenta abierta a préstamo
Desde el detalle de un fiado/adelanto → botón **"Convertir a préstamo"** → usa el flujo de refinanciación (`es_refinanciacion_de`) → genera nuevo préstamo con cuotas.

### Refinanciar
`POST /api/productos` con `es_refinanciacion_de=<id>` → cierra original con estado `refinanciado`.

### Congelación
Tipo de sistema (`tipo='congelacion'`, `comportamiento='prestamo_normal'`) para diferir una deuda vencida (capital pendiente + interés ya causado) **sin generar interés nuevo**. Se dispara desde el botón ❄️ en el detalle de un crédito, que redirige a `/prestamos/nuevo?congelar=1&...` y usa el flujo de refinanciación (`es_refinanciacion_de`) igual que "Convertir a préstamo". Se excluye de los KPIs de capital del dashboard (`WHERE p.tipo NOT IN (...,'congelacion')`) porque su `monto_capital` mezcla capital viejo + interés causado, no es desembolso nuevo.

**Regla de negocio (blindada 2026-07-02):** una congelación **nunca** cobra interés — `tasa_interes` y `con_interes` deben quedar siempre en 0/false. Antes esto solo se forzaba cuando se entraba por el botón ❄️ (parámetro `?congelar=1`); si el usuario elegía "Congelación" manualmente en el desplegable de Tipo — tanto en `/prestamos/nuevo` como en `/migracion/cargue-inicial` (Cargue Inicial de Saldos, para legalizar créditos antiguos) — la tasa quedaba con el valor que tuviera el formulario (ej. 10%), violando la regla. Se corrigió en **ambos puntos de entrada**, en dos capas cada uno:
- **`/prestamos/nuevo`** — Frontend (`app/prestamos/nuevo/page.js`): `esCongelacion = esCongelar || form.tipo === 'congelacion'` — un `useEffect` fuerza `tasa_interes:'0'`/`con_interes:false` apenas el tipo es congelación (por cualquier vía), y el campo Tasa se bloquea visualmente (`0% — sin interés ❄️`). Backend (`app/api/productos/route.js`, POST): `tasaSegura`/`conInteresSeguro` fuerzan 0/false cuando `tipo === 'congelacion'`, sin importar lo que envíe el cliente.
- **`/migracion/cargue-inicial`** — Frontend (`app/migracion/cargue-inicial/page.js`): mismo patrón (`esCongelacion`, `useEffect`, campo bloqueado, payload forzado en `finalizar()`). Backend (`app/api/migracion/cargue-inicial/route.js`): mismas `tasaSegura`/`conInteresSeguro` antes de generar el cronograma (`generarCuotas`) y antes del INSERT en `cred_productos`.

**Patrón a replicar**: cualquier formulario nuevo que permita elegir un `tipo` de crédito con tasa editable debe calcular `esCongelacion = form.tipo === 'congelacion'` y bloquear tasa/interés en cuanto se detecte ese tipo — tanto en el cliente (UX) como en el endpoint que recibe el POST (seguridad real).

**Importante:** el motor de cálculo (`lib/calculos.js`) NO tiene una modalidad "solo interés" (bullet) para ningún tipo de crédito — cualquier pago por encima del interés del período abona a capital de forma incondicional (`app/api/pagos/route.js`). "Congelación" NO sirve para cobrar interés perpetuo sobre un capital que nunca baja; solo difiere mora existente a tasa 0. Si se necesita un crédito que solo cobre interés sin amortizar capital, es una funcionalidad nueva a diseñar (un `comportamiento` adicional en `cred_tipos_prestamo`), no algo ya soportado.

### Migración masiva
1. Descargar plantilla Excel (3 tipos: Solo Clientes, Clientes+Deudas, Solo Saldos).
2. Subir archivo → validar → preview → importar.
3. Crea clientes (upsert por documento) + saldos como cuentas abiertas.

---

## 9. Migraciones SQL

| Archivo | Descripción |
|---------|-------------|
| `03_alter_refinanciacion.sql` | Columnas `refinanciado_por`, `es_refinanciacion_de` |
| `04_limpiar_datos_prueba.sql` | Borra datos operativos |
| `05_alter_fiado.sql` | Agrega tipo `fiado` |
| `06_crear_usuarios.sql` | Tabla usuarios + admin inicial |
| `07_crear_auditoria.sql` | Tabla auditoría con índices |
| `08_alter_pagos_usuario.sql` | Columna `usuario_nombre` en pagos |
| `09_agregar_adelanto.sql` | Agrega tipo `adelanto` al CHECK |
| `10_agregar_referencia_credito.sql` | Columna `referencia` (CRED-XXXXXX) + clave `credito_consecutivo` + backfill |
| `10_fix_cuotas_liquidacion.sql` | Corrige cuotas "fantasma" de la race condition de liquidación (one-shot) |
| `10_historial_recalculos.sql` | Tabla `cred_historial_recalculos` |
| `10_tipos_prestamo.sql` | Elimina CHECK fijo de `tipo` + tabla `cred_tipos_prestamo` con 5 base |
| `11_pagos_monto_interes_capital.sql` | Columnas `monto_interes`, `monto_capital` en pagos + backfill |
| `12_indices_rendimiento.sql` | Índices compuestos (cuotas, configuración, caja, productos) |
| `13_backup_historial.sql` | Tabla `cred_backups` |
| `14_indices_rendimiento_v2.sql` | Índices trigram (si hay `pg_trgm`), arqueo por día, parciales + ANALYZE |
| `15_metodo_desembolso.sql` | Columnas `metodo_desembolso`, `entidad_desembolso`, `referencia_desembolso` + CHECK |
| `16_normalizar_mora_cuotas.sql` | Normaliza cuotas guardadas como `estado='mora'` (legado del cargue inicial) → `pendiente/parcial` y recalcula estado de productos. Idempotente, no destructivo |
| `17_check_estado_cuota.sql` | **Blindaje**: `CHECK chk_cred_cuotas_estado IN ('pendiente','parcial','pagada')` para impedir que se vuelva a persistir `'mora'`. Ejecutar después de la 16 |
| `18_fix_cuotas_sobrepagadas.sql` | Corrige cuotas con `monto_pagado > monto_cuota` (excedente a capital): fija `monto_cuota = monto_pagado` y `abono_capital = monto_pagado − abono_interes`. Evita "saldo pendiente" negativo en el detalle. Idempotente |
| `19_interes_fijo.sql` | Columna `cred_productos.interes_fijo BOOLEAN NOT NULL DEFAULT FALSE`. Interés congelado sobre capital original para créditos plano opt-in. |
| `20_sin_cuotas_futuras.sql` | **Módulo Créditos Sin Cuotas Futuras**: (1) `ALTER TABLE cred_pagos ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`; (2) elimina el CHECK de comportamientos en `cred_tipos_prestamo`; (3) inserta el tipo `credito_libre` (`comportamiento='sin_cuotas_futuras'`). Idempotente. **No es necesario ejecutarla manualmente** — `autoMigrar()` la ejecuta en cada llamada a los endpoints del módulo. |
| `21_monto_inyectado.sql` | Columna `cred_productos.monto_inyectado NUMERIC NOT NULL DEFAULT 0`. Registra el dinero nuevo desembolsado en una refinanciación con inyección de capital ("Refinanciar + prestar más"), independiente del saldo que hizo rollover. Ver §19. |
| `22_fecha_desembolso.sql` | Columna `cred_productos.fecha_desembolso DATE NULL`. Fecha real de entrega del dinero al cliente, editable por el usuario (distinta de `fecha_creacion`, automática). NULL en créditos anteriores — usar `fecha_creacion::date` como respaldo. Ver §19. |

> **Convención de mora**: `cred_cuotas.estado` ∈ {`pendiente`,`parcial`,`pagada`}. La **mora NO es un estado almacenado**; se deriva por `fecha_vencimiento < CURRENT_DATE` en cada consulta (Cobros, dashboard, informes, listados de clientes/productos). El cargue inicial fija la mora solo a nivel de **producto** (`estado='en_mora'`), nunca en la cuota. **`cred_productos.estado` tampoco se re-evalúa después de creado** (ningún endpoint lo transiciona a `'en_mora'` salvo el cargue inicial), por lo que ningún filtro o vista debe usar `p.estado === 'en_mora'` para detectar mora real; usar siempre el conteo dinámico `cuotas_mora` que expone `GET /api/productos` (cuotas con `fecha_vencimiento < CURRENT_DATE`, `estado != 'pagada'` y `fecha_vencimiento <> '2099-12-31'`).
>
> **Bug corregido (2026-07-02)**: la pestaña "En mora" de `/prestamos` filtraba por `p.estado === 'en_mora'` (valor casi siempre desactualizado) y no mostraba créditos que el Dashboard sí contaba (cálculo dinámico por `cuotas_mora`). Se corrigió `app/prestamos/page.js` para que el filtro y el resaltado de fila usen `Number(p.cuotas_mora) > 0` (excluyendo `saldado`/`refinanciado`), igual que el Dashboard. Replicar este mismo criterio en cualquier vista nueva de mora.

> **`00_schema_completo.sql`**: estructura completa **idempotente** (`IF NOT EXISTS` en todo). Sirve para levantar la BD desde cero o normalizar una existente. El endpoint `POST /api/backup/estructura` ejecuta esta misma estructura desde la app.

> **Nota tipos `10_*`**: hay varios archivos con prefijo `10_` (referencia, fix liquidación, historial, tipos préstamo); son migraciones independientes, no versiones de una sola.

---

## 10. Módulos del Sistema

### Dashboard (`/`)
- KPIs históricos: Total invertido, Total recuperado, Capital en la calle.
- KPIs operativos: Intereses ganados, Clientes en mora, Recaudo del día, Cartera vencida +30d.
- Listas: Cuotas hoy, Cuotas semana, Empeños próximos a vencer.
- **Aclaración KPI "Estado de la cartera" (2026-07-02)**: las 4 tarjetas (`EstadoCard` — Activos/Saldados/En mora/Refinanciados) muestran `p.monto_capital` (capital **desembolsado originalmente**, sin descontar abonos), no el saldo pendiente. Esto generaba confusión con "Capital en la calle" (que sí es saldo pendiente real). Se agregó el texto fijo "capital desembolsado (no es el saldo pendiente)" debajo del monto en `EstadoCard` (`app/page.js`) para diferenciarlas a simple vista. Si se agrega una tarjeta nueva de capital al dashboard, aclarar siempre si es monto **desembolsado** (histórico) o **saldo pendiente** (real por cobrar) — son conceptualmente distintos y no deben verse igual de "cobrable".
- **Detalle por crédito de "Capital en la calle"**: doble clic en la tarjeta abre un modal (igual que "Intereses proyectados" y "Intereses recogidos") con el desglose por cliente/crédito — `GET /api/dashboard/capital-detalle`, misma fórmula que la tarjeta (suma de `abono_capital` pendiente por cuota, productos activos, excluye `congelacion` y la cuota abierta `2099-12-31`). No usa el filtro de rango de fechas del dashboard porque la tarjeta tampoco lo usa (es una foto del saldo actual, no un acumulado del período).
- **Bug corregido (2026-07-02) — "Invalid Date" en "Próximos 7 días"**: `GET /api/dashboard` devolvía `cred_cuotas.fecha_vencimiento` / `cred_productos.fecha_limite_rescate` tal cual las entrega `pg` (objeto `Date`), que al pasar por `NextResponse.json()` se serializa como ISO completo (`...T00:00:00.000Z`). El frontend (`app/page.js`) hace `new Date(fecha + 'T12:00:00')` esperando un `"YYYY-MM-DD"` simple; al concatenar sobre un ISO ya completo, el resultado es `"Invalid Date"`. Se corrigió normalizando esas fechas a `"YYYY-MM-DD"` (helper `fechaStr`, en UTC para no desfasar) antes de responder, en `cuotas_hoy`, `cuotas_semana` y `empenos_vencer`. **Mismo patrón a vigilar** en cualquier endpoint nuevo que devuelva columnas `DATE`/`TIMESTAMP` crudas de `pg` para que el frontend las concatene con hora fija.

### Clientes (`/clientes`)
- Hero card blanco con barra de acento de color (rojo=mora, azul=activo, verde=sin deuda).
- Tabs de filtro con colores: Activos (navy), Saldados (verde), Refinanciados (morado), Todos (gris).
- QR del estado de cuenta con opciones: Copiar QR, Descargar QR, Copiar enlace, Ver página, Enviar por WhatsApp.
- **Listado `/clientes`**: dos segmentadores independientes y combinables — (1) Todos/Reales/Prueba (`filtroPrueba`, va al backend vía `solo_prueba`), (2) **Todos/Activos/En mora/Sin préstamos** (`filtroEstado`, filtrado en cliente sobre `c.estado_calculado` que ya trae `GET /api/clientes` calculado dinámicamente por fecha de vencimiento — no por un campo `estado` almacenado). Cada botón muestra su contador.

### Préstamos (`/prestamos`)
- Agrupado por cliente con: nombre, teléfono (chip verde), dirección.
- Chips de refinanciación en columna de estado.
- Tabs: Activos, Todos, Saldados, **En mora**, Refinanciados. El tab **En mora** filtra por `cuotas_mora > 0` (dinámico, no por el campo `estado` — ver §9 "Convención de mora"). Fila resaltada en rojo con el mismo criterio.
- **Panel de desglose (2026-07-02)**: debajo de las tarjetas Todos/Clientes/Empresas, 3 tarjetas — Capital prestado (`SUM(p.monto_capital)`), Interés pendiente, Capital recuperado (prestado − pendiente real) — calculadas sobre `filtrados` (respeta la pestaña de estado, el segmento Clientes/Empresas y la búsqueda). Se agregó porque el campo `capital_pendiente` que ya traía `GET /api/productos` **mezcla capital + interés pese al nombre** (`monto_cuota - monto_pagado`, no solo `abono_capital`) y confundía al usuario sobre cuánto de la deuda total pendiente era capital vs. interés. Se agregaron dos campos nuevos al mismo endpoint para el desglose real: `capital_pendiente_real` (solo `abono_capital`) e `interes_pendiente` (solo `abono_interes`), con la misma fórmula ponderada que ya usa el dashboard (`abono_capital/interes * (1 - pagado/cuota)`). El campo `capital_pendiente` original **se deja intacto** (otras pantallas ya dependen de él) — el desglose correcto vive en los dos campos nuevos.

### Detalle del crédito (`/prestamos/[id]`)
- KPIs: Capital desembolsado, Intereses totales, **Total proyectado**, Cobrado, Saldo pendiente, **Saldo solo capital**, Avance cuotas.
- Barra de progreso bicolor: verde (pagadas) + amarillo (parciales).
- Calificación del cliente: Bronce (0-40) / Plata (41-65) / Oro (66-85) / Diamante (86-100).
  - `null` si no hay historial de pagos → muestra "Sin historial aún".
- Botones: Editar, Eliminar, **Convertir a préstamo** (fiado/adelanto), **Liquidar crédito**, Refinanciar.

### Cobros (`/cobros`)
- Filtros: Todas, En mora, Hoy, Semana, Rango.
- Acordeón por crédito: nombre (grande), tipo+descripción (bold), fecha del préstamo, capital, teléfono.
- Cuando hay mora: chip rojo + botón WhatsApp de cobro con mensaje pre-cargado.
- **Arqueo del día**: programado vs cobrado, barra de progreso, por método, lista de pagos del día.
- **Segmentador Clientes/Empresas/Todos** y **tramos de la "Brújula de cobro"** (Todas, Vencidas, Hoy, Mañana, 7 días, 15 días): al cambiar de tramo los acordeones quedan **cerrados** (`setAbiertos({})`); el usuario decide cuál abrir. Abrir un crédito (`toggle()`) dispara `fetchHistorial(producto_id)` bajo demanda.
- **Bug corregido (2026-07-02) — historial "Cargando..." indefinido**: los botones de tramo, el rango de fechas y el buscador abrían TODOS los acordeones en bloque (`setAbiertos({...todos})`) sin llamar `fetchHistorial()`, que solo se disparaba desde el `toggle()` manual. Resultado: el spinner "⏳ Cargando historial..." quedaba girando para siempre en los créditos abiertos en bloque. Se corrigió: (a) los tramos de la Brújula ahora **cierran** los acordeones al cambiar de filtro (arriba); (b) el rango de fechas y el buscador, que sí necesitan mostrar resultados abiertos, usan el helper `abrirTodos()` / disparan `fetchHistorial()` para cada crédito recién abierto que no tenga historial en `historialPagos`.

### Recibos (`/recibos`)
- Búsqueda por `REC-000001` o solo el número (`1`).
- Tarjeta completa: datos del cliente, producto, cuota, desglose capital/interés.
- Botón imprimir con layout de tiquete de caja.

### Informes (`/informes`)
- KPIs históricos globales (Total invertido, Total recuperado, Capital en la calle).
- KPIs del período: recaudado, intereses, capital, pagos, clientes.
- Resumen mensual + detalle de pagos.
- Exportar Excel con 3 hojas: Resumen, Por mes, Detalle.

### Migración (`/migracion`)
- 3 plantillas Excel descargables con instrucciones.
- Subida con validación y vista previa (primeros 10 registros).
- **Zona de desarrollo**:
  - Toggle **Modo prueba** (fechas futuras en pagos) — persiste en BD.
  - Botón **Limpiar datos de prueba** con triple confirmación (escribir "LIMPIAR").
  - **Limpiar cliente específico**: busca por nombre/documento → trae la lista de créditos del cliente (`GET /api/productos?cliente_id=`) con checkbox por crédito + "Seleccionar/Deseleccionar todos" (marcados por defecto) → al confirmar envía solo los `productoIds` marcados a `POST /api/migracion/reset-cliente`. Permite borrar un crédito puntual de un cliente con varios créditos sin tocar los demás (antes solo existía "borrar todos los créditos del cliente").

### Configuración (`/configuracion`) — solo admin
- Gestión de **tipos de préstamo** dinámicos (CRUD).
- Cada tipo: label, icono (selector de emojis), descripción, comportamiento (`prestamo_normal` / `cuenta_abierta` / `empeno`), orden, activo.
- Los 5 tipos base (`es_sistema`) no se pueden eliminar; los tipos en uso solo se desactivan.

### Backup (`/backup`) — solo admin
- **Exportar**: descarga JSON completo de la base (8 tablas).
- **Restaurar**: carga un JSON y reemplaza la base (sin tocar al usuario que restaura).
- **Recrear estructura**: ejecuta el SQL idempotente de toda la estructura.
- **Historial**: lista de exportaciones/restauraciones registradas en `cred_backups`.

### Créditos Sin Cuotas Futuras (`/creditos-libres`)
- Módulo **completamente independiente**: no importa `lib/calculos.js`, no llama `/api/pagos`, no toca `recalcularCuotasPlano`.
- **Lista** (`/creditos-libres`): KPIs (activos, capital en calle, intereses cobrados), filtros Activos/Saldados/Todos, alerta si llevan >30 días sin corte de interés.
- **Crear** (`/creditos-libres/nuevo`): cliente, capital, tasa%, período, método de desembolso, fecha de inicio, concepto. Sin campos de cuotas/frecuencia/método-cálculo. Campo capital con formato moneda en tiempo real.
- **Detalle** (`/creditos-libres/[id]`): cabecera con capital/tasa/interés mensual aprox/desembolso; 4 KPIs (capital pagado, pendiente, intereses cobrados, total recaudado); barra de progreso; historial de abonos con período cubierto (`desde → hasta`); modal de abono. Si accede con `?abrir=1` (desde Cobros), el modal se abre automáticamente.
- **Modal de abono**: selector de tipo (Intereses / Capital / Ambos), fecha de corte con cálculo automático en tiempo real (convención 30/360), monto sugerido editable, método de pago, notas.
- **Cobros**: al hacer clic en "💰 Pagar" o "💳 Abonar" sobre un `credito_libre`, redirige a `/creditos-libres/[id]?abrir=1` en lugar de abrir el modal estándar de cuotas.

---

## 11. Calificación del Cliente

Calculada en el frontend a partir de las cuotas del crédito activo:

```js
// Solo evalúa cuotas con actividad real (pagadas, parciales, o vencidas)
evaluables = cuotas con pagos O con fecha_vencimiento <= hoy (excluye 2099)
if (!hayPagos || evaluables.length === 0) return null // Sin historial

score = ((pagadas * 1.0) + (parciales * 0.5)) / evaluables.length * 100
if (refinanciado) score -= 20
```

| Rango | Nivel | Color |
|-------|-------|-------|
| null | Sin historial | Gris |
| 0-40 | 🥉 Bronce | Naranja |
| 41-65 | 🥈 Plata | Gris |
| 66-85 | 🥇 Oro | Amarillo |
| 86-100 | 💎 Diamante | Cian |

---

## 12. Liquidación Anticipada

`POST /api/productos/[id]/liquidar`:
- **Validación**: `monto_acordado >= saldo_capital_pendiente` (se puede condonar intereses, NO capital).
- Registra 1 pago por `monto_acordado` con nota "LIQUIDACIÓN ANTICIPADA".
- Cierra todas las cuotas pendientes (`estado='pagada'`).
- Producto → `saldado`.
- Registra descuento en auditoría.

---

## 13. Modo Prueba

Controlado por `cred_configuracion.clave='modo_prueba'`.

- **Activar/desactivar**: `/migracion` → Zona de desarrollo → Toggle.
- **Persistencia**: DELETE + INSERT con UUID en BD.
- **Efecto**: La API `/api/pagos` omite la validación de fecha futura.
- **Indicador visual**: Banner amarillo en toda la app (`LayoutWrapper.jsx`).
- **No afecta** otras validaciones del sistema.

---

## 14. Convenciones de Código

- `const S = 'administrativo'` en todos los Route Handlers.
- **Arquitectura de pagos (`POST /api/pagos`)**: usa `Promise.all` paralelo (sin `withTransaction`). El consecutivo de recibo se incrementa atómicamente con `UPDATE ... RETURNING (valor::int - 1) AS consecutivo` en el primer bloque paralelo, garantizando unicidad sin transacción global.
- **`withTransaction`**: se usa en `POST /api/productos` y `POST /api/productos/[id]/liquidar`. NO se usa en `POST /api/pagos`. **OJO**: en modo proxy (`PROXY_URL`) no hay atomicidad real — la transacción degrada a ejecución secuencial best-effort.
- **Acceso a BD doble modo** (`lib/db.js`): `query()` usa pool `pg` directo o proxy HTTP según `PROXY_URL`. El proxy reintenta (3x) y maneja cold start de Render.
- **Tipos de préstamo dinámicos**: `cred_productos.tipo` ya NO tiene CHECK fijo; los valores válidos viven en `cred_tipos_prestamo`. El comportamiento de cuotas se deriva del campo `comportamiento`.
- IDs generados con `uuidv4()` en la capa de aplicación.
- Fechas en **zona horaria local** con `split('-')`.
- `fecha_primer_pago` de PostgreSQL → convertir a string antes de `generarCuotas()`.
- Formato moneda: `Intl.NumberFormat('es-CO', { style:'currency', currency:'COP' })`.
- Auditoría en todos los endpoints mutantes.
- Errores BD: `{ error: error.message }` status 500.
- Documento duplicado: status 409.

---

## 15. Comandos de Desarrollo

```bash
npm install
npm run dev    # http://localhost:3000
npm run build
npm start
```

---

## 16. Puntos de Extensión / Mejoras Pendientes

- **Mora automática**: no hay job que actualice `estado='mora'`; se detecta por comparación de fechas en queries. Consecuencia conocida: cualquier UI que filtre por `p.estado==='en_mora'` en vez de `cuotas_mora` mostrará resultados incompletos/vacíos (bug real detectado y corregido en `/prestamos` el 2026-07-02, ver §9).
- **Notificaciones**: candidato para cron + SMS/WhatsApp.
- **Multiempresa**: esquema fijo `administrativo`; para multitenancy parametrizar.
- **Tests**: sin suite de pruebas; prioridad en `lib/calculos.js`.
- **Recibo PDF**: número generado, falta layout imprimible completo.
- **Modo prueba**: desactivar antes de pasar a producción real.
- **Tipo `venta`**: mismo flujo que préstamo; se podría diferenciar con inventario.

---

## 17. Interés Fijo (Congelar Intereses) — 2026-07-03

Opción opt-in para créditos **nuevos** con `metodo_calculo='plano'`. Columna
`cred_productos.interes_fijo BOOLEAN NOT NULL DEFAULT FALSE` (`19_interes_fijo.sql`).

**Contexto / por qué existe:** el comportamiento por defecto de un crédito 'plano' ya
creado es que `recalcularCuotasPlano()` (`app/api/pagos/route.js`) recalcula el interés
de las cuotas restantes sobre el saldo de capital que va bajando con cada abono
(interés decreciente) — esto es correcto y **no se toca** para ningún crédito existente
(quedan con `interes_fijo=false` por default, comportamiento idéntico a antes). El
usuario pidió una opción adicional, disponible solo al crear un crédito nuevo (en
`/prestamos/nuevo` o `/migracion/cargue-inicial`): un interés que quede "congelado"
sobre el capital original, de modo que abonar a capital no reduzca el interés cobrado
cada período.

**Implementación:**
- `app/api/pagos/route.js` (`recalcularCuotasPlano`): agrega `interes_fijo` al SELECT
  del producto y calcula `baseInteres = prod.interes_fijo ? monto_capital : saldoCapital`.
  Esa base reemplaza a `saldoCapital` en las 2 fórmulas de interés (`interesTotal` del
  loop principal de redistribución y `periodInt` del caso especial de última cuota con
  capital pendiente). El resto del algoritmo (cierre de cuotas, prorrateo de capital,
  snapshots) no cambia — solo cambia la BASE sobre la que se calcula interés.
- `POST /api/productos` y `POST /api/migracion/cargue-inicial`: aceptan `interes_fijo`
  del body y lo persisten, pero lo **fuerzan a `false`** si `tipo==='congelacion'`
  (nunca cobra interés, ver §8) o si `metodo_calculo !== 'plano'` (el francés ya tiene
  cronograma fijo que nunca se redistribuye — la opción no aplica).
- UI: checkbox "❄️ Congelar intereses" en ambos formularios de creación, visible solo
  cuando el método es 'plano' y no es congelación/cuenta abierta.
- Badge "❄️ Fijo" junto a la Tasa en el detalle del crédito (`/prestamos/[id]`) cuando
  `interes_fijo=true`, para que quede visualmente claro que ese crédito no recalcula
  interés al abonar capital.

**Alcance de la migración:** columna con `DEFAULT FALSE` — cero impacto en créditos ya
montados, cero cambio en el cálculo del tope de pago (`maxPago` en `POST /api/pagos`,
que ya lee `abono_interes` de la cuota, sea cual sea su base de cálculo).

---

## 18. Módulo Créditos Sin Cuotas Futuras — 2026-07-12

Módulo **totalmente independiente** del motor de cuotas existente. El dueño del sistema solicitó un tipo de crédito donde el interés no se liquida en cuotas futuras fijas, sino que el cobrador selecciona una "fecha de corte" y el sistema calcula lo acumulado hasta esa fecha.

### Reglas de negocio
- **Convención 30/360**: cada mes cuenta exactamente 30 días, sin importar si tiene 28, 29, 30 o 31. Fórmula: `(Y2−Y1)×360 + (M2−M1)×30 + (D2−D1)`. Esto garantiza cobros mensuales consistentes.
- **Fórmula de interés**: `interés = capital_pendiente × (tasa/100 / diasBase) × dias30_360`, donde `diasBase = DIAS_PERIODO[periodo_tasa]` (diario=1, semanal=7, quincenal=15, mensual=30, anual=360).
- **Tipos de abono**: `interes` (solo cobro de interés del período), `capital` (abono libre al principal), `ambos` (en un solo recibo).
- **Fecha de corte**: siempre debe ser estrictamente posterior a la última fecha de corte registrada. No se puede cobrar interés del mismo día.
- **Capital**: puede abonarse en cualquier momento y en cualquier monto (hasta el pendiente). Bajar el capital reduce la base de cálculo de interés en el próximo período.
- **Saldado**: cuando `capital_pagado >= monto_capital - 0.5`, el producto pasa a `saldado`.
- **`fecha_primer_pago`**: almacena la fecha de inicio del crédito ingresada por el usuario (no la fecha de inserción en BD). Siempre usar `fecha_primer_pago` como inicio del primer período de interés.

### Auto-migración (patrón clave)
Los 4 endpoints del módulo llaman `autoMigrar()` al inicio de cada request:
```js
async function autoMigrar() {
  await query(`ALTER TABLE administrativo.cred_pagos ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`)
  await query(`ALTER TABLE administrativo.cred_tipos_prestamo DROP CONSTRAINT IF EXISTS cred_tipos_prestamo_comportamiento_check`)
  await query(`INSERT INTO administrativo.cred_tipos_prestamo (...) VALUES ('tipo-credito-libre','credito_libre','Crédito Sin Cuotas','📅',...,'sin_cuotas_futuras',TRUE,TRUE,7) ON CONFLICT (codigo) DO NOTHING`)
}
```
Esto elimina la necesidad de correr SQL manualmente. El patrón es idempotente (seguro de correr múltiples veces).

### Estructura de datos
- **Producto**: `tipo='credito_libre'`, `metodo_calculo='plano'`, `num_cuotas=1`, `con_interes=FALSE`.
- **Cuota placeholder**: única cuota con `fecha_vencimiento='2099-12-31'`, `monto_cuota=monto_capital`. Sirve de ancla para el sistema de caja; no se usa para calcular interés.
- **Pagos**: cada abono va a `cred_pagos` con `monto_interes` y `monto_capital` desglosados. Si el abono incluye interés, `fecha_corte_interes` registra hasta qué fecha cubre.
- **`fecha_desde_periodo`**: campo derivado (no almacenado). Se calcula en `GET /api/creditos-libres/[id]` ordenando los pagos cronológicamente y rastreando el último `fecha_corte_interes` visto.

### Navegación desde Cobros
`app/cobros/page.js` detecta `g.tipo === 'credito_libre'` en los tres puntos de pago:
- `abrirModalTodo(g)` → `router.push('/creditos-libres/[id]?abrir=1')`
- Botón "💳 Abonar" móvil → igual
- Botón "💳 Abonar" tabla desktop → igual

El parámetro `?abrir=1` hace que la página de detalle inicialice `modalAbierto=true` (via `useState(searchParams.get('abrir') === '1')`), abriendo el modal de registro de abono directamente.

### Bugs conocidos y fixes aplicados
- **Fecha UTC desfasada**: `new Date("2026-05-01")` = medianoche UTC = 30 de abril en Colombia (UTC-5). Fix: siempre `new Date(str + 'T12:00:00')` antes de formatear fechas.
- **Capital con `step`**: `<input type="number" step="1000">` genera secuencia 1, 1001... y rechaza 1.000.000. Fix: `type="text" inputMode="numeric"` con handler de formateo manual.
- **Interés mismo día**: validación original `<` en lugar de `<=`. Fix correcto: `if (fecha_corte <= anteriorStr)` rechaza — siempre debe ser estrictamente posterior.
- **Constraint violado**: `cred_tipos_prestamo_comportamiento_check` no incluía `sin_cuotas_futuras`. Fix: `DROP CONSTRAINT IF EXISTS` en `autoMigrar()`.

### Aislamiento garantizado
- NO modifica `lib/calculos.js`
- NO llama a `POST /api/pagos`
- NO toca `recalcularCuotasPlano`
- Los créditos existentes (préstamos, fiados, empeños, etc.) no se ven afectados en ningún caso

---

## 19. Registro de Dinero Inyectado en Refinanciación — 2026-07-17

Columna `cred_productos.monto_inyectado NUMERIC NOT NULL DEFAULT 0` (`21_monto_inyectado.sql`).

**Problema que resuelve:** el botón **"💵 Refinanciar + prestar más"** (`/prestamos/[id]`, visible junto a "❄️ Refinanciar solo capital" cuando `puedeRefinanciarCapitalFijo`) permite refinanciar el saldo de capital congelado de un crédito **y** sumarle dinero nuevo en la misma operación. Hasta esta versión, `/prestamos/nuevo` calculaba `monto_capital = saldo_congelado + monto_inyeccion` (useEffect con `inyeccionPresel`) pero **solo enviaba el total combinado** a `POST /api/productos` — el monto de dinero nuevo (`montoInyeccion`, estado local del formulario) nunca viajaba al backend como campo propio. Quedaba mencionado únicamente dentro de `notas` (texto libre, editable, no consultable), por lo que no había forma confiable de reconstruir después "cuánto tenía de saldo el cliente" vs. "cuánto le presté de más y cuándo".

**Implementación:**
- `app/prestamos/nuevo/page.js` (`guardar()`): agrega al body del POST `monto_inyectado: inyeccionPresel ? (parseFloat(montoInyeccion) || 0) : 0`.
- `app/api/productos/route.js` (POST): desestructura `monto_inyectado` del body y calcula `montoInyectadoSeguro` — se fuerza a `0` si el crédito **no** es una refinanciación (`es_refinanciacion_de` vacío), igual patrón de defensa en profundidad que `tasaSegura`/`interesFijoSeguro`. Se persiste en el INSERT de `cred_productos` y se incluye en el `detalle` de auditoría.
- `app/api/productos/[id]/route.js` (GET): agrega `orig.referencia AS ref_origen` al JOIN existente con el crédito origen, para poder mostrar de qué crédito (`CRED-XXXXXX`) se refinanció.
- `app/prestamos/[id]/page.js`: nuevo bloque informativo (fondo teal, ícono 💵) visible cuando `data.monto_inyectado > 0.5`, debajo de la nota de interés congelado. Muestra: crédito de origen (`ref_origen`), fecha de la operación (`fecha_creacion`), saldo que venía refinanciado (`monto_capital − monto_inyectado`), dinero nuevo prestado ese día (`monto_inyectado`) y capital total del crédito.

**Cómo reconstruir el historial completo de inyecciones de un cliente:** cada crédito es un eslabón de la cadena `es_refinanciacion_de` / `refinanciado_por`. Sumando `monto_inyectado` de todos los créditos de un cliente (`SELECT SUM(monto_inyectado) FROM cred_productos WHERE cliente_id=$1`) se obtiene el total de dinero nuevo que ha recibido a través de todas sus refinanciaciones, sin depender de texto libre en `notas`.

**Alcance de la migración:** columna con `DEFAULT 0` — cero impacto en créditos ya existentes ni en refinanciaciones sin inyección (`monto_inyectado` queda en 0, el bloque informativo simplemente no se muestra).

**Mejora pendiente (no incluida en este cambio):** un resumen consolidado por cliente ("total inyectado históricamente") en `/clientes/[id]` o `/prestamos/[id]`, en vez de tener que revisar crédito por crédito la cadena de refinanciaciones.

### Extensión — 2026-07-17: inyección también en créditos SIN interés congelado

La primera versión de "Refinanciar + prestar más" solo estaba disponible para créditos con `interes_fijo=true` (junto a "❄️ Refinanciar solo capital", condicionado a `puedeRefinanciarCapitalFijo`). Se extendió para que **cualquier** crédito refinanciable pueda usar la misma mecánica, sin exigir interés congelado.

- `app/prestamos/nuevo/page.js`: `inyeccionPresel` dejó de depender de `fijoPresel` (`searchParams.get('inyeccion') === '1'` a secas). Cuando `inyeccionPresel && !fijoPresel`, el bloque de capital ("Saldo de capital a refinanciar" + "💰 Dinero nuevo a prestar") se muestra igual, pero tasa/período/frecuencia/método/cuotas quedan **libres** (no se bloquean como en el caso de capital congelado) — se comporta como la refinanciación de saldo estándar, solo que con un campo adicional de dinero nuevo. El banner hero y los textos de ayuda distinguen ambos casos (`fijoPresel` true/false) para no hablar de "congelado" cuando no aplica.
- `app/prestamos/[id]/page.js`: nueva variable `puedeInyectarNormal = !data.interes_fijo && saldoCapitalPendiente > 0.5 && !['saldado','refinanciado'].includes(data.estado)` y `urlRefinanciarNormalMasInyeccion` con `capital=Math.round(saldoCapitalPendiente)` (**no** `saldoPendiente`/`totalPendiente` — ver corrección abajo). Botón **"💵 Refinanciar + prestar más"** agregado en el header de la tabla de cuotas, junto a "Registrar cobro" — visible para cualquier crédito refinanciable que no tenga interés congelado (el caso congelado ya tiene su propio botón junto a la nota de interés fijo, sin cambios).
- Backend (`POST /api/productos`) y persistencia de `monto_inyectado` no requirieron cambios: ya funcionaban para cualquier `es_refinanciacion_de`, sin importar `interes_fijo`.

**Corrección (mismo día) — la base a refinanciar debe ser solo capital, no el saldo total:** la primera implementación de `urlRefinanciarNormalMasInyeccion` reutilizaba `urlRefinanciar` (capital = `saldoPendiente`/`totalPendiente`, que mezcla capital **e interés de cuotas aún no vencidas**). Esto habría recapitalizado interés todavía no causado junto con el dinero nuevo inyectado — un problema de anatocismo (interés sobre interés) y, en la práctica, un valor que no coincide con lo que el usuario necesita decirle al cliente ("tenías tanto de capital, te presté tanto más"). Se corrigió para usar `saldoCapitalPendiente` (solo capital, la misma variable que ya usaba la variante de capital congelado) como base, tanto en `puedeInyectarNormal` como en la URL. El interés pendiente de cuotas no vencidas del crédito original simplemente no viaja al nuevo crédito (igual que en la refinanciación de capital congelado) — es interés que aún no se ha devengado.

### Fecha de desembolso editable — 2026-07-17

Columna `cred_productos.fecha_desembolso DATE NULL` (`22_fecha_desembolso.sql`).

**Problema que resuelve:** la única fecha disponible para "cuándo nació este crédito" era `fecha_creacion` (`TIMESTAMP DEFAULT CURRENT_TIMESTAMP`), fijada automáticamente por Postgres en el momento del INSERT — nunca editable desde el formulario. Si el operador registra el crédito uno o varios días después de haber entregado el dinero (dato tardío, corrección posterior), `fecha_creacion` queda con la fecha de captura en el sistema, no con la fecha real del desembolso. Esto es crítico en refinanciaciones con inyección de capital: el usuario necesita poder decirle después al cliente "tal día te desembolsé/inyecté tal valor" con la fecha correcta, no con la fecha en que tecleó el registro.

**Implementación:**
- `app/prestamos/nuevo/page.js`: nuevo campo **"📅 Fecha de desembolso"** (input `date`, requerido) en la sección "¿Cómo se entregó el dinero?", junto al medio de pago. Por defecto es hoy (seteado en el `useEffect` de montaje), pero el usuario puede cambiarlo. Aplica a **todos** los tipos de crédito (préstamo, refinanciación, fiado, adelanto, empeño, etc. — no solo al flujo de inyección), porque el problema (registro tardío) puede pasar en cualquier alta.
- `app/api/productos/route.js` (POST): acepta `fecha_desembolso` del body; si no viene, hace fallback a "hoy" (`fechaDesembolsoSegura`). Se persiste tanto en la rama normal (préstamo/refinanciación/empeño/venta) como en la rama fiado/adelanto.
- `app/prestamos/[id]/page.js`: helper `fechaDesembolsoStr`/`fechaDesembolsoObj` — usa `data.fecha_desembolso` si existe; si es un crédito anterior a esta migración (columna NULL), cae en `fecha_creacion::date` como respaldo. Construye la fecha con `'T12:00:00'` para evitar el desfase de un día por UTC (convención del sistema, ver §10). La etiqueta "Fecha del préstamo" en el encabezado y en la ficha de datos se renombró a **"Fecha de desembolso"**, y el bloque de dinero inyectado (§19 arriba) ahora usa esta fecha en vez de `fecha_creacion` directamente.

**Alcance de la migración:** columna `NULL` por defecto — cero impacto en créditos existentes; simplemente muestran la fecha de respaldo (`fecha_creacion`) hasta que se edite ese registro o se cree uno nuevo.

---

## 20. Mejoras de UX — Cobros y claridad de capital pendiente — 2026-07-17

### Modal de "Registrar pago" centrado (`/cobros`)

**Problema:** el panel de registro de pago (`app/cobros/page.js`) era un bloque `sticky top-4 self-start` dentro de una columna lateral (`w-80 flex-shrink-0`), no un modal real. Al hacer clic en "Pagar" sobre un crédito que estaba varias filas más abajo en la lista, el panel aparecía anclado arriba a la derecha del viewport, desconectado visualmente de la fila que el usuario acababa de tocar — mala experiencia para quien registra los cobros a diario.

**Fix:** se reemplazó por un modal real centrado, con el mismo patrón `fixed inset-0 bg-black/50 flex items-center justify-center z-50` que ya usan los demás modales del archivo (Arqueo del día, envío masivo por WhatsApp, etc.). La tarjeta usa `flex flex-col max-h-[90vh]`: cabecera fija, cuerpo con scroll interno (`overflow-y-auto flex-1`) y footer fijo con los botones **Cancelar/Confirmar pago** siempre visibles (antes quedaban dentro del área con scroll y podían quedar fuera de la vista). Ahora el modal aparece siempre centrado en pantalla sin importar el scroll o la posición del crédito en la lista.

### Claridad de "cuánto capital debo" en la tabla de cuotas (`/prestamos/[id]`)

**Problema:** la fila de TOTALES de la tabla de cuotas muestra en la columna Capital la suma de `abono_capital` de **todas** las cuotas (pagadas + pendientes) — es decir, el capital de todo el crédito, no lo que falta por cobrar. Un usuario mirando "$1.000.000" en esa columna no tenía forma de saber, sin hacer cuentas o abrir el bloque de interés congelado (que solo aparece si `interes_fijo=true`), cuánto capital real debía el cliente hoy.

**Fix:** se agregó una segunda línea, siempre visible (no depende de `interes_fijo`), debajo del total de Capital en el `<tfoot>`: **"Debe de capital: `{fmt(saldoCapitalPendiente)}`"** (número en rojo, `text-sm font-bold`; etiqueta en `text-xs text-gray-500`), usando la misma variable `saldoCapitalPendiente` que ya alimenta la nota de interés congelado y la liquidación anticipada. Solo se muestra si `saldoCapitalPendiente > 0.5` (crédito no saldado en capital). Este es el patrón a replicar en cualquier vista nueva que muestre un total de capital "de todo el crédito": siempre acompañarlo de cuánto de ese capital sigue pendiente, para no dejarlo ambiguo.

### Mensaje de WhatsApp del envío asistido — simplificado (`buildMensaje`, `/cobros`)

**Problema:** el mensaje que arma `buildMensaje()` para el envío masivo por WhatsApp (botón "📤 Envío asistido" por tramo) mostraba demasiada información redundante por crédito: una línea "Saldo pendiente: $X" o, en cuotas del tramo, "Cuota #N (vencida el fecha): $total" seguida de "Capital: $A + Interés: $B" — y **además** una línea "Subtotal: $X" que repetía el mismo número ya mostrado arriba. Para un cliente con 2-3 créditos el mensaje se volvía largo y confuso, mezclando totales redundantes con el desglose real que el cliente necesita (cuánto es capital y cuánto es interés, y para cuándo).

**Fix:** se simplificó `bloque()` dentro de `buildMensaje()` (`app/cobros/page.js`) a solo dos formatos, sin subtotales:
- Crédito con cuota(s) en el tramo actual (`p.esTramo=true`): una línea por cuota — `Vencida {fecha}: Capital {monto} + Interés {monto}` (o solo Capital si no hay interés, ej. fiados). Se quitó el `Cuota #N` y el monto total de la cuota (ya se deduce de capital+interés).
- Resto de créditos del cliente (`p.esTramo=false`, no es el foco de este tramo): se suma `capitalPend`/`interesPend` de **todas** sus cuotas pendientes y se muestra `Capital: {total} + Interés: {total}` — antes solo mostraba un "Saldo pendiente" sin desglosar.
- Se eliminó la línea `Subtotal: {monto}` en ambos casos (quedaba duplicada con lo ya mostrado). El mensaje conserva el cierre `*Total que debe: {total}*` como único resumen numérico al final.

**Ajuste de tono del cierre (mismo día):** a pedido del dueño del negocio, el cierre del mensaje se simplificó a un texto puramente informativo que invita al cliente a acercarse a pagar, en vez de agradecer compromiso/puntualidad por anticipado: `'Un pago puntual habla muy bien de usted. Le invitamos a acercarse para ponerse al día...'` (mora) / `'...Le invitamos a acercarse en la fecha indicada. Gracias.'` (hoy/mañana/semana/quince).

**Retiro temporal de montos del mensaje (mismo día):** mientras se termina de afinar el cálculo de capital/interés pendiente (fuente de los valores que se venían mostrando), el negocio pidió que el mensaje de WhatsApp **no incluya ninguna cifra** — ni el desglose por cuota, ni el total. Se eliminó por completo el bloque `detalle` (la función `bloque()` y el `.map` sobre `cl.productos`) y la línea `*Total que debe: {total}*` de `buildMensaje()`. El mensaje quedó reducido a: saludo + una frase de contexto según el tramo (mora/hoy/mañana/otros, sin montos) + el cierre informativo de la sección anterior. `cl.productos`/`cl.total` se siguen calculando en `iniciarEnvio()` (se usan para filtrar clientes con deuda y para el contador interno "Cliente X de Y · {fmt(cur.total)}" que ve el cobrador en el modal — **ese** total es solo para uso interno del operador, no viaja al cliente). Cuando el cálculo de capital/interés quede validado, reintroducir el desglose es tan simple como restaurar el bloque `detalle` documentado arriba.
