# PROMPT.md — Instrucciones de Arranque para Claude

> Este archivo le indica a Claude cómo cargar y usar la base de conocimiento
> del proyecto **Inversiones Tata Liñán** al inicio de cada sesión de trabajo.

---

## ¿Qué hacer al comenzar una sesión?

**Paso 1 — Leer la base de conocimiento completa:**

```
Lee el archivo CLAUDE.md en su totalidad antes de responder cualquier pregunta
o modificar cualquier archivo del proyecto.
```

El archivo `CLAUDE.md` contiene:
- Visión general del sistema y stack tecnológico
- Estructura completa de directorios
- Esquema de base de datos (todas las tablas y columnas)
- Lógica financiera y reglas de negocio
- Todos los endpoints de la API
- Módulos del sistema y sus comportamientos
- Convenciones de código obligatorias
- Bugs conocidos y sus correcciones
- Migraciones SQL aplicadas (historial)

**Paso 2 — Leer archivos específicos si la tarea lo requiere:**

Antes de modificar cualquier archivo, léelo primero con el tool `Read`. Nunca edites
un archivo que no hayas leído en la sesión actual.

**Paso 3 — Verificar convenciones antes de escribir código:**

- Siempre `const S = 'administrativo'` en Route Handlers
- IDs con `uuidv4()` en la capa de aplicación
- Fechas: siempre `split('-')` o `+ 'T12:00:00'` para evitar desfase UTC-5
- Formato moneda: `Intl.NumberFormat('es-CO', { style:'currency', currency:'COP' })`
- Auditoría en todos los endpoints que escriben datos
- Errores: `{ error: error.message }` status 500

---

## Reglas críticas que nunca se pueden romper

1. **NO tocar `lib/calculos.js`** para el módulo de créditos libres — tiene su propio motor.
2. **NO llamar `/api/pagos`** desde el módulo `creditos-libres` — son sistemas paralelos.
3. **NO usar `estado='mora'` como campo almacenado** en `cred_cuotas` — la mora se deriva dinámicamente por fecha.
4. **NO filtrar créditos en mora por `p.estado === 'en_mora'`** — usar `cuotas_mora > 0`.
5. **NO crear crédito tipo `congelacion` con tasa > 0** — forzar `tasa=0` y `con_interes=false` en frontend Y backend.
6. **El campo `fecha_primer_pago`** almacena la fecha de inicio ingresada por el usuario (no la fecha de inserción). Siempre usarlo como punto de partida para cálculos de interés.

---

## Módulos activos en el sistema

| Ruta | Descripción |
|------|-------------|
| `/` | Dashboard — KPIs y listas de cobro |
| `/clientes` | Gestión de clientes con QR de estado |
| `/prestamos` | Cartera de créditos con cuotas |
| `/cobros` | Brújula de cobro diario |
| `/empenos` | Empeños próximos a vencer |
| `/creditos-libres` | **Créditos Sin Cuotas Futuras** (módulo nuevo) |
| `/recibos` | Búsqueda de recibos por número |
| `/informes` | Reportes y exportación Excel |
| `/migracion` | Importación masiva + zona de desarrollo |
| `/configuracion` | Tipos de préstamo dinámicos (admin) |
| `/backup` | Copias de seguridad (admin) |
| `/usuarios` | Gestión de usuarios (admin) |
| `/auditoria` | Log de acciones del sistema |

---

## Migraciones SQL aplicadas (no correr de nuevo)

| Archivo | Estado |
|---------|--------|
| `00_schema_completo.sql` | Base idempotente — se puede correr siempre |
| `03` al `19` | Aplicadas — no tocar |
| `20_sin_cuotas_futuras.sql` | Aplicada vía `autoMigrar()` — no requiere ejecución manual |

---

## Patrones de implementación establecidos

### Auto-migración (módulo creditos-libres)
```js
async function autoMigrar() {
  await query(`ALTER TABLE administrativo.cred_pagos ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`)
  await query(`ALTER TABLE administrativo.cred_tipos_prestamo DROP CONSTRAINT IF EXISTS cred_tipos_prestamo_comportamiento_check`)
  await query(`INSERT INTO administrativo.cred_tipos_prestamo (...) ON CONFLICT (codigo) DO NOTHING`)
}
// Llamar al inicio de cada GET y POST del módulo
```

### Convención 30/360 (créditos libres)
```js
function diasD360(inicioStr, finStr) {
  const [y1, m1, d1] = inicioStr.split('-').map(Number)
  const [y2, m2, d2] = finStr.split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}
```

### Fechas sin desfase UTC (Colombia UTC-5)
```js
// MAL — puede mostrar el día anterior
new Date("2026-05-01").toLocaleDateString('es-CO')

// BIEN — mediodía local evita el desfase
new Date("2026-05-01" + 'T12:00:00').toLocaleDateString('es-CO', {...})

// En APIs: normalizar fechas DATE de pg a string antes de enviar
const toYMD = v => !v ? null
  : typeof v === 'string' ? v.slice(0, 10)
  : new Date(v).toISOString().slice(0, 10)
```

### Consecutivo de recibo (atómico, sin transacción global)
```js
const reciboRes = await query(
  `UPDATE administrativo.cred_configuracion
   SET valor = (valor::int + 1)::text
   WHERE clave = 'recibo_consecutivo'
   RETURNING (valor::int - 1) AS consecutivo`
)
const numeroRecibo = 'REC-' + String(parseInt(reciboRes.rows[0].consecutivo)).padStart(6, '0')
```

### Input de capital con formato moneda (sin restricción de step)
```js
// BIEN — type text con handler manual
<input type="text" inputMode="numeric" value={capitalDisplay}
  onChange={e => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    const num = raw ? parseInt(raw, 10) : ''
    setCapital(num === '' ? '' : String(num))
    setCapitalDisplay(num === '' ? '' : new Intl.NumberFormat('es-CO').format(num))
  }} />

// MAL — step genera secuencia inválida y rechaza valores como 1.000.000
<input type="number" step="1000" min="1" />
```

---

## Cómo actualizar esta base de conocimiento

Cada vez que se implemente una funcionalidad nueva o se corrija un bug importante:

1. Actualizar la sección correspondiente en `CLAUDE.md` (estructura, tabla, API, módulo).
2. Si hay nueva migración SQL, agregarla a la tabla de migraciones en §9.
3. Si hay nuevo módulo, añadir su descripción en §10 y sus endpoints en §6.
4. Si hay un bug relevante corregido, documentarlo en el módulo afectado con la fecha.
5. Ejecutar este prompt al inicio de la siguiente sesión para que Claude arranque con contexto completo.

---

## Prompt de inicio recomendado para cada sesión nueva

Copia y pega esto al inicio de cada conversación con Claude sobre este proyecto:

```
Lee el archivo CLAUDE.md completo y PROMPT.md del proyecto Inversiones Tata Liñán
antes de responder. Este es el sistema de gestión de créditos. Una vez hayas leído
la base de conocimiento, dime que estás listo y qué entendiste del estado actual
del sistema para confirmar que lo cargaste correctamente.
```
