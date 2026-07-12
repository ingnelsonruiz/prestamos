# Créditos Sin Cuotas Futuras

> Módulo implementado el 2026-07-12. Completamente independiente del motor de cuotas existente.
> No toca `lib/calculos.js`, no llama `POST /api/pagos`, no ejecuta `recalcularCuotasPlano`.

---

## ¿Qué es este módulo?

Un tipo de crédito donde el interés **no se liquida en cuotas futuras fijas**. En cambio, el cobrador selecciona una "fecha de corte" y el sistema calcula el interés acumulado desde el último corte hasta esa fecha. El cliente puede abonar libremente a intereses, a capital, o a ambos en un mismo recibo.

---

## Reglas de negocio

- **Convención 30/360**: cada mes cuenta exactamente 30 días, sin importar si tiene 28, 29, 30 o 31. Fórmula: `(Y2−Y1)×360 + (M2−M1)×30 + (D2−D1)`.
- **Fórmula de interés**: `interés = capital_pendiente × (tasa/100 / diasBase) × dias30_360`
  - `diasBase` según `periodo_tasa`: diario=1, semanal=7, quincenal=15, mensual=30, anual=360
- **Tipos de abono**:
  - `interes` — solo cobro del interés del período (requiere `fecha_corte`)
  - `capital` — abono libre al principal (sin `fecha_corte`)
  - `ambos` — interés + capital en un solo recibo
- **Fecha de corte**: debe ser **estrictamente posterior** al último corte registrado. Se rechaza si es igual o anterior (`fecha_corte <= anteriorStr`).
- **Capital**: puede abonarse en cualquier monto hasta el pendiente. Reducir capital reduce la base de interés en el próximo período.
- **Saldado**: cuando `capital_pagado >= monto_capital - 0.5`, el producto pasa a `saldado`.
- **`fecha_primer_pago`**: almacena la fecha de inicio ingresada por el usuario. Es el punto de partida del primer período de interés.

---

## Motor de cálculo (30/360)

```js
// En app/api/creditos-libres/[id]/calcular/route.js
function diasD360(inicioStr, finStr) {
  const [y1, m1, d1] = inicioStr.split('-').map(Number)
  const [y2, m2, d2] = finStr.split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}
// Ejemplo: 1 mayo → 1 julio = 0×360 + 2×30 + 0 = 60 días (no 61)
```

---

## Patrón de auto-migración

Los 4 endpoints ejecutan `autoMigrar()` al inicio de cada request:

```js
async function autoMigrar() {
  // 1. Agregar columna si no existe
  await query(`ALTER TABLE administrativo.cred_pagos
    ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`)
  // 2. Eliminar CHECK restrictivo de comportamientos
  await query(`ALTER TABLE administrativo.cred_tipos_prestamo
    DROP CONSTRAINT IF EXISTS cred_tipos_prestamo_comportamiento_check`)
  // 3. Insertar tipo credito_libre si no existe
  await query(`INSERT INTO administrativo.cred_tipos_prestamo
    (id, codigo, label, icono, descripcion, comportamiento, activo, es_sistema, orden)
    VALUES ('tipo-credito-libre','credito_libre','Crédito Sin Cuotas','📅',
    'Crédito con interés calculado por fecha de corte','sin_cuotas_futuras',TRUE,TRUE,7)
    ON CONFLICT (codigo) DO NOTHING`)
}
```

Es idempotente — seguro de correr múltiples veces sin efectos secundarios.

---

## Estructura de datos en BD

| Tabla | Campo | Valor para crédito libre |
|-------|-------|--------------------------|
| `cred_productos` | `tipo` | `credito_libre` |
| `cred_productos` | `metodo_calculo` | `plano` |
| `cred_productos` | `num_cuotas` | `1` |
| `cred_productos` | `con_interes` | `FALSE` |
| `cred_productos` | `fecha_primer_pago` | Fecha de inicio ingresada por el usuario |
| `cred_cuotas` | `fecha_vencimiento` | `2099-12-31` (placeholder) |
| `cred_cuotas` | `monto_cuota` | `monto_capital` (del producto) |
| `cred_pagos` | `fecha_corte_interes` | `YYYY-MM-DD` si el abono incluye interés, `NULL` si es solo capital |

---

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/creditos-libres` | Lista con KPIs por crédito |
| POST | `/api/creditos-libres` | Crear crédito libre |
| GET | `/api/creditos-libres/[id]` | Detalle + historial de abonos |
| GET | `/api/creditos-libres/[id]/calcular?fecha_corte=` | Proyectar interés (solo lectura) |
| POST | `/api/creditos-libres/[id]/abonar` | Registrar abono |

---

## Navegación desde Cobros

`app/cobros/page.js` detecta `g.tipo === 'credito_libre'` en los tres botones de pago:

```js
// En abrirModalTodo(g)
if (g.tipo === 'credito_libre') {
  router.push(`/creditos-libres/${g.producto_id}?abrir=1`)
  return
}

// En botones por cuota (móvil y desktop)
onClick={() => g.tipo === 'credito_libre'
  ? router.push(`/creditos-libres/${g.producto_id}?abrir=1`)
  : abrirModal(c)}
```

El parámetro `?abrir=1` hace que la página de detalle inicialice `modalAbierto=true`:

```js
// En app/creditos-libres/[id]/page.js
const searchParams = useSearchParams()
const [modalAbierto, setModalAbierto] = useState(searchParams.get('abrir') === '1')
```

---

## Archivos del módulo

```
app/api/creditos-libres/
├── route.js              # GET lista / POST crear
└── [id]/
    ├── route.js          # GET detalle
    ├── calcular/route.js # GET proyección de interés
    └── abonar/route.js   # POST abono

app/creditos-libres/
├── page.js               # Lista con KPIs y filtros
├── nuevo/page.js         # Formulario de creación
└── [id]/page.js          # Detalle + modal de abono
```

---

## Bugs corregidos durante el desarrollo

| Fecha | Bug | Causa | Fix |
|-------|-----|-------|-----|
| 2026-07-12 | Fecha mostraba día anterior | `new Date("2026-05-01")` = medianoche UTC = abril 30 en Colombia (UTC-5) | Siempre `new Date(str + 'T12:00:00')` |
| 2026-07-12 | Input capital rechazaba 1.000.000 | `type="number" step="1000"` genera secuencia inválida | `type="text" inputMode="numeric"` con handler manual |
| 2026-07-12 | Se cobraba interés del mismo día | Validación usaba `<` en lugar de `<=` | `if (fecha_corte <= anteriorStr)` rechaza |
| 2026-07-12 | Error constraint BD al insertar tipo | CHECK no incluía `sin_cuotas_futuras` | `DROP CONSTRAINT IF EXISTS` en `autoMigrar()` |
| 2026-07-12 | Interés con días reales (mayo=31) | No usaba convención 30/360 | Función `diasD360()` |
| 2026-07-12 | Botón Pagar en Cobros no redirigía | Faltaba `useRouter` e interceptación en `abrirModalTodo` | Detectar `g.tipo === 'credito_libre'` y hacer `router.push` |
| 2026-07-12 | Modal no se abría al llegar desde Cobros | No se leía `?abrir=1` de la URL | `useState(searchParams.get('abrir') === '1')` |

---

## Aislamiento garantizado

- ✅ NO modifica `lib/calculos.js`
- ✅ NO llama `POST /api/pagos`
- ✅ NO ejecuta `recalcularCuotasPlano`
- ✅ Los créditos existentes (préstamos, fiados, empeños, adelantos) no se ven afectados en ningún caso
