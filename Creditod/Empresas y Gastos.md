# Empresas y Gastos

> Módulo implementado en julio 2026 (migraciones 21–26).
> Permite gestionar las empresas propias de Alberto Liñán, sus gastos operativos y los retornos/ingresos que generan.

---

## ¿Qué es este módulo?

El dueño del sistema tiene varias empresas propias (constructora, metalúrgica, finca) desde las cuales puede:
- Registrar **gastos** operativos (nómina, materiales, transporte, etc.) con referencia `GASTO-XXXXXX`.
- Registrar **retornos** (capital e interés que la empresa le devuelve al dueño).
- Crear **préstamos internos** (`es_prestamo_interno=TRUE`) donde la empresa es el deudor — sin cliente externo.
- Ver el **resumen financiero** de cada empresa: saldo de préstamos activos, total de gastos y total de retornos.

---

## Empresas registradas (julio 2026)

| Código | Nombre | NIT | Giro |
|--------|--------|-----|------|
| EMPRE-004 | ALMACO | 901418520-2 | Construcción |
| EMPRE-005 | INMETAL | 901640647-1 | Metalúrgica |
| EMPRE-006 | FINCA MONSERRATE | — | Finca de café |

> Los códigos EMPRE-001 a EMPRE-003 corresponden a empresas eliminadas en la etapa de pruebas.

---

## Tablas involucradas

- `cred_empresas_propias` — maestro de empresas.
- `cred_tipos_gasto` — categorías de gasto (7 tipos base + personalizados).
- `cred_gastos` — registro de gastos con referencia `GASTO-XXXXXX`.
- `cred_retornos_empresa` — ingresos que retornan las empresas.
- `cred_productos.es_prestamo_interno` / `empresa_id` — préstamos internos vinculados a una empresa.

Ver [[Base de Datos]] para el diccionario completo de columnas.

---

## Tipos de gasto

### Base del sistema (no eliminables)

| ID | Nombre | Orden |
|----|--------|-------|
| `tg-nomina` | Nómina | 1 |
| `tg-materiales` | Compra de materiales | 2 |
| `tg-imprevistos` | Imprevistos | 3 |
| `tg-servicios` | Servicios públicos | 4 |
| `tg-transporte` | Transporte | 5 |
| `tg-alimentacion` | Alimentación | 6 |
| `tg-personal` | Gasto personal | 7 |

### Personalizados activos (julio 2026)
COMPRA DE GANADO, SUMINISTRO, COMBUSTIBLE.

---

## Consecutivos

| Entidad | Formato | Clave en `cred_configuracion` |
|---------|---------|-------------------------------|
| Empresa | `EMPRE-001` | `empresa_consecutivo` |
| Gasto | `GASTO-000001` | `gasto_consecutivo` |

Ambos usan el mismo patrón atómico `INSERT ... ON CONFLICT DO UPDATE RETURNING` que los consecutivos de recibo y crédito.

---

## API Endpoints

### Empresas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/empresas` | Lista todas las empresas con KPIs: `saldo_prestamos`, `total_gastos`, `total_retornos_capital`, `total_retornos_interes`, `total_retornos` |
| POST | `/api/empresas` | Crea empresa. Body: `{ nombre, descripcion, nit }`. Valida duplicado por nombre y NIT. Genera `codigo` autonumérico. 409 si duplicado |
| DELETE | `/api/empresas` | Body: `{ id }`. Falla con 409 si tiene préstamos o gastos asociados |
| PUT | `/api/empresas/[id]` | Edita `nombre`, `descripcion`, `activo` |
| DELETE | `/api/empresas/[id]` | Elimina si no tiene gastos; de lo contrario, solo desactivar |

**KPIs calculados en `GET /api/empresas`** (subconsultas independientes para evitar fan-out):
```sql
-- saldo_prestamos: capital pendiente de préstamos internos activos
SELECT SUM(p.monto_capital) FROM cred_productos p
WHERE p.empresa_id = ep.id AND p.es_prestamo_interno = TRUE
  AND p.estado NOT IN ('saldado','decomisado','refinanciado')

-- total_gastos: suma de todos los gastos de la empresa
SELECT SUM(g.monto) FROM cred_gastos g WHERE g.empresa_id = ep.id

-- total_retornos / total_retornos_capital / total_retornos_interes
SELECT SUM(r.monto_total / monto_capital / monto_interes)
FROM cred_retornos_empresa r WHERE r.empresa_id = ep.id
```

---

### Retornos de empresa

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/empresas/[id]/retornos` | Lista retornos de la empresa ordenados por `fecha_retorno DESC` |
| POST | `/api/empresas/[id]/retornos` | Body: `{ monto_capital, monto_interes, fecha_retorno, notas, producto_id }`. `monto_interes` opcional (default 0). `monto_total` es columna generada |
| DELETE | `/api/empresas/[id]/retornos` | Body: `{ retorno_id }`. Elimina el retorno especificado de la empresa |

---

### Gastos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/gastos` | Lista gastos con filtros: `empresa_id`, `fecha_desde`, `fecha_hasta`, `personal=true`. JOIN con `cred_tipos_gasto` y `cred_empresas_propias` |
| POST | `/api/gastos` | Body: `{ empresa_id, producto_id, tipo_gasto_id, descripcion, monto, fecha_gasto, es_personal, notas }`. Genera `referencia` GASTO-XXXXXX atómicamente. `descripcion` se guarda en MAYÚSCULAS. Si `es_personal=TRUE`, `empresa_id` puede ser NULL |
| PATCH | `/api/gastos` | Body: `{ id, cubierto: bool }`. Marca/desmarca el gasto como cubierto. Registra `fecha_cubierto` automáticamente |
| DELETE | `/api/gastos/[id]` | Elimina el gasto. 404 si no existe |

**Validaciones de `POST /api/gastos`**:
- `tipo_gasto_id` obligatorio.
- `descripcion` obligatorio.
- `monto > 0`.
- Si `es_personal = FALSE`, `empresa_id` es obligatorio.

---

### Tipos de gasto

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tipos-gasto` | Lista todos los tipos activos, ordenados por `orden ASC, nombre ASC`. Auto-inicializa los 7 tipos base si la tabla está vacía |
| POST | `/api/tipos-gasto` | Body: `{ nombre }`. Crea tipo personalizado (`es_sistema=FALSE`). Nombre se guarda en MAYÚSCULAS |

---

## Préstamos internos

Un préstamo interno es un `cred_productos` con `es_prestamo_interno=TRUE` y `empresa_id` apuntando a una empresa propia. En estos créditos:

- `cliente_id` es **NULL** (migración 23 eliminó el NOT NULL).
- Se crean desde el mismo formulario `/prestamos/nuevo`, seleccionando la empresa como deudor.
- Aparecen en el KPI `saldo_prestamos` del `GET /api/empresas`.
- Se excluyen de los listados de clientes normales.

---

## Auto-registro de clientes (`/registro` y `/autoregistro`)

Módulo público que permite a un cliente registrarse sin autenticación:

### `/api/registro`
- `GET /api/registro?documento=XXXXXXXXX` — verifica en tiempo real si la cédula ya existe. Retorna `{ existe: bool }`.
- `POST /api/registro` — crea un cliente nuevo. Body: `{ nombre, documento, telefono, telefono2, direccion, email }`.

**Validaciones**:
- `nombre`: solo letras y espacios, mínimo 3 caracteres.
- `documento`: solo dígitos, 5-12 caracteres.
- `telefono`: solo dígitos, 7-10 caracteres.
- `telefono2`: opcional, mismas reglas que `telefono`.
- `email`: formato válido si se ingresa.
- Retorna errores por campo en `{ error, errores: { campo: 'mensaje' } }`.
- 409 si el documento ya existe.
- El cliente se crea con `es_prueba=FALSE`.

> `telefono2` es una columna nueva en `cred_clientes`, agregada por el `setup()` del endpoint de registro de forma idempotente (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

### `/autoregistro/[id]`
Página pública de confirmación post-registro. Muestra el estado del cliente recién registrado.

---

## Página `/gastos`

Lista unificada de gastos con:
- Filtros: empresa, rango de fechas, tipo de gasto, solo personales.
- Columnas: referencia (`GASTO-XXXXXX`), empresa, tipo, descripción, monto, fecha, cubierto.
- Acción rápida: marcar/desmarcar cubierto (llama `PATCH /api/gastos`).
- Botón "Nuevo gasto" con modal de creación.

---

## Notas de arquitectura

- Los endpoints de empresas y gastos implementan el mismo patrón `setup()` que el módulo de créditos libres: ejecutan `CREATE TABLE IF NOT EXISTS` al inicio de la primera request, garantizando idempotencia sin necesidad de correr migraciones manuales en todos los entornos.
- El `GET /api/empresas` usa **subconsultas escalares independientes** (no JOINs 1→N) para calcular KPIs por empresa, evitando el problema de fan-out que duplica filas al cruzar varias relaciones 1→N simultáneamente.
- La columna `monto_total` en `cred_retornos_empresa` es **GENERATED ALWAYS AS (monto_capital + monto_interes) STORED** — no se puede insertar ni actualizar directamente; Postgres la mantiene automáticamente.
