# Glosario

> Diccionario de términos de negocio, enums y consecutivos usados en todo el sistema. Sirve como referencia rápida — el detalle de cada tabla vive en [[Base de Datos]], el de cada endpoint en [[API Endpoints]].

---

## Términos de negocio

| Término | Significado |
|---|---|
| **Producto** | Registro genérico en `cred_productos` que representa cualquier operación de crédito: préstamo, venta, empeño, fiado, adelanto, congelación o crédito libre. Es la entidad "core" del sistema. |
| **Cuota** | Fila de `cred_cuotas` — una obligación de pago programada dentro del cronograma de un producto. |
| **Mora** | Estado calculado dinámicamente (`fecha_vencimiento < CURRENT_DATE` y `estado != 'pagada'`), **nunca** almacenado como valor de `cred_cuotas.estado` (bloqueado por el CHECK de la migración 17). |
| **Refinanciación** | Operación **1:1**: un crédito origen se cierra (`estado='refinanciado'`) y da lugar a exactamente un crédito nuevo (`refinanciado_por`). Las cuotas del origen NO se cierran automáticamente — quedan como registro histórico. Ver el bug documentado en [[Base de Datos]] (2026-08-05). |
| **Unificación** | Operación **N:1**: dos o más créditos origen se consolidan en un solo crédito nuevo. Usa la misma columna `estado='refinanciado'` y la tabla `cred_unificaciones` como traza adicional. Ver [[Unificar Créditos]]. |
| **Congelación** | Tipo de producto para diferir deudas en mora severa: unifica capital + interés causado en un nuevo préstamo a tasa 0%. Blindado en frontend y backend para impedir tasa > 0. |
| **Interés fijo** (`interes_fijo`) | Modo opcional del método `plano`: la base del cálculo de interés se mantiene fija sobre `monto_capital` original en vez de decrecer con el saldo. |
| **Crédito Sin Cuotas Futuras** (`credito_libre`) | Módulo aislado del motor de cuotas normal: no genera cronograma, usa una única cuota placeholder con `fecha_vencimiento='2099-12-31'` y `abono_interes=0` fijo, y calcula interés bajo convención 30/360 por fecha de corte. Ver [[Créditos Sin Cuotas Futuras]]. |
| **Cuenta abierta** | Comportamiento de tipos `fiado` y `adelanto`: una sola cuota a `2099-12-31`, sin interés. |
| **Préstamo interno / empresa propia** | Crédito donde `es_prestamo_interno=TRUE` y `empresa_id` apunta a `cred_empresas_propias` en vez de a un cliente externo (`cliente_id` puede ser NULL desde la migración 23). |
| **Retorno de empresa** | Ingreso registrado en `cred_retornos_empresa` cuando una empresa propia devuelve capital + interés generado por un préstamo interno. |
| **Decomiso** | Estado terminal de un empeño no rescatado a tiempo (`estado='decomisado'`). |
| **Liquidación anticipada** | `POST /api/productos/[id]/liquidar` — cierre de un crédito pagando de una vez el saldo de capital pendiente, con `monto_acordado >= saldo_capital_pendiente`. |
| **Modo prueba** | Configuración global (`cred_configuracion.modo_prueba`) que permite registrar pagos con `fecha_pago` futura, usada en QA/demos. |
| **Cliente de prueba** (`es_prueba`) | Cliente marcado como no real; eliminable sin restricciones aunque tenga movimientos, a diferencia de un cliente normal. |
| **Capability token** | Patrón de acceso usado en `/autoregistro/[id]` y `/api/estado/[id]`: el UUID del recurso funciona como credencial de acceso público, sin expiración ni segundo factor — ver hallazgos en [[Auto-registro y Recibos]]. |

---

## Enums y valores controlados

### `cred_productos.tipo` (vía `cred_tipos_prestamo.codigo`)

| codigo | label | comportamiento |
|---|---|---|
| `prestamo` | Préstamo | `prestamo_normal` |
| `venta` | Venta | `prestamo_normal` |
| `empeno` | Empeño | `empeno` |
| `fiado` | Fiado | `cuenta_abierta` |
| `adelanto` | Adelanto | `cuenta_abierta` |
| `congelacion` | Congelación | `prestamo_normal` (tasa forzada a 0) |
| `credito_libre` | Crédito Sin Cuotas | `sin_cuotas_futuras` |

### `cred_productos.estado`

`activo` · `al_dia` · `en_mora` · `saldado` · `decomisado` · `refinanciado`

> ⚠️ `en_mora` y `al_dia` son valores de conveniencia calculados en algunos endpoints, no un contrato estricto en todo el sistema — la fuente de verdad de la mora siempre es `cred_cuotas.fecha_vencimiento`, nunca este campo por sí solo (ver [[Base de Datos]]).

### `cred_productos.metodo_calculo`

`plano` (amortización a capital fijo + interés decreciente, o fijo si `interes_fijo=true`) · `frances` (cuota fija tradicional)

### `cred_productos.periodo_tasa`

`diario` · `semanal` · `quincenal` · `mensual` · `anual` — define `diasBase` en fórmulas de interés (1/7/15/30/360).

### `cred_productos.metodo_desembolso` / `cred_pagos.metodo_pago`

`efectivo` · `transferencia` · `nequi` · `daviplata` · `llave_breb` (solo desembolso) · `otro`

### `cred_cuotas.estado`

`pendiente` · `parcial` · `pagada` — CHECK estricto (`chk_cred_cuotas_estado`, migración 17). **Nunca** `'mora'`.

### `cred_creditos_libres` — `tipo_abono` (en `POST /api/creditos-libres/[id]/abonar`)

`interes` (solo interés del período) · `capital` (abono libre a principal) · `ambos` (interés + capital en un recibo)

### `cred_usuarios.rol`

`admin` · `operador` — **advertencia**: varios endpoints administrativos no verifican este campo antes de ejecutar operaciones sensibles; ver [[Incidentes y Bugs Conocidos]].

### `cred_gastos` / empresas

`es_personal` (boolean) — gasto sin empresa asociada · `cubierto` (boolean) — si el gasto ya fue pagado.

---

## Consecutivos (`cred_configuracion`)

| Clave | Formato | Uso |
|---|---|---|
| `credito_consecutivo` | `CRED-XXXXXX` | Referencia legible de cada producto |
| `recibo_consecutivo` | `REC-XXXXXX` | Número de recibo de cada pago |
| `empresa_consecutivo` | `EMPRE-XXX` | Código de empresa propia |
| `gasto_consecutivo` | `GASTO-XXXXXX` | Referencia de gasto |

Todos usan el mismo patrón de incremento atómico vía `INSERT ... ON CONFLICT (clave) DO UPDATE ... RETURNING`, documentado en [[Base de Datos]].

---

## Convenciones transversales

| Convención | Detalle |
|---|---|
| **30/360** | Convención de interés de [[Créditos Sin Cuotas Futuras]]: cada mes cuenta como 30 días exactos. Fórmula: `(Y2−Y1)×360 + (M2−M1)×30 + (D2−D1)`. |
| **Fechas UTC-5** | Toda fecha `DATE`/`TIMESTAMP` de Postgres se normaliza a `YYYY-MM-DD` antes de enviarse al frontend (`toYMD` o `.toISOString().slice(0,10)`) para evitar el desfase de un día por zona horaria Colombia (UTC-5). |
| **MAYÚSCULAS** | Nombres de clientes, empresas y descripciones de gastos siempre se normalizan a mayúsculas antes de INSERT/UPDATE (migración 20 para clientes). |
| **`2099-12-31`** | Fecha centinela para cuotas de "cuenta abierta" (fiado, adelanto) y para la cuota placeholder de crédito libre — se excluye explícitamente de todo cálculo de mora y capital en calle. |
| **Esquema `administrativo`** | Todas las tablas viven bajo este esquema; el backend usa la constante `const S = 'administrativo'` para calificar cada consulta SQL. |

---

Ver también: [[CLAUDE]] · [[Base de Datos]] · [[API Endpoints]] · [[Incidentes y Bugs Conocidos]]
