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
│   │   ├── productos/unificar/    # POST unificar varios créditos en uno nuevo
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
│   ├── prestamos/[id]/ nuevo/ unificar/
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

#### `cred_unificaciones`
Traza de **Unificar Créditos** (ver §21): qué créditos de origen se consolidaron en un crédito nuevo (relación N:1, a diferencia de `es_refinanciacion_de` que es 1:1) y cuánto capital aportó cada uno.

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| credito_nuevo_id | TEXT FK → `cred_productos` | El crédito resultante de la unificación |
| credito_origen_id | TEXT FK → `cred_productos` | Uno de los créditos consolidados |
| capital_aportado | NUMERIC | Capital pendiente real que aportó ese origen puntual |
| fecha_creacion | TIMESTAMP | |

Cada unificación genera **una fila por crédito de origen** (mismo `credito_nuevo_id`, distinto `credito_origen_id`). Los orígenes también quedan con `estado='refinanciado'` y `refinanciado_por=<credito_nuevo_id>` — el mismo mecanismo que ya usa la refinanciación 1:1 normal — para que todos los filtros y KPIs existentes (dashboard, listados de `/prestamos`, capital en la calle) dejen de contarlos automáticamente, sin necesidad de tocar esas queries.

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
| POST | `/api/productos/unificar` | Unifica **varios** créditos activos de un mismo cliente en uno nuevo. Body: `{ cliente_id, credito_ids: [...] (mín. 2), tipo, tasa_interes, periodo_tasa, frecuencia_cobro, num_cuotas, fecha_primer_pago, metodo_calculo, interes_fijo, metodo_desembolso, entidad_desembolso, referencia_desembolso, monto_inyectado, notas, fecha_desembolso }`. Calcula el capital pendiente real de cada origen desde `cred_cuotas` (server-side), marca los orígenes `refinanciado`, y registra la traza en `cred_unificaciones`. Ver §21. |

**GROUP BY en `/api/productos` GET**: `p.id, c.nombre, c.documento, c.telefono, c.direccion, por.referencia, orig.referencia`

### Cuotas
| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/api/cuotas?estado=&cliente_id=&producto_id=` | Incluye `telefono_cliente`, `fecha_creacion`, `monto_capital` del producto. También `fecha_desembolso_real` (COALESCE fecha_desembolso/fecha_primer_pago/fecha_creacion — usada por la regla de 30 días de créditos libres, §18/§24) y, desde 2026-08-11 (§25), `fecha_desembolso_mostrar` (COALESCE fecha_desembolso/fecha_creacion, **sin** fecha_primer_pago — desembolso real para UI) + `fecha_primer_pago_producto` (crudo) |

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
| `23_unificacion_creditos.sql` | Tabla `cred_unificaciones` (id, credito_nuevo_id, credito_origen_id, capital_aportado, fecha_creacion). Traza N:1 de qué créditos se consolidaron en un crédito nuevo al usar "Unificar Créditos". Ver §21. |

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

---

## 21. Unificar Créditos — 2026-07-17

Módulo nuevo, accesible desde el sidebar ("🔗 Unificar Créditos", debajo de "Préstamos") y desde un botón en `/prestamos`. Permite seleccionar **varios** créditos activos de un mismo cliente, consolidar su capital pendiente en un solo crédito nuevo con condiciones propias, y deja registro exacto de qué créditos se unificaron y cuánto aportó cada uno.

### Por qué no reutiliza `es_refinanciacion_de`

`cred_productos.es_refinanciacion_de` modela una relación **1:1** (un crédito nuevo viene de un único crédito origen) — es la base de toda la refinanciación existente (`urlRefinanciar`, `urlRefinanciarCapitalFijo`, "Refinanciar + prestar más", congelación). Unificar es **N:1** (varios orígenes → un crédito nuevo), que ese campo no puede representar. En vez de forzarlo, se creó una tabla puente dedicada: `cred_unificaciones` (ver §4 y `23_unificacion_creditos.sql`), con una fila por cada crédito de origen consolidado.

Los créditos de origen SÍ reutilizan el mecanismo ya existente `estado='refinanciado'` + `refinanciado_por=<credito_nuevo_id>` — el mismo que usa la refinanciación 1:1 — para que todos los filtros y KPIs que ya excluyen créditos refinanciados (dashboard, `/prestamos`, capital en la calle) dejen de contarlos automáticamente, sin tocar una sola query existente. `cred_unificaciones` solo aporta la traza fina (qué orígenes, cuánto aportó cada uno, cuándo).

### Regla de negocio: solo se consolida capital, nunca interés no causado

Igual que la corrección aplicada a "Refinanciar + prestar más" (§19): el capital que aporta cada crédito de origen es su **capital pendiente real** (`abono_capital − lo ya absorbido por pagos`, con la convención "interés primero" de siempre), **nunca** el interés de cuotas que aún no vencen. Esto evita anatocismo (cobrar interés sobre interés no devengado) y hace que el capital del crédito nuevo sea "limpio" — por eso, a diferencia de "congelación" (cuyo `monto_capital` sí mezcla interés viejo y por eso se excluye de los KPIs de capital del dashboard), el crédito resultante de una unificación **cuenta normalmente** en esos KPIs: no hizo falta agregar ninguna exclusión nueva.

El cálculo del capital pendiente se hace **en el servidor** (`POST /api/productos/unificar`, consultando `cred_cuotas` directamente), no confiando en las cifras que pudiera mandar el cliente — el frontend (`/prestamos/unificar`) calcula el mismo número con la misma fórmula solo para mostrárselo al usuario *antes* de confirmar, pidiendo el detalle completo (`GET /api/productos/[id]`) de cada crédito candidato.

### Implementación

- **`23_unificacion_creditos.sql`**: tabla `cred_unificaciones` (id, credito_nuevo_id, credito_origen_id, capital_aportado, fecha_creacion) + índices por ambas FK. Aplicada en Supabase y en `00_schema_completo.sql`.
- **`app/api/productos/unificar/route.js`** (POST, nuevo endpoint dedicado — no se sobrecargó `POST /api/productos` para no complicar un endpoint ya delicado): valida que los `credito_ids` (mínimo 2) pertenezcan al mismo cliente y no estén `saldado`/`refinanciado`. Calcula `capitalPorCredito` desde `cred_cuotas`, suma + `monto_inyectado` opcional (mismo campo de §19, para poder sumar dinero nuevo en la misma operación), crea el crédito nuevo (consecutivo `CRED-XXXXXX`, `generarCuotas`, movimiento de caja, snapshot `cred_historial_recalculos` tipo `creacion` — mismo patrón que `POST /api/productos`), marca los orígenes como `refinanciado`, inserta las filas de `cred_unificaciones`, y audita (`ACCIONES.UNIFICAR_CREDITOS`, nueva constante en `lib/auditoria.js`). Todo dentro de `withTransaction`.
- **Incluye créditos `credito_libre`** (Créditos Sin Cuotas Futuras, §18): aunque ese módulo es intencionalmente aislado, su cuota placeholder (`abono_capital=monto_capital`, `abono_interes=0` fijo, `monto_pagado` que solo acumula abonos a capital — ver `app/api/creditos-libres/[id]/abonar/route.js`) hace que la fórmula genérica "interés primero" (`capitalPagado = monto_pagado − abono_interes`; `pendiente = abono_capital − capitalPagado`) dé como resultado **exactamente** `monto_capital − capital_pagado`, la misma fórmula propia del módulo. No hizo falta ninguna rama de cálculo especial — solo se quitó la exclusión de `tipo==='credito_libre'` en el backend y el frontend.
- **`app/api/productos/[id]/route.js`** (GET): dos queries nuevas contra `cred_unificaciones` (con `.catch(() => ({rows:[]}))` por si la tabla no existiera en un ambiente viejo): `unificado_desde` (si este crédito es el resultado de una unificación, lista los orígenes con `capital_aportado`) y `unificado_en` (si este crédito fue absorbido en una unificación, el crédito nuevo al que pertenece).
- **`app/prestamos/unificar/page.js`** (nueva página): selector de cliente → lista sus créditos elegibles con checkbox y el capital pendiente real de cada uno (calculado igual que el backend) → al seleccionar 2+, se arma un bloque "🔗 N créditos seleccionados" con el capital consolidado + campo opcional de dinero nuevo + formulario de condiciones del crédito nuevo (tipo, tasa, período, frecuencia, método, cuotas, fecha primer pago, congelar intereses, medio de desembolso, fecha de desembolso, notas) + vista previa de amortización (reutiliza `calcularInteresPlano`/`calcularFrances` de `lib/calculos.js`, igual que `/prestamos/nuevo`) → `POST /api/productos/unificar` → redirige al detalle del crédito nuevo.
- **`app/prestamos/[id]/page.js`**: dos bloques informativos nuevos (estilo índigo) en la tarjeta de la tabla de cuotas — "🔗 Este crédito unificó N créditos anteriores" (lista con enlace a cada origen y lo que aportó) cuando `data.unificado_desde.length > 0`, y "Este crédito fue unificado en CRED-X" cuando `data.unificado_en` existe.
- **Navegación**: ítem "🔗 Unificar Créditos" en `components/Sidebar.jsx` justo debajo de "Préstamos" (con ajuste en el resaltado de activo para que no se marquen ambos ítems a la vez), y botón "🔗 Unificar créditos" junto a "+ Nuevo" en `app/prestamos/page.js`.

### Ajustes en el módulo Créditos Sin Cuotas Futuras para soportar unificación

Como un `credito_libre` puede terminar unificado (estado `refinanciado`), el módulo antes aislado (§18) necesitó tres ajustes mínimos para no quedar inconsistente:

- **`app/api/creditos-libres/[id]/abonar/route.js`**: nueva guardia — si `prod.estado === 'refinanciado'` rechaza el abono (`400`, "Este crédito ya fue unificado en otro crédito — los abonos se registran allá"), igual que ya hacía con `saldado`. Sin esto, se podría seguir abonando a un crédito cuyo capital ya se trasladó al nuevo, duplicando el cobro.
- **`app/api/creditos-libres/[id]/route.js`** (GET) y **`app/creditos-libres/[id]/page.js`**: mismo patrón `unificado_en` que `/api/productos/[id]` — si el crédito libre fue absorbido, se muestra un bloque índigo "🔗 Este crédito fue unificado en CRED-X" con el capital aportado, y se oculta el botón "💰 Registrar abono".
- **`app/creditos-libres/page.js`**: el filtro "Activos" y el conteo de KPI ("Créditos activos") solo excluían `estado==='saldado'` — se corrigió para excluir también `'refinanciado'` (igual patrón que `/prestamos` y el dashboard), y la alerta "⚠️ N días sin corte" ya no se muestra en créditos unificados (no tiene sentido pedir un corte de interés sobre un crédito que ya no se cobra ahí).

### Alcance y límites conocidos

- **Mínimo 2 créditos**: si solo se quiere refinanciar uno, ya existen los flujos de "Refinanciar saldo" / "Refinanciar + prestar más" — unificar exige al menos 2 orígenes para tener sentido semántico.
- **Movimiento de caja**: se registra el capital total como "desembolso" en `cred_movimientos_caja`, igual que cualquier refinanciación existente (aunque la mayor parte sea deuda consolidada y no dinero nuevo) — consistente con cómo ya se comporta el sistema, no es una particularidad de este módulo.

---

## 22. Fixes — Cobro de créditos sin interés (Congelación) — 2026-07-17

### Bug: "Monto a recibir" bloqueado al cobrar un crédito Congelación con varias cuotas

**Síntoma reportado por el dueño de la plataforma:** al abrir "Registrar pago" (`/cobros`) sobre un crédito **Congelación** diferido en varias cuotas (ej. `CRED-000571`, 4 cuotas mensuales de $210.000, tasa 0%), el campo "Monto a recibir" aparecía con el total precargado ($840.000) pero **no se podía editar** — no había forma de colocar lo que el cliente realmente traía (menos o más que el total).

**Causa raíz:** el bloque de chips "¿Qué paga el cliente?" (`app/cobros/page.js`) — única vía de la UI para cambiar `tipoPago` a `'personalizado'`, que es lo que quita el `readOnly` del input de monto — solo se renderizaba bajo la condición `interesBase(modal) > 0`. Un crédito Congelación tiene `tasa_interes=0` (regla de negocio blindada, ver §8: "una congelación nunca cobra interés"), así que `abono_interes` de sus cuotas es siempre `0` y esa condición nunca se cumplía. El input quedaba permanentemente en modo `readOnly` con el valor que precarga `abrirModalTodo()` (la suma de todas las cuotas pendientes del crédito), sin ninguna opción para pasar a "Personalizado". El mismo problema afecta a **cualquier** crédito con tasa 0% diferido en cuotas (no solo Congelación), aunque en la práctica es el único tipo del sistema con esa combinación (tasa 0 + varias cuotas futuras).

**Fix (`app/cobros/page.js`):** el bloque de chips ahora se muestra siempre que el producto no sea `fiado`/`adelanto` (que ya tienen su propio flujo de cuenta abierta), sin exigir `interesBase(modal) > 0`. Dentro del bloque, las opciones "💸 Solo intereses" y "💰 Abono capital" solo aparecen cuando sí hay interés (no aportan nada distinto de "Cuota completa" en un crédito a tasa 0); "✅ Cuota completa", "🏁 Recoger crédito" y "✏️ Personalizado" quedan siempre disponibles. Con esto el cobrador puede tocar "✏️ Personalizado" y escribir cualquier valor — menor (abono parcial a una o varias cuotas) o mayor (adelanta cuotas futuras) — en créditos a tasa 0% igual que ya podía hacerlo en cualquier crédito con interés.

**Patrón a vigilar:** cualquier condición de UI en `/cobros` que dependa de `interesBase(modal) > 0` para decidir si algo se muestra debe revisarse pensando específicamente en créditos a tasa 0% (Congelación, y cualquier tipo futuro que se cree con la misma combinación) — ese valor no es un "caso raro", es el comportamiento normal y esperado de ese tipo de crédito.

**Segunda vuelta del mismo bug (mismo día):** con el fix anterior ya aparecía el chip "✏️ Personalizado", pero el campo "Monto a recibir" seguía sin dejar escribir un valor distinto. Causa: el `<input>` tenía `readOnly={tipoPago !== 'personalizado'}` — `readOnly` en HTML bloquea el tecleo por completo (solo permite seleccionar/copiar el texto ya existente), así que aunque el usuario hiciera clic en el campo y el valor quedara "seleccionado" en azul, no había forma de escribir encima sin **primero** tocar el chip "Personalizado". Ese paso intermedio no era intuitivo — el cobrador esperaba poder escribir directamente. **Fix:** se quitó el `readOnly` por completo; el campo ahora es editable siempre, y el `onChange` (que ya existía) cambia `tipoPago` a `'personalizado'` automáticamente apenas se edita el valor — un solo paso, sin clic previo en ningún chip. El texto de ayuda debajo del campo se replanteó de "Monto fijado por el tipo seleccionado" (sonaba a bloqueo) a "Monto sugerido según el tipo seleccionado — puedes escribir otro valor".

### Nuevo filtro "❄️ Congelados" en `/prestamos`

**Necesidad:** el dueño de la plataforma no tenía forma de ubicar rápidamente qué créditos son de tipo **Congelación** (`cred_productos.tipo='congelacion'`) — que **nunca cobran interés**, usados para diferir una deuda vencida a tasa 0 (§8) — y los confundía con los créditos de **interés fijo/congelado** (`interes_fijo=true`, badge "❄️ Fijo" en el detalle del crédito, §17), que sí cobran interés, solo que no decrece con abonos a capital. Son dos conceptos distintos que comparten el emoji ❄️ y el nombre "congelado/congelación" en el lenguaje del negocio, lo cual genera confusión.

**Implementación (`app/prestamos/page.js`):** nuevo botón-toggle "❄️ Congelados" junto a "📅 Creados hoy" (mismo patrón de segmentador independiente, combinable con la pestaña de estado y el segmento Clientes/Empresas), que filtra `p.tipo === 'congelacion'` y muestra el conteo total de créditos de ese tipo. Se agregó también `tipoLabel.congelacion = '❄️ Congelación'` y `tipoColor.congelacion` (cian) para que el chip de tipo en cada fila de la tabla se identifique correctamente — antes caía en el fallback genérico y mostraba el código crudo `congelacion` en vez de una etiqueta legible.

**Distinción a tener siempre presente en el sistema:**
| Concepto | Campo | Cobra interés | Dónde se ve |
|----------|-------|----------------|-------------|
| Congelación (tipo de crédito) | `cred_productos.tipo = 'congelacion'` | **Nunca** (tasa forzada a 0, §8) | Badge "CONGELACION" en el detalle + nuevo filtro "❄️ Congelados" en `/prestamos` |
| Interés fijo / congelado (opción de un préstamo plano) | `cred_productos.interes_fijo = true` | **Sí**, pero calculado siempre sobre el capital original (no decrece con abonos) | Badge "❄️ Fijo" junto a la Tasa en el detalle del crédito (§17) |

### Deep-link "Registrar cobro" desde el detalle del crédito → `/cobros`

**Problema:** el botón "Registrar cobro" en `/prestamos/[id]` enlazaba a `/cobros` a secas — el cobrador tenía que volver a buscar manualmente al cliente/crédito en la lista completa para poder pagar, perdiendo el contexto desde el que venía. `/creditos-libres/[id]` ya resolvía esto para su propio módulo con `?abrir=1` (ver §18), pero el flujo de cuotas normales (`/cobros`) no tenía equivalente.

**Fix:**
- `app/prestamos/[id]/page.js`: el botón ahora enlaza a `/cobros?producto_id=${data.id}`.
- `app/cobros/page.js`: se envolvió el componente en `<Suspense>` (patrón ya usado en `/prestamos`, requerido por Next.js 15 para `useSearchParams`) y se leyó el nuevo parámetro `producto_id`. Un `useEffect` (con `useRef` como guardia para que solo dispare una vez) espera a que `grupos` cargue, busca el grupo cuyo `producto_id` coincide, abre su acordeón, dispara `fetchHistorial` y llama a `abrirModalTodo(grupo)` — la misma función que ya usa el botón "Pagar" de la lista, así que el comportamiento (incluida la redirección a `/creditos-libres/[id]?abrir=1` si el crédito es `credito_libre`) es idéntico al de siempre, solo que automático.
- El segmento inicial (`Clientes`/`Empresas`/`Todos`) se fuerza a `'todos'` cuando llega el deep-link, porque el crédito de origen puede ser de un cliente o de una empresa interna y el segmento por defecto (`'clientes'`) lo dejaría fuera de `grupos` sin poder encontrarlo nunca.

**Patrón a replicar:** cualquier botón nuevo que redirija desde el detalle de un crédito hacia `/cobros` para cobrar debería usar este mismo `?producto_id=`, en vez de enlazar a `/cobros` sin contexto.

---

## 23. Créditos Sin Cuotas Futuras — Ficha de lista completa y Fecha de abono independiente — 2026-07-18

### Ficha de lista (`/creditos-libres`) con datos completos del crédito

**Problema:** cada fila de la lista (`app/creditos-libres/page.js`) dejaba un espacio vacío grande entre el bloque de datos del cliente (izquierda) y el bloque de montos (derecha), porque el `flex-1` del bloque izquierdo reservaba todo el ancho sobrante sin contenido que lo ocupara.

**Fix:** se agregó un bloque central (`grid grid-cols-2`) con: Capital desembolsado (`monto_capital`), Tasa de interés, Interés mensual aprox. (misma fórmula que la ficha de detalle, ver §18) y Fecha de inicio / Último corte de intereses. Se removieron los duplicados de tasa/último corte del bloque de montos (derecha), que ahora solo muestra Capital pendiente e Intereses cobrados. `GET /api/creditos-libres` (lista) ahora también expone `fecha_inicio_credito` (`COALESCE(p.fecha_primer_pago, p.fecha_creacion::DATE)`), igual que ya hacía el detalle (`GET /api/creditos-libres/[id]`), para que la tarjeta muestre la fecha de inicio real y no la de creación en BD.

### Fecha de abono independiente de la Fecha de corte (modal "Registrar abono")

**Problema:** el modal de abono (`app/creditos-libres/[id]/page.js`) solo tenía un campo de fecha — "Fecha de corte" — que servía únicamente para calcular el interés del período, pero el pago siempre se registraba con `NOW()` en el backend (`app/api/creditos-libres/[id]/abonar/route.js`). No había forma de indicar que el abono se recibió/registró en una fecha distinta a la fecha de corte (por ejemplo, registro tardío de un pago), a diferencia del flujo normal de cuotas (`POST /api/pagos`), que sí acepta `fecha_pago` y respeta `modo_prueba`.

**Fix:**
- Frontend: nuevo campo **"Fecha de abono"** (input `date`, siempre visible sin importar el tipo de abono), independiente del campo "Fecha de corte" (que solo aparece para tipo `interes`/`ambos`). Ambas fechas pueden diferir libremente — no hay validación cruzada entre ellas.
- Backend (`abonar/route.js`): acepta `fecha_pago` del body, valida formato `YYYY-MM-DD` y — igual que `POST /api/pagos` — consulta `cred_configuracion.clave='modo_prueba'` y rechaza fechas futuras salvo que el modo prueba esté activo. Se calcula `fechaReal = fecha_pago ? new Date(fecha_pago + 'T12:00:00') : new Date()` (convención de mediodía local del sistema) y se persiste en `cred_pagos.fecha_pago` en vez de `NOW()`. Si no se envía `fecha_pago`, cae en el comportamiento anterior (fecha/hora actual del servidor).

**Alcance:** cambio aislado al módulo Créditos Sin Cuotas Futuras — no toca `lib/calculos.js` ni `/api/pagos`.

---

## 24. Fix — Créditos libres cayendo en "Vencidas" del envío masivo de WhatsApp sin estar vencidos — 2026-07-29

### Síntoma

En `/cobros` → "📲 WhatsApp masivo" → **Vencidas**, aparecían clientes con crédito `credito_libre` (Créditos Sin Cuotas Futuras, §18) recién desembolsados — incluso de **1 día** de antigüedad — mostrando el chip `📅 Sin fecha fija` en la tarjeta del modal "Envío asistido". Un crédito libre no tiene `fecha_vencimiento` real (usa la cuota placeholder `2099-12-31`), así que no existe un concepto de "mora" formal para él, pero el sistema lo trataba como vencido de todas formas.

### Causa raíz — dos bugs distintos, mismo síntoma

1. **`app/cobros/page.js`**, bucket `cuotasCreditoLibrePendientes` (usado para armar `bucketVencidasWA`, el tramo "Vencidas" del envío masivo): metía **todos** los créditos `credito_libre` con saldo pendiente > 0, sin ningún criterio de antigüedad —
   ```js
   const cuotasCreditoLibrePendientes = todasCuotas.filter(c => esCreditoLibre(c) && pendiente(c) > 0.5)
   ```
2. Incluso corrigiendo lo anterior, **la tarjeta de un cliente en el modal seguía mostrando TODOS sus créditos**, no solo el que causó que entrara al tramo. Un cliente con un préstamo normal en mora (correcto, sí es vencido) que además tenía un crédito libre de 1 día arrastraba ese crédito libre en su tarjeta como si también estuviera vencido — el crédito libre nunca entra a `enTramo` (su cuota placeholder no tiene fecha real), así que la rama `esTramo=false` lo mostraba siempre con "todo su saldo", sin filtrar por antigüedad.

### Regla de negocio definida con el usuario

Un crédito libre solo se considera **vencido** — y por tanto solo debe aparecer en el tramo "Vencidas" y en las tarjetas de clientes — cuando han pasado **más de 30 días desde su fecha real de desembolso**. Antes de cumplir el mes, es un crédito vigente y no debe listarse como deuda exigible en ningún tramo del envío masivo, aunque el cliente entre a la lista por otro crédito distinto.

### Implementación

- **`app/api/cuotas/route.js`** (GET): se agregó al SELECT `COALESCE(p.fecha_desembolso, p.fecha_primer_pago, p.fecha_creacion::DATE) AS fecha_desembolso_real` — misma jerarquía de fallback que ya usa `/api/creditos-libres` (§18) y el campo `fecha_desembolso` de §19. Antes esta ruta solo exponía `p.fecha_creacion AS fecha_prestamo` (fecha de captura en el sistema, no de desembolso real).
- **`app/cobros/page.js`**:
  - Nuevos helpers: `fdDe(c)` (fecha de desembolso de la cuota), `diasDesdeDesembolso(c)`, y `creditoLibreVencido(c) = esCreditoLibre(c) && diasDesdeDesembolso(c) > 30` — único criterio de "vencido" para este tipo de crédito, reutilizado en los dos puntos de fix.
  - `cuotasCreditoLibrePendientes` ahora exige `creditoLibreVencido(c)` además de saldo pendiente.
  - En `iniciarEnvio()`, cada producto del cliente calcula `libreVigente = tipo==='credito_libre' && !cuotas.some(creditoLibreVencido)`; el `.filter()` final de `productos` excluye `libreVigente` — así un crédito libre sin cumplir el mes nunca se lista en la tarjeta de ningún tramo, así el cliente haya entrado por otro crédito.
  - `grupos` (estado principal) ahora incluye `fecha_desembolso` por producto (viene de `fecha_desembolso_real`), y cada producto armado en `iniciarEnvio` expone `fechaDesembolso` para mostrarla en la UI.

### Mejoras de UX agregadas en el mismo cambio (a pedido del usuario)

- **Buscador por nombre** dentro del modal "Envío asistido" (`buscarEnvio`, estado nuevo): filtra `envio.lista` por `nombre` sin cerrar el modal ni perder el tramo activo. Se limpia automáticamente al abrir un tramo nuevo (`iniciarEnvio`).
- **Fecha de desembolso visible por crédito**: el badge de tipo en cada tarjeta (antes deduplicado por tipo con `[...new Set(...)]`) ahora itera `cl.productos` uno por uno (un cliente puede tener varios créditos del mismo tipo con fechas distintas) y agrega `· desde {fecha}` usando el `fechaDesembolso` de cada producto — útil para que el cobrador verifique a simple vista por qué un crédito cayó (o no) en el tramo.

### Patrón a vigilar

Cualquier vista nueva que trate créditos `credito_libre` como "vencidos" debe usar `creditoLibreVencido` (>30 días desde `fecha_desembolso_real`), nunca `fecha_vencimiento` (que siempre es el placeholder `2099-12-31` y no representa mora real). Y cualquier tarjeta/resumen que agrupe **todos los créditos de un cliente** para un tramo de cobro debe filtrar explícitamente los créditos libres vigentes — no basta con que el cliente "esté en la lista" por otro motivo.

> **Nota (2026-08-11):** el badge `· desde {fecha}` descrito arriba ("Fecha de desembolso visible por crédito") fue **reemplazado** por dos etiquetas separadas ("Desembolso" / "Pago") — ver §25. El campo `fechaDesembolso` sigue existiendo pero ya no es la única fecha mostrada.

---

## 25. Fix — Desfase de fecha (UTC-5) y etiquetas ambiguas "desde" en `/cobros` — 2026-08-11

### Bug 1: fechas mostradas un día antes de la real (desfase UTC-5)

**Síntoma:** en el modal "Envío asistido" de `/cobros`, un crédito con `fecha_primer_pago = 2026-08-11` (hoy) se mostraba como "Préstamo · desde 10/08/2026" — un día antes. Verificado contra la BD (Supabase, proyecto `HERMANOS_LIÑAN`, `fecnicckenqlmpqefkth`): el dato real era correcto, el problema era de renderizado.

**Causa raíz:** Postgres devuelve una columna `DATE`/`TIMESTAMP` como objeto `Date` en medianoche UTC; al serializarse en `NextResponse.json()` queda como `"2026-08-11T00:00:00.000Z"`. Cuatro puntos de `app/cobros/page.js` hacían `new Date(fechaSinHora).toLocaleDateString('es-CO')` **sin** fijar mediodía local — en el navegador del cobrador (Bogotá, UTC-5) esto interpreta el instante UTC y lo convierte a `2026-08-10T19:00:00-05:00`, corriendo la fecha un día hacia atrás. Es el mismo patrón de desfase que `CLAUDE.md` ya documenta en §10/§14/§18/§19, pero aquí no se aplicó la convención `+'T12:00:00'`.

**Puntos corregidos en `app/cobros/page.js`:**
- `fmtFechaCorta` (badge "· desde {fecha}" y "Último pago: ... el {fecha}"): ahora hace `new Date(s.split('T')[0] + 'T12:00:00')`.
- `abrirModalWA` (mensaje individual de mora por WhatsApp — **este era el más grave, mostraba fecha de vencimiento equivocada al cliente**): se reemplazó el parseo manual por los helpers ya existentes `fvDe`/`diasDesde` (que sí usaban la convención correcta).
- Acordeón móvil de cuotas y tabla desktop de cuotas (ambos mostraban `fecha_vencimiento` con el mismo antipatrón): ahora usan `new Date(fvDe(c) + 'T12:00:00')`.

**Patrón a vigilar:** cualquier `new Date(x).toLocaleDateString(...)` en este archivo (o en cualquier componente cliente) donde `x` sea una fecha sin hora explícita (`DATE` de Postgres, o un string `"YYYY-MM-DD"`) debe pasar primero por `.split('T')[0] + 'T12:00:00'`. Los helpers `fvDe`/`diasDesde`/`fdDe`/`diasDesdeDesembolso` ya existentes en `app/cobros/page.js` aplican esto correctamente — reutilizarlos en vez de parsear fechas a mano es la forma de no repetir el bug.

### Bug 2 (UX, no técnico): la etiqueta "desde {fecha}" se confundía con "fecha en que se hizo el préstamo"

**Problema:** el badge `· desde {fecha}` (agregado en §24) usaba `fecha_desembolso_real = COALESCE(fecha_desembolso, fecha_primer_pago, fecha_creacion)` — fórmula pensada para la regla de 30 días de créditos libres (§18/§24), donde `fecha_primer_pago` sí es la fecha de inicio real. Pero para un préstamo normal sin `fecha_desembolso` explícito (la mayoría, ver §19), esa fórmula prioriza `fecha_primer_pago` — es decir, el badge mostraba la fecha de la **primera cuota**, no la fecha en que se entregó el dinero. Como el badge solo decía "desde", el cobrador no podía distinguir cuál de los dos conceptos estaba viendo.

**Fix:**
- `app/api/cuotas/route.js` (GET): se agregaron dos columnas nuevas al SELECT, **sin tocar** `fecha_desembolso_real` (la regla de 30 días de créditos libres depende de ella tal cual):
  - `fecha_desembolso_mostrar` = `COALESCE(p.fecha_desembolso, p.fecha_creacion::DATE)` — desembolso real, misma prioridad que ya usa `/prestamos/[id]` (fecha_desembolso > fecha_creacion, **sin** `fecha_primer_pago` de por medio).
  - `fecha_primer_pago_producto` = `p.fecha_primer_pago` crudo.
- `app/cobros/page.js`:
  - `cargar()`: el objeto agrupado por producto ahora guarda `fecha_desembolso_mostrar` y `fecha_primer_pago` además del `fecha_desembolso` (`fecha_desembolso_real`) que ya existía.
  - `iniciarEnvio()`: cada producto calcula **dos** fechas independientes — `fechaDesembolso` (desembolso real; para `credito_libre` se conserva `fecha_desembolso_real`, porque ese módulo no tiene "próxima cuota") y `fechaPago` (la cuota pendiente más próxima dentro de `relevantes`, excluyendo la placeholder `2099-12-31` de fiado/adelanto vía `enRuta`).
  - Chip del modal "Envío asistido": pasó de `· desde {fecha}` a `· Desembolso: {fecha} · Pago: {fecha}` (cada fecha se omite si no aplica, ej. crédito recién creado sin cuotas vencidas todavía no muestra "Pago").

**Alcance:** cambio de UI + una fórmula adicional en un endpoint ya existente — no se tocó ninguna tabla, ninguna migración SQL, ni la regla de 30 días de créditos libres.

### Lección de implementación: backticks de markdown dentro de un template literal SQL rompen el build

Al documentar el cambio anterior con un comentario SQL (`-- ...`) dentro del template literal `` sql = `...` `` de `app/api/cuotas/route.js`, se usaron backticks de markdown (`` `fecha_desembolso_real` ``) para resaltar un nombre de columna. Como todo el bloque SQL ya está envuelto en backticks (es un template literal de JS), esos backticks internos sin escapar **cierran el template literal antes de tiempo** y rompen el archivo — Vercel falló el build con `Error: Expected a semicolon` apuntando justo a esa línea.

**Patrón a vigilar:** nunca usar backticks (`` ` ``) dentro de un comentario `-- ...` que viva dentro de un template literal de SQL en JS/TS. Si se necesita resaltar un nombre de columna en un comentario ahí, usar comillas simples o ninguna comilla. Además, `node --check archivo.js` **no es confiable** para detectar este tipo de error en archivos con `import`/`export` (ESM) — dio un falso "OK" en este caso. Verificación más fiel usada después: `node --input-type=module --check < archivo.js` para módulos sin JSX, y `@babel/parser` con el plugin `jsx` para archivos de página (`.js` con JSX).

---

## 26. Exportar Excel — una hoja por cliente (`/backup`) — 2026-08-11

Nuevo botón **"📊 Exportar Excel (por cliente)"** en `/backup`, junto al backup `.json` existente. A diferencia del backup JSON (que es para *restaurar* la base), este Excel es para **revisar/compartir la cartera de forma legible** — no se puede restaurar desde él.

### Qué contiene

Un archivo `.xlsx` con una hoja **"Índice"** primero (lista de los 373 clientes con documento, teléfono, dirección, # de créditos y el nombre exacto de su hoja) y luego **una hoja por cliente**, cada una con:
- Datos del cliente (nombre, documento, teléfono, dirección, email).
- Por cada crédito del cliente: referencia, tipo (con label/ícono dinámico de `cred_tipos_prestamo`, vía `GET /api/configuracion/tipos`), capital, tasa, estado, método de cálculo, fecha de desembolso, fecha de la primera cuota, medio de desembolso, notas.
- Tabla de **cuotas** completa del crédito (#, vencimiento, valor, interés, capital, pagado, estado).
- Tabla de **pagos** completa del crédito (fecha, monto, interés, capital, método, recibo, notas).

Si un cliente no tiene créditos, o un crédito no tiene cuotas/pagos aún, la hoja lo indica explícitamente (`Sin créditos registrados` / `Sin cuotas registradas` / `Sin pagos registrados`) en vez de dejar espacio en blanco ambiguo.

### Implementación (`app/backup/page.js`)

- **No se creó ningún endpoint nuevo.** `exportarExcel()` reutiliza `GET /api/backup` (el mismo que ya genera el backup JSON, ya registra el evento en `cred_backups` y en la auditoría) — solo toma `data.tablas.clientes/productos/cuotas/pagos` del JSON y descarta el resto (caja, historial, config, usuarios). Evita duplicar las 8 consultas SQL en un segundo endpoint.
- Agrupa `productos` por `cliente_id`, `cuotas` y `pagos` por `producto_id` en objetos-mapa antes de iterar clientes (evita recorrer los arrays completos una vez por cliente).
- **Nombres de hoja únicos y válidos**: Excel limita los nombres de hoja a 31 caracteres y prohíbe `: \ / ? * [ ]`. `nombreHojaUnico()` sanitiza el nombre del cliente, y si hay colisión (nombres repetidos entre los 373 clientes) agrega los últimos 4 dígitos del documento o un sufijo numérico `(2)`, `(3)`, etc.
- **Fechas**: se creó `fmtSoloFecha()` (helper nuevo en este archivo) que aplica la misma convención `+'T12:00:00'` corregida en `/cobros` (§25) — todas las fechas de este Excel (desembolso, primera cuota, vencimiento de cuota, fecha de pago) están protegidas contra el mismo desfase UTC-5 desde el día uno, no se reintrodujo el bug.
- Usa `XLSX.utils.aoa_to_sheet` (array de arrays) — mismo patrón ya usado en `exportarRuta` de `/cobros` y en `/informes`, no una librería nueva.

### Alcance y límites conocidos

- Con 373 clientes activos hoy, el archivo genera 374 hojas (373 + Índice). Es manejable pero pesado de abrir en equipos con poca RAM — si la cartera crece significativamente, considerar paginar por fecha o generar el archivo en el servidor en vez de en el navegador.
- El Excel se genera 100% en el navegador (igual que los demás export de este sistema) — para 373 clientes con miles de cuotas/pagos esto puede tardar unos segundos; no hay barra de progreso, solo el texto del botón ("⏳ Generando Excel...").
- **Hallazgo de seguridad relacionado, no corregido en este cambio:** al revisar `app/api/backup/route.js` se encontró que la función `verificarAdmin()` (línea ~10) está definida pero **nunca se llama** — ni `GET` (exportar) ni `POST` (restaurar) verifican `rol === 'admin'`, solo que exista un usuario autenticado (`getUsuarioDesdeRequest`). Cualquier usuario con rol `operador` que llame directamente a estos endpoints (sin pasar por el botón de la UI) podría exportar el backup completo (incluye `password_hash` de usuarios) o **restaurar/reemplazar toda la base de datos**. Pendiente de decisión del dueño del sistema: agregar `if (!u?.rol || u.rol !== 'admin') return 403` en ambos handlers.

---

## 27. Fix — "Limpiar cliente específico" falla con FK de `cred_unificaciones` — 2026-08-19

### Síntoma

Desde `/migracion` → Zona de desarrollo → **Limpiar cliente específico**, al intentar borrar varios créditos de un cliente (ej. cliente CC 77159747, 6 de sus 7 créditos, dejando solo `CRED-000777` activo), la operación fallaba con:

```
update or delete on table "cred_productos" violates foreign key constraint
"cred_unificaciones_credito_origen_id_fkey" on table "cred_unificaciones"
```

### Causa raíz

`POST /api/migracion/reset-cliente` (documentado en §6) borra en cascada manual, filtrando siempre por `producto_id`: `cred_movimientos_caja` → `cred_pagos` → `cred_historial_recalculos` → `cred_cuotas` → `cred_productos`. La tabla `cred_unificaciones` (migración `23_unificacion_creditos.sql`, ver §4 y §21) se agregó **después** de que este endpoint ya existía y **nunca se actualizó** para limpiarla también. Esa tabla tiene FK reales (a diferencia de `es_refinanciacion_de`/`refinanciado_por`, que son `TEXT` sin FK) hacia `cred_productos` en **ambas** columnas — `credito_nuevo_id` y `credito_origen_id` — sin `ON DELETE CASCADE`. Cualquier crédito que haya participado en una unificación (como origen consolidado, estado `refinanciado`) no se puede borrar sin antes borrar su(s) fila(s) en `cred_unificaciones`.

**Por qué apareció justo con este cliente:** de sus 7 créditos, varios (`CRED-000654`, `CRED-000653` credito_libre, `CRED-000564`, `CRED-000561`, `CRED-000471`) estaban en estado `refinanciado` — es decir, fueron orígenes de una o más unificaciones — y tenían filas en `cred_unificaciones.credito_origen_id` apuntando a ellos. Al intentar borrarlos, Postgres rechazó el `DELETE` de `cred_productos` por esa FK.

### Fix (`app/api/migracion/reset-cliente/route.js`)

Se agregó, justo antes del `DELETE FROM cred_productos`, un `DELETE FROM cred_unificaciones WHERE credito_nuevo_id IN (...) OR credito_origen_id IN (...)` sobre el mismo array `productoIds` — mismo patrón "filtrar por producto_id, nunca por cliente_id" que ya usa todo el endpoint. Envuelto en `.catch(() => ({ rowCount: 0 }))` para tolerar un ambiente viejo sin la tabla (mismo patrón defensivo que ya usa `GET /api/productos/[id]` para las consultas de `unificado_desde`/`unificado_en`, ver §21). El contador `unificaciones` se agregó a la respuesta JSON y al mensaje de auditoría, junto a `prods`/`cuotas`/`pagos`/`movimientos`/`recalculos`.

**Efecto colateral esperado (correcto, no un bug):** si alguno de los créditos borrados era el `credito_nuevo_id` de una unificación cuyos orígenes **no** se están borrando en la misma operación, esos orígenes quedan con `refinanciado_por` apuntando a un crédito que ya no existe (columna `TEXT` sin FK, así que no truena, pero el dato queda huérfano). Es inherente a que el usuario pidió borrar ese crédito puntual — no hay forma de "recomponer" una unificación después de borrar su resultado.

**Patrón a vigilar:** cualquier tabla nueva que agregue una FK real hacia `cred_productos` (a diferencia de las columnas `TEXT` sueltas como `es_refinanciacion_de`) debe revisarse contra **ambos** endpoints de borrado de créditos — `POST /api/migracion/reset-cliente` y `POST /api/migracion/reset` (borrado masivo) — para agregar su propio `DELETE` previo. `cred_unificaciones` es, a la fecha, la única tabla en ese caso.

**Pendiente de desplegar:** el archivo corregido se entregó y se sincronizó a `C:\programa alberto mario\Programa_Creditos\app\api\migracion\reset-cliente\route.js` — falta el `git commit`/despliegue a Vercel para que tome efecto en producción (este proyecto no tiene hot-reload remoto).
