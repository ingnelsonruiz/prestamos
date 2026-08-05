# Dashboard y KPIs

> `GET /api/dashboard` es el endpoint más pesado del backend: 16 queries SQL disparadas en paralelo con un único `Promise.all`, más lógica JS (30/360) para los Créditos Sin Cuotas Futuras. Dos endpoints satélite — `/api/dashboard/capital-detalle` e `/api/dashboard/intereses-detalle` — repiten las mismas fórmulas a nivel de crédito individual para alimentar los modales de doble clic del frontend. Esta nota documenta la lógica SQL/JS real detrás de cada KPI, no solo la forma del JSON (eso ya está en [[API Endpoints]]).

Archivos cubiertos:
- `app/api/dashboard/route.js` (~28 KB, 16 queries + cálculo 30/360 en JS)
- `app/api/dashboard/capital-detalle/route.js`
- `app/api/dashboard/intereses-detalle/route.js`

Ver también [[API Endpoints]] (estructura de respuesta y el endpoint hermano `intereses-recogidos-detalle`, con su bug corregido el 2026-08-05), [[Base de Datos]] (diccionario de columnas), [[Créditos Sin Cuotas Futuras]] (motor 30/360 y reglas del módulo) y [[Empresas y Gastos]] (tabla `cred_retornos_empresa`).

---

## 0. Estructura general del handler

`GET` acepta `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (ambos requeridos; si solo llega uno se ignora el rango completo):

```js
const rangoValido = /^\d{4}-\d{2}-\d{2}$/
desde = rangoValido.test(desde || '') ? desde : null
hasta = rangoValido.test(hasta || '') ? hasta : null
const hayRango = Boolean(desde && hasta)
if (!hayRango) { desde = null; hasta = null }
```

Las 16 queries corren con `Promise.all`, es decir **no comparten transacción ni snapshot de BD** — si un pago se registra a mitad de ejecución, unos KPIs pueden reflejarlo y otros no. En un dashboard de solo lectura refrescado a demanda esto es aceptable, pero es la causa raíz de cualquier inconsistencia puntual entre dos tarjetas que en teoría deberían cuadrar (ver mora vs cartera_vencida más abajo).

`fechaStr()` normaliza las columnas `DATE` que `pg` devuelve como `Date` (medianoche UTC) a un string plano `YYYY-MM-DD`, porque el frontend hace `new Date(fecha + 'T12:00:00')` y una fecha con hora ISO completa (`...T00:00:00.000Z`) rompe esa concatenación:

```js
const fechaStr = (v) => {
  if (v instanceof Date) {
    return v.getUTCFullYear() + '-' + String(v.getUTCMonth() + 1).padStart(2, '0') + '-' + String(v.getUTCDate()).padStart(2, '0')
  }
  return v
}
```

Se aplica solo a `cuotas_hoy`, `cuotas_semana` y `empenos_vencer` — las fechas usadas internamente para cálculos (mora, cartera_vencida) nunca salen al frontend, así que no lo necesitan.

---

## 1. Cartera — `cartera.*` (capital_activo / saldado / mora / refinanciado)

La mora **no se lee de una columna**, se detecta dinámicamente comparando `fecha_vencimiento` contra `CURRENT_DATE` en una CTE:

```sql
WITH mora_por_producto AS (
  SELECT DISTINCT producto_id
  FROM administrativo.cred_cuotas
  WHERE fecha_vencimiento < CURRENT_DATE
    AND estado IN ('pendiente','parcial')
    AND fecha_vencimiento != '2099-12-31'
)
SELECT
  SUM(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
    AND mpm.producto_id IS NULL     THEN p.monto_capital END) AS capital_activo,
  SUM(CASE WHEN p.estado = 'saldado' THEN p.monto_capital END) AS capital_saldado,
  SUM(CASE WHEN p.estado IN ('activo','al_dia','en_mora')
    AND mpm.producto_id IS NOT NULL THEN p.monto_capital END) AS capital_mora,
  SUM(CASE WHEN p.estado = 'refinanciado' THEN p.monto_capital END) AS capital_refinanciado
  -- + COUNT(...) análogos para num_activos / num_saldados / num_mora / num_refinanciados
FROM administrativo.cred_productos p
LEFT JOIN mora_por_producto mpm ON mpm.producto_id = p.id
WHERE p.tipo NOT IN ('fiado','adelanto','congelacion')
```

Lógica: un producto "activo" (`estado` en `activo/al_dia/en_mora` — el campo `estado` en sí **no** se usa para decidir mora) cae en `capital_mora` si `producto_id` aparece en la CTE (tiene al menos una cuota vencida en `pendiente`/`parcial`); si no aparece, cae en `capital_activo`. El monto sumado es siempre `p.monto_capital` (el capital **original** del crédito, no el saldo pendiente) — esto es un conteo de cartera por "cubeta de estado", no un saldo real; para saldo real ver la sección [Capital](#6-capital--encalle-e-intereses-proyectados-normales-vs-libres-30360).

> ⚠️ **Riesgo — Créditos Sin Cuotas Futuras inflan `capital_activo`, nunca caen en `capital_mora`.** El filtro `p.tipo NOT IN ('fiado','adelanto','congelacion')` **no excluye** `credito_libre`. Como su única fila en `cred_cuotas` es el placeholder con `fecha_vencimiento = '2099-12-31'` (excluido explícitamente de la CTE de mora), un crédito libre activo **siempre** cuenta en `capital_activo` y **nunca** en `capital_mora`, sin importar cuántos días lleve sin corte de intereses. Además, el monto sumado es `monto_capital` (el desembolso original completo), no el capital realmente pendiente tras abonos parciales — a diferencia de `creditos_libres.capital_pendiente` (sección 7) que sí descuenta abonos. Es decir: la misma cifra "capital activo" del dashboard mezcla saldos reales (créditos normales, vía estado de cuotas) con montos originales sin descontar pagos (créditos libres). La mora real de créditos libres se expone aparte en `creditos_libres_mora` (sección 8) — quien lea solo `cartera.capital_mora` la está subestimando sistemáticamente.

---

## 2. Intereses — `intereses.*` (tres fuentes, tres queries independientes)

El JSON final es la **suma en JS** de tres queries SQL completamente separadas — el propio código lo explica en los comentarios de cada una:

| Fuente | Query | Por qué es aparte |
|---|---|---|
| Préstamos normales (cuotas) | #2 — `cu.abono_interes` vía `cred_pagos` JOIN `cred_cuotas` | Requiere prorratear por sobrepago |
| Retornos de empresas propias | #12 — `cred_retornos_empresa.monto_interes` | *"no pasan por `cred_pagos`"* |
| Créditos Sin Cuotas Futuras | #16 — `cred_pagos.monto_interes` directo | La fórmula de #2 da 0 para estos pagos |

**2a. Préstamos normales:**

```sql
SELECT
  SUM(CASE WHEN p.fecha_pago::date = $1
    THEN LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0) END) AS hoy,
  -- análogos para semana / mes / total / rango
FROM administrativo.cred_pagos p
JOIN administrativo.cred_cuotas cu ON cu.id = p.cuota_id
```

Comentario del código: *"`LEAST(p.monto, cu.monto_cuota)` evita sobrecontar en casos de sobrepago"*. La fórmula prorratea el interés de la cuota (`cu.abono_interes`) según qué proporción del `monto_cuota` cubrió ese pago puntual (`p.monto`), capado a 1 (`LEAST`) para que un pago que excede la cuota (sobrepago) no genere más interés del que la cuota realmente tenía asignado. Esta query **no filtra por `p.tipo`** de producto.

**2b. Retornos de empresas propias:**

```sql
SELECT
  SUM(CASE WHEN r.fecha_retorno = $1::date THEN r.monto_interes END) AS hoy,
  -- semana / mes / total / rango
FROM administrativo.cred_retornos_empresa r
```

Va envuelta en `.catch(() => ({ rows: [{ hoy:0, semana:0, mes:0, total:0, rango:0 }] }))` — degrada a ceros si la tabla no existe en un entorno viejo, en vez de tumbar todo el dashboard.

**2c. Créditos Sin Cuotas Futuras:**

```sql
SELECT
  SUM(CASE WHEN pg.fecha_pago::date = $1 THEN pg.monto_interes END) AS hoy,
  -- semana / mes / total / rango
FROM administrativo.cred_pagos pg
JOIN administrativo.cred_productos p ON p.id = pg.producto_id
WHERE p.tipo = 'credito_libre' AND pg.monto_interes > 0
```

Comentario del código: *"La fórmula estándar (Query 2) da 0 para estos pagos porque usa `cu.abono_interes / cu.monto_cuota`, y el placeholder tiene `abono_interes=0`"*. Por eso se lee `monto_interes` directo del pago en vez de derivarlo de la cuota.

**Combinación final en JS:**

```js
intereses: {
  hoy:    parseFloat(ip.hoy)    + parseFloat(ir.hoy    || 0) + parseFloat(il.hoy    || 0),
  // ...
  intereses_prestamos:       parseFloat(ip.total),
  intereses_retornos:        parseFloat(ir.total || 0),
  intereses_creditos_libres: parseFloat(il.total || 0),
}
```

> ⚠️ **Riesgo — filtrado asimétrico de tipos entre queries.** La query 2a (préstamos) no excluye `fiado`, `adelanto` ni `congelacion` como sí lo hacen la cartera (§1) y los KPIs históricos (§9). Si alguna cuota de esos tipos llegara a tener `abono_interes > 0` (por ejemplo una `congelacion`, cuyo `monto_capital` según el propio comentario del código *"incluye interés viejo"*), ese interés se sumaría a `intereses.total` mientras su capital está excluido de `cartera.capital_activo` — dos KPIs del mismo dashboard describiendo universos de productos ligeramente distintos. No se detectó evidencia de que esto ocurra hoy (las cuentas abiertas normalmente tienen `con_interes=false`), pero es una inconsistencia estructural a vigilar si se agregan más tipos de producto.
>
> **✅ Corregido (2026-08-05) — variante de este mismo riesgo, confirmada contra la BD real**: la query 2 tampoco excluía `credito_libre`. Se verificaron 11 créditos libres en producción cuya cuota placeholder está mal formada (`abono_interes > 0` real, en vez del `0` fijo esperado — ver [[Créditos Sin Cuotas Futuras]]), causando doble conteo de interés (ya contado también en `intereses_creditos_libres` vía `pg.monto_interes`). Se agregó `JOIN cred_productos` + `WHERE tipo != 'credito_libre'` a la query 2. Detalle completo, impacto medido y lista de créditos afectados en [[Incidentes y Bugs Conocidos]].

El endpoint hermano `GET /api/dashboard/intereses-recogidos-detalle` desglosa estas tres fuentes por crédito individual; su documentación completa (incluye el bug corregido el 2026-08-05 sobre créditos sin cuotas sin corte y retornos de empresa) está en [[API Endpoints]].

---

## 3. Mora — `mora.*` (rangos de antigüedad 0-30 / 31-60 / +60)

```sql
SELECT
  COUNT(DISTINCT CASE WHEN cu.fecha_vencimiento < $1::date
    AND cu.estado IN ('pendiente','parcial')
    THEN cu.cliente_id END) AS clientes_total,
  COUNT(DISTINCT CASE WHEN cu.fecha_vencimiento < $1::date
    AND cu.estado IN ('pendiente','parcial')
    AND ($1::date - cu.fecha_vencimiento) > 30
    THEN cu.cliente_id END) AS clientes_30d,
  SUM(CASE WHEN ... THEN cu.monto_cuota - cu.monto_pagado END)                                    AS monto_total,
  SUM(CASE WHEN ... AND ($1::date - cu.fecha_vencimiento) <= 30      THEN ... END)                AS monto_0_30d,
  SUM(CASE WHEN ... AND ($1::date - cu.fecha_vencimiento) BETWEEN 31 AND 60 THEN ... END)          AS monto_31_60d,
  SUM(CASE WHEN ... AND ($1::date - cu.fecha_vencimiento) > 60        THEN ... END)                AS monto_mas60d
FROM administrativo.cred_cuotas cu
WHERE cu.fecha_vencimiento != '2099-12-31'
```

Comentario del código: *"Usa comparación de fechas — NO usa `estado='mora'` que no se auto-asigna"* (consistente con la regla documentada en [[Base de Datos]]: `cred_cuotas.estado` solo admite `pendiente`/`parcial`/`pagada` por CHECK). El monto en mora de cada cuota es `monto_cuota - monto_pagado` (saldo pendiente de la cuota, no del crédito completo), y la antigüedad es `$1::date - cu.fecha_vencimiento` en días calendario reales. `clientes_30d` solo cuenta clientes con **al menos una** cuota a más de 30 días — no hay un desglose de clientes por las tres cubetas, solo de montos.

> ⚠️ **Cross-check con `cartera_vencida`.** `mora.monto_total` (aquí) y `cartera_vencida.total` (sección 5) parten de la misma condición base (`estado IN ('pendiente','parcial')` y `fecha_vencimiento < hoy`, excluyendo el placeholder `2099-12-31`) y por lo tanto **deberían ser matemáticamente idénticos** — son dos vistas (por antigüedad vs por período calendario de vencimiento) del mismo universo de cuotas. Si en producción llegan a divergir, es señal de un problema real (p.ej. una de las dos queries corriendo contra un snapshot distinto por la falta de transacción compartida del `Promise.all`), no una diferencia de negocio esperada.
>
> **✅ Corregido (2026-08-05) — esta query SÍ tenía el problema estructural, confirmado contra la BD real, no solo teórico.** Ni esta query ni la de `cartera_vencida` (§5) hacían `JOIN` a `cred_productos`, así que no podían excluir créditos ya `refinanciado`/`saldado`/`decomisado` (mismo patrón del bug de "clientes en mora" corregido antes en `/api/clientes`, nunca replicado aquí) ni créditos `tipo='credito_libre'` con cuota mal formada (ver riesgo de la sección 2). Impacto medido en producción: **$87.777.732 de mora falsa** ($35.583.932 de créditos refinanciados + $56.088.800 de créditos libres, de un total reportado de $318.940.552 — el 27,5%). Se agregó `JOIN cred_productos p` + `AND p.estado NOT IN ('saldado','decomisado','refinanciado') AND p.tipo != 'credito_libre'` a ambas queries. Detalle completo, metodología de verificación y lista de créditos afectados en [[Incidentes y Bugs Conocidos]].

---

## 4. Recaudo — `recaudo.*`

```sql
SELECT
  SUM(CASE WHEN fecha_pago::date = $1                             THEN monto END) AS hoy,
  SUM(CASE WHEN fecha_pago::date >= DATE_TRUNC('week',  $1::date) THEN monto END) AS semana,
  SUM(CASE WHEN fecha_pago::date >= DATE_TRUNC('month', $1::date) THEN monto END) AS mes,
  SUM(monto) AS total,
  SUM(CASE WHEN $2::date IS NOT NULL AND fecha_pago::date BETWEEN $2::date AND $3::date THEN monto END) AS rango,
  COUNT(CASE WHEN $2::date IS NOT NULL AND fecha_pago::date BETWEEN $2::date AND $3::date THEN 1 END) AS rango_pagos
FROM administrativo.cred_pagos
```

Es el único KPI de dinero que suma `monto` (el recibo completo: capital + interés) sin ningún `JOIN` ni filtro de `tipo` de producto — incluye pagos de **todos** los tipos de crédito, incluyendo `fiado`, `adelanto` y `congelacion` que sí están excluidos en cartera y KPIs históricos. Es intencional (recaudo = caja real que entró), pero significa que `recaudo.total` **no es comparable directamente** con `intereses.total + capital recuperado` de otras secciones sin tener en cuenta esa diferencia de alcance.

---

## 5. Cartera vencida — `cartera_vencida.*` (buckets por período calendario)

```sql
SELECT
  SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
    AND cu.fecha_vencimiento = $1::date
    THEN cu.monto_cuota - cu.monto_pagado END)                                                    AS vencio_hoy,
  SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
    AND cu.fecha_vencimiento >= DATE_TRUNC('week', $1::date) AND cu.fecha_vencimiento < $1::date
    THEN cu.monto_cuota - cu.monto_pagado END)                                                    AS vencio_semana,
  SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
    AND cu.fecha_vencimiento >= DATE_TRUNC('month', $1::date) AND cu.fecha_vencimiento < $1::date
    THEN cu.monto_cuota - cu.monto_pagado END)                                                    AS vencio_mes,
  SUM(CASE WHEN cu.estado IN ('pendiente','parcial')
    AND cu.fecha_vencimiento < $1::date - INTERVAL '30 days'
    THEN cu.monto_cuota - cu.monto_pagado END)                                                    AS mas_30d,
  SUM(CASE WHEN cu.estado IN ('pendiente','parcial') AND cu.fecha_vencimiento < $1::date
    THEN cu.monto_cuota - cu.monto_pagado END)                                                    AS total
FROM administrativo.cred_cuotas cu
WHERE cu.fecha_vencimiento != '2099-12-31'
```

A diferencia de `mora` (que agrupa por **días transcurridos** desde el vencimiento), aquí se agrupa por **en qué ventana calendario cayó el vencimiento** (hoy exacto / esta semana antes de hoy / este mes antes de hoy / hace más de 30 días). Las cubetas `vencio_hoy`, `vencio_semana` y `vencio_mes` **no son mutuamente excluyentes entre sí en el sentido acumulado** (una cuota vencida hoy también cae dentro del rango "esta semana" si se sumaran ingenuamente `vencio_hoy + vencio_semana`, aunque aquí `vencio_semana` explícitamente excluye `= $1::date` con `< $1::date`, así que sí son disjuntas tal como están escritas). `mas_30d` sí puede solaparse conceptualmente con `vencio_mes` si el mes calendario tiene más de 30 días de antigüedad acumulada — revisar antes de sumarlas en un reporte.

---

## 6. Capital — `en_calle` e intereses proyectados (normales vs libres 30/360)

**Capital en la calle (créditos normales):**

```sql
SELECT SUM(
  cu.abono_capital * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))
) AS total
FROM administrativo.cred_cuotas cu
JOIN administrativo.cred_productos p ON p.id = cu.producto_id
WHERE cu.estado IN ('pendiente','parcial')
  AND p.estado IN ('activo','al_dia','en_mora')
  AND p.tipo <> 'congelacion'
  AND cu.fecha_vencimiento != '2099-12-31'
```

Fórmula: por cada cuota pendiente/parcial se calcula qué fracción de `abono_capital` sigue sin pagar (`1 - pagado/cuota`, capado a 1 con `LEAST`) y se suma. `capital-detalle/route.js` reutiliza literalmente esta misma expresión, pero agrupada `GROUP BY` cliente/producto para el modal de detalle, con `HAVING ... > 0.5` para descartar residuos de redondeo.

**Créditos libres (capital pendiente):**

```sql
SELECT SUM(p.monto_capital - COALESCE(cap.capital_pagado, 0)) AS capital_pendiente
FROM administrativo.cred_productos p
LEFT JOIN (
  SELECT producto_id, SUM(monto_capital) AS capital_pagado
  FROM administrativo.cred_pagos WHERE monto_capital > 0 GROUP BY producto_id
) cap ON cap.producto_id = p.id
WHERE p.tipo = 'credito_libre' AND p.estado NOT IN ('saldado','refinanciado','decomisado')
```

Comentario del código: *"NO se puede derivar de `cred_cuotas` (placeholder tiene `abono_capital=0`), se calcula directamente: `monto_capital` − suma de abonos a capital en pagos"*.

**Combinación final:**

```js
en_calle: parseFloat(capitalCalle.rows[0].total) + parseFloat(cl.capital_pendiente || 0)
```

> ⚠️ **La exclusión de `credito_libre` en la query de `capitalCalle` es implícita, no explícita.** No hay `AND p.tipo <> 'credito_libre'`; funciona porque la única cuota de un crédito libre tiene `fecha_vencimiento = '2099-12-31'`, que el `WHERE` ya excluye. Si algún día un crédito libre llegara a tener una cuota real con fecha distinta (migración, fix manual, bug), su capital se sumaría **dos veces**: una vez aquí (`capitalCalle`) y otra vez en `cl.capital_pendiente`. Mismo patrón de riesgo en la query de `interesesProyectados` de abajo.

**Intereses proyectados — créditos normales** (dos variantes según si hay rango):

```sql
-- Sin rango: todas las cuotas futuras pendientes
SELECT SUM(cu.abono_interes * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))) AS total
FROM administrativo.cred_cuotas cu
JOIN administrativo.cred_productos p ON p.id = cu.producto_id
WHERE cu.estado IN ('pendiente','parcial') AND p.estado IN ('activo','al_dia','en_mora')
  AND p.tipo <> 'congelacion' AND cu.fecha_vencimiento != '2099-12-31'

-- Con rango: se agrega  AND cu.fecha_vencimiento BETWEEN $1 AND $2
```

**Intereses proyectados — créditos libres (30/360)**, solo si `hayRango` (se necesita `hasta` como fecha de corte de la proyección):

```js
const DIAS_BASE_CL = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }
function diasD360(ini, fin) {
  const [y1, m1, d1] = ini.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = fin.slice(0, 10).split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}
function calcInteresCL(capitalPendiente, tasa, periodTasa, inicioStr, hastaStr) {
  if (capitalPendiente <= 0 || !inicioStr || !hastaStr) return 0
  const dias = diasD360(inicioStr, hastaStr)
  if (dias <= 0) return 0
  const diasBase = DIAS_BASE_CL[periodTasa] || 30
  return capitalPendiente * (tasa / 100 / diasBase) * dias
}
```

La misma convención 30/360 que ya usa `/api/creditos-libres` (documentada en detalle en [[Créditos Sin Cuotas Futuras]]). El dato base viene de la query 17 (`creditosLibresDetalle`), que trae por crédito el `capital_pendiente` y el `inicio_periodo`:

```sql
inicio_periodo = COALESCE(MAX(pg.fecha_corte_interes)::text, p.fecha_primer_pago::text, p.fecha_creacion::date::text)
```

Pero al proyectar el interés para el KPI, **no se usa `inicio_periodo`**:

```js
// ← fecha DESDE del selector (no el último corte)
const interes = calcInteresCL(capital, tasa, row.periodo_tasa, desde, hasta)
```

El propio comentario del código lo justifica: *"usa `desde` como inicio del período ... para que el cálculo refleje exactamente el rango seleccionado en el dashboard — más dinámico y controlado por el usuario"*.

> ⚠️ **Riesgo de doble conteo entre "intereses ya cobrados" e "intereses proyectados libres".** Si el usuario elige un `desde` **anterior** al `inicio_periodo` real (el último corte efectivamente cobrado), `intereses_libres_proyectados` calculará interés sobre un período que **ya fue cobrado y contabilizado** en `creditos_libres.intereses_cobrados` (query 16, sección 7). Como son dos tarjetas distintas del dashboard (una es "ya cobrado", la otra "proyectado a futuro"), un usuario que sume ambas para estimar el total esperado del negocio estaría contando ese tramo dos veces. No hay validación en el backend que fuerce `desde >= inicio_periodo` por crédito — la responsabilidad de elegir un rango coherente queda en el usuario del dashboard.

---

## 7. Créditos Libres (resumen) — `creditos_libres.*`

```js
creditos_libres: {
  cantidad:           cl.cantidad,             // COUNT(*) de la query 15
  capital_pendiente:  parseFloat(cl.capital_pendiente || 0),
  intereses_cobrados: parseFloat(il.total || 0),  // total de la query 16
}
```

`cl` (query 15) y `il` (query 16) ya se documentaron en las secciones 6 y 2c respectivamente. Nótese que el filtro de estados difiere levemente del resto del dashboard: `estado NOT IN ('saldado','refinanciado','decomisado')` en vez de la lista positiva `IN ('activo','al_dia','en_mora')` usada en otras queries — funcionalmente equivalente mientras esos sean los únicos 6 estados posibles de `cred_productos.estado` (ver [[Base de Datos]]), pero si se agrega un estado nuevo, esta query lo incluiría por defecto mientras las otras lo excluirían por defecto.

---

## 8. Créditos Sin Cuotas en mora — `creditos_libres_mora`

Este bloque **no tiene equivalente en `cartera.capital_mora`** (ver ⚠️ de la sección 1): como el módulo de créditos libres no usa `fecha_vencimiento` real, la mora se redefine por completo con la convención ya usada por la alerta visual de `/creditos-libres` (documentada en `CLAUDE.md` §18, ver [[CLAUDE]]):

```js
const UMBRAL_MORA_LIBRES_DIAS = 30
function diasCalendario(desdeStr, hastaStr) {
  const d1 = new Date(desdeStr.slice(0, 10) + 'T00:00:00Z')
  const d2 = new Date(hastaStr.slice(0, 10) + 'T00:00:00Z')
  return Math.round((d2 - d1) / 86400000)
}
```

Algoritmo (en JS, iterando las filas de la query 17 `creditosLibresDetalle`):

```js
for (const row of creditosLibresDetalle.rows) {
  const capital = parseFloat(row.capital_pendiente)
  if (capital <= 0.5 || !row.inicio_periodo) continue
  const diasSinCorte = diasCalendario(row.inicio_periodo, hoy)
  if (diasSinCorte <= UMBRAL_MORA_LIBRES_DIAS) continue          // umbral: > 30 días sin corte
  const interesCausado = calcInteresCL(capital, parseFloat(row.tasa_interes), row.periodo_tasa, row.inicio_periodo, hoy)
  const totalAdeudado = capital + interesCausado
  // acumula cantidad, capital_pendiente, interes_causado, total_adeudado
  // push a detalle[] con dias_sin_corte, para ordenar descendente al final
}
```

Puntos clave:
- **"Días sin corte"** = días calendario reales (no 30/360) desde `inicio_periodo` (último `fecha_corte_interes` registrado, o `fecha_primer_pago`/`fecha_creacion` si nunca se ha cobrado interés) hasta **hoy**.
- **Umbral de mora**: `> 30` días sin corte — el mismo criterio ya usado por la alerta visual de la lista de `/creditos-libres`, elegido deliberadamente para *"no introducir un criterio de negocio nuevo"* (comentario del código).
- **"Total adeudado"** = capital pendiente + interés causado (30/360) calculado **desde `inicio_periodo` hasta hoy** — a diferencia de la sección 6, aquí el fin del período es siempre `hoy` (no una fecha elegida por el usuario), y el inicio sí es el `inicio_periodo` real (no `desde`). Es decir: **esta es la fórmula "correcta" con las fechas reales del crédito**; la de intereses proyectados (sección 6) es una simulación con fechas elegidas por el usuario, y por eso pueden divergir entre sí para el mismo crédito.
- `creditosLibresDetalle` (query 17) se reutiliza para **dos propósitos con semántica de fechas distinta** (mora → `inicio_periodo` real hasta hoy; proyección → `desde` del selector hasta `hasta`), algo a tener presente si se modifica esa query pensando en un solo consumidor.

Documentación completa del módulo (reglas de negocio, motor 30/360, aislamiento del resto del sistema) en [[Créditos Sin Cuotas Futuras]].

---

## 9. KPIs históricos — `kpis.*` (consumidos por `/informes`)

```sql
SELECT
  SUM(p.monto_capital) FILTER (WHERE p.estado <> 'refinanciado') AS total_invertido,
  COUNT(*) FILTER (WHERE p.estado <> 'refinanciado')              AS num_creditos,
  (SELECT SUM(pg.monto) FROM cred_pagos pg
   JOIN cred_productos pp ON pp.id = pg.producto_id
   WHERE pp.tipo NOT IN ('fiado','adelanto','congelacion'))        AS total_recuperado
FROM administrativo.cred_productos p
WHERE p.tipo NOT IN ('fiado','adelanto','congelacion')
```

Doble exclusión documentada en el propio comentario del código: `fiado`/`adelanto` son "cuentas abiertas" (no créditos con capital fijo desembolsado) y `congelacion` porque *"su `monto_capital` incluye interés viejo, no es capital real desembolsado"*. El estado `refinanciado` se excluye de `total_invertido`/`num_creditos` para **no duplicar** la cifra: el crédito original refinanciado y su sucesor representan el mismo capital contado una sola vez (el sucesor sí se cuenta, con su propio `monto_capital`).

---

## Endpoints satélite (drill-down por crédito)

### `GET /api/dashboard/capital-detalle`
Sin filtros de fecha (foto del saldo actual). Repite exactamente la fórmula de capital de la sección 6, pero agrupada por cliente/producto:

```sql
GROUP BY c.id, c.nombre, c.documento, p.id, p.referencia, p.tipo, p.monto_capital
HAVING SUM(cu.abono_capital * (1 - LEAST(cu.monto_pagado, cu.monto_cuota) / NULLIF(cu.monto_cuota, 0))) > 0.5
```

El `HAVING > 0.5` filtra créditos con saldo residual por redondeo que no deberían mostrarse como "pendientes".

### `GET /api/dashboard/intereses-detalle`
Devuelve `{ normales[], libres[], totales }` (formato nuevo; el frontend soporta compatibilidad con el formato viejo vía `detalleIntereses.normales ?? detalleIntereses ?? []`, ver [[API Endpoints]]). `normales` repite la query de interés proyectado de la sección 6 agrupada por crédito, con `filtroRango` opcional sobre `cu.fecha_vencimiento`. `libres` solo se calcula **si hay rango completo** (`desde` y `hasta`), reutilizando la misma lógica `desde → hasta` con 30/360 descrita en la sección 6 — hereda por tanto el mismo riesgo de posible solape con intereses ya cobrados si `desde` antecede al corte real.

---

## Resumen de riesgos detectados (⚠️)

| # | Riesgo | Ubicación | Estado |
|---|--------|-----------|--------|
| 1 | `cartera.capital_activo` incluye créditos libres por su `monto_capital` original (no el saldo real) y nunca los marca en `capital_mora`, aunque estén muy atrasados según `creditos_libres_mora` | Query 1 (`carteraEstados`) | Sin corregir |
| 2 | La query de intereses de préstamos normales no excluía `credito_libre` — causó doble conteo real de $25.000 el 04/08/2026 | Query 2 (`interesesPeriodos`) | **✅ Corregido 2026-08-05** |
| 3 | `mora.monto_total` y `cartera_vencida.total` no excluían productos refinanciados/saldados/decomisados ni `credito_libre` — $87.777.732 de mora falsa medida en producción (27,5% del total reportado) | Query 3 vs Query 5 | **✅ Corregido 2026-08-05** |
| 4 | Exclusión de `credito_libre` en `capitalCalle` / `interesesProyectados` (queries 6 y 7) — a diferencia de lo que se documentó originalmente, **SÍ es explícita**: ambas hacen `JOIN cred_productos` y filtran `p.estado IN ('activo','al_dia','en_mora')`, por lo que no heredan el bug de las queries 3/5. Verificado al corregir el riesgo #3 | Query 6 y 7 | No es un riesgo real — documentación previa corregida |
| 5 | `intereses_libres_proyectados` usa `desde` (elegido por el usuario) en vez de `inicio_periodo` (último corte real) como inicio del cálculo 30/360 — puede solaparse con `creditos_libres.intereses_cobrados` si `desde` antecede al último corte real | Sección "capital" (JS, tras query 17) y `intereses-detalle/route.js` | Sin corregir |
| 6 | 11 créditos `tipo='credito_libre'` en producción tienen la cuota placeholder mal formada (fecha y montos reales en vez de `2099-12-31`/`0`) — causa raíz de los riesgos #2 y #3. Pendiente decidir con el usuario si se resetean los datos | `cred_cuotas` de esos 11 productos (ver lista en [[Incidentes y Bugs Conocidos]]) | **Dato pendiente de decisión** |