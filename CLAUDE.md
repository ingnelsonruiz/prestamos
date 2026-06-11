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

---

## 2. Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 15 (App Router, Server Components + Client Components) |
| Base de datos | PostgreSQL (esquema `administrativo`) |
| ORM / driver | `pg` (node-postgres) con pool de conexiones |
| Autenticación | JWT con `jose` v6, almacenado en cookie `itl_session` (8 h) |
| Estilos | Tailwind CSS v3 |
| Gráficas | Chart.js 4 + react-chartjs-2 |
| Exportación | xlsx (SheetJS) |
| IDs | UUID v4 (`uuid`) |
| Hashing | bcryptjs |
| Middleware | Next.js Middleware (verificación JWT en cada ruta) |

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
│   ├── usuarios/
│   ├── auditoria/
│   └── page.js                    # Dashboard principal
├── components/
│   ├── Sidebar.jsx
│   ├── BottomNav.jsx
│   ├── LayoutWrapper.jsx          # Banner modo prueba global
│   └── KPICard.jsx
├── lib/
│   ├── db.js
│   ├── auth.js
│   ├── calculos.js
│   └── auditoria.js
├── middleware.js
├── .env.local
└── *.sql                          # Migraciones 03..09
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
| cliente_id | TEXT FK | |
| tipo | TEXT | `prestamo`, `venta`, `empeno`, `fiado`, `adelanto` |
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
| `modo_prueba` | `'true'`/`'false'` — permite fechas futuras en pagos |

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
| GET | `/api/productos?cliente_id=` | Incluye `telefono`, `direccion` del cliente |
| POST | `/api/productos` | Fiado y adelanto: cuenta abierta. Otros: genera cuotas. |
| GET/PUT | `/api/productos/[id]` | |
| POST | `/api/productos/[id]/liquidar` | Liquidación anticipada con valor acordado |

**GROUP BY en `/api/productos` GET**: `p.id, c.nombre, c.documento, c.telefono, c.direccion`

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

### Estado (PÚBLICO)
`GET /api/estado/[id]` — devuelve: nombre, documento, productos con métricas completas, últimos 10 pagos.

---

## 7. Autenticación y Seguridad

- JWT HS256 con `jose`, cookie HttpOnly `itl_session` (8h).
- Rutas públicas: `/login`, `/estado/*`, `/api/auth/*`, `/api/estado/*`.
- Roles: `admin` (acceso total) / `operador` (operación diaria).
- Variables `.env.local`: `DB_HOST`, `DB_PORT=5435`, `DB_NAME=base_sie_dusakawi`, `DB_USER`, `DB_PASSWORD`, `DB_SCHEMA=administrativo`, `JWT_SECRET`.

---

## 8. Flujos de Negocio

### Crear préstamo
`POST /api/productos` → genera cuotas → registra desembolso en caja.

### Fiado / Adelanto
`POST /api/productos` con `tipo='fiado'` o `tipo='adelanto'` → 1 cuota abierta `2099-12-31`.

### Registrar pago
`POST /api/pagos` → actualiza cuota → genera recibo → mueve caja → si sin pendientes → producto `saldado`.

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
- **Transacciones**: toda operación con múltiples escrituras usa `withTransaction(fn)` de `lib/db.js` (BEGIN/COMMIT sobre un mismo cliente del pool, ROLLBACK ante error). Los consecutivos (`recibo_consecutivo`, `credito_consecutivo`) se incrementan DENTRO de la transacción para no consumir números si algo falla. Aplicado en: `POST /api/pagos`, `POST /api/productos`, `POST /api/productos/[id]/liquidar`. NOTA: en modo proxy (`PROXY_URL`) no hay sesión entre llamadas → el helper ejecuta secuencialmente sin atomicidad real.
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
