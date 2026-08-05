# Componentes y Layout Frontend

> Documentación de la capa de UI compartida del App Router: `Sidebar`, `BottomNav`, `LayoutWrapper`, `KPICard` y el `RootLayout` (`app/layout.js`). Todos los componentes de navegación son Client Components (`'use client'`) y basan su estado en `usePathname()`; no existe un contexto global de usuario ni de layout — cada pieza resuelve su propio estado por fetch.

## 1. Resumen de componentes

| Componente | Archivo | Client/Server | Se renderiza en |
|---|---|---|---|
| `RootLayout` | `app/layout.js` | Server Component | Toda la app (raíz del árbol) |
| `LayoutWrapper` | `components/LayoutWrapper.jsx` | Client (`'use client'`) | Envuelve `children` dentro de `RootLayout` |
| `Sidebar` | `components/Sidebar.jsx` | Client (`'use client'`) | Desktop fijo (`lg:block`) + drawer móvil bajo demanda |
| `BottomNav` | `components/BottomNav.jsx` | Client (`'use client'`) | Solo móvil (`lg:hidden`), fija al fondo |
| `KPICard` | `components/KPICard.jsx` | Server Component (sin `'use client'`) | Tarjetas de indicadores en dashboards/informes |

## 2. `Sidebar.jsx`

### 2.1 Cuándo se renderiza

`Sidebar` **no decide por sí mismo si es desktop o móvil** — es un componente "tonto" reutilizado en dos contextos distintos por `LayoutWrapper`:

```jsx
{/* Sidebar desktop */}
<div className="hidden lg:block">
  <Sidebar />
</div>

{/* Sidebar móvil — drawer */}
{sidebarAbierto && (
  <>
    <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarAbierto(false)} />
    <div className="fixed left-0 top-0 h-full z-50 lg:hidden">
      <Sidebar onClose={() => setSidebarAbierto(false)} />
    </div>
  </>
)}
```

- **Desktop**: siempre montado, visible desde el breakpoint `lg` (`hidden lg:block`).
- **Móvil**: solo se monta cuando `sidebarAbierto === true` (estado que vive en `LayoutWrapper`, activado por el botón hamburguesa del header móvil), como drawer con overlay oscuro (`bg-black/50`) que cierra al hacer clic fuera.

La única diferencia de comportamiento entre ambos casos es la prop `onClose`: si se pasa (caso móvil), aparece un botón de cierre (`✕`) en la cabecera del sidebar y cada `Link` lo ejecuta al navegar (`onClick={onClose}`).

### 2.2 Ítems de navegación (lista completa)

Array `nav` (fijo para todos los usuarios):

| Orden | Label | Ruta (`href`) | Icono |
|---|---|---|---|
| 1 | Dashboard | `/` | 📊 |
| 2 | Clientes | `/clientes` | 👥 |
| 3 | Préstamos | `/prestamos` | 💰 |
| 4 | Unificar Créditos | `/prestamos/unificar` | 🔗 |
| 5 | Cobros | `/cobros` | 💳 |
| 6 | Empeños | `/empenos` | 🔒 |
| 7 | Cred. Sin Cuotas | `/creditos-libres` | 📅 |
| 8 | Recibos | `/recibos` | 🧾 |
| 9 | Empresas | `/gastos` | 🏢 |
| 10 | Informes | `/informes` | 📊 |
| 11 | Migración | `/migracion` | 📦 |

`/creditos-libres` corresponde al módulo documentado en [[Créditos Sin Cuotas Futuras]] y `/gastos` al de [[Empresas y Gastos]]. Ver también [[Estructura de Directorios]] para el mapeo completo de rutas del App Router.

Adicionalmente, **solo si `user?.rol === 'admin'`**, se agregan (hardcodeados fuera del array `nav`, no forman parte de la lista anterior):

| Label | Ruta | Icono |
|---|---|---|
| Configuración | `/configuracion` | ⚙️ |
| Usuarios | `/usuarios` | 👤 |
| Auditoría | `/auditoria` | 📋 |
| Copia de seguridad | `/backup` | 🛡️ |

El rol se obtiene con un `fetch` propio al montar el componente:

```jsx
const [user, setUser] = useState(null)
useEffect(() => {
  fetch('/api/auth/me').then(r=>r.json()).then(d => setUser(d.user))
}, [])
```

### 2.3 Lógica de resaltado de ítem activo

```jsx
const otroMasEspecifico = item.href === '/prestamos' && pathname.startsWith('/prestamos/unificar')
const active = !otroMasEspecifico && (pathname === item.href ||
  (item.href !== '/' && pathname.startsWith(item.href)))
```

Es un `startsWith` genérico, con una excepción explícita en código: cuando la ruta activa es `/prestamos/unificar`, el ítem "Préstamos" (`/prestamos`) **no** se marca activo simultáneamente, para que solo se resalte "Unificar Créditos". Los ítems de admin usan la comparación simple `pathname.startsWith(...)` sin esta excepción.

### 2.4 Pie del sidebar: sesión y cierre

```jsx
const cerrarSesion = async () => {
  await fetch('/api/auth/logout', { method: 'POST' })
  router.push('/login')
  router.refresh()
}
```

Muestra nombre y rol del usuario (`user.nombre`, `user.rol`) si ya resolvió el fetch, un botón "🚪 Cerrar sesión", y un bloque estático de crédito de desarrollo ("Ing. Nelson Javier Ruiz Lozano" / "⚡ DataDevs Systems").

> ⚠️ El fetch a `/api/auth/me` es asíncrono y sin loading state: en el primer render `user` es `null`, por lo que los enlaces de administrador (Configuración, Usuarios, Auditoría, Backup) y el bloque "Conectado como" aparecen con un frame de retraso, incluso para usuarios admin.

## 3. `BottomNav.jsx`

### 3.1 Cuándo se renderiza

Confirmado en código: es **exclusivamente móvil**. La barra principal usa `lg:hidden` y se monta siempre (no depende de ningún estado de `LayoutWrapper`, a diferencia del `Sidebar` móvil):

```jsx
<nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-30">
```

No existe un equivalente "BottomNav desktop": en `lg` desaparece por completo y la navegación pasa a depender solo del `Sidebar`.

### 3.2 Navegación principal (siempre visible en la barra)

| Label | Ruta | Icono |
|---|---|---|
| Inicio | `/` | 📊 |
| Cobros | `/cobros` | 💳 |
| Clientes | `/clientes` | 👥 |
| Créditos | `/prestamos` | 💰 |

### 3.3 Navegación secundaria (drawer "Más")

Un quinto botón fijo ("⋯" / "✕" según estado) abre un drawer (`masAbierto`) con grid de 5 columnas:

| Label | Ruta | Icono |
|---|---|---|
| Empresas | `/gastos` | 🏢 |
| Sin Cuotas | `/creditos-libres` | 📅 |
| Empeños | `/empenos` | 🔒 |
| Recibos | `/recibos` | 🧾 |
| Informes | `/informes` | 📈 |
| Migración | `/migracion` | 📦 |

El botón "Más" se resalta (línea azul superior + texto azul) si la ruta actual coincide con **cualquier** ítem de `navSecundario`:

```jsx
const enSecundario = navSecundario.some(item =>
  pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
)
```

El drawer se cierra al seleccionar un ítem (`onClick={() => setMasAbierto(false)}`) o al tocar el overlay (`fixed inset-0 z-40 lg:hidden`).

> ⚠️ `BottomNav` no incluye enlaces a `/configuracion`, `/usuarios`, `/auditoria` ni `/backup`: las secciones de administración solo son accesibles desde el `Sidebar` desktop o el drawer móvil del `Sidebar` — en móvil, un admin debe abrir el sidebar (hamburguesa) para llegar a ellas, `BottomNav` no las expone.

## 4. `LayoutWrapper.jsx`

### 4.1 Rutas públicas vs. shell de aplicación

```jsx
const RUTAS_PUBLICAS = ['/login', '/estado', '/registro', '/autoregistro']
...
const esPublica = RUTAS_PUBLICAS.some(r => pathname.startsWith(r))
if (esPublica) return <>{children}</>
```

Si la ruta actual empieza por cualquiera de esos cuatro prefijos, `LayoutWrapper` **no** renderiza sidebar, header ni bottom nav: devuelve `children` a secas.

> ⚠️ La detección es por prefijo de string (`startsWith`), no por estado de autenticación real. No hay ningún chequeo de sesión en este componente ni en `app/layout.js`; el control de acceso a rutas privadas debe vivir en otra capa (middleware o el propio endpoint `/api/auth/me` consumido por `Sidebar`).

### 4.2 Composición del shell (rutas privadas)

Para rutas no públicas arma tres piezas responsivas:

- **Sidebar desktop**: `<div className="hidden lg:block"><Sidebar /></div>`.
- **Header móvil** (`lg:hidden`, `sticky top-0`): botón hamburguesa que abre el drawer del sidebar (`setSidebarAbierto(true)`), marca "💼 Inversiones / Hnos Liñán", y un botón `+` (`Link` a `/prestamos/nuevo`) para crear préstamo rápido.
- **`<main>`**: `flex-1 p-4 lg:p-8 pb-24 lg:pb-8 overflow-auto` — el `pb-24` en móvil reserva espacio para no quedar tapado por el `BottomNav` fijo.
- **`BottomNav`**: montado siempre al final del árbol (se auto-oculta en desktop vía `lg:hidden` interno).

### 4.3 Banner de "modo prueba" — confirmado y su mecanismo real

Se confirma en código: existe un banner global de modo prueba, y **se activa mediante fetch a un endpoint**, no por variable de entorno ni flag estático:

```jsx
const [modoPrueba, setModoPrueba] = useState(false)

useEffect(() => {
  fetch('/api/config/modo-prueba')
    .then(r => r.json())
    .then(d => setModoPrueba(d.activo))
    .catch(() => {})
}, [pathname]) // re-chequea cada vez que cambia de página
```

```jsx
{modoPrueba && (
  <div className="bg-amber-400 text-amber-900 px-4 py-2 flex items-center justify-between text-sm font-semibold">
    <span>🧪 MODO PRUEBA ACTIVO — Se permiten fechas futuras en pagos</span>
    <Link href="/migracion" className="underline hover:text-amber-950 text-xs whitespace-nowrap ml-4">
      Desactivar →
    </Link>
  </div>
)}
```

Puntos clave verificados:

- El fetch se repite en **cada cambio de `pathname`** (dependencia `[pathname]` del `useEffect`), es decir, se revalida al navegar entre páginas, no solo al montar la app.
- El endpoint debe responder JSON con forma `{ activo: boolean }`; el estado se asigna directo (`d.activo`).
- El enlace "Desactivar →" del banner apunta a `/migracion`, sugiriendo que el flag de modo prueba se administra desde ese módulo.
- El banner se renderiza entre el header móvil y el `<main>`, por lo que aparece tanto en desktop como en móvil (no tiene clase `lg:hidden`).

> ⚠️ El fetch usa `.catch(() => {})`: si `/api/config/modo-prueba` falla o no existe, el error se silencia por completo y el banner simplemente no aparece — no hay logging ni feedback de error visible para el usuario ni para desarrollo.

## 5. `KPICard.jsx`

### 5.1 API de props

| Prop | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| `titulo` | `string` | Sí | — | Texto descriptivo bajo el ícono (ej. "Cartera activa") |
| `valor` | `string \| number` | Sí | — | Valor principal, mostrado en grande y negrita |
| `icono` | `string` (emoji/texto) | Sí | — | Ícono grande superior izquierdo |
| `color` | `'blue' \| 'green' \| 'red' \| 'yellow'` | No | `'blue'` | Paleta de fondo/borde/texto de la tarjeta |
| `alerta` | `boolean` | No | `false` | Fuerza color rojo y agrega badge "!" |

```jsx
export default function KPICard({ titulo, valor, icono, color = 'blue', alerta = false }) {
  const colores = {
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    red:    'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  }
  return (
    <div className={`rounded-xl border p-5 ${colores[alerta ? 'red' : color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-4xl">{icono}</span>
        {alerta && <span className="text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">!</span>}
      </div>
      <p className="text-base font-medium opacity-70">{titulo}</p>
      <p className="text-3xl font-bold mt-1">{valor}</p>
    </div>
  )
}
```

Uso típico en un dashboard:

```jsx
<KPICard titulo="Cartera activa" valor="$12.500.000" icono="💰" color="green" />
<KPICard titulo="Créditos vencidos" valor={3} icono="⚠️" alerta />
```

> ⚠️ `colores[alerta ? 'red' : color]`: si `alerta === true`, la tarjeta se pinta de rojo **sin importar el `color` recibido** — pasar `color="green"` junto con `alerta` no tiene efecto visual sobre la paleta, solo `alerta` decide.

No es Client Component (no tiene `'use client'`): puede renderizarse en Server Components sin restricción, ya que no usa hooks ni interactividad.

## 6. `app/layout.js` (Root Layout)

```jsx
import './globals.css'
import LayoutWrapper from '@/components/LayoutWrapper'

export const metadata = {
  title: 'Inversiones Hnos Liñan',
  description: 'Gestión de préstamos, carteras mixtas y empeños',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="bg-gray-50 text-gray-900" suppressHydrationWarning>
        <LayoutWrapper>{children}</LayoutWrapper>
      </body>
    </html>
  )
}
```

| Aspecto | Estado real en el código |
|---|---|
| Metadata | Objeto estático `metadata` con `title` y `description` únicamente. No hay `generateMetadata`, ni `viewport`, ni `icons`/`openGraph`. |
| Fuentes | **No se usa `next/font`** en absoluto (ni `next/font/google` ni `next/font/local`). No hay import de fuente ni `className` de fuente en `<html>`/`<body>`; la tipografía depende de lo definido en `globals.css`/Tailwind por defecto. |
| Providers | **Ninguno.** No hay `ThemeProvider`, `SessionProvider`, `QueryClientProvider` ni contexto de React envolviendo la app. La única envoltura es `LayoutWrapper`. |
| Idioma | `lang="es"` fijo en `<html>`. |
| Hidratación | `suppressHydrationWarning` en `<html>` y `<body>` (típico cuando hay diferencias cliente/servidor esperadas, coherente con que `LayoutWrapper` decide su render vía `usePathname` y fetches client-side). |
| Estilos globales | Import de `./globals.css`; `bg-gray-50 text-gray-900` aplicado directo en `<body>` vía Tailwind. |

> ⚠️ Todo el árbol de layout de la app (sidebar, bottom nav, banner de modo prueba, header móvil) depende de `usePathname()` y de `fetch` en el cliente. `RootLayout` en sí es un Server Component "delgado" que no aporta lógica de negocio ni datos — toda la decisión de qué mostrar ocurre en `LayoutWrapper` y `Sidebar` ya en el navegador.

## 7. Notas relacionadas

- [[Estructura de Directorios]] — mapeo completo de rutas del App Router referenciadas en `Sidebar`/`BottomNav`.
- [[Créditos Sin Cuotas Futuras]] — módulo detrás de la ruta `/creditos-libres`.
- [[Empresas y Gastos]] — módulo detrás de la ruta `/gastos`.
- [[CLAUDE]] — convenciones generales del proyecto para componentes Next.js/Tailwind.
