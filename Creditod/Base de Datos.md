# Base de Datos

El sistema implementa PostgreSQL y encapsula todas sus entidades dentro del esquema lógico llamado `administrativo`. En todo el backend, se define la constante global `const S = 'administrativo'` para calificar las consultas SQL.

---

## Diccionario de Tablas

### 1. `cred_clientes`
Almacena la información de contacto de los clientes deudores.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `documento` | TEXT UNIQUE | Cédula o NIT |
| `nombre` | TEXT | Siempre en **MAYÚSCULAS** (migración 20) |
| `telefono` | TEXT NULL | Principal |
| `telefono2` | TEXT NULL | Secundario (agregado via `autoRegistro`) |
| `direccion` | TEXT NULL | Siempre en MAYÚSCULAS |
| `email` | TEXT NULL | |
| `es_prueba` | BOOLEAN DEFAULT FALSE | TRUE = cliente de prueba, eliminable si no tiene movimientos |

**Índice parcial**: `idx_cred_clientes_prueba ON cred_clientes(es_prueba) WHERE es_prueba = TRUE`

---

### 2. `cred_productos`
Entidad core que unifica préstamos, empeños, ventas a crédito, fiados, adelantos, congelaciones y créditos libres.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `referencia` | TEXT | Código legible `CRED-000001` (consecutivo) |
| `cliente_id` | TEXT FK NULL | **Nullable** desde migración 23 (préstamos internos sin cliente) |
| `tipo` | TEXT | Código de `cred_tipos_prestamo` |
| `monto_capital` | NUMERIC | Capital financiado |
| `tasa_interes` | NUMERIC | Tasa en % |
| `periodo_tasa` | TEXT | `diario`, `semanal`, `quincenal`, `mensual`, `anual` |
| `frecuencia_cobro` | TEXT | |
| `num_cuotas` | INTEGER | |
| `fecha_primer_pago` | DATE | |
| `con_interes` | BOOLEAN | |
| `metodo_calculo` | TEXT | `plano` o `frances` |
| `interes_fijo` | BOOLEAN DEFAULT FALSE | Opt-in: congela interés sobre capital original en método plano |
| `metodo_desembolso` | TEXT | `efectivo`, `transferencia`, `nequi`, `daviplata`, `llave_breb`, `otro` |
| `entidad_desembolso` | TEXT NULL | Banco o billetera |
| `referencia_desembolso` | TEXT NULL | N° cuenta, celular o llave |
| `estado` | TEXT | `activo`, `al_dia`, `en_mora`, `saldado`, `decomisado`, `refinanciado` |
| `es_refinanciacion_de` | TEXT NULL | ID del producto origen |
| `refinanciado_por` | TEXT NULL | ID del producto nuevo |
| `es_prestamo_interno` | BOOLEAN DEFAULT FALSE | TRUE = préstamo de la empresa a sí misma (migración 21) |
| `empresa_id` | TEXT FK NULL | Referencia a `cred_empresas_propias` (migración 21) |
| `descripcion_bien` | TEXT NULL | Empeños |
| `valor_comercial_bien` | NUMERIC NULL | Empeños |
| `fecha_limite_rescate` | DATE NULL | Empeños |
| `notas` | TEXT NULL | |
| `fecha_creacion` | TIMESTAMP | |

---

### 3. `cred_cuotas`
Cronograma de cobros por producto.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | |
| `producto_id` | TEXT FK | |
| `cliente_id` | TEXT FK NULL | **Nullable** desde migración 23 |
| `numero_cuota` | INTEGER | |
| `fecha_vencimiento` | DATE | `2099-12-31` en cuentas abiertas y créditos libres |
| `monto_cuota` | NUMERIC | |
| `abono_interes` | NUMERIC | |
| `abono_capital` | NUMERIC | |
| `saldo_pendiente` | NUMERIC | |
| `monto_pagado` | NUMERIC | |
| `dias_mora` | INTEGER | |
| `estado` | TEXT | **CHECK estricto**: solo `pendiente`, `parcial`, `pagada` |

> ⚠️ **Regla**: la mora NO se almacena en `estado`. Se deriva dinámicamente por `fecha_vencimiento < CURRENT_DATE` en cada consulta.

---

### 4. `cred_pagos`
Historial inmutable de abonos recibidos.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | |
| `cuota_id` | TEXT FK | |
| `producto_id` | TEXT FK | |
| `cliente_id` | TEXT FK NULL | **Nullable** desde migración 25 (pagos de empresas propias) |
| `monto` | NUMERIC | |
| `monto_interes` | NUMERIC | Interés pactado al momento del cobro |
| `monto_capital` | NUMERIC | Capital abonado |
| `fecha_pago` | TIMESTAMP | Puede ser futura en modo prueba |
| `metodo_pago` | TEXT | `efectivo`, `transferencia`, `nequi`, `daviplata`, `otro` |
| `notas` | TEXT NULL | |
| `numero_recibo` | TEXT | Formato `REC-000001` |
| `usuario_nombre` | TEXT | |
| `fecha_corte_interes` | DATE NULL | Solo créditos libres: fecha hasta la que cubre el interés cobrado |

---

### 5. `cred_usuarios`
| Campo | Tipo |
|-------|------|
| `id` | TEXT PK |
| `nombre` | TEXT |
| `usuario` | TEXT UNIQUE |
| `password_hash` | TEXT |
| `rol` | TEXT — `admin` o `operador` |
| `activo` | BOOLEAN |
| `ultimo_acceso` | TIMESTAMP |

---

### 6. `cred_tipos_prestamo`
Tipos de crédito dinámicos. Reemplaza el CHECK fijo de `cred_productos.tipo`.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | |
| `codigo` | TEXT UNIQUE | Slug usado en `cred_productos.tipo` |
| `label` | TEXT | Nombre visible |
| `icono` | TEXT | Emoji |
| `descripcion` | TEXT | |
| `comportamiento` | TEXT | Ver tabla abajo |
| `activo` | BOOLEAN | |
| `es_sistema` | BOOLEAN | Los tipos base no se pueden eliminar |
| `orden` | INTEGER | |

**Tipos de sistema registrados en BD** (verificado 2026-07-12):

| orden | codigo | label | icono | comportamiento | es_sistema |
|-------|--------|-------|-------|----------------|------------|
| 1 | `prestamo` | Préstamo | 💰 | `prestamo_normal` | TRUE |
| 2 | `venta` | Venta | 🛍️ | `prestamo_normal` | TRUE |
| 3 | `empeno` | Empeño | 🔒 | `empeno` | TRUE |
| 4 | `fiado` | Fiado | 🌿 | `cuenta_abierta` | TRUE |
| 5 | `adelanto` | Adelanto | ⚡ | `cuenta_abierta` | TRUE |
| 6 | `congelacion` | Congelación | ❄️ | `prestamo_normal` | TRUE |
| 7 | `credito_libre` | Crédito Sin Cuotas | 📅 | `sin_cuotas_futuras` | TRUE |

**Comportamientos disponibles**:

| Comportamiento | Descripción |
|----------------|-------------|
| `prestamo_normal` | Genera cuotas con tasa/interés periódico |
| `cuenta_abierta` | 1 cuota a 2099-12-31, sin interés |
| `empeno` | Como `prestamo_normal` + campos de bien y rescate |
| `sin_cuotas_futuras` | Crédito libre — módulo propio, sin cuotas futuras |

---

### 7. `cred_empresas_propias`
Empresas de Alberto Liñán gestionadas desde el sistema. Permiten registrar préstamos internos, gastos y retornos.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `codigo` | TEXT UNIQUE | Autonumérico `EMPRE-001` (migración 24) |
| `nombre` | TEXT NOT NULL | En MAYÚSCULAS. Único por nombre |
| `nit` | TEXT NULL | NIT de la empresa (único si se ingresa) |
| `descripcion` | TEXT NULL | |
| `activo` | BOOLEAN DEFAULT TRUE | |
| `fecha_creacion` | TIMESTAMP | |

**Empresas registradas** (julio 2026):

| codigo | nombre | nit | descripcion |
|--------|--------|-----|-------------|
| EMPRE-004 | ALMACO | 901418520-2 | CONSTRUCCION |
| EMPRE-005 | INMETAL | 901640647-1 | METALURGICA |
| EMPRE-006 | FINCA MONSERRATE | — | FINCA DE CAFE |

**Índice**: `idx_cred_empresas_codigo UNIQUE ON cred_empresas_propias(codigo)`

---

### 8. `cred_tipos_gasto`
Categorías de gasto (sistema + personalizados). Gestionable desde la UI.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | IDs fijos para tipos base (`tg-nomina`, etc.) |
| `nombre` | TEXT NOT NULL | |
| `es_sistema` | BOOLEAN DEFAULT FALSE | Los tipos base no se pueden eliminar |
| `activo` | BOOLEAN DEFAULT TRUE | |
| `orden` | INTEGER DEFAULT 99 | |

**Tipos base registrados en BD** (verificado 2026-07-12):

| id | nombre | orden |
|----|--------|-------|
| `tg-nomina` | Nómina | 1 |
| `tg-materiales` | Compra de materiales | 2 |
| `tg-imprevistos` | Imprevistos | 3 |
| `tg-servicios` | Servicios públicos | 4 |
| `tg-transporte` | Transporte | 5 |
| `tg-alimentacion` | Alimentación | 6 |
| `tg-personal` | Gasto personal | 7 |

**Tipos personalizados activos**: COMPRA DE GANADO, SUMINISTRO, COMBUSTIBLE.

---

### 9. `cred_gastos`
Gastos operativos de las empresas propias o gastos personales del dueño.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `referencia` | TEXT NULL | Formato `GASTO-000001` (consecutivo atómico) |
| `empresa_id` | TEXT FK NULL | NULL si `es_personal = TRUE` |
| `producto_id` | TEXT NULL | Préstamo al que se carga (opcional) |
| `tipo_gasto_id` | TEXT FK NOT NULL | Referencia a `cred_tipos_gasto` |
| `descripcion` | TEXT NOT NULL | En MAYÚSCULAS |
| `monto` | NUMERIC NOT NULL | CHECK `monto > 0` |
| `fecha_gasto` | DATE DEFAULT CURRENT_DATE | |
| `es_personal` | BOOLEAN DEFAULT FALSE | TRUE = gasto personal sin empresa |
| `cubierto` | BOOLEAN DEFAULT FALSE | Indica si el gasto ya fue cubierto/pagado |
| `fecha_cubierto` | TIMESTAMP NULL | Fecha en que se marcó cubierto |
| `usuario_nombre` | TEXT NULL | |
| `notas` | TEXT NULL | |
| `fecha_creacion` | TIMESTAMP | |

**Índices**: `idx_cred_gastos_empresa`, `idx_cred_gastos_fecha DESC`, `idx_cred_gastos_producto`

---

### 10. `cred_retornos_empresa`
Ingresos/retornos que generan las empresas propias (capital recuperado + interés ganado).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `empresa_id` | TEXT FK NOT NULL | |
| `producto_id` | TEXT NULL | Préstamo asociado (opcional) |
| `monto_capital` | NUMERIC NOT NULL | CHECK `> 0` |
| `monto_interes` | NUMERIC DEFAULT 0 | CHECK `>= 0` |
| `monto_total` | NUMERIC GENERATED | `monto_capital + monto_interes` (columna calculada) |
| `fecha_retorno` | DATE DEFAULT CURRENT_DATE | |
| `notas` | TEXT NULL | |
| `usuario_nombre` | TEXT NULL | |
| `fecha_creacion` | TIMESTAMP | |

**Índices**: `idx_cred_retornos_empresa`, `idx_cred_retornos_fecha DESC`, `idx_cred_retornos_producto`

---

### 11. Tablas de soporte
- `cred_movimientos_caja`: Registro contable con saldo acumulado (`desembolso`, `cobro_capital`).
- `cred_historial_recalculos`: Snapshots del crédito en creación y en cada abono a capital.
- `cred_backups`: Historial de exportaciones JSON (últimas 50).
- `cred_auditoria`: Log de cada acción mutante con usuario, IP, módulo y detalle JSONB.
- `cred_configuracion`: Pares clave/valor del sistema.

---

## `cred_configuracion` — Claves registradas

| Clave | Valor actual (jul 2026) | Uso |
|-------|------------------------|-----|
| `recibo_consecutivo` | 260 | Contador `REC-XXXXXX` |
| `credito_consecutivo` | 396 | Contador `CRED-XXXXXX` |
| `empresa_consecutivo` | 7 | Contador `EMPRE-XXX` |
| `gasto_consecutivo` | 14 | Contador `GASTO-XXXXXX` |
| `modo_prueba` | `false` | Permite fechas futuras en pagos |

**Patrón de incremento atómico** (igual para todos los consecutivos):
```sql
INSERT INTO administrativo.cred_configuracion (id, clave, valor)
VALUES (gen_random_uuid()::text, 'gasto_consecutivo', '2')
ON CONFLICT (clave) DO UPDATE
  SET valor = (administrativo.cred_configuracion.valor::int + 1)::text
RETURNING (valor::int - 1) AS num
```

---

## Control de Migraciones SQL

| Script | Descripción |
|--------|-------------|
| `03` | Columnas `refinanciado_por`, `es_refinanciacion_de` |
| `04` | Borra datos operativos de prueba |
| `05` | Agrega tipo `fiado` |
| `06` | Tabla usuarios + admin inicial |
| `07` | Tabla auditoría con índices |
| `08` | Columna `usuario_nombre` en pagos |
| `09` | Agrega tipo `adelanto` |
| `10_agregar_referencia_credito` | Columna `referencia` + clave `credito_consecutivo` + backfill |
| `10_fix_cuotas_liquidacion` | Corrige cuotas "fantasma" de liquidación (one-shot) |
| `10_historial_recalculos` | Tabla `cred_historial_recalculos` |
| `10_tipos_prestamo` | Elimina CHECK fijo + tabla `cred_tipos_prestamo` con 5 tipos base |
| `11` | Columnas `monto_interes`, `monto_capital` en pagos + backfill |
| `12` | Índices compuestos de rendimiento |
| `13` | Tabla `cred_backups` |
| `14` | Índices trigram (`pg_trgm`), parciales + ANALYZE |
| `15` | Columnas `metodo_desembolso`, `entidad_desembolso`, `referencia_desembolso` + CHECK |
| `16` | Normaliza cuotas con `estado='mora'` → `pendiente/parcial`. Idempotente |
| `17` | CHECK `chk_cred_cuotas_estado` — impide persistir `'mora'` |
| `18` | Corrige cuotas sobrepagadas (`monto_pagado > monto_cuota`) |
| `19_interes_fijo` | Columna `interes_fijo BOOLEAN DEFAULT FALSE` en `cred_productos` |
| `19_clientes_prueba` | Columna `es_prueba BOOLEAN DEFAULT FALSE` en `cred_clientes` + índice parcial |
| `20_sin_cuotas_futuras` | `fecha_corte_interes` en pagos, elimina CHECK comportamientos, inserta `credito_libre`. **Auto-ejecutada por `autoMigrar()`** |
| `20_clientes_mayusculas` | Normaliza `nombre` y `direccion` de clientes a MAYÚSCULAS. Idempotente |
| `21_empresas_y_gastos` | Tablas `cred_empresas_propias`, `cred_tipos_gasto`, `cred_gastos`. Columnas `es_prestamo_interno` y `empresa_id` en `cred_productos` |
| `22_retornos_empresa` | Tabla `cred_retornos_empresa` con columna generada `monto_total` |
| `23_cliente_nullable_interno` | `cliente_id` nullable en `cred_productos` y `cred_cuotas` (préstamos internos) |
| `24_empresa_codigo_nit` | Columnas `codigo` y `nit` en empresas + clave `empresa_consecutivo` + backfill |
| `25_pagos_cliente_nullable` | `cliente_id` nullable en `cred_pagos` |
| `26_tipo_congelacion` | Inserta tipo de sistema `congelacion` (❄️) en `cred_tipos_prestamo`. Idempotente |

> **Convención de mora**: `cred_cuotas.estado` ∈ {`pendiente`, `parcial`, `pagada`}. La mora NO es un estado almacenado — se deriva por `fecha_vencimiento < CURRENT_DATE`. Filtrar mora siempre por `cuotas_mora > 0` (calculado dinámicamente), nunca por `p.estado === 'en_mora'`.
>
> ⚠️ **Bug corregido (2026-08-05) — `GET /api/clientes` marcaba "en mora" a clientes con créditos ya refinanciados**: al refinanciar un crédito, `POST /api/productos` solo actualiza `cred_productos.estado='refinanciado'` en el crédito origen — **nunca toca las cuotas** de `cred_cuotas` de ese crédito (quedan `pendiente` para siempre, como registro histórico; el saldo real se seguía correctamente vía `cred_pagos`, ver `Flujos de Negocio.md`). El `SELECT` de `GET /api/clientes` (`app/api/clientes/route.js`) calculaba `cuotas_en_mora`/`estado_calculado` contando **todas** las cuotas vencidas del cliente sin excluir las de productos `refinanciado`/`saldado`/`decomisado` — a diferencia de `productos_activos`, que sí filtraba por esos estados. Resultado: un cliente con un crédito activo al día pero con un crédito **anterior ya refinanciado** (con cuotas viejas vencidas y nunca cerradas) aparecía como "en mora" en el listado `/clientes`, aunque ningún crédito vigente estuviera realmente vencido.
> **Fix**: se agregó `AND p.estado NOT IN ('saldado','decomisado','refinanciado')` al `FILTER` de `cuotas_en_mora` (y a su uso dentro del `CASE` de `estado_calculado`) en `app/api/clientes/route.js`, igual patrón que ya usaba `productos_activos`.
> **Patrón a vigilar**: cualquier agregación nueva sobre `cred_cuotas` a nivel de cliente (no solo por producto individual) debe excluir explícitamente `refinanciado`/`saldado`/`decomisado`, porque las cuotas de un crédito refinanciado no se cierran automáticamente y quedan "vencidas" indefinidamente en la tabla.

> **Nullabilidad de `cliente_id`**: desde las migraciones 23 y 25, los campos `cliente_id` en `cred_productos`, `cred_cuotas` y `cred_pagos` son opcionalmente NULL para soportar préstamos internos entre empresas propias donde no hay un cliente deudor externo.
