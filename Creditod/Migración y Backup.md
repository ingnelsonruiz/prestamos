# Migración y Backup

> Módulo administrativo con dos responsabilidades muy distintas que conviven bajo `/migracion` y `/backup`: **(1)** poblar el sistema con datos históricos (migración masiva desde Excel y cargue inicial de saldos con reconstrucción de pagos pasados) y **(2)** operaciones de continuidad (exportar/restaurar la base completa, recrear el esquema SQL y limpiar datos de prueba). Casi todos sus endpoints son **destructivos o irreversibles** — ver los callouts ⚠️ antes de tocar cualquiera de ellos en producción.

---

## Índice de endpoints

| Método | Ruta | Archivo | Qué hace |
|--------|------|---------|----------|
| POST | `/api/migracion` | `app/api/migracion/route.js` | Importa clientes + saldos desde Excel como **cuentas abiertas** |
| POST | `/api/migracion/cargue-inicial` | `app/api/migracion/cargue-inicial/route.js` | Legaliza un crédito antiguo con cronograma y pagos históricos reales |
| POST | `/api/migracion/reset` | `app/api/migracion/reset/route.js` | Borra **todos** los movimientos operativos. Conserva clientes y usuarios |
| POST | `/api/migracion/reset-cliente` | `app/api/migracion/reset-cliente/route.js` | Borra los créditos (todos o una selección) de **un** cliente |
| GET | `/api/backup` | `app/api/backup/route.js` | Exporta un JSON completo de la base de datos |
| POST | `/api/backup` | `app/api/backup/route.js` | Restaura la base desde un JSON (TRUNCATE + INSERT) |
| POST | `/api/backup/estructura` | `app/api/backup/estructura/route.js` | Recrea el esquema SQL de forma idempotente (SQL embebido, no corre las migraciones) |
| GET | `/api/backup/historial` | `app/api/backup/historial/route.js` | Últimas 50 filas de `cred_backups` |

Páginas: `app/migracion/page.js` (migración + zona de pruebas), `app/migracion/cargue-inicial/page.js` (wizard de 2 pasos), `app/backup/page.js` (exportar/restaurar/recrear con confirmaciones de texto).

Ver [[API Endpoints]] para la referencia corta de todos los endpoints del sistema.

---

## 1. Migración masiva — `POST /api/migracion`

Importa desde Excel usando tres plantillas definidas en el frontend (`PLANTILLAS` en `app/migracion/page.js`), pero **las tres llegan al backend con el mismo shape de fila** — el backend no distingue entre plantillas, solo entre presencia/ausencia de campos.

### Formato esperado por fila (JSON, ya parseado del Excel en el navegador)

```js
{
  _fila: 2,                    // número de fila del Excel, solo para reportar errores
  documento: '1067123456',
  nombre: 'JUAN CARLOS PEREZ',
  telefono: '3001234567',      // opcional
  direccion: 'Cra 5 #10-20',   // opcional
  email: 'juan@gmail.com',     // opcional
  tipo: 'prestamo',            // opcional — prestamo/venta/empeno/fiado/adelanto
  saldo_actual: '500000',      // opcional — si > 0, crea un producto
  descripcion: 'Queso 5 libras', // opcional
  notas: 'Desde enero',        // opcional
}
```

El parseo Excel→JSON (`app/migracion/page.js`, función `leerArchivo`) normaliza cabeceras a minúsculas/snake_case (`k.toLowerCase().trim().replace(/\s+/g,'_')`) y descarta filas totalmente vacías. La validación cliente ya bloquea el botón "Importar" si hay errores, pero **es responsabilidad exclusiva del frontend** — el backend vuelve a validar por su cuenta (ver abajo).

### Qué crea exactamente el backend

```js
// 1. Upsert de cliente por documento
if (clienteExiste) {
  UPDATE cred_clientes SET nombre=..., telefono=COALESCE(NULLIF($2,''),telefono), ...
} else {
  INSERT INTO cred_clientes (id, documento, nombre, telefono, direccion, email)
}

// 2. Si saldo_actual > 0 → producto tipo "cuenta abierta" sin plan de cuotas real
INSERT INTO cred_productos
  (id, cliente_id, tipo, monto_capital, tasa_interes, num_cuotas,
   fecha_primer_pago, con_interes, metodo_calculo, descripcion_bien, notas)
VALUES ($1,$2,$3,$4, 0, 1, $5, false, 'plano', $6, $7)

// Una sola cuota "trampa" con vencimiento en el año 2099
INSERT INTO cred_cuotas (..., fecha_vencimiento, monto_cuota, abono_interes,
                          abono_capital, saldo_pendiente, monto_pagado, estado)
VALUES ($1,$2,$3,1,'2099-12-31',$4,0,$4,$4,0,'pendiente')
```

Puntos clave:

- **Un cliente puede recibir múltiples productos** — cada fila del Excel con `saldo_actual > 0` genera un producto independiente (plantilla "Clientes + Deudas" del frontend usa esto para varios saldos por documento).
- El producto migrado **siempre** queda con `tasa_interes=0`, `con_interes=false`, `metodo_calculo='plano'`, `num_cuotas=1` — es decir, no es un crédito amortizado, es una **cuenta abierta de saldo puro**: una sola cuota pendiente con `fecha_vencimiento='2099-12-31'` que representa "lo que debe hoy" sin cronograma. No tiene referencia consecutiva `CRED-XXXXXX` (esa columna queda `NULL`, a diferencia de `/api/productos` y de `cargue-inicial`).
- `tipo` se valida contra `['prestamo','venta','empeno','fiado','adelanto']`; si no coincide (o viene vacío), cae a `'prestamo'` por defecto — **nunca falla la fila por un tipo inválido**, solo lo normaliza.
- La nota del producto siempre lleva el prefijo `MIGRADO desde cuaderno` (+ las notas del Excel si las hay), quedando trazable.
- Si el cliente ya existe, los campos vacíos del Excel **no pisan** los datos existentes (`COALESCE(NULLIF($x,''), columna_actual)`) — solo el `nombre` se sobreescribe siempre.
- **No usa transacción**: cada fila se procesa en su propio `try/catch` con `query()` suelto (no `withTransaction`). Un error en la fila 50 no revierte las filas 1–49 ya insertadas; simplemente se acumula en `resultados.errores` y se continúa con la siguiente.
- No genera movimiento de caja para el desembolso migrado — a diferencia de `cargue-inicial`, esta ruta **no toca `cred_movimientos_caja`**.
- Auditoría única al final del lote (`MODULOS.CLIENTES`, acción `'Migración masiva'`) con el detalle completo del resultado.

> ⚠️ **Nada de esto usa `withTransaction`.** Si el proceso se corta a mitad de un archivo de 500 filas (timeout, caída de red, error no controlado antes del `try` de la fila), quedan clientes y productos parcialmente creados sin forma de saber automáticamente dónde se detuvo — solo el array `errores` de la respuesta HTTP, que se pierde si el cliente no llega a recibir la respuesta.

---

## 2. Cargue Inicial de Saldos — `POST /api/migracion/cargue-inicial`

A diferencia de la migración masiva (saldo plano sin cronograma), el Cargue Inicial **legaliza un crédito preexistente reconstruyendo su historial completo**: genera el cronograma teórico igual que un crédito nuevo, aplica los pagos históricos que el cobrador recuerda haber recibido, y deja todo (cuotas, pagos, recibos, movimientos de caja, snapshot de creación) con **fechas reales del pasado**, no con la fecha de hoy.

### Filosofía de diseño (comentario textual del archivo)

```js
// El cliente SOLO envía qué cuotas se pagaron, cuánto y cuándo; el servidor
// recalcula montos/intereses de cada cuota con lib/calculos.js para no confiar
// en valores enviados desde el navegador (seguridad + consistencia).
```

El frontend (`app/migracion/cargue-inicial/page.js`) también corre `generarCuotas()` en el paso 1 solo para **previsualizar** la tabla; el backend vuelve a generarla de cero con `lib/calculos.js` y es la única fuente autoritativa — nunca confía en los montos que llegan del navegador.

### Wizard de 2 pasos (frontend)

1. **Parámetros del crédito**: cliente, tipo, método de cálculo (plano/francés), capital, tasa, período, frecuencia, número de cuotas, congelar intereses (`interes_fijo`, solo aplica a método plano), fecha de desembolso (pasado), fecha de primer pago, **fecha de corte**, medio de desembolso (si no es efectivo pide entidad/referencia), descripción del bien (si es empeño), notas.
2. **Reconstrucción de pagos**: tabla generada con `generarCuotas()`; cada cuota con `fecha_vencimiento <= fecha_corte` se marca `esHistorica=true` y es editable (checkbox "¿pagó?", monto pagado, fecha real del pago). Botón "✨ Marcar todas las vencidas como pagadas en su fecha exacta" rellena en un click todo lo vencido como pagado íntegro en su fecha de vencimiento.

### Payload que llega al backend

```js
{
  producto: {
    cliente_id, tipo, monto_capital, tasa_interes, periodo_tasa, frecuencia_cobro,
    num_cuotas, metodo_calculo, con_interes, interes_fijo,
    fecha_desembolso, fecha_primer_pago, fecha_corte,
    metodo_desembolso, entidad_desembolso, referencia_desembolso,
    descripcion_bien, valor_comercial_bien, fecha_limite_rescate, notas,
  },
  pagos: [ { numero_cuota, monto_pagado, fecha_pago }, ... ]  // solo las que el cobrador marcó como pagadas
}
```

### Validaciones de entrada (backend)

- `cliente_id`, `tipo`, `monto_capital` obligatorios → 400 si falta alguno.
- `num_cuotas` debe ser entero > 0 → 400.
- `fecha_desembolso` y `fecha_primer_pago` obligatorias (una puede heredar de la otra si falta una de las dos) → 400.
- `metodo_desembolso` se restringe a la whitelist `['efectivo','transferencia','nequi','daviplata','llave_breb','otro']`; si no es efectivo, se guardan `entidad_desembolso` / `referencia_desembolso`.
- `metodo_calculo` solo admite `'frances'` o cae a `'plano'` por defecto.

### Regla `tipo='congelacion'` — defensa en profundidad

```js
// Congelación NUNCA cobra interés — misma regla que en POST /api/productos
// (defensa en profundidad, sin importar lo que envíe el cliente).
const tasaSegura       = tipo === 'congelacion' ? 0 : (con_interes === false ? 0 : parseFloat(tasa_interes || 0))
const conInteresSeguro = tipo === 'congelacion' ? false : (con_interes !== false)

// interes_fijo solo aplica a método 'plano'; se fuerza false fuera de ese caso
const interesFijoSeguro = (tipo === 'congelacion' || metodo !== 'plano')
  ? false
  : interes_fijo === true
```

El frontend ya fuerza `tasa_interes='0'` con un `useEffect` en cuanto detecta `tipo==='congelacion'`, pero el backend **repite exactamente la misma regla** sin confiar en lo recibido — es la misma convención que existe en `POST /api/productos` (documentada en [[Flujos de Negocio]] y en la regla #5 de [[CLAUDE]]: *"No crear congelación con tasa > 0 — forzar tasa=0 y con_interes=false en frontend Y backend"*).

### Backfill de fechas retroactivas — cómo se construye el historial

1. **Cronograma teórico**: `generarCuotas()` con `fecha_primer_pago` genera todas las cuotas normalmente (igual que un crédito nuevo), con `producto_id` fijo generado por adelantado (`uuidv4()` antes de la transacción).
2. **Aplicación de pagos históricos** (en memoria, cuota por cuota):
   - Si la cuota tiene un pago en `pagosPorCuota` (indexado por `numero_cuota`): `monto_pagado = min(pago.monto, monto_cuota)`, `estado = 'pagada'` si cubre ≥ cuota−0.5, si no `'parcial'`. La mora teórica se calcula con `diasEntre(fecha_vencimiento, fecha_pago_real)` y se persiste en `dias_mora` **de ese pago específico** (única excepción a la regla de no persistir mora, porque aquí es un dato histórico ya cerrado, no un estado vivo).
   - El interés del período se cubre primero: `interesAplicado = min(monto_pagado, abono_interes)`, `capitalAplicado = monto_pagado - interesAplicado`.
   - Si la cuota **no** tiene pago registrado: queda `estado='pendiente'` con `dias_mora=0` — el comentario del código es explícito sobre por qué:
     ```js
     // Sin pago: la mora NO se persiste como estado de cuota. Convención del
     // sistema (CLAUDE.md §16): la mora se DERIVA por fecha en cada consulta...
     // Si se guardara estado='mora', la cuota quedaría fuera de todos los filtros
     // estado IN ('pendiente','parcial') y desaparecería de Cobros, cartera
     // vencida, capital en la calle, etc.
     ```
     Solo se activa una bandera interna `hayMora=true` si `diasEntre(venc, fecha_corte) > 0`, usada para decidir el **estado del producto** (no de la cuota).
3. **Estado final del producto**: `saldado` si todas las cuotas quedaron `pagada`; si no, `en_mora` si hubo alguna cuota vencida sin pagar antes del corte, si no `activo`.
4. **Referencia consecutiva** (`CRED-XXXXXX`) y **bloque de recibos** (`REC-XXXXXX`) se reservan atómicamente con `UPDATE ... RETURNING` sobre `cred_configuracion` — igual patrón que `POST /api/productos`. Para los recibos se reserva **el bloque completo de una vez** (`valor + pagosFinales.length`) y luego se numeran secuencialmente en memoria, evitando N round-trips.
5. **Persistencia dentro de una transacción** (`withTransaction`): producto → cuotas (batch) → movimientos de caja → pagos → historial de recálculo. El producto se inserta con `fecha_creacion = tsLocal(fecha_desembolso)` (mediodía local para evitar el corrimiento UTC-5), es decir, **la fecha de creación del registro queda en el pasado**, no en el momento real del cargue.
6. **Movimientos de caja no destructivos**: en vez de recalcular todo el libro de caja, lee el último `saldo_acumulado` existente (`ORDER BY fecha DESC LIMIT 1`) y **avanza en memoria** desde ahí: resta el desembolso, suma cada pago histórico en orden cronológico. Los movimientos quedan insertados con su `fecha` real del pasado (`tsLocal(fecha_desembolso)`, `tsLocal(pago.fecha_pago)`), pero **se insertan al final de la tabla** — es decir, cronológicamente están "en el pasado" pero fueron creados hoy. Cualquier reporte que ordene por `fecha` los mostrará en su posición correcta; cualquier reporte que asuma que el orden de inserción = orden cronológico se rompe.

> ⚠️ **El saldo acumulado de caja puede quedar inconsistente si se hacen cargues iniciales en paralelo o fuera de orden cronológico.** El cálculo de `saldoAcum` parte de una única lectura del último movimiento existente al momento del request; si dos cargues corren simultáneamente o si se carga un crédito con fecha de desembolso *anterior* a movimientos ya insertados, el `saldo_acumulado` de las filas nuevas no reflejará el saldo real en esa fecha del pasado — solo será matemáticamente correcto respecto al saldo *actual* del sistema, no respecto al histórico real intermedio.

> ⚠️ El snapshot de creación (`cred_historial_recalculos`, tipo `'creacion'`) usa los valores **del cronograma teórico completo** (`interesTotal`, `totalAPagar`), no los que reflejan los pagos ya aplicados — es el mismo comportamiento que un crédito nuevo (snapshot "como si nada se hubiera pagado aún").

---

## 3. Reset — limpieza de datos operativos

Dos endpoints con alcance muy distinto. Ambos están detrás de doble confirmación **solo en el frontend** (escribir `LIMPIAR` literal) — ninguno de los dos valida un rol de administrador ni exige un token/confirmación en el propio request HTTP.

### `POST /api/migracion/reset` — reset total (zona de pruebas)

```js
await query(`DELETE FROM cred_movimientos_caja`)
await query(`DELETE FROM cred_pagos`)
await query(`DELETE FROM cred_historial_recalculos`)
await query(`DELETE FROM cred_cuotas`)
await query(`DELETE FROM cred_productos`)
await query(`DELETE FROM cred_retornos_empresa`)
await query(`DELETE FROM cred_gastos`)
UPDATE cred_configuracion SET valor='1' WHERE clave='recibo_consecutivo'
UPDATE cred_configuracion SET valor='1' WHERE clave='credito_consecutivo'
```

| Se borra | Se conserva |
|----------|-------------|
| `cred_movimientos_caja`, `cred_pagos`, `cred_historial_recalculos`, `cred_cuotas`, `cred_productos`, `cred_retornos_empresa`, `cred_gastos` | `cred_clientes`, `cred_usuarios`, `cred_empresas_propias`, `cred_tipos_gasto`, `cred_tipos_prestamo`, `cred_configuracion` (solo se resetean 2 claves), `cred_auditoria`, `cred_backups` |

Los consecutivos `recibo_consecutivo` y `credito_consecutivo` vuelven a `'1'` — el próximo crédito que se cree después de un reset **reutilizará** referencias `CRED-000001` / `REC-000001` que ya existieron antes, generando colisión visual (no de base de datos, porque no hay UNIQUE en `referencia`, pero sí confusión operativa: dos créditos históricos con el mismo `CRED-XXXXXX` si el backup viejo convive con datos nuevos).

Las tablas de empresas propias (`cred_gastos`, `cred_retornos_empresa`) se borran, pero **la empresa (`cred_empresas_propias`) y sus tipos de gasto (`cred_tipos_gasto`) NO se tocan** — quedan huérfanas de historial pero la empresa sigue existiendo.

La auditoría de este reset se registra explícitamente con `⚠️` en la descripción:
```js
descripcion: `⚠️ ${u.nombre} eliminó todos los movimientos, productos, cuotas y pagos. Solo se conservaron clientes y usuarios.`
```

> ⚠️ **Operación catastrófica sin punto de retorno.** No usa `withTransaction` (son 9 `DELETE`/`UPDATE` sueltos en secuencia) — si el proceso se interrumpe a mitad de camino, la base queda en un estado intermedio incoherente (p. ej. cuotas borradas pero productos aún presentes). No hay backup automático antes de ejecutar; si no se corrió `GET /api/backup` justo antes, los datos son irrecuperables.

### `POST /api/migracion/reset-cliente` — reset por cliente (con selección parcial)

Body: `{ clienteId, productoIds? }`.

- Verifica que el cliente exista (404 si no).
- Trae **todos** los productos del cliente para validar la selección.
- Si `productoIds` no viene o llega vacío → se conserva el comportamiento legado: se borran **todos** los créditos del cliente.
- Si `productoIds` viene con contenido → se filtra contra los productos reales del cliente (`idsCliente.includes(id)`); si ninguno pertenece al cliente, 400. Si el subconjunto es menor al total, marca `esSeleccionParcial=true` para el mensaje de auditoría.
- Si el cliente no tiene ningún producto, responde `{ ok:true, sinMovimientos:true }` **sin auditar** (no hay nada que borrar).
- Todo el borrado se filtra por `producto_id IN (...)`, nunca por `cliente_id`, precisamente para poder dejar intactos los créditos no seleccionados del mismo cliente:

```sql
DELETE FROM cred_movimientos_caja WHERE referencia_id IN (...)
DELETE FROM cred_pagos            WHERE producto_id   IN (...)
DELETE FROM cred_historial_recalculos WHERE producto_id IN (...)
DELETE FROM cred_cuotas           WHERE producto_id   IN (...)
DELETE FROM cred_productos        WHERE id            IN (...)
```

| | `reset` | `reset-cliente` |
|---|---|---|
| Alcance | Toda la base | Un cliente (todo o una selección de créditos) |
| Borra `cred_clientes` | No | No (el cliente en sí nunca se borra, solo sus créditos) |
| Borra `cred_retornos_empresa`/`cred_gastos` | Sí (global) | No los toca |
| Resetea consecutivos | Sí | No |
| Transacción | No (`query` sueltos) | No (`query` sueltos) |
| Auditoría si no hay nada que borrar | N/A | No audita (`sinMovimientos`) |

> ⚠️ El frontend (`app/migracion/page.js`) exige escribir `LIMPIAR`/confirmar dos veces antes de invocar estos endpoints, pero esa fricción es **puramente de UI**. Ninguno de los dos route handlers valida un token de confirmación, un rol admin, ni recibe la palabra de confirmación en el body — cualquier request `POST` autenticado (una llamada directa con `curl`/Postman usando la cookie de sesión de cualquier usuario) ejecuta el borrado inmediatamente, sin los pasos intermedios de la UI.

---

## 4. Backup — exportación, restauración y reconstrucción de esquema

### `GET /api/backup` — exportación

Ejecuta 8 `SELECT * FROM ...` en paralelo (`Promise.all`) y arma un único JSON:

```js
{
  version: '1.0',
  fecha: '2026-08-05T...',
  sistema: 'Inversiones Tata Liñán',
  generado_por: 'Nombre del usuario',
  conteos: { clientes, productos, cuotas, pagos, caja, historial, config, usuarios },
  tablas: {
    clientes:  [...],  // SELECT * FROM cred_clientes ORDER BY nombre
    productos: [...],  // SELECT * FROM cred_productos ORDER BY fecha_creacion
    cuotas:    [...],  // SELECT * FROM cred_cuotas ORDER BY producto_id, numero_cuota
    pagos:     [...],  // SELECT * FROM cred_pagos ORDER BY fecha_pago
    caja:      [...],  // SELECT * FROM cred_movimientos_caja ORDER BY fecha
    historial: [...],  // SELECT * FROM cred_historial_recalculos ORDER BY fecha
    config:    [...],  // SELECT * FROM cred_configuracion (sin orden)
    usuarios:  [...],  // columnas explícitas, ver abajo
  }
}
```

La tabla `usuarios` **no** usa `SELECT *`: trae explícitamente `id, nombre, usuario, password_hash, rol, activo, ultimo_acceso` — es decir, **el backup incluye el hash bcrypt de la contraseña de cada usuario del sistema**, tal cual, dentro de un archivo `.json` descargable.

El JSON se descarga con `Content-Disposition: attachment; filename="backup-itl-YYYY-MM-DD.json"` y **no incluye** `cred_tipos_prestamo`, `cred_auditoria`, `cred_backups`, `cred_empresas_propias`, `cred_tipos_gasto`, `cred_gastos` ni `cred_retornos_empresa` — el módulo de empresas propias completo queda fuera del backup, así como toda la auditoría y el propio historial de backups.

Cada exportación se registra en `cred_backups` (`tipo='exportacion'`, conteos y `tamanio_kb`) y en auditoría (módulo `'Backup'`).

> ⚠️ **`GET /api/backup` no verifica rol de administrador.** El archivo define una función `verificarAdmin()` (líneas 10–14 de `route.js`) que comprueba `u.rol === 'admin'`, pero **nunca se invoca** — ni en el `GET` ni en el `POST` de este mismo archivo. Además, `getUsuarioDesdeRequest()` (`lib/auditoria.js`) solo devuelve `{ id, nombre }`, **sin el campo `rol`**, así que aunque se llamara a `verificarAdmin()` el chequeo `u.rol === 'admin'` sería siempre falso. En la práctica, cualquier usuario autenticado (operador incluido) puede descargar un JSON con **todos los datos del negocio y los hashes de contraseña de todos los usuarios**.

### `POST /api/backup` — restauración

```js
if (!u?.id) return 403 // "Solo administradores pueden restaurar"
if (!tablas || !version) return 400 // backup inválido
```

El mensaje de error dice "Solo administradores", pero el chequeo real es `!u?.id` — es decir, **basta con estar autenticado con cualquier rol** (de nuevo, `u` nunca trae `rol`). No hay verificación real de administrador en este endpoint tampoco.

**Orden de restauración (respeta FKs):**

```sql
-- 1. Limpieza total con CASCADE
TRUNCATE cred_pagos, cred_historial_recalculos, cred_cuotas,
         cred_movimientos_caja, cred_productos, cred_clientes,
         cred_configuracion CASCADE

-- 2. Reinserción en este orden (padres antes que hijos):
INSERT INTO cred_clientes            (batch de 200 filas, ON CONFLICT (id) DO NOTHING)
INSERT INTO cred_productos           (idem)
INSERT INTO cred_cuotas              (idem)
INSERT INTO cred_pagos               (idem)
INSERT INTO cred_movimientos_caja    (idem)
INSERT INTO cred_historial_recalculos(idem)
INSERT/UPDATE cred_configuracion     (uno por uno, ON CONFLICT (id) DO UPDATE)
INSERT cred_usuarios                 (uno por uno, ON CONFLICT DO NOTHING, salvo el usuario actual)
```

Notas importantes:

- **`cred_usuarios` NUNCA se trunca.** Se restauran solo las filas del backup, y se salta explícitamente la fila cuyo `id === u.id` (el usuario que ejecuta la restauración) — así evita que un admin se bloquee a sí mismo si el backup restaurado no lo incluye o trae una contraseña distinta.
- El `TRUNCATE ... CASCADE` incluye `cred_clientes` y `cred_configuracion`, pero **no incluye `cred_usuarios`, `cred_tipos_prestamo`, `cred_auditoria`, `cred_backups`, `cred_empresas_propias`, `cred_gastos` ni `cred_retornos_empresa`** — el `CASCADE` de Postgres puede arrastrar filas de tablas con FK hacia las truncadas que no están en la lista explícita, dependiendo de qué constraints existan realmente en la BD (no visibles en este archivo).
- Cada `INSERT` usa `ON CONFLICT (id) DO NOTHING` (excepto `cred_configuracion`, que hace `DO UPDATE`) — si el backup tiene un `id` que sigue en la tabla por algún motivo, la fila del backup se descarta silenciosamente en vez de sobrescribir.
- Los batches de inserción son de 200 filas por sentencia (`CHUNK = 200`), reconstruyendo placeholders `$1..$n` manualmente por chunk.
- Se registra la restauración en `cred_backups` (`tipo='restauracion'`) y en auditoría.

> ⚠️ **Restaurar es 100% destructivo y no transaccional.** El `TRUNCATE` se ejecuta como una sentencia `query()` suelta, no dentro de `withTransaction`; si cualquiera de los `insertBatch` posteriores falla a mitad de camino (por ejemplo, un JSON corrupto con una fila que rompe un tipo de columna), **la base queda truncada sin haberse repoblado por completo** — no hay rollback automático que restaure el estado previo al intento fallido. El único seguro real es haber hecho un `GET /api/backup` reciente *antes* de intentar restaurar.

> ⚠️ El frontend exige escribir `RESTAURAR` en mayúsculas antes de habilitar el botón (`app/backup/page.js`), pero esa confirmación es client-side; el endpoint acepta el `POST` sin ningún campo de confirmación en el body.

### `POST /api/backup/estructura` — reconstrucción de esquema

**No ejecuta las migraciones SQL 03–26 documentadas en [[Base de Datos]].** Tiene su propio arreglo `SENTENCIAS` embebido en `app/api/backup/estructura/route.js` con ~40 sentencias `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, ejecutadas una por una en un `for` secuencial (no en batch, no en transacción):

```js
for (const sql of SENTENCIAS) {
  try {
    await query(sql)
    resultados.push({ ok: true, sql: label })
  } catch (e) {
    // Ignora "ya existe": 42P07 duplicate_table, 42701 duplicate_column,
    // 42710 duplicate_object, 23505 unique_violation
    if (['42P07','42701','42710','23505'].includes(e.code)) {
      resultados.push({ ok: true, sql: label, nota: 'ya existía' })
    } else {
      resultados.push({ ok: false, sql: label, error: e.message })
      errores++
    }
  }
}
```

Crea, en orden: esquema `administrativo`, `cred_clientes`, `cred_productos` (+3 índices), `cred_cuotas` (+6 índices), `cred_pagos` (+4 índices), `cred_movimientos_caja` (+2 índices), `cred_configuracion` (+1 índice, + 3 filas seed: `recibo_consecutivo=1`, `credito_consecutivo=1`, `modo_prueba=false`), `cred_usuarios` (+ usuario `admin`/`admin123` seed con hash bcrypt fijo), `cred_auditoria` (+3 índices), `cred_historial_recalculos` (+1 índice), `cred_tipos_prestamo` (+5 tipos base seed: prestamo, venta, empeno, fiado, adelanto), `cred_backups` (+1 índice), y 6 `ALTER TABLE ADD COLUMN IF NOT EXISTS` sueltas al final (`refinanciado_por`, `es_refinanciacion_de`, `referencia`, `monto_interes`, `monto_capital`, `usuario_nombre`, `interes_fijo`).

Solo requiere `u?.id` (mismo patrón débil que `POST /api/backup`, sin verificación de rol real).

> ⚠️ **El SQL embebido está desactualizado frente a las migraciones reales del proyecto** (documentadas en [[Base de Datos]], migraciones 03–26). No crea `cred_empresas_propias`, `cred_tipos_gasto`, `cred_gastos`, `cred_retornos_empresa` (migraciones 21–22), no agrega `es_prueba` en clientes (19_clientes_prueba), no agrega `codigo`/`nit` en empresas (24), no inserta el tipo `congelacion` (26), no crea el `CHECK chk_cred_cuotas_estado` (17) que impide persistir `estado='mora'`, y no hace `cliente_id` nullable en productos/cuotas/pagos (23, 25). Si se usa este endpoint para "resucitar" una base colapsada, **el esquema resultante es un subconjunto viejo** — hay que correr manualmente las migraciones posteriores a la 20 para dejar la BD al día con el código actual, algo que el propio texto de la página (`app/backup/page.js`) no advierte (dice "crea todas las tablas... desde cero").

### `GET /api/backup/historial`

`SELECT * FROM cred_backups ORDER BY fecha DESC LIMIT 50`. Si la tabla aún no existe (`error.message.includes('does not exist')`), responde `[]` en vez de 500 — pensado para no romper la página `/backup` en una instalación nueva donde todavía no se corrió la migración `13` que crea `cred_backups`.

### Registro en `cred_backups`

| Columna | Exportación (`GET`) | Restauración (`POST`) |
|---------|---------------------|------------------------|
| `tipo` | `'exportacion'` | `'restauracion'` |
| `num_clientes/productos/pagos/cuotas` | conteos reales de la exportación | `conteos` recibidos del body del backup (no recalculados desde la BD ya restaurada) |
| `tamanio_kb` | tamaño real del JSON generado | no aplica (queda `0`/default) |
| `notas` | — | `Restaurado desde backup del {fecha}` |

---

## Resumen de riesgos (para no repetir el hallazgo cada vez)

| Endpoint | ¿Transacción? | ¿Rol admin real? | ¿Confirmación server-side? | Reversible |
|----------|:---:|:---:|:---:|:---:|
| `POST /api/migracion` | No | No | No | Parcialmente (upsert no destruye clientes previos) |
| `POST /api/migracion/cargue-inicial` | Sí (`withTransaction`) | No | No | No (crea, no borra) |
| `POST /api/migracion/reset` | No | No | No (solo UI: texto `LIMPIAR`) | **No** |
| `POST /api/migracion/reset-cliente` | No | No | No (solo UI) | **No** |
| `GET /api/backup` | N/A | **No** (función `verificarAdmin` sin usar) | N/A | N/A (solo lectura, pero filtra credenciales) |
| `POST /api/backup` | No | **No** (solo `u?.id`) | No (solo UI: texto `RESTAURAR`) | **No** |
| `POST /api/backup/estructura` | No | **No** (solo `u?.id`) | No (solo UI: texto `RECREAR`) | Idempotente (no borra), pero deja esquema desactualizado |

Ver [[Auditoría]] para el detalle de cómo quedan registradas estas acciones en `cred_auditoria`, y [[Flujos de Negocio]] / [[CLAUDE]] para las reglas de negocio (congelación, mora derivada, interés fijo) que este módulo debe respetar al reconstruir historiales.
