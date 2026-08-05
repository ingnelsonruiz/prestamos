# Usuarios e Informes

> Módulo administrativo de **Inversiones Tata Liñán** que cubre la gestión de cuentas de acceso al sistema (`administrativo.cred_usuarios`) y el módulo de reportería financiera (intereses cobrados, capital recuperado, KPIs históricos). Basado en los archivos `app/api/usuarios/route.js`, `app/api/usuarios/[id]/route.js`, `app/usuarios/page.js`, `app/api/informes/route.js` y `app/informes/page.js`.

## 1. Módulo de Usuarios

### 1.1 Endpoints disponibles

| Método | Ruta | Función |
|---|---|---|
| `GET` | `/api/usuarios` | Lista todos los usuarios (sin `password_hash`) |
| `POST` | `/api/usuarios` | Crea un usuario nuevo |
| `PUT` | `/api/usuarios/[id]` | Edita nombre/rol/activo y/o cambia la contraseña |
| `DELETE` | `/api/usuarios/[id]` | Desactivación lógica (`activo = false`), **no borra el registro** |

> Sí existe `POST /api/usuarios` — está implementado en `app/api/usuarios/route.js` junto al `GET`. No hace falta un seed manual en BD para crear usuarios; el alta se hace desde la UI de `/usuarios`.

### 1.2 Modelo de datos — `administrativo.cred_usuarios`

Columnas confirmadas por las consultas SQL de estas rutas:

| Campo | Origen / uso |
|---|---|
| `id` | `uuid` generado con `uuidv4()` en el backend (no lo asigna Postgres) |
| `nombre` | Nombre completo, obligatorio en el alta |
| `usuario` | Login, obligatorio y único (constraint `UNIQUE`) |
| `password_hash` | Hash bcrypt, nunca se expone en `SELECT` de `GET` |
| `rol` | `'admin'` \| `'operador'` (default `'operador'`) |
| `activo` | boolean, controla si puede iniciar sesión |
| `fecha_creacion` | Usada para ordenar el listado (`ORDER BY fecha_creacion`) |
| `ultimo_acceso` | Se muestra en la UI (`Nunca` si es `null`); se actualiza en la ruta de login (ver [[Autenticación y Seguridad]]) |

### 1.3 Alta de usuario — `POST /api/usuarios`

```js
const { nombre, usuario, password, rol } = await request.json()
if (!nombre || !usuario || !password)
  return NextResponse.json({ error: 'Nombre, usuario y contraseña son obligatorios' }, { status: 400 })

const hash = await bcrypt.hash(password, 10)
const id   = uuidv4()

const res = await query(
  `INSERT INTO ${S}.cred_usuarios (id, nombre, usuario, password_hash, rol)
   VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, usuario, rol, activo`,
  [id, nombre, usuario, hash, rol || 'operador']
)
```

- Hash con **bcryptjs**, `saltRounds = 10` (valor estándar razonable).
- Si `rol` no se envía, cae a `'operador'` por defecto.
- Colisión de `usuario` duplicado se traduce del código Postgres `23505` a un 409 `"El usuario ya existe"`.
- Cada alta se registra en auditoría: `ACCIONES.CREAR_USUARIO`, módulo `MODULOS.USUARIOS` (ver [[Auditoría]]).

### 1.4 Edición y cambio de contraseña — `PUT /api/usuarios/[id]`

```js
const { nombre, rol, activo, password } = await request.json()

if (password) {
  const hash = await bcrypt.hash(password, 10)
  await query(`UPDATE ${S}.cred_usuarios SET password_hash=$1 WHERE id=$2`, [hash, id])
  await auditar({ ...u, accion: ACCIONES.CAMBIAR_CLAVE, modulo: MODULOS.USUARIOS, ... })
}

const res = await query(
  `UPDATE ${S}.cred_usuarios
   SET nombre=COALESCE($1,nombre), rol=COALESCE($2,rol), activo=COALESCE($3,activo)
   WHERE id=$4 RETURNING id, nombre, usuario, rol, activo`,
  [nombre||null, rol||null, activo??null, id]
)
```

- El cambio de contraseña es un `UPDATE` **separado** del de datos generales; ambos se ejecutan si `password` viene presente, pero cada uno hace su propio `query`.
- `COALESCE` permite enviar solo el campo que se quiere tocar (patrón usado también por `toggleActivo` en el frontend, que solo manda `{ activo: !u.activo }`).
- El cambio de clave se audita con `ACCIONES.CAMBIAR_CLAVE`.

### 1.5 Baja — `DELETE /api/usuarios/[id]`

```js
await query(`UPDATE ${S}.cred_usuarios SET activo=false WHERE id=$1`, [id])
```

Es una **desactivación lógica**, no un `DELETE` real. El registro permanece en la tabla (relevante para trazabilidad de pagos/créditos históricos que referencian `usuario_nombre`).

### 1.6 Roles

| Rol | Valor en BD | Descripción (según UI en `usuarios/page.js`) |
|---|---|---|
| Operador | `operador` | "acceso normal" — valor por defecto al crear |
| Admin | `admin` | "gestión de usuarios" |

```jsx
<option value="operador">Operador — acceso normal</option>
<option value="admin">Admin — gestión de usuarios</option>
```

> ⚠️ **Hallazgo verificado — sin control de autorización por rol en las rutas de usuarios.** Ni `POST /api/usuarios`, ni `PUT /api/usuarios/[id]`, ni `DELETE /api/usuarios/[id]` verifican en el código que `getUsuarioDesdeRequest(request)` tenga `rol === 'admin'` antes de ejecutar la operación. El objeto `u` obtenido de esa función solo se usa para **auditar quién hizo el cambio**, nunca para autorizar. Si un `operador` autenticado logra invocar directamente estos endpoints, puede crear usuarios `admin`, cambiar la contraseña de cualquier cuenta o reactivar/desactivar a cualquiera. Consistente con el mismo patrón de falta de autorización por rol ya documentado en [[Autenticación y Seguridad]] y [[Migración y Backup]].

> ⚠️ **Hallazgo verificado — política de contraseña inconsistente y débil.** El backend (`POST`/`PUT`) solo valida que `password` sea *truthy*, sin mínimo de longitud ni complejidad. El único control de longitud (mínimo 4 caracteres) vive exclusivamente en el frontend, en el modal "Cambiar contraseña" de `usuarios/page.js`:
> ```js
> if (!nuevaPass || nuevaPass.length < 4) { alert('Mínimo 4 caracteres'); return }
> ```
> Ese control no existe en el formulario de alta de usuario ni en el servidor: una contraseña de un solo carácter es aceptada por la API sin problema, y cualquier llamada directa a la API evita por completo el límite del frontend.

### 1.7 Interfaz — `app/usuarios/page.js`

- Tabla con columnas: Nombre, Usuario, Rol (badge morado `admin` / azul `operador`), Último acceso (`toLocaleString('es-CO')` o `"Nunca"`), Estado (badge verde `Activo` / gris `Inactivo`, fila atenuada con `opacity-50` si está inactivo).
- Acciones por fila: botón `🔑 Clave` (abre modal de cambio de contraseña) y botón `Desactivar`/`Activar` (toggle de `activo` vía `PUT`).
- Modal "Nuevo usuario": campos Nombre, Usuario, Contraseña (todos `required` en HTML, sin `minLength`) y selector de Rol.
- No hay componente de edición de nombre/rol de un usuario existente en la UI — el `PUT` solo se invoca desde la página para `activo` y `password`; cambiar `rol` o `nombre` de un usuario ya creado requeriría llamar la API manualmente (la funcionalidad backend existe, pero no tiene formulario asociado en esta página).

## 2. Módulo de Informes

### 2.1 `GET /api/informes` — parámetros

| Parámetro | Default | Notas |
|---|---|---|
| `desde` | 1 de enero del año actual | `new Date(new Date().getFullYear(), 0, 1)` |
| `hasta` | Fecha de hoy | |
| `tipo` | `'intereses'` | **Es el único tipo implementado**; cualquier otro valor devuelve `400 { error: 'Tipo de informe no válido' }` |

### 2.2 Cálculo de intereses (tipo `intereses`)

La fórmula central, repetida en las tres consultas (`resumen`, `detalle`, `totales`), reparte cada pago entre interés y capital de forma proporcional al peso del interés dentro de la cuota:

```sql
LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0)  -- interés cobrado
p.monto - (LEAST(p.monto, cu.monto_cuota) * cu.abono_interes / NULLIF(cu.monto_cuota, 0))  -- capital cobrado
```

- `LEAST(p.monto, cu.monto_cuota)` limita el prorrateo de interés al valor de la cuota, para que abonos que exceden la cuota (pagos anticipados/adelantos de capital) no inflen el interés calculado.
- El excedente sobre `monto_cuota` cae íntegramente en `capital_cobrado`.
- El propio nombre del campo (`intereses_estimados`) indica que es una aproximación contable, no un valor registrado de forma independiente en `cred_pagos`. Ver [[Dashboard y KPIs]] para la misma fórmula aplicada al KPI de intereses del dashboard.

### 2.3 Estructura de la respuesta (transcrita del código)

```json
{
  "desde": "2026-01-01",
  "hasta": "2026-08-05",
  "totales": {
    "num_pagos": 0,
    "num_clientes": 0,
    "total_recaudado": 0,
    "total_intereses": 0,
    "total_capital": 0
  },
  "resumen_mensual": [
    {
      "mes": "2026-01-01",
      "num_pagos": 0,
      "num_clientes": 0,
      "total_recaudado": 0,
      "intereses_estimados": 0,
      "capital_recuperado": 0
    }
  ],
  "detalle": [
    {
      "fecha": "2026-01-15",
      "numero_recibo": "REC-0001",
      "cliente": "...",
      "documento": "...",
      "tipo_producto": "prestamo | fiado",
      "descripcion_bien": "...",
      "numero_cuota": 1,
      "total_pago": 0,
      "interes_cobrado": 0,
      "capital_cobrado": 0,
      "metodo_pago": "efectivo | transferencia | ...",
      "registrado_por": "nombre del usuario que registró el pago",
      "notas": "..."
    }
  ]
}
```

Consultas relacionadas: `administrativo.cred_pagos` JOIN `administrativo.cred_cuotas` JOIN `administrativo.cred_clientes` JOIN `administrativo.cred_productos` (ver [[Base de Datos]]).

### 2.4 `app/informes/page.js` — qué muestra la UI

- **No usa Chart.js ni ninguna librería de gráficas** — el módulo es 100% tablas HTML. La única librería de datos importada es `xlsx` (SheetJS), usada exclusivamente para exportar a Excel, no para visualizar.
- **KPIs históricos globales** (arriba de todo, independientes del filtro de fechas): se obtienen de `GET /api/dashboard` (ver [[Dashboard y KPIs]]), del cual esta página consume `d.kpis`:
  - `total_invertido` → tarjeta "💼 Total invertido en préstamos" + `num_creditos`
  - `total_recuperado` → tarjeta "💰 Total recuperado" + `%` recuperado sobre lo invertido
  - `capital_en_calle` → tarjeta "📊 Capital en la calle"
- **Filtros**: rango `desde`/`hasta` (con `hasta` limitado a `max={hoy}`) y atajos rápidos "Este mes", "Este año", "Mes anterior". Se auto-consulta al montar el componente.
- **KPIs del período** (5 tarjetas): Total recaudado, Intereses cobrados, Capital recuperado, Número de pagos, Clientes únicos.
- **Tabla "Resumen por mes"**: Mes, Pagos, Clientes, Total recaudado, Intereses, Capital, con fila `TOTAL` en el `tfoot`.
- **Tabla "Detalle de pagos"**: Fecha pago, Recibo, Cliente, Tipo, Total, Interés, Capital, Método, Registró — con contador `(data.detalle.length)` en el encabezado.
- **Exportar a Excel** (`exportarExcel`, vía `XLSX.utils.book_new()`): genera un `.xlsx` de 3 hojas —
  1. `Resumen`: título, período, indicadores ejecutivos.
  2. `Por mes`: igual que la tabla en pantalla.
  3. `Detalle pagos`: igual que la tabla en pantalla, con una regla especial: si `numero_cuota === 1 && tipo_producto === 'fiado'` se muestra el texto `'Cuenta'` en vez del número de cuota.
  - Nombre de archivo: `Informe_Intereses_${desde}_${hasta}.xlsx`.

## 3. Recomendaciones

1. Añadir verificación explícita de `rol === 'admin'` en `POST/PUT/DELETE /api/usuarios` antes de mutar datos de usuarios — actualmente el rol del solicitante solo se usa para auditoría, no para autorizar.
2. Enforzar longitud mínima y complejidad de contraseña en el servidor (no solo en el modal de cambio de clave del frontend), y aplicar la misma regla también en el alta de usuario.
3. Documentar/implementar los `tipo` de informe adicionales que el diseño de `GET /api/informes` deja preparados (el manejo actual solo cubre `'intereses'`), o eliminar el parámetro si no se planea extender.
4. Confirmar que `ultimo_acceso` y el chequeo de `activo` efectivamente bloquean el ingreso de usuarios desactivados (ver [[Autenticación y Seguridad]]).

## Ver también

- [[Autenticación y Seguridad]]
- [[Base de Datos]]
- [[API Endpoints]]
- [[Dashboard y KPIs]]
- [[CLAUDE]]
