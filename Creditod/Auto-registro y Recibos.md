# Auto-registro y Recibos

> Dos módulos independientes que comparten el esquema `administrativo` pero con perfiles de acceso opuestos: **auto-registro** (`/registro`, `/autoregistro/[id]`) es 100% público y sin autenticación; **recibos** (`/recibos`) es interno y requiere sesión JWT.

---

## ¿Qué es cada módulo?

- **Auto-registro** (`/registro` → `POST /api/registro`): formulario público para que un cliente potencial se registre por su cuenta, sin que un operador digite sus datos. Crea un `cred_clientes` nuevo con `es_prueba=FALSE`.
- **Actualización de contacto** (`/autoregistro/[id]`): página pública ligada a un cliente ya existente (por `id` UUID) para que actualice teléfono, dirección, email o complete su cédula si quedó con un placeholder.
- **Recibos** (`/recibos` → `GET /api/recibos?q=`): buscador interno de recibos de pago ya emitidos, con reimpresión y reenvío por WhatsApp.

Ver [[Base de Datos]] para las tablas `cred_clientes`, `cred_pagos`, `cred_cuotas`, `cred_productos`. Ver [[API Endpoints]] para el catálogo completo de rutas.

---

## Flujo de auto-registro (`/registro`)

### Exposición pública

`/registro` y `/api/registro` están explícitamente whitelisteados en `middleware.js` (autenticación global JWT vía cookie `itl_session`):

```js
const PUBLICAS = ['/login', '/estado', '/api/auth', '/api/estado', '/autoregistro', '/api/autoregistro', '/registro', '/api/registro']
```

Sin este whitelist, el middleware redirigiría cualquier request a `/login` por falta de cookie de sesión.

### Validaciones exactas (`validarCampos` en `route.js`, duplicadas en el cliente)

| Campo | Obligatorio | Regla | Regex / condición |
|---|---|---|---|
| `nombre` | Sí | Mínimo 3 caracteres, solo letras/espacios/tildes/guiones/apóstrofes | `/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/` |
| `documento` | Sí | Solo dígitos, 5 a 12 caracteres | `/^\d+$/` + `length` 5–12 |
| `telefono` | Sí | Solo dígitos, 7 a 10 caracteres | `/^\d+$/` + `length` 7–10 |
| `telefono2` | No | Si se llena, mismas reglas que `telefono` | igual que arriba |
| `direccion` | No | Sin validación de formato | — |
| `email` | No | Formato básico si se llena | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |

> ⚠️ La validación existe **duplicada en dos archivos con la misma lógica copiada a mano**: `validar()` en `app/registro/page.js` (feedback instantáneo) y `validarCampos()` en `app/api/registro/route.js` (guardia real). No hay un módulo compartido — si se cambia una regla hay que tocar ambos.

### Verificación de cédula duplicada — dos capas

1. **En vivo mientras se escribe** (`onBlur` del campo cédula): `GET /api/registro?documento=XXXX` → `{ existe: bool }`. Solo se dispara si el valor ya matchea `/^\d{5,12}$/`. Marca el campo en rojo antes de llegar a intentar el submit.
2. **Explícito antes del `INSERT`** en el POST:

```js
// Verificar duplicado explícitamente (antes del INSERT, mensaje más claro)
const dup = await query(
  `SELECT nombre FROM ${S}.cred_clientes WHERE documento=$1 LIMIT 1`,
  [documento.trim()]
)
if (dup.rows.length > 0)
  return NextResponse.json({
    error: 'Esa cédula ya está registrada. Si crees que es un error, comunícate con nosotros.',
    errores: { documento: 'Cédula ya registrada.' }
  }, { status: 409 })
```

Además existe un `catch (error.code === '23505')` que atrapa la violación real del constraint `UNIQUE` sobre `documento`, como red de seguridad final ante una condición de carrera entre el `SELECT` y el `INSERT`.

> ⚠️ **Race condition posible**: dos requests simultáneas con la misma cédula podrían pasar ambas el `SELECT` de duplicado antes de que cualquiera inserte. El resultado final sigue siendo correcto gracias al `UNIQUE` de Postgres, pero el segundo request recibe el mensaje genérico `'Esa cédula ya está registrada.'` en vez del mensaje detallado del chequeo explícito.

### Migración idempotente embebida en el endpoint

`POST /api/registro` (función `setup()`, memoizada en `_ok`) y `POST /api/autoregistro/[id]` (función `asegurarTelefono2()`, memoizada en `_t2Verificado`) agregan columnas a `cred_clientes` si faltan, en cada request del proceso:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='administrativo' AND table_name='cred_clientes' AND column_name='telefono2')
  THEN ALTER TABLE administrativo.cred_clientes ADD COLUMN telefono2 TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='administrativo' AND table_name='cred_clientes' AND column_name='es_prueba')
  THEN ALTER TABLE administrativo.cred_clientes ADD COLUMN es_prueba BOOLEAN NOT NULL DEFAULT FALSE; END IF;
END$$
```

Mismo patrón `setup()` documentado en [[Empresas y Gastos]] para evitar migraciones manuales en cada entorno.

### Creación del cliente

`POST /api/registro` genera el `id` con `uuidv4()` en Node (no `DEFAULT gen_random_uuid()` de Postgres) y **fuerza `es_prueba=FALSE`** — un registro público jamás puede quedar marcado como cliente de prueba:

```sql
INSERT INTO administrativo.cred_clientes
   (id, documento, nombre, telefono, telefono2, direccion, email, es_prueba)
 VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)
 RETURNING id, nombre, documento
```

> ⚠️ **Sin rate limiting ni CAPTCHA**: `/api/registro` es totalmente público, sin autenticación y sin límite de requests por IP. No hay ningún mecanismo anti-bot en `middleware.js` ni en el route handler. Un actor malicioso puede intentar spam de registros; el único freno es la unicidad del `documento` (fácil de variar incrementalmente). Vale la pena evaluar rate limiting por IP o un captcha si este formulario circula en un canal masivo.

### Pantalla de éxito

`app/registro/page.js` **no redirige** tras el `POST` exitoso: cambia el estado local a `'exito'`, muestra agradecimiento y un botón **"Registrar otra persona"** que resetea el formulario. El `id` del cliente recién creado (presente en la respuesta `{ ok, cliente: { id, nombre, documento } }`) **no se usa ni se muestra** en esta pantalla — no se genera ahí ningún link hacia `/autoregistro/[id]`.

---

## ¿Por qué `/registro/layout.js` es un layout separado?

```js
export const metadata = {
  title: 'Inversiones Hnos Liñán',
  description: 'Inversiones Hnos Liñán',
  openGraph: { title: 'Inversiones Hnos Liñán', description: 'Inversiones Hnos Liñán' },
}
export default function RegistroLayout({ children }) {
  return children
}
```

Verificado contra `app/layout.js` (root) y `components/LayoutWrapper.jsx`: **este layout NO es lo que oculta el sidebar.** El root layout siempre envuelve todo en `<LayoutWrapper>`, y es `LayoutWrapper` quien decide por `pathname` si mostrar sidebar/bottom-nav:

```js
const RUTAS_PUBLICAS = ['/login', '/estado', '/registro', '/autoregistro']
const esPublica = RUTAS_PUBLICAS.some(r => pathname.startsWith(r))
if (esPublica) return <>{children}</>
```

El propósito real de `app/registro/layout.js` (igual que `app/login/layout.js`) es **sobrescribir el `metadata` de Next.js** (título de pestaña/OpenGraph) para esa sección pública — el ocultamiento del sidebar ya lo resuelve `LayoutWrapper` por pathname sin importar qué `layout.js` exista en el árbol de rutas.

> ⚠️ **Asimetría entre módulos gemelos**: `/autoregistro/[id]` también está en `RUTAS_PUBLICAS` de `LayoutWrapper` y en `PUBLICAS` de `middleware.js`, pero **no tiene `layout.js` propio** — hereda el `metadata` genérico del root (`"Inversiones Hnos Liñan"`). Inconsistente con `/registro`, que sí define su propio título; probablemente un descuido al construirse el módulo de auto-actualización de contacto después del de registro inicial.

---

## Página de confirmación `/autoregistro/[id]`

### Propósito real

No es una "pantalla de éxito post-registro": es un **formulario de auto-servicio** para que un cliente ya existente (vía link con su `id` UUID como token de acceso, presumiblemente enviado por WhatsApp/SMS) actualice sus propios datos de contacto sin login.

### `GET /api/autoregistro/[id]`

Devuelve los datos actuales del cliente para precargar el formulario. `404` con `{ error: 'Enlace no válido' }` si el `id` no existe:

```js
const r = await query(
  `SELECT id, nombre, documento, telefono, telefono2, direccion, email FROM administrativo.cred_clientes WHERE id=$1`,
  [id]
)
```

### `POST /api/autoregistro/[id]` — reglas de actualización de documento

La lógica central impide que un cliente ya registrado con cédula real pierda o pise el documento de otro cliente, pero permite completar una cédula placeholder:

| Situación | Regla |
|---|---|
| `documento` actual vacío o placeholder (`/^[0-9]{1,3}$/`, ej. `"1"`, `"23"`) | Se puede establecer el documento real por primera vez |
| `documento` actual ya es cédula real y el nuevo valor es **igual** | Se acepta (no-op) |
| `documento` actual ya es cédula real y el nuevo valor es **distinto** | `400` — *"El documento ya está registrado y no puede modificarse aquí."* |
| Nuevo documento ya usado por **otro** cliente | `409` — *"Ese número de documento ya pertenece a otro cliente."* |

```js
const docEsPlaceholder = !docActual || docActual.trim() === '' || /^[0-9]{1,3}$/.test(docActual.trim())
```

El resto de campos se actualiza con `COALESCE(NULLIF($n,''), columna_actual)` — un string vacío o `null` en el body **deja el valor existente intacto**, no lo borra.

> ⚠️ **Sin validación de formato en el servidor**: a diferencia de `/api/registro`, este endpoint **no valida regex de teléfono, longitud de documento ni formato de email** — solo la lógica de placeholder/duplicado del documento. El frontend (`app/autoregistro/[id]/page.js`) tampoco valida más allá del `required` HTML del input de cédula. Un cliente puede guardar un teléfono con letras o un email inválido sin que nada lo rechace.

> ⚠️ **Token de un solo factor y sin expiración**: el `id` (UUID de `cred_clientes`) funciona como capability token permanente — quien lo conozca puede editar los datos de contacto de ese cliente indefinidamente, sin caducidad ni límite de usos ni segundo factor. Si el link se filtra o queda indexado, cualquiera con el UUID modifica teléfono/dirección/email del cliente.

### Estados de la página

`cargando → listo → enviando → exito` | `invalido` (id no existe). El campo cédula se bloquea visualmente (`🔒`, fondo gris, "Ya registrado") cuando `docEsPlaceholder` es `false`, replicando en cliente la misma regex `/^[0-9]{1,3}$/` del backend.

---

## Módulo de Recibos (`/recibos`)

### Acceso

A diferencia de los dos módulos anteriores, `/recibos` **no** está en `RUTAS_PUBLICAS` de `LayoutWrapper` ni en `PUBLICAS` de `middleware.js` — requiere sesión JWT válida y se renderiza dentro del layout con sidebar/bottom-nav.

### `GET /api/recibos?q=` — búsqueda flexible

```js
const q = (searchParams.get('q') || '').trim().toUpperCase()
const termino = q.startsWith('REC-') ? `%${q}%` : `%REC-%${q}%`
...
WHERE pg.numero_recibo ILIKE $1
ORDER BY pg.fecha_pago DESC
LIMIT 20
```

Permite buscar por:
- Número completo: `REC-000001` → patrón `%REC-000001%`.
- Solo el número o fragmento: `1`, `000001`, `1234` → patrón `%REC-%1%` (matchea "REC-" seguido, en cualquier punto posterior, del fragmento).

> ⚠️ El patrón `%REC-%<fragmento>%` no ancla el fragmento a los dígitos consecutivos del número — matchea si el fragmento aparece en cualquier posición después de `REC-`. Buscar `"0"` puede devolver muchísimos recibos, acotado solo por `LIMIT 20` (sin paginación real ni conteo total).

### Datos completos retornados

El `SELECT` cruza 4 tablas más una subconsulta escalar de capital pagado:

| Origen | Campos |
|---|---|
| `cred_pagos` (`pg`) | `numero_recibo`, `monto`, `fecha_pago`, `metodo_pago`, `notas`, `usuario_nombre` |
| `cred_cuotas` (`cu`) | `numero_cuota`, `monto_cuota`, `monto_pagado`, `abono_capital`, `abono_interes`, `fecha_vencimiento` |
| `cred_clientes` (`c`) | `nombre_cliente`, `documento`, `telefono` |
| `cred_productos` (`p`) | `tipo_producto`, `descripcion_bien`, `num_cuotas`, `monto_capital`, `tasa_interes`, `periodo_tasa`, `frecuencia_cobro`, `metodo_calculo`, `estado_producto` |
| Subconsulta | `capital_pagado` = `SUM(GREATEST(monto_pagado - abono_interes, 0))` sobre todas las cuotas del producto |

```sql
COALESCE((
  SELECT SUM(GREATEST(cu2.monto_pagado - cu2.abono_interes, 0))
  FROM administrativo.cred_cuotas cu2
  WHERE cu2.producto_id = p.id
), 0) AS capital_pagado
```

Con `capital_pagado`, el frontend calcula el **saldo de capital del crédito completo** (no solo de la cuota), forzando a 0 si `estado_producto === 'saldado'`, y ocultando ese bloque si es cuenta libre (`fecha_vencimiento === '2099-12-31'`, cuota placeholder de créditos sin cuotas futuras).

### Render en `app/recibos/page.js`

- Buscador con **debounce de 400 ms** (`setTimeout` en `handleChange`) + disparo inmediato con `Enter`.
- Estados: inicial (sin buscar), buscando, sin resultados, con resultados.
- Cada recibo se pinta como tarjeta: header con número/fecha, badge de método de pago, monto destacado, grid de cliente/producto/cuota/desglose, bloque de capital prestado vs saldo, notas.
- Acciones por recibo:
  - **🖨️ Imprimir recibo** — no exporta PDF: setea el recibo en estado `imprimiendo`, espera 200 ms para que React pinte el nodo oculto, y llama `window.print()`. Un `<div id="recibo-imprimible">` con `hidden print:block` y la regla `@media print { body * { visibility:hidden } #recibo-imprimible { visibility:visible } }` es lo único visible al imprimir — formato térmico simple (`font-mono`).
  - **👤 Ver cliente** — link a `/clientes/[cliente_id]`.
  - **💬 Enviar por WhatsApp** — solo si el cliente tiene `telefono`. Arma el mensaje con `encodeURIComponent` y abre `https://wa.me/57<telefono>?text=...`. El prefijo `57` (Colombia) está hardcodeado.

> ⚠️ No hay exportación real a PDF/imagen ni envío automático de mensajes: "imprimir" depende del diálogo nativo del navegador (`window.print()`), y "WhatsApp" solo abre `wa.me` con el texto precargado — el usuario debe presionar enviar manualmente.

---

## Resumen de exposición pública vs interna

| Ruta | Middleware (`itl_session`) | Sidebar (`LayoutWrapper`) | Layout propio |
|---|---|---|---|
| `/registro` | Público | Público | `registro/layout.js` (solo metadata) |
| `/api/registro` | Público | — | — |
| `/autoregistro/[id]` | Público | Público | Ninguno (hereda root) |
| `/api/autoregistro/[id]` | Público | — | — |
| `/recibos` | Requiere JWT | Con sidebar | Ninguno (hereda root) |
| `/api/recibos` | Requiere JWT | — | — |

Ver [[API Endpoints]] para el catálogo completo de rutas, [[Empresas y Gastos]] para el otro módulo con patrón `setup()` idempotente, y [[CLAUDE]] para las convenciones generales del proyecto.
