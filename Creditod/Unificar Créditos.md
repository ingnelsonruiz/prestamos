# Unificar Créditos

> Endpoint `POST /api/productos/unificar` + UI `/prestamos/unificar`. Consolida **N créditos activos de un mismo cliente** (N:1) en un solo crédito nuevo con condiciones propias, arrastrando únicamente el **capital pendiente real** (nunca el interés no causado). Cada crédito de origen queda `estado='refinanciado'` + `refinanciado_por=<nuevo_id>`, y se deja traza fila-por-fila en `cred_unificaciones` con el `capital_aportado` de cada uno. Distinto de la refinanciación normal (`es_refinanciacion_de`, relación **1:1**) documentada en [[Base de Datos]] y [[Flujos de Negocio]].

---

## 1. Comparación con otros flujos de consolidación

| Flujo | Relación | Campo de traza | Créditos de origen |
|---|---|---|---|
| Refinanciación normal (`POST /api/productos` con `es_refinanciacion_de`) | 1:1 | `cred_productos.es_refinanciacion_de` / `refinanciado_por` | Exactamente 1 |
| **Unificar créditos** (`POST /api/productos/unificar`) | **N:1** | Tabla `cred_unificaciones` (1 fila por origen) | **2 o más** |
| Congelación (`tipo='congelacion'`) | 1:1 | Igual mecanismo que refinanciación, pero fuerza `tasa=0` | Exactamente 1 |

---

## 2. Validaciones del endpoint (`app/api/productos/unificar/route.js`)

Todas ocurren **antes** de abrir la transacción — si algo falla aquí, no hay efectos secundarios parciales.

| Orden | Validación | Código |
|---|---|---|
| 1 | `cliente_id` presente | `if (!cliente_id) → 400 'Falta el cliente'` |
| 2 | Mínimo 2 créditos | `if (!Array.isArray(credito_ids) \|\| credito_ids.length < 2) → 400 'Selecciona al menos 2 créditos para unificar'` |
| 3 | Campos obligatorios del nuevo crédito | `if (!num_cuotas \|\| !fecha_primer_pago) → 400` |
| 4 | Todos los IDs existen | `SELECT * FROM cred_productos WHERE id = ANY($1::text[])` — si `rows.length !== credito_ids.length` → 404 |
| 5 | Todos pertenecen al mismo cliente | por cada fila, `p.cliente_id !== cliente_id` → 400 con la referencia del crédito ofensor |
| 6 | Ninguno está cerrado | `['saldado', 'refinanciado'].includes(p.estado)` → 400 `'El crédito X ya está {estado} y no se puede unificar'` |
| 7 | Capital pendiente total > 0 | ver §3 — si `capitalTotalOrigenes <= 0.5` → 400 |
| 8 | Medio de desembolso válido | mismo patrón que `POST /api/productos`: transferencia/nequi/daviplata/llave_breb exigen `referencia_desembolso` |

> ⚠️ **Un crédito ya refinanciado/unificado NO se puede volver a unificar directamente.** La validación #6 usa la misma lista `['saldado', 'refinanciado']` que el resto del sistema. Si un crédito ya fue absorbido por una refinanciación o unificación previa (`estado='refinanciado'`), intentar incluirlo de nuevo en `credito_ids` devuelve 400 explícito — no falla en silencio ni lo ignora. Para "reabrir" ese capital hay que operar sobre el **crédito nuevo** que lo sucedió (`refinanciado_por`), que sí queda `activo`.

---

## 3. Capital pendiente REAL — cálculo server-side

El endpoint **no confía en cifras enviadas por el cliente**: recalcula el capital pendiente de cada crédito de origen consultando directamente `cred_cuotas`, con la misma fórmula que usa `saldoCapitalDe()` en el frontend (interés primero, todo lo demás es capital puro):

```sql
SELECT * FROM administrativo.cred_cuotas
WHERE producto_id = ANY($1::text[]) AND estado != 'pagada'
```

```js
const capitalPorCredito = Object.fromEntries(credito_ids.map(id => [id, 0]))
for (const c of cuotasRes.rows) {
  const montoPagado   = parseFloat(c.monto_pagado || 0)
  const abonoCapital  = parseFloat(c.abono_capital || 0)
  const abonoInteres  = parseFloat(c.abono_interes || 0)
  const capitalPagado = Math.max(0, montoPagado - abonoInteres)
  capitalPorCredito[c.producto_id] = (capitalPorCredito[c.producto_id] || 0)
    + Math.max(0, abonoCapital - capitalPagado)
}
const capitalTotalOrigenes = Object.values(capitalPorCredito).reduce((s, v) => s + v, 0)
```

Interpretación: de lo pagado en una cuota (`monto_pagado`) se descuenta primero el interés pactado de esa cuota (`abono_interes`); lo que sobra (`capitalPagado`) se resta del `abono_capital` originalmente proyectado. El residuo por cuota, sumado sobre todas las cuotas no `pagada` del crédito, es su capital realmente pendiente. Solo cuotas con `estado != 'pagada'` entran al cálculo (las pagadas ya liquidaron su capital por definición).

> ⚠️ **Créditos `credito_libre` sí son elegibles.** El módulo de "Créditos Sin Cuotas Futuras" (ver [[Créditos Sin Cuotas Futuras]]) usa una cuota placeholder con `abono_interes=0` fijo, así que la fórmula genérica de arriba coincide exactamente con `monto_capital - capital_pagado` (la fórmula propia de ese módulo). Al unificarse, quedan `estado='refinanciado'` igual que cualquier otro origen, y el módulo de créditos libres ya los excluye de "Activos" con ese mismo campo.

Si `capitalTotalOrigenes <= 0.5`, el endpoint rechaza con 400 `'Los créditos seleccionados no tienen capital pendiente para unificar'` (protección contra unificar créditos ya prácticamente saldados).

---

## 4. `monto_inyectado` — dinero nuevo en la unificación

```js
const montoInyectadoSeguro = Math.max(0, parseFloat(monto_inyectado) || 0)
const capitalFinanciar = capitalTotalOrigenes + montoInyectadoSeguro
```

Funciona **igual que en "Refinanciar + prestar más"** (`POST /api/productos` con `es_refinanciacion_de`): el capital del crédito nuevo es la suma del capital consolidado más cualquier dinero adicional entregado al cliente en el mismo acto.

La diferencia frente a `POST /api/productos` es que allí `monto_inyectado` está condicionado explícitamente a que exista `es_refinanciacion_de`:

```js
// POST /api/productos — condicional
const montoInyectadoSeguro = es_refinanciacion_de
  ? Math.max(0, parseFloat(monto_inyectado) || 0)
  : 0
```

En `POST /api/productos/unificar` **no hay ese `if`** — el endpoint es exclusivamente de consolidación, así que `monto_inyectado` siempre se acepta sin condición adicional (defensa mínima: `Math.max(0, ...)` evita negativos).

---

## 5. Armado del crédito nuevo — ¿hereda condiciones o son nuevas?

**Ninguna condición financiera se hereda de los créditos de origen.** El único dato que viaja desde los orígenes es el **capital pendiente**; tasa, período, método de cálculo, número de cuotas y frecuencia son **siempre valores nuevos** que decide quien unifica (con defaults del backend si el body los omite):

| Campo | Origen del valor | Default si falta |
|---|---|---|
| `tipo` | Body (`tipo`) | `'prestamo'` |
| `tasa_interes` | Body (`tasa_interes`) | `0` |
| `periodo_tasa` | Body | `'mensual'` |
| `frecuencia_cobro` | Body | `'mensual'` |
| `num_cuotas` | Body — **obligatorio** | — (400 si falta) |
| `fecha_primer_pago` | Body — **obligatorio** | — (400 si falta) |
| `metodo_calculo` | Body (`metodo_calculo`) | `'plano'` |
| `interes_fijo` | Body, **solo aplica si `metodo_calculo === 'plano'`** | `false` |
| `monto_capital` | **Calculado**: `capitalTotalOrigenes + monto_inyectado` | — |

```js
const tipoSeguro          = tipo || 'prestamo'
const tasaSegura          = parseFloat(tasa_interes) || 0
const metodoCalculoSeguro = metodo_calculo || 'plano'
// Interés fijo solo tiene sentido en método plano (misma regla que POST /api/productos)
const interesFijoSeguro = metodoCalculoSeguro === 'plano' ? interes_fijo === true : false
```

El `INSERT` en `cred_productos` recibe todos estos valores directamente — no hay ningún `JOIN` o lectura que copie `tasa_interes`/`num_cuotas` de los créditos de origen.

Las cuotas del crédito nuevo se generan con el motor genérico `generarCuotas(prod0)` de `lib/calculos.js` (mismo motor que usa la creación normal de préstamos), sobre el `capitalFinanciar` ya consolidado.

---

## 6. Transaccionalidad

Todo el flujo mutante corre dentro de `withTransaction`, igual patrón que la creación/refinanciación normal en `POST /api/productos`:

```js
const { prodRow, cuotas } = await withTransaction(async (q) => {
  // 1. Consecutivo de referencia CRED-XXXXXX (incrementado dentro de la Tx)
  // 2. INSERT del crédito nuevo en cred_productos
  // 3. UPDATE masivo: marca TODOS los orígenes como refinanciado
  // 4. INSERT en cred_unificaciones — una fila por crédito de origen
  // 5. generarCuotas() + INSERT masivo en cred_cuotas
  // 6. INSERT en cred_movimientos_caja (desembolso)
  // 7. INSERT en cred_historial_recalculos (snapshot 'creacion')
  return { prodRow: prod.rows[0], cuotas: cuotasGen }
})
```

Paso 3 — marca **todos** los orígenes en un solo `UPDATE` (no uno por uno):

```sql
UPDATE administrativo.cred_productos
SET estado='refinanciado', refinanciado_por=$1
WHERE id = ANY($2::text[])
```

Paso 4 — una fila de traza por cada origen, con el `capital_aportado` calculado en §3:

```sql
INSERT INTO administrativo.cred_unificaciones
  (id, credito_nuevo_id, credito_origen_id, capital_aportado)
VALUES ($1,$2,$3,$4)
```

Si `generarCuotas()` no produce filas (caso borde `cuotasGen.length === 0`), el flujo igual registra el movimiento de caja del desembolso, sin cuotas ni historial de recálculo.

> ⚠️ **Todo o nada.** Al estar dentro de `withTransaction`, si falla el `INSERT` de cuotas, el movimiento de caja o cualquier paso intermedio, se revierte también el `UPDATE` que marcó los orígenes como `refinanciado` — no puede quedar un crédito "huérfano" (origen cerrado sin su sucesor, o sucesor sin plan de pagos).

El movimiento de caja se registra siempre como `'desembolso'` por el `capitalFinanciar` completo, aunque la mayor parte sea deuda consolidada y no dinero nuevo — mismo criterio que ya aplica "Refinanciar saldo" en todo el sistema:

```sql
INSERT INTO administrativo.cred_movimientos_caja
  (id,tipo,monto,concepto,referencia_id,saldo_acumulado)
VALUES ($1,'desembolso',$2,$3,$4,
  COALESCE((SELECT saldo_acumulado FROM administrativo.cred_movimientos_caja
            ORDER BY fecha DESC LIMIT 1), 0) + $2)
```

La auditoría (`ACCIONES.UNIFICAR_CREDITOS = 'Unificar créditos'`, módulo `PRESTAMOS`) se dispara *fire-and-forget* después de confirmar la transacción, con `detalle.capital_por_credito` guardando el desglose completo.

---

## 7. Trazabilidad posterior — `GET /api/productos/[id]`

El detalle de un crédito consulta `cred_unificaciones` en ambos sentidos:

```sql
-- Si este crédito NACIÓ de unificar varios:
SELECT u.credito_origen_id, u.capital_aportado, u.fecha_creacion,
       p.referencia, p.tipo, p.monto_capital AS monto_capital_origen
FROM administrativo.cred_unificaciones u
JOIN administrativo.cred_productos p ON p.id = u.credito_origen_id
WHERE u.credito_nuevo_id = $1
ORDER BY u.capital_aportado DESC
```

```sql
-- Si este crédito FUE absorbido en una unificación:
SELECT u.credito_nuevo_id, u.capital_aportado, u.fecha_creacion, p.referencia
FROM administrativo.cred_unificaciones u
JOIN administrativo.cred_productos p ON p.id = u.credito_nuevo_id
WHERE u.credito_origen_id = $1
LIMIT 1
```

Se exponen como `unificado_desde[]` y `unificado_en` en la respuesta del endpoint.

---

## 8. Flujo de UI — `/prestamos/unificar/page.js`

1. **Selector de cliente** (`SelectorCliente`, mismo componente de `/prestamos/nuevo`) — búsqueda por nombre o cédula.
2. Al elegir cliente, un `useEffect` llama `GET /api/productos?cliente_id=` y **pre-filtra en el cliente** los elegibles:
   ```js
   const elegibles = lista.filter(p => !['saldado', 'refinanciado'].includes(p.estado))
   ```
3. Para cada elegible, hace `GET /api/productos/[id]` (trae sus `cuotas`) y calcula el saldo pendiente **con la fórmula idéntica a la del backend** (`saldoCapitalDe`), para que el número mostrado al usuario coincida con el que el servidor va a consolidar:
   ```js
   function saldoCapitalDe(detalle) {
     return (detalle.cuotas || []).filter(c => c.estado !== 'pagada').reduce((s, c) => {
       const montoPagado = parseFloat(c.monto_pagado || 0)
       const abonoCapital = parseFloat(c.abono_capital || 0)
       const abonoInteres = parseFloat(c.abono_interes || 0)
       const capitalPagado = Math.max(0, montoPagado - abonoInteres)
       return s + Math.max(0, abonoCapital - capitalPagado)
     }, 0)
   }
   ```
4. Se descartan además los créditos con `saldoCapitalPendiente <= 0.5` (`filter(c => c.saldoCapitalPendiente > 0.5)`).
5. Lista con **checkboxes** — el usuario marca 2 o más créditos (`toggleSeleccion`).
6. Con `seleccionados.size >= 2` aparece el bloque de consolidación:
   - **Capital pendiente consolidado** = suma de `saldoCapitalPendiente` de los marcados (solo lectura).
   - **Dinero nuevo a prestar** (opcional) — input `InputMiles` → `monto_inyectado`.
   - **Capital total del nuevo crédito** = suma de ambos (`capitalNuevo`).
7. Formulario de condiciones del crédito nuevo: `tipo` (solo `prestamo` / `empeno` / `venta` — **no** se puede elegir `fiado`, `adelanto`, `congelacion` ni `credito_libre` como resultado de unificar), `metodo_calculo` (plano/francés), `tasa_interes`, `periodo_tasa`, `num_cuotas`, `frecuencia_cobro`, `fecha_primer_pago`, checkbox de "Congelar intereses" (`interes_fijo`, solo visible en método plano) y `notas` (si se deja vacío, el backend genera una descripción automática con la lista de créditos unificados).
8. Bloque "¿Cómo se entregó el dinero?": `fecha_desembolso`, `metodo_desembolso` y, si no es efectivo, `entidad_desembolso` / `referencia_desembolso`.
9. **Vista previa de amortización** (`cuotasPreview`) — se recalcula en cada cambio con un `useEffect` que llama directamente `calcularInteresPlano` o `calcularFrances` de `lib/calculos.js` sobre `capitalNuevo`, usando IDs ficticios `'preview'`; **no escribe nada en BD**, es solo referencia visual antes de confirmar. Muestra Total a pagar, Total intereses, Cuota estándar y la tabla completa de cuotas proyectadas.
10. Al confirmar (`guardar`), valida en cliente (cliente seleccionado, ≥2 créditos, referencia de desembolso si aplica) y hace `POST /api/productos/unificar` con el payload completo (`cliente_id`, `credito_ids`, condiciones nuevas, `monto_inyectado`, datos de desembolso). Si responde `ok`, redirige a `/prestamos/[data.producto.id]` (el crédito nuevo); si falla, muestra `data.error` inline.

---

## 9. Callouts críticos

> ⚠️ **Riesgo de doble/triple conteo en KPIs si se omite el filtro de `estado`.** El sistema ya sufrió y corrigió este patrón en `estado_calculado` (`GET /api/clientes`) y en `kpis.total_invertido` del dashboard (`app/api/dashboard/route.js`, comentario: *"el refinanciado original se omite para no duplicar con su sucesor"*), ambos filtrando explícitamente `p.estado NOT IN ('saldado','decomisado','refinanciado')` o `p.estado <> 'refinanciado'`. Con **Unificar Créditos el riesgo se agrava**: cada unificación deja **N filas** en `estado='refinanciado'` apuntando al mismo `refinanciado_por`. Cualquier reporte nuevo que sume `monto_capital` sobre `cred_productos` sin excluir `'refinanciado'` no duplicaría el capital — lo **multiplicaría por N+1** (los N orígenes más el consolidado). Todo informe que agregue capital por cliente/cartera debe replicar el mismo filtro que ya usan `dashboard/route.js`, `clientes/route.js` y `productos/route.js`.

> ⚠️ **Créditos cerrados no se pueden reingresar a una unificación.** `['saldado', 'refinanciado'].includes(p.estado)` → 400 explícito, sin fallback silencioso. No existe "unificar una unificación" tomando directamente el origen ya cerrado; hay que operar sobre el crédito **nuevo** resultante (que sí queda `activo`).

> ⚠️ **El backend nunca confía en el capital que calcula el frontend.** Aunque `/prestamos/unificar` muestra el saldo pendiente con la fórmula exacta del servidor (para que la UX sea consistente), el endpoint **siempre** vuelve a calcularlo consultando `cred_cuotas` en el momento de la escritura — protección contra condiciones de carrera (pagos registrados entre que el usuario abre la pantalla y confirma).

> ⚠️ **Ninguna condición financiera se hereda del origen.** Tasa, período, método de cálculo, número de cuotas y frecuencia de cobro son siempre nuevos, decididos por el usuario en el formulario (con defaults de backend si faltan) — solo el **capital** viaja desde los créditos de origen.

---

Ver también: [[Base de Datos]] (esquema de `cred_productos`, `cred_cuotas`, `cred_unificaciones`), [[Flujos de Negocio]] (refinanciación, congelación, interés fijo), [[API Endpoints]] (catálogo de rutas) y [[CLAUDE]] (reglas críticas del sistema, §21 unificación).
