# API Endpoints

Catálogo completo de los Route Handlers del backend Next.js. Todas las rutas bajo `/api/` requieren autenticación JWT (cookie `itl_session`) salvo las marcadas como **PÚBLICO**.

---

## 🔐 Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Genera sesión JWT en cookie HttpOnly `itl_session` (8 h) |
| POST | `/api/auth/logout` | Invalida la sesión limpiando la cookie |
| GET | `/api/auth/me` | Retorna datos del usuario autenticado |

---

## 👥 Clientes

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/clientes?q=&solo_prueba=` | Búsqueda flexible. Devuelve `estado_calculado` dinámico. `solo_prueba=true` filtra clientes de prueba |
| POST | `/api/clientes` | Registra nuevo cliente. 409 si el documento ya existe |
| GET | `/api/clientes/[id]` | Detalle con productos y métricas: `total_cuotas`, `cuotas_pagadas`, `cuotas_pendientes`, `cuotas_mora`, `saldo_total` |
| PUT | `/api/clientes/[id]` | Edita datos del cliente |
| DELETE | `/api/clientes/[id]` | Elimina si no tiene productos |

### Auto-registro público

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/registro?documento=` | **PÚBLICO**. Verifica si una cédula ya existe. Retorna `{ existe: bool }` |
| POST | `/api/registro` | **PÚBLICO**. Crea cliente con validaciones estrictas (nombre, documento, teléfono, email). Retorna errores por campo `{ error, errores: { campo: 'msg' } }`. `es_prueba=FALSE` siempre |

---

## 💰 Productos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/productos?cliente_id=` | Lista productos. Incluye `capital_pendiente_real`, `interes_pendiente`, `cuotas_mora`, `ref_nuevo`, `ref_origen` |
| POST | `/api/productos` | Crea crédito, genera cuotas, desembolso en caja, snapshot inicial. Rechaza 400 si `tipo='credito_libre'` (usar `/api/creditos-libres`) |
| GET | `/api/productos/[id]` | Detalle del producto |
| PUT | `/api/productos/[id]` | Edita producto |
| POST | `/api/productos/[id]/liquidar` | Liquidación anticipada. Body: `{ monto_acordado, metodo_pago, notas, fecha_pago }`. Valida `monto_acordado >= saldo_capital_pendiente` |

---

## 📝 Cuotas y Pagos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/cuotas?estado=&cliente_id=&producto_id=` | Cuotas de cobro. Incluye `telefono_cliente`, `fecha_creacion`, `monto_capital` |
| POST | `/api/pagos` | Procesa abono con `Promise.all` paralelo (sin transacción global). Incremento atómico de recibo. Ejecuta `recalcularCuotasPlano` post-pago |
| GET | `/api/pagos?producto_id=&cliente_id=&fecha=YYYY-MM-DD` | Historial. `fecha` activa arqueo de caja |
| GET | `/api/recibos?q=` | Busca recibo por `REC-000001` o número simple. Retorna datos completos del pago, cuota, cliente y producto |

---

## 📊 Dashboard

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dashboard` | KPIs globales. Ver estructura de respuesta abajo |
| GET | `/api/dashboard/capital-detalle` | Desglose de "Capital en la calle" por cliente/crédito (foto del saldo actual, sin filtro de fechas) |
| GET | `/api/dashboard/intereses-detalle` | Desglose de intereses proyectados. Retorna `{ normales[], libres[], totales }` — ver abajo |
| GET | `/api/dashboard/intereses-recogidos-detalle` | Desglose de intereses ya cobrados por crédito. Retorna `{ normales[], libres[], totales }` (mismo formato que `intereses-detalle`, corregido 2026-08-05 — ver abajo) |

### Estructura de respuesta `GET /api/dashboard`

Acepta `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (ambos requeridos para activar el rango).

```js
{
  cartera: {
    capital_activo, capital_saldado, capital_mora, capital_refinanciado,
    num_activos, num_saldados, num_mora, num_refinanciados
  },
  intereses: {
    hoy, semana, mes, total, rango,         // intereses YA COBRADOS (normales + retornos + libres)
    intereses_prestamos,                     // desglose: solo préstamos normales
    intereses_retornos,                      // desglose: retornos de empresas
    intereses_creditos_libres,               // desglose: créditos libres ya cobrados
  },
  mora: { clientes_total, clientes_30d, monto_total, monto_0_30d, monto_31_60d, monto_mas60d },
  recaudo: { hoy, semana, mes, total, rango, rango_pagos },
  cartera_vencida: { vencio_hoy, vencio_semana, vencio_mes, mas_30d, total },
  capital: {
    en_calle,                                // cuotas normales pendientes + capital libres
    intereses_proyectados,                   // solo créditos normales (cuotas futuras)
    intereses_libres_proyectados,            // créditos libres calculados 30/360 hasta `hasta`. 0 si no hay rango
    intereses_libres_fecha_corte,            // fecha `hasta` usada. null si no hay rango
    intereses_proyectados_total,             // normales + libres (el que muestra el KPI)
    detalle_libres_proyectados,              // array por crédito libre con: referencia, capital_pendiente,
                                             //   inicio_periodo, fecha_corte, dias_calculados, interes_proyectado
  },
  creditos_libres: { cantidad, capital_pendiente, intereses_cobrados },
  kpis: { total_invertido, num_creditos, total_recuperado, capital_en_calle },
  rango,                                     // { desde, hasta } o null
  cuotas_hoy, cuotas_semana, empenos_vencer, otros_rubros
}
```

### Estructura de respuesta `GET /api/dashboard/intereses-detalle`

Acepta `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`. Antes retornaba un array plano; ahora retorna un objeto con tres secciones:

```js
{
  normales: [                   // créditos con cuotas programadas
    {
      cliente_id, nombre_cliente, documento,
      producto_id, referencia, tipo_producto, monto_capital,
      cuotas_pendientes, proxima_fecha,
      interes_proyectado        // suma de abono_interes pendiente en cuotas
    }
  ],
  libres: [                     // créditos sin cuotas — solo si hay fecha hasta
    {
      cliente_id, nombre_cliente, documento,
      producto_id, referencia,
      tasa_interes, periodo_tasa,
      capital_pendiente,
      inicio_periodo,           // último fecha_corte_interes o fecha_primer_pago
      fecha_corte,              // la fecha `hasta` del rango
      dias_calculados,          // diasD360(inicio_periodo, fecha_corte)
      interes_proyectado        // calculado en JS con convención 30/360
    }
  ],
  totales: {
    interes_normales,
    interes_libres,
    total,
    fecha_corte_libres          // fecha hasta usada para libres
  }
}
```

> **Retrocompatibilidad**: el frontend usa `detalleIntereses.normales ?? detalleIntereses ?? []` para soportar tanto la respuesta nueva (objeto) como la vieja (array plano).

### Estructura de respuesta `GET /api/dashboard/intereses-recogidos-detalle`

Mismo formato `{ normales[], libres[], totales }` que `intereses-detalle`, adoptado el 2026-08-05:

```js
{
  normales: [ { cliente_id, nombre_cliente, documento, producto_id, referencia,
                tipo_producto, monto_capital, num_pagos, ultimo_pago, interes_cobrado } ],
  libres:   [ { ...mismos campos... } ],   // créditos tipo credito_libre
  totales: { interes_normales, interes_libres, total }
}
```

> **Retrocompatibilidad**: el frontend usa `detalleRecogidos.normales ?? detalleRecogidos ?? []`, igual patrón que `intereses-detalle`.

> ⚠️ **Bug corregido (2026-08-05) — el modal "Detalle de intereses recogidos" no cuadraba con el KPI "Intereses recogidos"**: la card grande del dashboard (`GET /api/dashboard`, campo `intereses.total`/`.rango`) ya sumaba correctamente tres fuentes — `intereses_prestamos` (créditos normales, vía `cu.abono_interes`), `intereses_retornos` (retornos de empresas propias) e `intereses_creditos_libres` (créditos sin cuotas, tomado de `pg.monto_interes` porque su cuota placeholder tiene `abono_interes=0` fijo — el propio código de `GET /api/dashboard` ya traía un comentario documentando exactamente esta razón, query "16"). Pero `GET /api/dashboard/intereses-recogidos-detalle` (el que alimenta el modal de doble clic) solo implementaba la fórmula de créditos normales (`LEAST(pg.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota,0)`) contra **todos** los productos sin excluir `credito_libre` — que por el `abono_interes=0` siempre aportaba `$0` y quedaba fuera del `HAVING > 0` — y no tocaba `cred_retornos_empresa` en absoluto. Resultado: el tile mostraba el total real (ej. $5.480.010) pero el detalle solo sumaba los créditos normales (ej. $2.223.050), sin mostrar ni explicar la diferencia.
> **Fix**: se separó `intereses-recogidos-detalle` en dos queries — `normales` (excluye `credito_libre`, misma fórmula de antes) y `libres` (créditos `credito_libre`, interés tomado de `pg.monto_interes`) — devueltas en el mismo formato `{ normales, libres, totales }` que ya usaba `intereses-detalle`, con dos tablas separadas en el modal (📋 normales / 📅 sin cuotas) más un resumen de subtotales, igual patrón visual que el modal de intereses proyectados. **Los retornos de empresas propias (`intereses_retornos`) siguen sin desglosarse en este modal** — si `ir.total` > 0 en el rango, el tile seguirá mostrando un total ligeramente mayor a `normales + libres` del modal; pendiente agregar una tercera sección si se necesita trazabilidad completa.
> **De paso**: se cambió el `JOIN cred_clientes` a `LEFT JOIN` con fallback a `cred_empresas_propias` (vía `p.empresa_id` cuando `es_prestamo_interno=TRUE`) en ambas queries — antes un `INNER JOIN` descartaba silenciosamente los intereses cobrados en préstamos internos a empresas propias (`cliente_id NULL` desde la migración 25).
> **Patrón a vigilar**: cualquier cálculo de interés cobrado/pendiente que dependa de `cred_cuotas.abono_interes` da `0` para `tipo='credito_libre'` — su cuota es solo un placeholder de trazabilidad (ver `Créditos Sin Cuotas Futuras.md`). El interés real de ese tipo siempre debe leerse de `cred_pagos.monto_interes`.

---

## 🏢 Empresas propias

Ver [[Empresas y Gastos]] para la documentación completa del módulo.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/empresas` | Lista con KPIs: `saldo_prestamos`, `total_gastos`, `total_retornos_capital`, `total_retornos_interes`, `total_retornos` |
| POST | `/api/empresas` | Crea empresa. Body: `{ nombre, descripcion, nit }`. Genera `EMPRE-XXX`. 409 si nombre o NIT duplicado |
| DELETE | `/api/empresas` | Body: `{ id }`. 409 si tiene préstamos o gastos |
| PUT | `/api/empresas/[id]` | Edita `nombre`, `descripcion`, `activo` |
| DELETE | `/api/empresas/[id]` | Elimina si no tiene gastos; si tiene, retorna 400 |
| GET | `/api/empresas/[id]/retornos` | Lista retornos de la empresa por `fecha_retorno DESC` |
| POST | `/api/empresas/[id]/retornos` | Body: `{ monto_capital, monto_interes, fecha_retorno, notas, producto_id }` |
| DELETE | `/api/empresas/[id]/retornos` | Body: `{ retorno_id }` |

---

## 💸 Gastos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/gastos?empresa_id=&fecha_desde=&fecha_hasta=&personal=true` | Lista gastos con JOIN a tipos y empresas |
| POST | `/api/gastos` | Body: `{ empresa_id, tipo_gasto_id, descripcion, monto, fecha_gasto, es_personal, notas }`. Genera `GASTO-XXXXXX`. `descripcion` en MAYÚSCULAS |
| PATCH | `/api/gastos` | Body: `{ id, cubierto: bool }`. Marca/desmarca cubierto. Registra `fecha_cubierto` |
| DELETE | `/api/gastos/[id]` | Elimina. 404 si no existe |

---

## 🗂️ Tipos de gasto

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tipos-gasto` | Lista tipos por `orden, nombre`. Auto-inicializa 7 base si la tabla está vacía |
| POST | `/api/tipos-gasto` | Body: `{ nombre }`. Crea tipo personalizado en MAYÚSCULAS, `es_sistema=FALSE` |

---

## 📅 Créditos Sin Cuotas Futuras

Módulo completamente independiente. No llama `/api/pagos`. Ejecuta `autoMigrar()` al inicio de cada request.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/creditos-libres` | Lista con KPIs: `capital_pagado`, `capital_pendiente`, `intereses_pagados`, `ultima_fecha_corte`, `dias_sin_corte` |
| POST | `/api/creditos-libres` | Crea crédito libre: producto + cuota placeholder `2099-12-31` + desembolso en caja |
| GET | `/api/creditos-libres/[id]` | Detalle con historial de pagos, `fecha_corte_interes` y `fecha_desde_periodo`. Fechas a `YYYY-MM-DD` |
| GET | `/api/creditos-libres/[id]/calcular?fecha_corte=YYYY-MM-DD` | Proyecta interés (solo lectura, 30/360). Rechaza si `dias < 1` |
| POST | `/api/creditos-libres/[id]/abonar` | Body: `{ tipo_abono, fecha_corte, monto_interes, monto_capital, metodo_pago, notas }`. `tipo_abono`: `interes`, `capital`, `ambos`. Valida `fecha_corte > último corte` |

---

## ⚙️ Configuración

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/configuracion/tipos` | Lista tipos de préstamo. Auto-inicializa con 5 base si vacía |
| POST | `/api/configuracion/tipos` | Crea tipo dinámico. Genera `codigo` slug del `label`. 409 si existe |
| PUT | `/api/configuracion/tipos/[id]` | Edita label, icono, descripción, comportamiento, activo, orden |
| DELETE | `/api/configuracion/tipos/[id]` | `es_sistema` → 403. Con productos activos → solo desactiva. Sin uso → elimina |
| GET | `/api/config/modo-prueba` | Retorna `{ activo: bool }` |
| POST | `/api/config/modo-prueba` | Body: `{ activo: bool }`. DELETE + INSERT con UUID |

---

## 🗄️ Migración y Backup

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/migracion` | Importación masiva desde Excel. Crea clientes + saldos como cuentas abiertas |
| POST | `/api/migracion/cargue-inicial` | Legalizar créditos existentes. Fuerza `tasa=0` / `con_interes=false` si `tipo='congelacion'` |
| POST | `/api/migracion/reset` | Borra datos operativos. Conserva clientes y usuarios |
| POST | `/api/migracion/reset-cliente` | Body: `{ clienteId, productoIds? }`. Sin `productoIds` borra todos; con ids borra solo esos (borrado parcial) |
| GET | `/api/backup` | Exporta JSON completo + registra en `cred_backups` |
| POST | `/api/backup` | Restaura desde JSON (TRUNCATE + INSERT batch). No sobreescribe al usuario actual |
| POST | `/api/backup/estructura` | Recrea estructura SQL idempotente. Solo admin |
| GET | `/api/backup/historial` | Últimos 50 backups. `[]` si la tabla no existe |

---

## 🔧 Sistema y utilidades

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Healthcheck: `SELECT 1`. Retorna `{ ok, ms }` o 503 |
| GET | `/api/historial?producto_id=` | Retorna `{ recalculos, pagos, cuotasTodas }` de un crédito |
| GET | `/api/estado/[id]` | **PÚBLICO**. Estado de cuenta con productos, métricas y últimos 10 pagos |
| GET | `/api/informes` | KPIs históricos + resumen mensual + detalle de pagos |
| GET/PUT/DELETE | `/api/usuarios/[id]` | Gestión de usuarios (solo admin) |
| GET | `/api/auditoria` | Log de auditoría con filtros |

---

## Convenciones de respuesta

- **Error de BD**: `{ error: error.message }` status 500.
- **Duplicado**: status 409.
- **No encontrado**: status 404.
- **Validación fallida**: status 400 con `{ error, errores? }`.
- **Sin permisos de rol**: status 403.
- **Fechas DATE/TIMESTAMP de pg**: normalizar siempre a `YYYY-MM-DD` antes de enviar al frontend (helper `toYMD` o `v.toISOString().slice(0,10)`) para evitar desfase UTC-5 Colombia.
