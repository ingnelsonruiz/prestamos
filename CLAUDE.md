# CLAUDE.md — Base de Conocimiento: Programa Créditos

> Sistema web de gestión de créditos, empeños y fiados para una empresa prestamista.
> Stack: **Next.js 15** (App Router) + **PostgreSQL** + **Tailwind CSS**
> Nombre interno del sistema: **Inversiones Tata Liñán**

---

## 1. Visión General

Aplicación full-stack para administrar la cartera crediticia de una empresa prestamista. Permite:

- Registrar clientes y asociarles productos financieros (préstamos, empeños, ventas a crédito, fiados, adelantos).
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
└── *.sql                          # Migraciones 03..15
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
| tipo | TEXT | Código de `cred_tipos_prestamo` (ya **sin CHECK fijo**). Base: `prestamo`, `venta`, `empeno`, `fiado`, `adelanto` |
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
**Comportamientos**: `prestamo_normal` (cuotas con tasa/interés), `cuenta_abierta` (1 cuota a 2099-12-31 sin interés), `empeno` (igual que normal + campos de bien y rescate).

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
| GET | `/api/productos?cliente_id=` | Incluye `telefono`, `direccion`, `ref_nuevo`, `ref_origen` (referencias de refinanciación) |
| POST | `/api/productos` | Fiado/adelanto: cuenta abierta. Otros: genera cuotas. Asigna `referencia` (CRED-XXXXXX) y `metodo_desembolso`. Snapshot de creación en `cred_historial_recalculos`. |
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
- Variables `.env.local` (modo directo): `DB_HOST`, `DB_PORT=5435`, `DB_NAME=base_sie_dusakawi`, `DB_USER`, `DB_PASSWORD`, `DB_SCHEMA=administrativo`, `JWT_SECRET`.
- Variables modo cloud/proxy: `PROXY_URL`, `PROXY_API_KEY` (si están definidas, `lib/db.js` usa el proxy HTTP en lugar del pool directo).

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

> **Convención de mora**: `cred_cuotas.estado` ∈ {`pendiente`,`parcial`,`pagada`}. La **mora NO es un estado almacenado**; se deriva por `fecha_vencimiento < CURRENT_DATE` en cada consulta (Cobros, dashboard, informes, listados de clientes/productos). El cargue inicial fija la mora solo a nivel de **producto** (`estado='en_mora'`), nunca en la cuota.

> **`00_schema_completo.sql`**: estructura completa **idempotente** (`IF NOT EXISTS` en todo). Sirve para levantar la BD desde cero o normalizar una existente. El endpoint `POST /api/backup/estructura` ejecuta esta misma estructura desde la app.

> **Nota tipos `10_*`**: hay varios archivos con prefijo `10_` (referencia, fix liquidación, historial, tipos préstamo); son migraciones independientes, no versiones de una sola.

---

## 10. Módulos del Sistema

### Dashboard (`/`)
- KPIs históricos: Total invertido, Total recuperado, Capital en la calle.
- KPIs operativos: Intereses ganados, Clientes en mora, Recaudo del día, Cartera vencida +30d.
- Listas: Cuotas hoy, Cuotas semana, Empeños próximos a vencer.

### Clientes (`/clientes`)
- Hero card blanco con barra de acento de color (rojo=mora, azul=activo, verde=sin deuda).
- Tabs de filtro con colores: Activos (navy), Saldados (verde), Refinanciados (morado), Todos (gris).
- QR del estado de cuenta con opciones: Copiar QR, Descargar QR, Copiar enlace, Ver página, Enviar por WhatsApp.

### Préstamos (`/prestamos`)
- Agrupado por cliente con: nombre, teléfono (chip verde), dirección.
- Chips de refinanciación en columna de estado.

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

### Configuración (`/configuracion`) — solo admin
- Gestión de **tipos de préstamo** dinámicos (CRUD).
- Cada tipo: label, icono (selector de emojis), descripción, comportamiento (`prestamo_normal` / `cuenta_abierta` / `empeno`), orden, activo.
- Los 5 tipos base (`es_sistema`) no se pueden eliminar; los tipos en uso solo se desactivan.

### Backup (`/backup`) — solo admin
- **Exportar**: descarga JSON completo de la base (8 tablas).
- **Restaurar**: carga un JSON y reemplaza la base (sin tocar al usuario que restaura).
- **Recrear estructura**: ejecuta el SQL idempotente de toda la estructura.
- **Historial**: lista de exportaciones/restauraciones registradas en `cred_backups`.

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

- **Mora automática**: no hay job que actualice `estado='mora'`; se detecta por comparación de fechas en queries.
- **Notificaciones**: candidato para cron + SMS/WhatsApp.
- **Multiempresa**: esquema fijo `administrativo`; para multitenancy parametrizar.
- **Tests**: sin suite de pruebas; prioridad en `lib/calculos.js`.
- **Recibo PDF**: número generado, falta layout imprimible completo.
- **Modo prueba**: desactivar antes de pasar a producción real.
- **Tipo `venta`**: mismo flujo que préstamo; se podría diferenciar con inventario.
