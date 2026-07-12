# PROMPT.md — Cómo cargar la base de conocimiento

> Instrucciones para que Claude arranque correctamente en cada sesión de trabajo
> sobre el proyecto **Inversiones Tata Liñán**.

---

## Prompt de inicio — cópialo y pégalo al comenzar cada sesión

```
Eres el asistente de desarrollo del proyecto "Inversiones Tata Liñán".
Antes de responder cualquier pregunta o tocar cualquier archivo, lee en este orden:

1. base_de_conocimiento/CLAUDE.md         ← índice y protocolo
2. base_de_conocimiento/Stack Tecnológico.md
3. base_de_conocimiento/Estructura de Directorios.md
4. base_de_conocimiento/Base de Datos.md
5. base_de_conocimiento/API Endpoints.md
6. base_de_conocimiento/Lógica Financiera y Calificación.md
7. base_de_conocimiento/Flujos de Negocio.md
8. base_de_conocimiento/Créditos Sin Cuotas Futuras.md

Una vez leídos, responde:
- ¿Qué módulos tiene el sistema actualmente?
- ¿Cuál es la regla más importante que no se puede romper en el módulo de créditos libres?
- ¿Qué convención de días usa ese módulo y por qué?

Con eso confirmo que cargaste bien el contexto y podemos trabajar.
```

---

## Reglas que Claude NUNCA puede romper

1. **No tocar `lib/calculos.js`** para el módulo de créditos libres — tiene su propio motor con convención 30/360.
2. **No llamar `/api/pagos`** desde `/api/creditos-libres/*` — son sistemas paralelos e independientes.
3. **No almacenar `estado='mora'` en `cred_cuotas`** — la mora se deriva dinámicamente por `fecha_vencimiento < CURRENT_DATE`.
4. **No filtrar créditos en mora por `p.estado === 'en_mora'`** — usar `cuotas_mora > 0` (calculado dinámicamente).
5. **No crear congelación con tasa > 0** — forzar `tasa=0` y `con_interes=false` en frontend Y backend.
6. **Siempre usar `fecha_primer_pago`** como punto de partida del interés en créditos libres — no `fecha_creacion`.
7. **Siempre leer el archivo antes de editarlo** — nunca editar sin haber hecho `Read` en la sesión actual.

---

## Convenciones de código obligatorias

```js
// Esquema siempre con constante
const S = 'administrativo'

// IDs siempre con uuid
import { v4 as uuidv4 } from 'uuid'
const id = uuidv4()

// Fechas: evitar desfase UTC-5 (Colombia)
// MAL:
new Date("2026-05-01").toLocaleDateString('es-CO')
// BIEN:
new Date("2026-05-01" + 'T12:00:00').toLocaleDateString('es-CO', {...})

// Normalizar fechas DATE de pg antes de enviar al frontend
const toYMD = v => !v ? null
  : typeof v === 'string' ? v.slice(0, 10)
  : new Date(v).toISOString().slice(0, 10)

// Consecutivo de recibo (atómico)
const r = await query(`UPDATE administrativo.cred_configuracion
  SET valor = (valor::int + 1)::text WHERE clave = 'recibo_consecutivo'
  RETURNING (valor::int - 1) AS consecutivo`)
const numeroRecibo = 'REC-' + String(parseInt(r.rows[0].consecutivo)).padStart(6, '0')

// Formato moneda
new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

// Input de capital — NUNCA type="number" step=
// BIEN:
<input type="text" inputMode="numeric" />
// con handler: replace(/[^0-9]/g, '') + Intl.NumberFormat para display

// Auditoría en todo endpoint mutante
await auditar({ usuarioId, usuarioNombre, accion, modulo, descripcion, detalle, request })

// Errores de BD
return NextResponse.json({ error: error.message }, { status: 500 })
```

---

## Cómo actualizar la base de conocimiento

Cuando se implemente algo nuevo o se corrija un bug importante:

| Cambio | Archivo a actualizar |
|--------|----------------------|
| Nueva tabla o columna | `Base de Datos.md` |
| Nuevo endpoint | `API Endpoints.md` |
| Nuevo flujo transaccional | `Flujos de Negocio.md` |
| Nuevo cálculo financiero | `Lógica Financiera y Calificación.md` |
| Nueva carpeta o archivo | `Estructura de Directorios.md` |
| Nuevo módulo completo | Crear archivo propio + enlazar en `CLAUDE.md` |
| Bug crítico corregido | Módulo afectado + tabla de bugs con fecha |

Al terminar, actualiza el índice en `CLAUDE.md` si se creó un archivo nuevo.
