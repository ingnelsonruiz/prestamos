# CLAUDE.md — Base de Conocimiento: Programa Créditos

> Sistema web de gestión de créditos, empeños y fiados para una empresa prestamista.
> Stack: **Next.js 15** (App Router) + **PostgreSQL** + **Tailwind CSS**
> Nombre interno del sistema: **Inversiones Tata Liñán**

---

## 1. Visión General

Aplicación full-stack para administrar la cartera crediticia de una empresa prestamista. Permite:

- Registrar clientes y asociarles productos financieros (préstamos, empeños, ventas a crédito, fiados).
- Generar automáticamente el plan de cuotas según método de amortización seleccionado.
- Registrar pagos, emitir recibos numerados consecutivamente y actualizar el saldo de caja.
- Hacer seguimiento de mora, cartera vencida y empeños próximos a vencer.
- Auditar cada acción del sistema con usuario, fecha e IP.
- Consulta pública del estado de cuenta de un cliente (sin autenticación).

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
│   ├── api/                   # API Routes (Route Handlers)
│   │   ├── auth/login|logout|me/
│   │   ├── clientes/[id]/
│   │   ├── productos/[id]/
│   │   ├── cuotas/
│   │   ├── pagos/
│   │   ├── dashboard/
│   │   ├── estado/[id]/       # PÚBLICO - saldo cliente
│   │   ├── informes/
│   │   ├── usuarios/[id]/
│   │   └── auditoria/
│   ├── login/                 # Ruta pública
│   ├── clientes/[id]/
│   ├── prestamos/[id]/ nuevo/
│   ├── cobros/
│   ├── empenos/
│   ├── estado/[id]/           # PÚBLICO - vista cliente
│   ├── informes/
│   ├── usuarios/
│   ├── auditoria/
│   └── page.js                # Dashboard principal
├── components/
│   ├── Sidebar.jsx            # Navegación escritorio
│   ├── BottomNav.jsx          # Navegación móvil
│   ├── LayoutWrapper.jsx      # Wrapper con auth guard
│   └── KPICard.jsx            # Tarjeta de métrica
├── lib/
│   ├── db.js                  # Pool PostgreSQL
│   ├── auth.js                # JWT: crearToken, verificarToken
│   ├── calculos.js            # Motor financiero (cuotas, amortización)
│   └── auditoria.js           # Logger de auditoría + constantes
├── middleware.js              # Protección global de rutas (JWT)
├── .env.local                 # Variables de entorno (no commitear)
└── *.sql                      # Migraciones numeradas
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

**Estado calculado** (no almacenado): se deriva en query JOIN → `sin_prestamos`, `activo`, `en_mora`.

#### `cred_productos`
Representa cualquier operación financiera activa.

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | UUID v4 |
| cliente_id | TEXT FK | → cred_clientes |
| tipo | TEXT | `prestamo`, `venta`, `empeno`, `fiado` |
| monto_capital | NUMERIC | Capital financiado (ya descontada cuota_inicial) |
| tasa_interes | NUMERIC | Tasa en % |
| periodo_tasa | TEXT | `diario`, `semanal`, `quincenal`, `mensual`, `anual` |
| frecuencia_cobro | TEXT | `diario`, `semanal`, `quincenal`, `mensual` |
| num_cuotas | INTEGER | |
| fecha_primer_pago | DATE | |
| con_interes | BOOLEAN | |
| metodo_calculo | TEXT | `plano` o `frances` |
| cuota_inicial | NUMERIC | Enganche/pie |
| descripcion_bien | TEXT | Empeños y ventas |
| valor_comercial_bien | NUMERIC | Empeños |
| fecha_limite_rescate | DATE | Empeños |
| estado | TEXT | `activo`, `al_dia`, `en_mora`, `saldado`, `decomisado`, `refinanciado` |
| es_refinanciacion_de | TEXT | ID del crédito refinanciado |
| refinanciado_por | TEXT | ID del nuevo crédito |
| notas | TEXT | |
| fecha_creacion | TIMESTAMP | |

#### `cred_cuotas`
Plan de pagos generado automáticamente al crear un producto.

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | UUID v4 |
| producto_id | TEXT FK | |
| cliente_id | TEXT FK | |
| numero_cuota | INTEGER | 1..n |
| fecha_vencimiento | DATE | Calculada por lib/calculos.js |
| monto_cuota | NUMERIC | Total a pagar |
| abono_interes | NUMERIC | Porción de interés |
| abono_capital | NUMERIC | Porción de capital |
| saldo_pendiente | NUMERIC | Saldo tras esta cuota |
| monto_pagado | NUMERIC | Acumulado pagado |
| dias_mora | INTEGER | Calculado en cobro |
| estado | TEXT | `pendiente`, `parcial`, `pagada`, `mora` |

#### `cred_pagos`
Registro histórico de cada transacción de pago.

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| cuota_id | TEXT FK | |
| producto_id | TEXT FK | |
| cliente_id | TEXT FK | |
| monto | NUMERIC | |
| fecha_pago | TIMESTAMP | No puede ser futura |
| metodo_pago | TEXT | `efectivo`, etc. |
| notas | TEXT | |
| numero_recibo | TEXT | Formato `REC-000001` |
| usuario_nombre | TEXT | Quién registró el pago |

#### `cred_usuarios`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| nombre | TEXT | |
| usuario | TEXT UNIQUE | Login |
| password_hash | TEXT | bcrypt |
| rol | TEXT | `admin` o `operador` |
| activo | BOOLEAN | |
| ultimo_acceso | TIMESTAMP | |

#### `cred_auditoria`
Traza completa de acciones del sistema.

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

Índices: `fecha DESC`, `usuario_id`, `modulo`.

#### `cred_movimientos_caja`
Flujo de caja: desembolsos (-) y cobros (+).

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | |
| tipo | TEXT | `desembolso`, `cobro_capital` |
| monto | NUMERIC | Negativo en desembolso |
| concepto | TEXT | |
| referencia_id | TEXT | ID pago o producto |
| saldo_acumulado | NUMERIC | Saldo corriente |
| fecha | TIMESTAMP | |

#### `cred_configuracion`
Pares clave-valor para configuración del sistema.

| Clave | Uso |
|-------|-----|
| `recibo_consecutivo` | Contador autoincremental de recibos (REC-XXXXXX) |

---

## 5. Lógica Financiera (`lib/calculos.js`)

### Períodos disponibles
```js
const DIAS = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }
```

### Conversión de tasas

```js
convertirTasa(tasa, periodoOrigen, periodoDestino)
// Usa equivalencia efectiva: (1 + i)^(d2/d1) - 1
```

### Método Plano (Interés Simple)

- Conversión **proporcional** (lineal): `tasa_periodo = (tasa% / 100) * (días_destino / días_origen)`
- El interés se calcula siempre sobre el capital inicial.
- La cuota es constante; el residuo de centavos se suma a la primera cuota.
- El saldo disminuye linealmente.

```js
calcularInteresPlano(productoId, clienteId, P, tasaPct, periodoTasa, frecuenciaCobro, n, fechaPrimerPago)
```

### Método Francés (Amortización Francesa)

- Conversión **efectiva** (compuesta): usa `convertirTasa`.
- Cuota fija calculada con la fórmula estándar: `P * i*(1+i)^n / ((1+i)^n - 1)`.
- El interés decrece cuota a cuota; el abono a capital aumenta.

```js
calcularFrances(productoId, clienteId, P, tasaPct, periodoTasa, frecuenciaCobro, n, fechaPrimerPago)
```

### Tipo Fiado
- Sin interés, sin cuotas múltiples.
- Se crea una única cuota con `fecha_vencimiento = '2099-12-31'` (cuenta abierta).
- Se puede abonar parcialmente.

### Cálculo de fechas de vencimiento
Se usa hora local (no UTC) para evitar desfases de zona horaria. El algoritmo incrementa por cuota según la frecuencia:
- `diario` → +1 día por cuota
- `semanal` → +7 días
- `quincenal` → +15 días
- `mensual` → +1 mes (setMonth)

---

## 6. API Endpoints

Todas las rutas (excepto `/login`, `/estado/*`, `/api/auth/*`, `/api/estado/*`) requieren cookie `itl_session` válida.

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login: valida usuario+password, crea JWT, setea cookie |
| POST | `/api/auth/logout` | Elimina cookie |
| GET | `/api/auth/me` | Devuelve payload del token actual |

### Clientes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/clientes?q=` | Lista con estado calculado y mora. Búsqueda por nombre o documento |
| POST | `/api/clientes` | Crea cliente. Campos req: `documento`, `nombre` |
| GET | `/api/clientes/[id]` | Detalle del cliente |
| PUT | `/api/clientes/[id]` | Actualiza datos del cliente |
| DELETE | `/api/clientes/[id]` | Elimina si no tiene productos activos |

### Productos (Préstamos/Empeños/Ventas/Fiados)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/productos?cliente_id=` | Lista productos con métricas de cuotas |
| POST | `/api/productos` | Crea producto + genera cuotas + registra desembolso en caja |
| GET | `/api/productos/[id]` | Detalle con cuotas y pagos |
| PUT | `/api/productos/[id]` | Actualiza datos del producto |

**Refinanciación**: Si el body incluye `es_refinanciacion_de`, al crear el nuevo producto se cierra el original con estado `refinanciado`.

### Cuotas
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/cuotas?estado=&cliente_id=&producto_id=` | Lista cuotas filtradas. `estado=mora` usa lógica por fecha |

### Pagos
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/pagos` | Registra pago: actualiza cuota, genera recibo, mueve caja. Valida fecha no futura |
| GET | `/api/pagos?producto_id=&cliente_id=` | Historial de pagos |

### Dashboard
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dashboard` | KPIs + cuotas hoy + cuotas semana + empeños próximos a vencer + últimos movimientos caja |

**KPIs retornados:**
- `capital_en_calle`: suma saldos pendientes de cuotas activas
- `intereses_ganados`: suma abono_interes de cuotas pagadas
- `clientes_en_mora`: clientes distintos con al menos una cuota en mora
- `recaudo_hoy`: suma pagos del día
- `cartera_vencida_30d`: saldo de cuotas en mora con +30 días vencidas

### Informes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/informes?desde=&hasta=&tipo=intereses` | Resumen mensual + detalle de pagos en el período |

### Estado (PÚBLICO)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/estado/[id]` | Saldo del cliente: nombre, documento, productos activos con saldo. Sin datos sensibles |

### Usuarios
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/usuarios` | Lista usuarios (solo admin) |
| POST | `/api/usuarios` | Crea usuario con bcrypt hash |
| PUT | `/api/usuarios/[id]` | Edita / cambia contraseña / activa o desactiva |

### Auditoría
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/auditoria` | Log paginado con filtros por módulo/usuario/fecha |

---

## 7. Autenticación y Seguridad

### Flujo de autenticación
1. Usuario POST `/api/auth/login` → se verifica `bcrypt.compare(password, hash)`.
2. Se genera JWT HS256 con `jose` (expiración 8 h).
3. JWT se almacena en cookie HttpOnly `itl_session`.
4. El middleware `middleware.js` verifica el token en **cada request** antes de llegar a las rutas.

### Rutas públicas (no requieren token)
```
/login, /estado/*, /api/auth/*, /api/estado/*
```

### Roles
- `admin`: acceso total, gestión de usuarios.
- `operador`: operaciones del día a día (clientes, préstamos, cobros).

### Variables de entorno (`.env.local`)
```
DB_HOST=<ip>
DB_PORT=5435
DB_NAME=base_sie_dusakawi
DB_USER=postgres
DB_PASSWORD=<password>
DB_SCHEMA=administrativo
JWT_SECRET=<secret>   # default: 'inversiones-tata-linan-secret-2026'
```

---

## 8. Flujo de Negocio Principal

### Crear un préstamo
```
1. Seleccionar cliente (o crear uno nuevo)
2. Elegir tipo: prestamo | venta | empeno | fiado
3. Ingresar: monto_capital, tasa, periodo_tasa, frecuencia_cobro, num_cuotas, fecha_primer_pago, metodo_calculo
4. POST /api/productos → genera cuotas automáticamente → registra desembolso en caja
```

### Registrar un pago
```
1. Identificar cuota (por cliente o por fecha de vencimiento)
2. POST /api/pagos { cuota_id, monto, metodo_pago, fecha_pago? }
3. Sistema: actualiza monto_pagado en cuota → calcula estado (parcial/pagada)
   → genera numero_recibo correlativo → mueve caja → si no quedan pendientes → producto = 'saldado'
```

### Refinanciar un crédito
```
1. POST /api/productos con es_refinanciacion_de = <id_credito_original>
2. El crédito original queda en estado 'refinanciado' y campo refinanciado_por = <nuevo_id>
3. Se genera el nuevo plan de cuotas normalmente
```

---

## 9. Migraciones SQL

Ejecutar en orden sobre la BD:

| Archivo | Descripción |
|---------|-------------|
| `03_alter_refinanciacion.sql` | Agrega columnas `refinanciado_por` y `es_refinanciacion_de` a `cred_productos`; actualiza CHECK de estados |
| `04_limpiar_datos_prueba.sql` | Borra todos los datos operativos (mantiene estructura y usuarios) |
| `05_alter_fiado.sql` | Agrega tipo `fiado` al CHECK de `cred_productos.tipo` |
| `06_crear_usuarios.sql` | Crea tabla `cred_usuarios` + usuario admin inicial (pass: `admin123`) |
| `07_crear_auditoria.sql` | Crea tabla `cred_auditoria` con índices |
| `08_alter_pagos_usuario.sql` | Agrega columna `usuario_nombre` a `cred_pagos` |

---

## 10. Componentes UI Clave

### `KPICard.jsx`
Tarjeta de métrica para el dashboard. Props: `titulo`, `valor`, `icono`, `color`, `alerta`.

### `Sidebar.jsx`
Navegación lateral para escritorio con links a todas las secciones.

### `BottomNav.jsx`
Barra de navegación inferior para móvil.

### `LayoutWrapper.jsx`
Wrapper que aplica el layout (sidebar + contenido) y actúa como guard de autenticación en el cliente.

---

## 11. Convenciones de Código

- Todos los Route Handlers usan `const S = 'administrativo'` para el nombre del esquema.
- IDs generados siempre con `uuidv4()` en la capa de aplicación (no en BD).
- Fechas manipuladas en **zona horaria local** con parsing manual `split('-')` para evitar desfase UTC.
- Formato de moneda: `Intl.NumberFormat('es-CO', { style:'currency', currency:'COP' })`.
- Auditoría registrada en **todos** los endpoints mutantes (crear, editar, pagar, refinanciar).
- Errores de BD retornan `{ error: error.message }` con status 500.
- Conflicto de documento único retorna status 409.

---

## 12. Comandos de Desarrollo

```bash
# Instalar dependencias
npm install

# Servidor de desarrollo
npm run dev          # http://localhost:3000

# Build de producción
npm run build
npm start
```

---

## 13. Puntos de Extensión / Mejoras Pendientes

- **Mora automática**: no hay job que actualice `estado='mora'` en cuotas vencidas; actualmente se detecta por comparación de fechas en las queries.
- **Notificaciones**: no implementadas; candidato natural para WebSockets o cron + SMS/WhatsApp.
- **Multiempresa**: el esquema `administrativo` es fijo; para multitenancy habría que parametrizar el esquema.
- **Tipo `venta`**: el flujo es igual al de `prestamo`; se podría diferenciar con lógica de inventario.
- **Recibo PDF**: actualmente solo se genera el número; el frontend podría renderizar un recibo imprimible con `window.print()`.
- **Tests**: no hay suite de pruebas; prioridad: tests de `lib/calculos.js` (lógica financiera crítica).
