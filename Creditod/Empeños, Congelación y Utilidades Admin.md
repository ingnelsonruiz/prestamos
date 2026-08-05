# Empeños, Congelación y Utilidades Admin

> Documenta tres piezas que solo aparecen mencionadas de pasada en [[Base de Datos]] y [[Flujos de Negocio]]: la vista de negocio `/empenos` (alertas de vencimiento de bienes empeñados), el endpoint de mantenimiento `/api/admin/fix-interes-fijo` (backfill para revertir crédito plano mal configurado como interés fijo) y el endpoint de consulta `GET /api/cuotas` que ambos (y el resto de la app) usan para leer el libro de cuotas.

## 1. Vista `/empenos` — tablero de bienes empeñados

Archivo: `app/empenos/page.js`. Es un componente cliente (`'use client'`) puramente de lectura: **no tiene endpoint propio**, reutiliza `GET /api/productos?tipo=empeno` y filtra en el cliente el resultado (`d.filter(p=>p.tipo==='empeno')`), es decir hace un doble filtrado redundante (query string + filter en JS) sobre el mismo criterio.

```js
useEffect(() => {
  fetch('/api/productos?tipo=empeno')
    .then(r=>r.json())
    .then(d => setEmpenos(d.filter(p=>p.tipo==='empeno')))
},[])
```

### Cálculo de alertas de vencimiento

La vista no consulta ningún campo de "días restantes" precalculado en BD: lo calcula en el navegador a partir de `fecha_limite_rescate`, comparando contra `new Date()` local del cliente.

```js
const diasRestantes = fechaLimite => {
  if (!fechaLimite) return null
  return Math.ceil((new Date(fechaLimite) - new Date()) / (1000*60*60*24))
}
```

| Días restantes | Color de tarjeta | Etiqueta |
|---|---|---|
| `< 0` | roja (`bg-red-50 border-red-300`) | `VENCIDO` |
| `0` | roja | `HOY` |
| `1–3` | roja | `N días` (texto rojo) |
| `4–7` | naranja (`bg-orange-50 border-orange-300`) | `N días` (texto naranja) |
| `8–15` | amarilla (`bg-yellow-50 border-yellow-200`) | `N días` (texto amarillo) |
| `> 15` o sin `fecha_limite_rescate` | blanca | sin etiqueta |

> ⚠️ El umbral de alerta se calcula con la fecha/hora del navegador del usuario, no con `CURRENT_DATE` del servidor. Si el equipo que consulta la vista tiene el reloj o la zona horaria desconfigurada, las alertas de "≤ 3 días" pueden desviarse. Ningún job de servidor recalcula este dato; es puramente decorativo en el frontend.

### Qué NO hace esta vista

- **No hay acción de decomiso ni de rescate en la UI.** No existe botón "Decomisar" ni "Rescatar" en `page.js`; solo un enlace `Ver cuotas →` hacia `/prestamos/[id]` y un botón `+ Nuevo empeño` que redirige al flujo genérico `/prestamos/nuevo` (el mismo formulario de creación de créditos, no uno especializado en empeños).
- **No llama a ningún endpoint especial de empeños.** Todo el ciclo de vida (registrar bien, marcar `decomisado`, marcar `rescatado`) debe resolverse desde las pantallas genéricas de préstamo/pagos documentadas en [[Flujos de Negocio]] — esta vista es solo un tablero de monitoreo con semáforo de vencimiento.
- **No pagina ni filtra por estado desde la UI.** Trae todos los productos `tipo='empeno'` sin importar si están `pendiente`, `rescatado` o `decomisado`, y los pinta todos en la grilla (el badge de estado es la única diferenciación visual: verde=`rescatado`, gris=`decomisado`, azul=cualquier otro).

### Consumo de campos de dominio ya documentados

Usa directamente `descripcion_bien`, `valor_comercial_bien` y `fecha_limite_rescate` (ver `cred_productos` / comportamiento `empeno` en [[Base de Datos]]), sin transformación adicional del lado servidor.

## 2. `/api/admin/fix-interes-fijo` — backfill de reverso de interés fijo

Archivo: `app/api/admin/fix-interes-fijo/route.js`. Es un **endpoint administrativo de mantenimiento/backfill**, no una utilidad de negocio recurrente: corrige créditos `metodo_calculo='plano'` que quedaron marcados con `interes_fijo = TRUE` por error (el interés se calculó sobre el capital original en cada cuota en vez de sobre saldo decreciente), revirtiendo el flag y recalculando el plan de cuotas pendientes como si siempre hubiera sido decreciente.

### GET — listar candidatos elegibles

Devuelve los créditos que **pueden** ser corregidos, sin modificar nada:

```sql
WHERE p.interes_fijo = TRUE
  AND p.tipo         != 'congelacion'
  AND p.tipo         != 'credito_libre'
  AND p.metodo_calculo = 'plano'
  AND p.estado NOT IN ('saldado','decomisado','refinanciado')
```

Respuesta: `{ total, creditos: [...] }` con capital pendiente, interés pendiente y cuotas pendientes por crédito (agregado con `LEFT JOIN cred_cuotas`).

Nota de exclusión importante: **las congelaciones se excluyen explícitamente** (`tipo != 'congelacion'`) porque siempre tienen `tasa_interes = 0`, por lo que revertir `interes_fijo` en ellas no tendría efecto financiero pero contaminaría el criterio de elegibilidad; y los `credito_libre` se excluyen porque usan un motor de cálculo propio no compatible con `recalcularCuotasPlano`.

### POST — ejecutar el reverso

Body: `{ productoIds: string[] }`. Flujo:

1. Re-valida elegibilidad en servidor con el mismo `WHERE` del `GET` (protección contra IDs enviados desde un listado obsoleto del cliente).
2. `UPDATE cred_productos SET interes_fijo = FALSE` en batch sobre los IDs elegibles.
3. Llama secuencialmente a `recalcularCuotasPlano(id)` por cada crédito — una **copia literal** del algoritmo de recálculo de cuotas planas de `/api/pagos/route.js` (ver comentario en el propio código: *"copia fiel del original"*), pero forzando `baseInteres = saldoCapital` (interés decreciente) porque el flag ya quedó en `FALSE` en BD antes de llamar la función.
4. Registra auditoría vía `auditar()` (módulo `configuracion`, acción `actualizar`) con el detalle de IDs corregidos/errores.

```js
await auditar({
  ...u,
  accion:      ACCIONES.ACTUALIZAR || 'actualizar',
  modulo:      MODULOS.CONFIGURACION || 'configuracion',
  descripcion: `Reverso masivo interes_fijo: ${corregidos} crédito(s) corregido(s) — ${refs}`,
  detalle:     { productoIds: idsElegibles, corregidos, errores, resultados }
})
```

### Comportamiento frente a reintentos

Es **idempotente en la práctica pero no por diseño explícito**: una vez que un crédito queda con `interes_fijo = FALSE`, el filtro `WHERE p.interes_fijo = TRUE` de ambos endpoints lo excluye automáticamente de listados y ejecuciones futuras. No hay bandera de "ya corregido", ni endpoint de rollback si el recálculo resultara incorrecto para un caso específico — la única traza posterior es el registro de auditoría.

> ⚠️ **El endpoint no tiene ninguna verificación de rol de administrador.** `POST` llama a `getUsuarioDesdeRequest(request)` únicamente para poblar el campo `usuario` de la auditoría (`...u` en el `auditar()`), pero el resultado de esa llamada **nunca se valida** (no hay `if (!u) return 401`, ni `if (u.rol !== 'admin') return 403`). Si `getUsuarioDesdeRequest` no lanza excepción cuando no hay sesión, cualquier usuario autenticado en la aplicación —independientemente de su rol— podría invocar este endpoint y ejecutar un reverso masivo sobre datos financieros reales (saldos y estados de cuota) de producción. Tampoco existe una bandera de entorno (`NODE_ENV`), un token de confirmación, ni un modo "dry-run" obligatorio antes de aplicar el `POST`: el único paso de verificación previo es que el frontend administrativo llame primero al `GET` para mostrar la lista, pero nada impide invocar el `POST` directamente contra la API. Se recomienda: (1) restringir esta ruta a rol `admin`/`superadmin` explícito antes de tocar `u`, (2) exigir confirmación server-side (p. ej. un segundo parámetro `confirmar: true` o un código de un solo uso), y (3) considerar deshabilitarla o protegerla tras el backfill inicial si ya no debería usarse de forma recurrente.

### Resumen de campos y tablas afectadas

| Tabla | Campos que modifica |
|---|---|
| `cred_productos` | `interes_fijo` (TRUE → FALSE) |
| `cred_cuotas` (no pagadas) | `monto_cuota`, `abono_capital`, `abono_interes`, `saldo_pendiente`, `estado` |

No inserta filas nuevas en `cred_cuotas` ni genera un evento de pago/recibo (`snapshotInfo = null` según el comentario del código), evitando así contaminar el historial de pagos con un movimiento sin recibo real. Ver también el motor de cálculo de plan plano en [[Lógica Financiera y Calificación]].

## 3. `GET /api/cuotas` — consulta general del libro de cuotas

Archivo: `app/api/cuotas/route.js`. Endpoint de solo lectura consumido por las pantallas de mora, cobranza y detalle de crédito (incluida la vista `Ver cuotas →` enlazada desde `/empenos`).

### Filtros aceptados (query params)

| Parámetro | Valores | Efecto |
|---|---|---|
| `estado` | `pendiente` (default) / `parcial` / `pagada` / `mora` / `todas` | `mora` es un filtro compuesto: `fecha_vencimiento < hoy AND monto_pagado < monto_cuota AND estado != 'pagada'` (no depende de un campo `estado='mora'` en BD, se calcula al vuelo). `todas` omite el filtro de estado. |
| `cliente_id` | UUID | Filtra cuotas de un cliente puntual |
| `producto_id` | UUID | Filtra cuotas de un crédito puntual |
| `segmento` | `clientes` / `empresas` | `clientes` → `p.empresa_id IS NULL`; `empresas` → `p.empresa_id IS NOT NULL` |

Regla fija no parametrizable: siempre excluye cuotas de productos `estado != 'refinanciado'` (`WHERE p.estado != 'refinanciado'` en el `WHERE` base), sin importar el filtro de `estado` de cuota solicitado.

### Datos que retorna

`SELECT cu.*` más columnas enriquecidas vía joins:

```sql
SELECT cu.*,
       c.nombre AS nombre_cliente, c.telefono AS telefono_cliente,
       p.tipo AS tipo_producto, p.descripcion_bien,
       p.fecha_creacion AS fecha_prestamo, p.monto_capital AS capital_producto,
       p.referencia AS referencia_producto, p.tasa_interes AS tasa_interes_producto,
       p.periodo_tasa AS periodo_tasa_producto, p.frecuencia_cobro AS frecuencia_cobro_producto,
       p.num_cuotas AS num_cuotas_producto, p.metodo_calculo AS metodo_calculo_producto,
       COALESCE(p.fecha_desembolso, p.fecha_primer_pago, p.fecha_creacion::DATE) AS fecha_desembolso_real,
       p.empresa_id, ep.nombre AS empresa_nombre,
       GREATEST(0, CURRENT_DATE - cu.fecha_vencimiento) AS dias_mora
FROM administrativo.cred_cuotas cu
LEFT JOIN administrativo.cred_clientes c ON c.id = cu.cliente_id
JOIN      administrativo.cred_productos p ON p.id = cu.producto_id
LEFT JOIN administrativo.cred_empresas_propias ep ON ep.id = p.empresa_id
```

Puntos relevantes:

- Trae `p.descripcion_bien`, lo que hace que este endpoint sea también la fuente de datos para mostrar el bien empeñado al listar cuotas de un empeño (usado por la vista de detalle `/prestamos/[id]` enlazada desde `/empenos`).
- `dias_mora` se calcula en cada consulta con `GREATEST(0, CURRENT_DATE - cu.fecha_vencimiento)` — usa la fecha del servidor (Postgres `CURRENT_DATE`), a diferencia de la vista `/empenos` que calcula sus propios "días restantes" en el navegador. Son dos cálculos de tiempo independientes sobre datos distintos (vencimiento de cuota vs. `fecha_limite_rescate` del bien) y no deben confundirse.
- No pagina resultados (`ORDER BY cu.fecha_vencimiento ASC` sin `LIMIT`/`OFFSET`); en carteras grandes esto puede volverse costoso si se llama con `estado=todas` sin `cliente_id`/`producto_id`.
- Es de solo lectura (`GET`), no valida autenticación/rol dentro del propio archivo — depende del middleware/capa de sesión global de la app.

### Consumidores típicos

Pantallas de mora/cobranza, detalle de crédito (`/prestamos/[id]`), y cualquier reporte que necesite el estado cuota-a-cuota con contexto de cliente/empresa/producto sin tener que hacer joins manuales en el frontend.

---

Referencias cruzadas: [[Base de Datos]] (esquema `cred_productos`, `cred_cuotas`, campos de empeño/congelación), [[Flujos de Negocio]] (ciclo de vida completo de crédito, incidente de blindaje `tasa=0` en congelación del 2026-07-02), [[Lógica Financiera y Calificación]] (algoritmo de recálculo de cuotas plano/decreciente), [[CLAUDE]] (convenciones generales del proyecto).