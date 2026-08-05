# Auditoría

> Módulo de trazabilidad del sistema: registra en la tabla `administrativo.cred_auditoria` quién hizo qué, en qué módulo, cuándo y desde qué IP. Vive en `lib/auditoria.js` (función `auditar()` + catálogos `ACCIONES`/`MODULOS`), se expone en solo lectura vía `GET /api/auditoria` y se visualiza en `/auditoria`. **No es un middleware ni un trigger de base de datos**: cada endpoint mutante debe invocar `auditar()` manualmente, lo cual — como se documenta abajo — no siempre ocurre ni siempre funciona.

## 1. Modelo de datos

Tabla `administrativo.cred_auditoria` (ver [[Base de Datos]]):

| Columna | Tipo | Origen |
|---|---|---|
| `id` | UUID | generado con `uuidv4()` dentro de `auditar()` |
| `usuario_id` | UUID/TEXT | del JWT de sesión (`getUsuarioDesdeRequest`) |
| `usuario_nombre` | TEXT | ídem, o `'Sistema'` / `'Desconocido'` |
| `accion` | TEXT | valor de `ACCIONES.*` (o string libre) |
| `modulo` | TEXT | valor de `MODULOS.*` (o string libre) |
| `descripcion` | TEXT | texto libre armado por cada endpoint |
| `detalle` | JSONB | objeto arbitrario, `JSON.stringify()` antes de insertar |
| `ip` | TEXT | solo si el caller la calcula y la pasa explícitamente |
| `fecha` | TIMESTAMP | **no se inserta explícitamente** — depende de un `DEFAULT` a nivel de tabla (probablemente `NOW()`) |

## 2. `lib/auditoria.js`

### 2.1 `getUsuarioDesdeRequest(request)`

Extrae la identidad del usuario a partir de la cookie de sesión (ver [[Autenticación y Seguridad]]), **no del cuerpo de la petición**:

```js
export async function getUsuarioDesdeRequest(request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE)?.value
    if (!token) return { id: null, nombre: 'Sistema' }
    const payload = await verificarToken(token)
    return { id: payload?.id || null, nombre: payload?.nombre || 'Desconocido' }
  } catch {
    return { id: null, nombre: 'Sistema' }
  }
}
```

- El parámetro `request` que recibe **no se usa para leer la cookie** (usa `next/headers`, que lee del contexto de la request actual del server); solo se pasa por convención/compatibilidad de firma.
- Nunca lanza: cualquier fallo de verificación de token cae al catch y devuelve `{ id: null, nombre: 'Sistema' }`.
- Devuelve un objeto con claves `id`/`nombre`, pero **`auditar()` espera `usuario_id`/`usuario_nombre`** (snake_case). El acople entre ambos se hace vía spread: `auditar({ ...u, accion, modulo, ... })`, donde `u = await getUsuarioDesdeRequest(request)` — funciona porque en `auditar()` los nombres de propiedad destructurados coinciden exactamente con `usuario_id`/`usuario_nombre`. Ver gotcha §5.1 sobre qué pasa cuando alguien no respeta esta convención.

### 2.2 `auditar(...)`

```js
export async function auditar({ usuario_id, usuario_nombre, accion, modulo, descripcion, detalle = {}, ip = null }) {
  try {
    await query(
      `INSERT INTO administrativo.cred_auditoria
        (id, usuario_id, usuario_nombre, accion, modulo, descripcion, detalle, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuidv4(), usuario_id, usuario_nombre, accion, modulo, descripcion, JSON.stringify(detalle), ip]
    )
  } catch (e) {
    console.error('Error auditoría:', e.message)
  }
}
```

Puntos clave:

- **No recibe el `request`**. No calcula IP, user-agent ni nada por sí misma; todo eso es responsabilidad del caller.
- **`ip` es `null` por defecto** y solo se completa si el endpoint la calcula manualmente. En todo el código auditado, el **único** sitio que lo hace es `app/api/auth/login/route.js`:
  ```js
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'local'
  await auditar({ usuario_id: user.id, usuario_nombre: user.nombre,
    accion: ACCIONES.LOGIN, modulo: MODULOS.AUTH,
    descripcion: `Inicio de sesión: ${user.usuario}`, ip })
  ```
  El resto de las ~20 llamadas a `auditar()` en la app **no pasan `ip`**, por lo que esa columna queda `NULL` salvo en el login.
- **Nunca propaga el error hacia arriba**: el `try/catch` interno atrapa cualquier fallo del `INSERT` (violación de constraint, tipo de dato inválido, columna inexistente, parámetro `undefined`, etc.) y solo lo imprime con `console.error`. Esto es intencional (para que un fallo de auditoría nunca tumbe la operación de negocio), pero implica que `auditar()` **prácticamente nunca rechaza su promesa** — ver gotcha §5.2 sobre por qué esto vuelve el `.catch()` de los callers, en la práctica, redundante.
- El `id` del registro de auditoría lo genera la propia función (`uuidv4()`), no el caller.

### 2.3 Catálogo `MODULOS`

```js
export const MODULOS = {
  AUTH:      'Autenticación',
  CLIENTES:  'Clientes',
  PRESTAMOS: 'Préstamos',
  COBROS:    'Cobros',
  USUARIOS:  'Usuarios',
}
```

### 2.4 Catálogo `ACCIONES`

```js
export const ACCIONES = {
  LOGIN:              'Inicio de sesión',
  LOGOUT:             'Cierre de sesión',
  CREAR_CLIENTE:      'Crear cliente',
  EDITAR_CLIENTE:     'Editar cliente',
  ELIMINAR_CLIENTE:   'Eliminar cliente',
  CREAR_PRESTAMO:     'Crear préstamo',
  EDITAR_PRESTAMO:    'Editar préstamo',
  ELIMINAR_PRESTAMO:  'Eliminar préstamo',
  REFINANCIAR:        'Refinanciar préstamo',
  UNIFICAR_CREDITOS:  'Unificar créditos',
  REGISTRAR_PAGO:     'Registrar pago',
  CREAR_USUARIO:      'Crear usuario',
  CAMBIAR_CLAVE:      'Cambiar contraseña',
  DESACTIVAR_USUARIO: 'Desactivar usuario',
  ACTIVAR_USUARIO:    'Activar usuario',
}
```

## 3. `modulo` y `accion` no son un enum real

Ambas columnas son de texto libre en la tabla; nada obliga a usar los catálogos anteriores. En el código conviven tres estilos:

| Estilo | Ejemplo | Dónde |
|---|---|---|
| Catálogo (`ACCIONES.*` / `MODULOS.*`) | `ACCIONES.CREAR_CLIENTE`, `MODULOS.CLIENTES` | `clientes/route.js`, `productos/route.js`, `usuarios/route.js`, `productos/[id]/route.js`, `productos/unificar/route.js` |
| String libre directo | `accion: 'Exportar backup', modulo: 'Backup'` | `backup/route.js`, `backup/estructura/route.js` |
| String libre con nombre inventado | `accion: 'RESET DE CLIENTE ESPECÍFICO'`, `accion: 'Migración masiva'`, `accion: 'Cargue inicial de saldos'` | `migracion/*` |

## 4. Patrón fire-and-forget vs `await auditar()`

En la base de código conviven ambos patrones para la misma función:

```js
// Patrón bloqueante (espera a que el INSERT termine antes de responder)
await auditar({ ...u, accion: ACCIONES.ELIMINAR_CLIENTE, modulo: MODULOS.CLIENTES, ... })
return NextResponse.json(result.rows[0])

// Patrón fire-and-forget (no bloquea la respuesta al cliente)
auditar({ ...u, accion: ACCIONES.CREAR_CLIENTE, modulo: MODULOS.CLIENTES, ... })
return NextResponse.json(result.rows[0], { status: 201 })

// Fire-and-forget con .catch() defensivo (solo loguea, no cambia el flujo)
auditar({ ...u, accion: ACCIONES.EDITAR_CLIENTE || 'Editar cliente', ... })
  .catch(err => console.error('[auditoría editar cliente]', err.message))
```

| Endpoint | Patrón |
|---|---|
| `POST /api/auth/login` | `await` |
| `POST /api/clientes` (crear) | fire-and-forget, sin `.catch()` |
| `PUT /api/clientes/[id]` (editar) | fire-and-forget **con** `.catch()` |
| `DELETE /api/clientes/[id]` | `await` |
| `POST /api/productos` (crear/refinanciar) | fire-and-forget, sin `.catch()` |
| `PUT /api/productos/[id]` (editar/eliminar) | `await` |
| `POST /api/productos/unificar` | fire-and-forget |
| `POST /api/usuarios`, `PUT /api/usuarios/[id]` (clave/desactivar) | `await` |
| `POST/PUT /api/migracion*` | mezcla: `await` en `migracion/route.js`, `migracion/reset`, `migracion/reset-cliente`; fire-and-forget en `migracion/cargue-inicial` |
| `GET/POST /api/backup*` | mezcla: `await` en restaurar, fire-and-forget sin `.catch()` en exportar y en recrear estructura |
| `POST /api/creditos-libres`, `.../abonar` | `await` (pero ver gotcha §5.1) |
| `POST /api/admin/fix-interes-fijo` | fire-and-forget con `.catch()` |

No hay un criterio consistente por criticidad de la acción: operaciones destructivas como `ELIMINAR_PRESTAMO` sí se esperan, pero otras igual de sensibles como `CREAR_PRESTAMO`, "Recrear estructura BD" o "Exportar backup" no.

## 5. Gotchas verificados en el código

> ⚠️ **Llamadas a `auditar()` con nombres de propiedad equivocados → el registro nunca se inserta.** En `app/api/creditos-libres/route.js` y `app/api/creditos-libres/[id]/abonar/route.js` se invoca así:
> ```js
> await auditar({
>   usuarioId:     u?.id,        // auditar() espera `usuario_id`
>   usuarioNombre: u?.nombre,    // auditar() espera `usuario_nombre`
>   accion:        ACCIONES.CREAR,   // no existe en el catálogo → undefined
>   modulo:        'creditos_libres',
>   descripcion:   `...`,
>   detalle:       { ... },
>   request,                      // auditar() no tiene este parámetro, se ignora
> })
> ```
> Como `usuario_id`/`usuario_nombre` quedan `undefined` (por el camelCase) y `accion` también queda `undefined` (`ACCIONES.CREAR` y `ACCIONES.PAGAR` **no existen** en el objeto `ACCIONES` transcrito arriba), el `INSERT` falla — node-postgres rechaza parámetros `undefined` — y el error se traga silenciosamente dentro del `try/catch` de `auditar()` (solo `console.error`). Resultado: **las creaciones y abonos de "créditos libres" prácticamente nunca quedan auditados**, y nadie se entera porque el `await` no lanza (la promesa de `auditar()` siempre resuelve, nunca rechaza).

> ⚠️ **Claves de catálogo usadas en el código que no existen en `ACCIONES`/`MODULOS`.** Además de `ACCIONES.CREAR` y `ACCIONES.PAGAR` (arriba), `app/api/admin/fix-interes-fijo/route.js` usa `ACCIONES.ACTUALIZAR || 'actualizar'` y `MODULOS.CONFIGURACION || 'configuracion'` — ninguna de las dos existe en los catálogos de `lib/auditoria.js`. Ese archivo sí tiene fallback con `||` y por tanto no rompe el insert, pero evidencia que el catálogo de `ACCIONES`/`MODULOS` está desactualizado respecto al uso real: hace falta agregar `CREAR`, `PAGAR`, `ACTUALIZAR` y `CONFIGURACION` (o refactorizar los call-sites para usar las claves ya existentes, p. ej. `REGISTRAR_PAGO` en vez de `PAGAR`).

> ⚠️ **`ACCIONES.REGISTRAR_PAGO` y `ACCIONES.ACTIVAR_USUARIO` están en el catálogo pero no se usan en ningún endpoint.** No hay ningún `route.js` que registre un pago normal de cuotas (`/api/cuotas` solo expone `GET`) ni que reactive un usuario dado de baja invocando `ACCIONES.ACTIVAR_USUARIO`. Son entradas "muertas" del catálogo, o señalan funcionalidad pendiente de auditar.

> ⚠️ **`POST /api/auth/logout` no llama a `auditar()`.** A pesar de que `ACCIONES.LOGOUT = 'Cierre de sesión'` existe en el catálogo, el endpoint solo borra la cookie:
> ```js
> export async function POST() {
>   const res = NextResponse.json({ ok: true })
>   res.cookies.delete(COOKIE)
>   return res
> }
> ```
> Los cierres de sesión nunca quedan registrados en `cred_auditoria`; solo los inicios de sesión.

> ⚠️ **`POST /api/registro` (autoregistro público de clientes) no llama a `auditar()`.** Es un endpoint listado como público en `middleware.js` (`PUBLICAS` incluye `/api/registro`), inserta directamente en `administrativo.cred_clientes` y no deja ningún rastro en la auditoría — a diferencia de `POST /api/clientes` (la creación interna de clientes), que sí registra `ACCIONES.CREAR_CLIENTE`.

> ⚠️ **`GET /api/auditoria` no valida rol, solo sesión válida.** El `route.js` del endpoint no importa `verificarToken` ni comprueba `rol`; toda la protección viene de `middleware.js`, que solo exige una cookie JWT válida (cualquier usuario autenticado, sin importar su rol) para acceder a rutas no listadas en `PUBLICAS`. Es decir, **cualquier usuario logueado puede leer el historial completo de auditoría de todos los usuarios**, incluyendo acciones administrativas de otros. No hay restricción adicional por rol como sí existe conceptualmente para acciones de administración (ver [[Autenticación y Seguridad]]).

> ⚠️ **El `.catch()` en las llamadas fire-and-forget es en la práctica redundante.** Como `auditar()` ya atrapa internamente cualquier error del `INSERT` y jamás rechaza su promesa, un `.catch(err => console.error(...))` colocado por el caller nunca llegará a ejecutarse por un fallo de auditoría real (solo protegería contra un `TypeError` si `auditar` no fuera ni siquiera una función). El verdadero riesgo no es la promesa rechazada, sino que en despliegues serverless (Vercel) el runtime puede congelar el contexto de ejecución justo después de enviar la respuesta al cliente, **antes** de que el `INSERT` fire-and-forget termine — perdiendo el registro sin ningún error visible. Los endpoints que hacen `await auditar(...)` no tienen este riesgo.

## 6. `GET /api/auditoria`

```js
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const modulo  = searchParams.get('modulo') || ''
  const usuario = searchParams.get('usuario') || ''
  const fecha   = searchParams.get('fecha') || ''
  const limite  = parseInt(searchParams.get('limite') || '100')
  ...
}
```

| Query param | Filtro SQL | Notas |
|---|---|---|
| `modulo` | `AND modulo = $n` | match exacto, sensible a mayúsculas/tildes |
| `usuario` | `AND usuario_nombre ILIKE '%valor%'` | búsqueda parcial, case-insensitive |
| `fecha` | `AND fecha::date = $n` | fecha exacta (formato `YYYY-MM-DD`), no rango |
| `limite` | `LIMIT $n` | default `100`; el `parseInt` **no valida** que sea numérico — un valor no numérico (`NaN`) probablemente rompe el `LIMIT` en Postgres |

No hay `OFFSET`/paginación real: solo `ORDER BY fecha DESC LIMIT <limite>`. La página usa `limite=200`.

## 7. Página `/auditoria`

Client component (`'use client'`) que:

- En `useEffect` inicial llama a `cargar()`, que hace `fetch('/api/auditoria?...')` con `limite=200` fijo y renderiza en una tabla: fecha/hora (`toLocaleString('es-CO')`), usuario, módulo (badge con color por `moduloColor`), acción (con emoji vía `accionIcon`, fallback `📌`) y descripción (truncada con `truncate`).
- Filtros de UI: `<select>` de módulo (opciones hardcodeadas `['','Autenticación','Clientes','Préstamos','Cobros','Usuarios']` — coinciden con los valores de `MODULOS`, pero **no incluyen `'Backup'`, `'creditos_libres'` ni `'configuracion'`**, los módulos-string libres usados en `backup/*`, `creditos-libres/*` y `fix-interes-fijo`; esos registros son invisibles desde el filtro de módulo aunque existan en la tabla), input de texto para `usuario` (ILIKE parcial) e `input type="date"` para `fecha`.
- Botón "Limpiar" resetea filtros y relanza `cargar()` con `setTimeout(cargar, 100)` (para esperar el `setState` antes de leer `filtros` de nuevo — patrón fragil pero funcional dado el `setFiltros` async de React).
- `accionIcon` no cubre `ACCIONES.REFINANCIAR`, `ACCIONES.UNIFICAR_CREDITOS`, `ACCIONES.REGISTRAR_PAGO` ni `ACCIONES.ACTIVAR_USUARIO` → esas acciones se muestran con el emoji genérico `📌`.
- No hay botón de exportación ni detalle expandible del campo JSONB `detalle` — la UI solo expone `descripcion`, no el contenido de `detalle`.

## 8. Ver también

- [[Base de Datos]] — esquema completo de `administrativo.cred_auditoria` y demás tablas `cred_*`.
- [[Autenticación y Seguridad]] — JWT, cookie `itl_session`, `verificarToken`, y el middleware que protege (parcialmente) `/api/auditoria`.
- [[CLAUDE]] — convenciones generales del proyecto y contexto para IA.
