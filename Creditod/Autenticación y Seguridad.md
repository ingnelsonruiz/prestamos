# Autenticación y Seguridad

> Sistema de sesión basada en JWT firmado (HS256, librería `jose`) almacenado en la cookie `itl_session`, validado en `middleware.js` para proteger todas las rutas salvo una lista explícita de públicas. No existe autorización por rol (RBAC) a nivel de middleware; los pocos checks de rol existen —o deberían existir— dentro de endpoints individuales.

## Componentes involucrados

| Archivo | Responsabilidad |
|---|---|
| `middleware.js` | Guardia de rutas: exige cookie `itl_session` válida antes de servir cualquier ruta no pública. |
| `lib/auth.js` | Emisión (`crearToken`) y verificación (`verificarToken`) del JWT. Exporta el nombre de la cookie (`COOKIE`). |
| `app/api/auth/login/route.js` | Valida credenciales contra `administrativo.cred_usuarios`, compara hash con `bcryptjs`, emite el JWT y setea la cookie. |
| `app/api/auth/logout/route.js` | Elimina la cookie de sesión. |
| `app/api/auth/me/route.js` | Devuelve los datos del usuario autenticado a partir del JWT (usado por el frontend para hidratar sesión, p.ej. `Sidebar.jsx`). |
| `app/login/page.js` | Formulario de login (cliente). |
| `app/login/layout.js` | Layout trivial (`return children`), sin lógica de seguridad. |
| `lib/auditoria.js` | `getUsuarioDesdeRequest` extrae usuario del JWT para trazabilidad; `auditar` inserta en `administrativo.cred_auditoria`. |

## Generación y verificación del JWT

Ambos, `middleware.js` y `lib/auth.js`, derivan la clave de firma de forma independiente (no comparten import):

```js
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'inversiones-tata-linan-secret-2026')
const COOKIE = 'itl_session'
```

> ⚠️ **Secreto JWT con fallback hardcodeado.** Si la variable de entorno `JWT_SECRET` no está definida en el entorno de despliegue, el sistema firma y verifica tokens con el literal `'inversiones-tata-linan-secret-2026'`, que queda expuesto en el código fuente. Cualquiera con acceso al repositorio podría forjar tokens válidos (incluyendo `rol: 'admin'`) si `JWT_SECRET` no está configurado en producción. Es imperativo confirmar que la variable de entorno esté seteada en Vercel/Supabase y considerar eliminar el fallback.

**Emisión** (`lib/auth.js`, usando `jose/jwt/sign`):

```js
export async function crearToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('8h')
    .sign(SECRET)
}
```

El `payload` firmado, construido en `login/route.js`, es:

```js
const token = await crearToken({ id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol })
```

Es decir, el JWT lleva embebidos `id`, `nombre`, `usuario` y `rol` del registro de `administrativo.cred_usuarios` (ver [[Base de Datos]]). Expira a las **8 horas** (`setExpirationTime('8h')`), consistente con la vida de la cookie.

**Verificación** (`lib/auth.js`, usando `jose/jwt/verify`):

```js
export async function verificarToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload
  } catch {
    return null
  }
}
```

`verificarToken` nunca lanza: cualquier fallo (firma inválida, expirado, formato corrupto) resulta en `null`, delegando al llamador decidir qué hacer (usado por `app/api/auth/me/route.js` y por `getUsuarioDesdeRequest` en `lib/auditoria.js`).

`middleware.js`, en cambio, no usa `verificarToken`: importa `jwtVerify` directamente de `jose/jwt/verify` y llama `await jwtVerify(token, SECRET)` dentro de un `try/catch` propio (no reutiliza `lib/auth.js`). Funcionalmente equivalente, pero es código duplicado del secreto y de la lógica de verificación.

### Cookie de sesión

Configuración exacta al hacer login (`app/api/auth/login/route.js`):

```js
response.cookies.set(COOKIE, token, {
  httpOnly: true,
  secure: false,
  sameSite: 'lax',
  maxAge: 60 * 60 * 8, // 8 horas
  path: '/',
})
```

| Atributo | Valor | Observación |
|---|---|---|
| `httpOnly` | `true` | Cookie inaccesible desde JavaScript del cliente — mitiga robo por XSS. |
| `secure` | `false` | La cookie se transmite también por HTTP plano. |
| `sameSite` | `lax` | Protección parcial contra CSRF. |
| `maxAge` | `28800` s (8h) | Coincide con `setExpirationTime('8h')` del JWT. |
| `path` | `/` | Válida en toda la aplicación. |

> ⚠️ **`secure: false` en la cookie de sesión.** El JWT completo (incluyendo `rol` y `id` de usuario) viaja en una cookie que el navegador enviará también sobre conexiones HTTP no cifradas. Si el despliegue no fuerza HTTPS de extremo a extremo (p.ej. detrás de un proxy mal configurado), la sesión es interceptable en tránsito. En producción debería ser `secure: true` (idealmente condicionado a `process.env.NODE_ENV === 'production'`).

## `middleware.js`: qué protege y qué no

```js
const PUBLICAS = ['/login', '/estado', '/api/auth', '/api/estado', '/autoregistro', '/api/autoregistro', '/registro', '/api/registro']

export async function middleware(request) {
  const { pathname } = request.nextUrl
  if (PUBLICAS.some(r => pathname.startsWith(r))) return NextResponse.next()

  const token = request.cookies.get(COOKIE)?.value
  if (!token) return NextResponse.redirect(new URL('/login', request.url))

  try {
    await jwtVerify(token, SECRET)
    return NextResponse.next()
  } catch {
    const res = NextResponse.redirect(new URL('/login', request.url))
    res.cookies.delete(COOKIE)
    return res
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

Puntos clave del comportamiento real:

- **Matcher**: se ejecuta sobre *toda* la app (`/((?!_next/static|_next/image|favicon.ico).*)`), excepto assets estáticos de Next y el favicon. Esto incluye páginas y rutas de API por igual.
- **Rutas públicas por prefijo** (`pathname.startsWith(r)`), no coincidencia exacta: `/login`, `/estado`, `/api/auth`, `/api/estado`, `/autoregistro`, `/api/autoregistro`, `/registro`, `/api/registro`. Cualquier ruta que **comience** con estos prefijos queda exenta de autenticación (p.ej. `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` quedan todas públicas porque comparten el prefijo `/api/auth`, lo cual es intencional pues son los propios endpoints de autenticación).
- **Sin token** → redirección 302 a `/login` (nunca responde 401 JSON; para rutas `/api/*` no listadas como públicas esto significa que un fetch sin sesión recibe una respuesta de redirección HTML en vez de un error estructurado).
- **Token presente pero inválido/expirado** → se redirige a `/login` **y además se borra la cookie** (`res.cookies.delete(COOKIE)`), evitando loops de redirección con una cookie corrupta.
- **Token válido** → `NextResponse.next()`, sin ninguna inspección de `rol` ni de otros claims del payload. El middleware solo certifica "sesión válida", no "usuario autorizado para este recurso".

> ⚠️ **El middleware no valida roles.** `middleware.js` únicamente comprueba que el JWT verifique correctamente; no lee `payload.rol` ni aplica ninguna política de autorización por ruta. Cualquier usuario autenticado (`admin` u `operador`) pasa el middleware exactamente igual para cualquier ruta protegida, incluidas las de administración. Ver [[API Endpoints]] para el detalle de qué endpoints existen; la autorización fina, si existe, debe implementarse dentro de cada `route.js`.

## Roles `admin` / `operador`

En los archivos de autenticación (`middleware.js`, `lib/auth.js`, `app/api/auth/*`) **no hay ningún check de rol**: el rol simplemente se transporta como claim del JWT (`rol: user.rol`) y se expone tal cual en `/api/auth/me` (`{ user: { nombre, usuario, rol } }`) para que el frontend lo use en la UI (p.ej. `components/Sidebar.jsx` condiciona el render de opciones de menú con `user?.rol === 'admin'`, pero eso es control de UI, no de seguridad de backend).

Buscando en otros endpoints, el **único** control de rol a nivel de servidor encontrado en el código está en `app/api/backup/route.js`:

```js
// ─── Solo administradores ────────────────────────────────────────────────────
async function verificarAdmin(request) {
  const u = await getUsuarioDesdeRequest(request)
  if (!u?.rol || u.rol !== 'admin') return null
  return u
}
```

Ver la sección de hallazgos: esta función **está definida pero nunca se invoca**, y aunque se invocara, fallaría siempre (ver más abajo). No se encontró ningún otro endpoint que verifique `rol` desde el backend.

## Flujo de login (frontend, `app/login/page.js`)

Componente cliente (`'use client'`) con estado local `form { usuario, password }`, `error`, `loading`, `showPass` (toggle de visibilidad de contraseña) y `dbStatus`/`dbMs` (chequeo de salud de la BD vía `GET /api/health` al montar, solo informativo en la UI).

Envío del formulario:

```js
const login = async e => {
  e.preventDefault()
  setLoading(true); setError('')
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form)
  })
  const data = await res.json()
  setLoading(false)
  if (!res.ok) { setError(data.error); return }
  router.push('/')
  router.refresh()
}
```

- Ningún trimming/validación de formato en cliente más allá de `required` en los inputs HTML.
- Si `res.ok` es `false`, muestra `data.error` tal cual viene del backend (mensajes genéricos: "Usuario y contraseña requeridos" o "Usuario o contraseña incorrectos" — no filtra si el usuario existe o no, evitando enumeración de usuarios).
- En éxito, navega a `/` y fuerza `router.refresh()` para que el Server Component / middleware relean la cookie recién seteada.
- `app/login/layout.js` es un passthrough sin lógica (`export default function LoginLayout({ children }) { return children }`), no aplica ningún wrapper de seguridad adicional.
- La UI del login exhibe explícitamente el texto "Conexión cifrada · JWT HS256 · Sesión 8h" y "Auditoría completa por usuario e IP" como mensajes de confianza al usuario final, coherente con lo implementado en `lib/auth.js` y `app/api/auth/login/route.js`.

## Flujo completo de autenticación

1. **Login** (`POST /api/auth/login`):
   - Recibe `{ usuario, password }`, valida que ambos existan (`400` si faltan).
   - Busca en `administrativo.cred_usuarios` por `usuario` **y `activo=true`** (usuarios desactivados no pueden autenticar aunque la contraseña sea correcta).
   - Compara con `bcrypt.compare(password, user.password_hash)` (`bcryptjs`); en cualquiera de los dos casos de fallo (usuario no existe o contraseña incorrecta) responde `401` con el mismo mensaje genérico `'Usuario o contraseña incorrectos'`.
   - Actualiza `ultimo_acceso=NOW()`.
   - Registra auditoría de `ACCIONES.LOGIN` / `MODULOS.AUTH` con IP obtenida de `x-forwarded-for` / `x-real-ip` (o `'local'` si ninguno está presente) — ver [[Base de Datos]] para el esquema de `cred_auditoria`.
   - Emite el JWT y lo setea como cookie `httpOnly`.
2. **Requests subsecuentes**: `middleware.js` intercepta toda ruta no pública, verifica el JWT de la cookie y deja pasar o redirige a `/login`.
3. **`GET /api/auth/me`**: lee la cookie con `cookies()` de `next/headers`, verifica el token con `verificarToken` y devuelve `{ user: { nombre, usuario, rol } }` o `{ user: null }` si no hay token o es inválido. No distingue entre "no autenticado" y "token corrupto" en la respuesta (ambos casos devuelven `user: null` con `200 OK`).
4. **Logout** (`POST /api/auth/logout`): simplemente `res.cookies.delete(COOKIE)` y responde `{ ok: true }`. No invalida el token en servidor (no hay blacklist/registro de tokens revocados) — el JWT eliminado del navegador seguiría siendo criptográficamente válido hasta su expiración natural de 8h si se reenviara manualmente (p.ej. capturado antes del logout).

## Manejo de errores y hardening observado

- `login/route.js` envuelve toda la lógica en `try/catch` y en el catch general devuelve `error.message` con `500` — filtra el mensaje de error interno (potencialmente detalles de PostgreSQL) al cliente en caso de fallo inesperado.
- Los mensajes de error de credenciales son deliberadamente genéricos (no revelan si el usuario no existe vs. contraseña incorrecta).
- El hash de contraseña usa `bcryptjs` (`bcrypt.compare`), no se ve el hashing en estos archivos (ocurre presumiblemente en `app/api/usuarios/route.js` al crear usuarios, fuera del alcance de esta nota — ver [[API Endpoints]]).
- No hay rate limiting ni bloqueo por intentos fallidos visible en `login/route.js`: no hay contador de intentos, `lockout`, ni captcha. Un atacante puede intentar fuerza bruta contra `/api/auth/login` sin restricción a nivel de aplicación.
- No hay CSRF token explícito; la mitigación depende únicamente de `sameSite: 'lax'` en la cookie.

## Relación con auditoría

`lib/auditoria.js` expone `getUsuarioDesdeRequest(request)`, que re-lee la cookie `itl_session` y llama `verificarToken` para reconstruir el usuario que ejecuta una acción, usado por casi todos los endpoints mutables para registrar `usuario_id` / `usuario_nombre` en `administrativo.cred_auditoria`. Ver [[Auditoría]] para el detalle de esa tabla y de la función `auditar`.

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

Nótese que este objeto retornado **no incluye `rol`**, dato relevante para la sección de hallazgos.

## ⚠️ Hallazgos y riesgos

1. **`GET /api/backup` expone `password_hash` de todos los usuarios sin ningún control de rol.** El handler `GET` en `app/api/backup/route.js` llama a `getUsuarioDesdeRequest(request)` solo para fines informativos (`generado_por`), pero no verifica `rol` en absoluto. Como el middleware solo exige "estar autenticado" (cualquier `admin` u `operador`), **cualquier usuario logueado del sistema** puede descargar un JSON completo de respaldo que incluye la tabla `cred_usuarios` completa con `password_hash` de todos los usuarios (`query('SELECT id, nombre, usuario, password_hash, rol, activo, ultimo_acceso FROM administrativo.cred_usuarios')`). Esto permite a un `operador` exfiltrar los hashes bcrypt de todas las cuentas, incluidas las de `admin`, para intentar crackearlos offline.

2. **`verificarAdmin()` está definida pero nunca se invoca.** En `app/api/backup/route.js` existe la función `verificarAdmin(request)` con el comentario `// ─── Solo administradores ───`, pero no aparece ninguna llamada a `verificarAdmin(...)` en todo el archivo (confirmado por búsqueda textual). El `POST /api/backup` (restauración completa de la base de datos, incluyendo `TRUNCATE ... CASCADE` de las tablas de negocio) solo verifica `if (!u?.id) return ... 403`, es decir, **solo exige estar autenticado**, no ser `admin`, a pesar de que el mensaje de error que devuelve dice textualmente `'Solo administradores pueden restaurar'`. Cualquier `operador` autenticado puede ejecutar un `TRUNCATE CASCADE` sobre `cred_pagos`, `cred_historial_recalculos`, `cred_cuotas`, `cred_movimientos_caja`, `cred_productos`, `cred_clientes` y `cred_configuracion`, y repoblarlas desde un JSON arbitrario que él mismo controla.

3. **Aunque `verificarAdmin()` se invocara, siempre fallaría.** `verificarAdmin` compara `u?.rol !== 'admin'`, pero `u` proviene de `getUsuarioDesdeRequest` (`lib/auditoria.js`), cuyo `return` es `{ id: payload?.id || null, nombre: payload?.nombre || 'Desconocido' }` — **no incluye la propiedad `rol`** aunque el JWT sí la contiene (`payload.rol` existe, ver `login/route.js`). Es decir, `u.rol` sería siempre `undefined`, por lo que `verificarAdmin` negaría el acceso incluso a un usuario `admin` legítimo. Esto es inconsistente con el propio propósito de la función y sugiere que el control de rol para backups nunca fue probado en ejecución real.

4. **Secreto JWT con valor por defecto hardcodeado en el código fuente.** Tanto `middleware.js` como `lib/auth.js` usan `process.env.JWT_SECRET || 'inversiones-tata-linan-secret-2026'`. Si la variable de entorno no está configurada en el entorno de despliegue, el sistema completo firma tokens con un secreto público (visible en el repositorio), permitiendo falsificar sesiones con cualquier `rol`, incluido `admin`.

5. **Cookie de sesión con `secure: false`.** En `app/api/auth/login/route.js`, la cookie `itl_session` (que contiene el JWT con `id`, `usuario`, `rol`) se emite con `secure: false`, permitiendo que viaje sobre HTTP no cifrado si el entorno no fuerza HTTPS por otra capa (proxy/CDN).

6. **No hay invalidación de sesión en servidor (logout no revoca el JWT).** `POST /api/auth/logout` solo borra la cookie del navegador; el token sigue siendo válido criptográficamente durante el resto de su ventana de 8h si fue capturado previamente, ya que no existe lista de revocación ni versión de sesión persistida en `cred_usuarios`.

7. **No hay límite de intentos de login.** `app/api/auth/login/route.js` no implementa rate limiting, bloqueo temporal ni backoff tras intentos fallidos repetidos, dejando el endpoint expuesto a ataques de fuerza bruta/credential stuffing contra usuarios válidos conocidos.

Referencias cruzadas: [[Base de Datos]] (esquema `cred_usuarios`, `cred_auditoria`), [[API Endpoints]] (inventario completo de rutas y su exposición real), [[CLAUDE]] (índice general de la bóveda).
