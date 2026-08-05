# Incidentes y Bugs Conocidos

> Registro cronológico consolidado de todos los incidentes, bugs corregidos y hallazgos de riesgo detectados en el sistema, antes dispersos entre `CLAUDE.md`, [[Base de Datos]], [[API Endpoints]], [[Flujos de Negocio]] y [[Créditos Sin Cuotas Futuras]]. Esta nota es el punto único de consulta — cada entrada enlaza a la nota donde vive el detalle técnico completo. Los hallazgos marcados **[VERIFICADO EN CÓDIGO]** provienen de la revisión exhaustiva 2026-08-05 y son riesgos reales de producción, no hipotéticos.

---

## 🔴 Hallazgos críticos de seguridad — sin corregir aún

> Ordenados por impacto. Todos fueron verificados leyendo el código fuente real (no la base de datos en vivo).

| # | Hallazgo | Endpoint(s) / archivo | Nota fuente |
|---|---|---|---|
| 1 | `GET /api/backup` no verifica rol admin — `verificarAdmin()` existe pero **nunca se invoca**, y aunque se invocara, `getUsuarioDesdeRequest()` no devuelve `rol` (siempre sería `undefined`). Cualquier usuario autenticado descarga un JSON con **todos los datos del negocio y los `password_hash` de todos los usuarios** | `app/api/backup/route.js` | [[Migración y Backup]] |
| 2 | `POST /api/backup` (restaurar) tampoco valida rol — solo comprueba `u?.id`. Cualquier usuario autenticado puede `TRUNCATE...CASCADE` + repoblar toda la base desde un JSON arbitrario | `app/api/backup/route.js` | [[Migración y Backup]] |
| 3 | `app/api/admin/fix-interes-fijo` (`POST`) no verifica rol ni sesión de admin antes de ejecutar un reverso masivo de `interes_fijo` sobre créditos reales — cualquier usuario autenticado puede disparar el recálculo financiero | `app/api/admin/fix-interes-fijo/route.js` | [[Empeños, Congelación y Utilidades Admin]] |
| 4 | Ninguna ruta de `/api/usuarios` (`POST`, `PUT /[id]`, `DELETE /[id]`) verifica `rol==='admin'` — un operador autenticado puede crear usuarios admin, cambiar cualquier contraseña o (des)activar cualquier cuenta | `app/api/usuarios/**` | [[Usuarios e Informes]] |
| 5 | `GET /api/auditoria` no valida rol — cualquier usuario logueado lee el historial completo de auditoría de todos los usuarios, incluidas acciones administrativas ajenas | `app/api/auditoria/route.js` | [[Auditoría]] |
| 6 | `middleware.js` no valida `payload.rol` en ninguna ruta — la autorización por rol, si existe, depende enteramente de que cada `route.js` la implemente por su cuenta (y varios no lo hacen, ver arriba) | `middleware.js` | [[Autenticación y Seguridad]] |
| 7 | Secreto JWT con fallback hardcodeado en código fuente (`'inversiones-tata-linan-secret-2026'`) si `JWT_SECRET` no está seteado en el entorno — permitiría forjar tokens `rol:'admin'` válidos | `lib/auth.js` | [[Autenticación y Seguridad]] |
| 8 | Cookie de sesión con `secure: false` — el JWT viaja sin forzar HTTPS | `lib/auth.js` | [[Autenticación y Seguridad]] |
| 9 | `/api/registro` (auto-registro público) sin rate limiting ni CAPTCHA — expuesto a spam de registros, único freno es el `UNIQUE` de `documento` | `app/api/registro/route.js` | [[Auto-registro y Recibos]] |
| 10 | `/autoregistro/[id]` usa el UUID del cliente como capability token permanente, sin expiración ni segundo factor, y sin validar formato de teléfono/email en el servidor | `app/api/autoregistro/[id]/route.js` | [[Auto-registro y Recibos]] |
| 11 | `POST /api/migracion/reset` y `reset-cliente` son irreversibles, sin transacción y sin confirmación server-side — la confirmación de texto (`LIMPIAR`) es solo de UI, un `POST` directo por API la evita completamente | `app/api/migracion/reset*/route.js` | [[Migración y Backup]] |

---

## 🟠 Inconsistencias de datos y riesgo de doble conteo — sin corregir aún

| # | Hallazgo | Ubicación | Nota fuente |
|---|---|---|---|
| 1 | `cartera.capital_activo` del dashboard incluye créditos libres por su `monto_capital` **original** (no el saldo real tras abonos) y nunca los refleja en `capital_mora`, aunque estén muy atrasados — subestima sistemáticamente la mora real si se lee solo `cartera.capital_mora` | `app/api/dashboard/route.js` | [[Dashboard y KPIs]] |
| 2 | La query de intereses de préstamos normales del dashboard no excluye `fiado`/`adelanto`/`congelacion`, a diferencia de cartera y KPIs históricos que sí lo hacen | `app/api/dashboard/route.js` | [[Dashboard y KPIs]] |
| 3 | `mora.monto_total` y `cartera_vencida.total` deberían coincidir matemáticamente (mismo universo de cuotas); si divergen en producción es señal de bug real, no una diferencia de negocio esperada | `app/api/dashboard/route.js` | [[Dashboard y KPIs]] |
| 4 | La exclusión de `credito_libre` en `capitalCalle`/`interesesProyectados` es implícita (por el placeholder `2099-12-31`), no explícita por `tipo` — frágil ante cualquier cambio futuro del placeholder; podría duplicar capital si un crédito libre llegara a tener una cuota con fecha real | `app/api/dashboard/route.js` | [[Dashboard y KPIs]] |
| 5 | `intereses_libres_proyectados` puede solaparse con `creditos_libres.intereses_cobrados` si el usuario elige un `desde` anterior al último corte real — no hay validación backend que fuerce `desde >= inicio_periodo` | `app/api/dashboard/route.js`, `intereses-detalle/route.js` | [[Dashboard y KPIs]] |
| 6 | **Unificar Créditos agrava el riesgo de doble/triple conteo**: cada unificación deja N filas en `estado='refinanciado'` apuntando al mismo sucesor. Cualquier reporte que sume `monto_capital` sin excluir `'refinanciado'` multiplica el capital por N+1, no solo lo duplica | `app/api/productos/unificar/route.js` | [[Unificar Créditos]] |
| 7 | El SQL embebido de `POST /api/backup/estructura` está desactualizado frente a las migraciones reales 21–26 (no crea empresas propias, gastos, retornos, `es_prueba`, `codigo`/`nit`, tipo `congelacion`, ni el CHECK de mora) — restaurar con este endpoint deja un esquema viejo sin advertirlo en la UI | `app/api/backup/estructura/route.js` | [[Migración y Backup]] |
| 8 | Catálogo `ACCIONES`/`MODULOS` desactualizado: varios call-sites usan claves inexistentes (`ACCIONES.CREAR`, `ACCIONES.PAGAR`, `ACCIONES.ACTUALIZAR`, `MODULOS.CONFIGURACION`) — los inserts de auditoría correspondientes fallan silenciosamente o dependen de un fallback `\|\|` | `app/api/creditos-libres/**`, `app/api/admin/fix-interes-fijo/route.js` | [[Auditoría]] |
| 9 | `POST /api/auth/logout` y `POST /api/registro` nunca llaman `auditar()` — no queda rastro de cierres de sesión ni de auto-registros públicos | `app/api/auth/logout`, `app/api/registro` | [[Auditoría]] |

---

## 🟢 Bugs corregidos (resueltos)

### 2026-08-05 — `GET /api/clientes` marcaba "en mora" a clientes con crédito ya refinanciado

- **Síntoma**: cliente ADRIAN ALFONSO AMARIS GOMEZ aparecía como "en mora" en `/clientes` a pesar de que su crédito vigente (producto de una refinanciación) estaba al día.
- **Causa**: al refinanciar, `POST /api/productos` cierra el crédito origen (`estado='refinanciado'`) pero **nunca cierra sus cuotas** en `cred_cuotas` — quedan `pendiente` indefinidamente como registro histórico (el saldo real se sigue correctamente vía `cred_pagos`). El `SELECT` de `GET /api/clientes` calculaba `cuotas_en_mora`/`estado_calculado` contando todas las cuotas vencidas del cliente sin excluir productos `refinanciado`/`saldado`/`decomisado`, a diferencia de `productos_activos` que sí lo hacía.
- **Fix**: se agregó `AND p.estado NOT IN ('saldado','decomisado','refinanciado')` al `FILTER` de `cuotas_en_mora` y a su uso en el `CASE` de `estado_calculado`, en `app/api/clientes/route.js`.
- **Patrón a vigilar**: cualquier agregación nueva sobre `cred_cuotas` a nivel de cliente debe excluir explícitamente esos tres estados. Detalle completo en [[Base de Datos]].

### 2026-08-05 — Modal "Intereses recogidos" no cuadraba con el KPI del dashboard

- **Síntoma**: la tarjeta KPI mostraba $5.480.010 pero el modal de detalle (doble clic) sumaba solo $2.223.050.
- **Causa**: `GET /api/dashboard` ya sumaba tres fuentes correctamente (préstamos normales vía `cu.abono_interes`, retornos de empresas, créditos libres vía `pg.monto_interes`). Pero `GET /api/dashboard/intereses-recogidos-detalle` solo implementaba la fórmula de créditos normales contra **todos** los productos sin excluir `credito_libre` — que por tener `abono_interes=0` fijo siempre aportaba $0 y quedaba fuera del `HAVING > 0`. Tampoco tocaba `cred_retornos_empresa`.
- **Fix**: se separó el endpoint en dos queries (`normales` excluyendo `credito_libre`, `libres` calculando desde `pg.monto_interes`), devueltas como `{ normales, libres, totales }` — mismo formato que `intereses-detalle`. El frontend (`app/page.js`) ahora muestra dos tablas con subtotales. De paso se cambió `INNER JOIN cred_clientes` a `LEFT JOIN` con fallback a `cred_empresas_propias` para no descartar intereses de préstamos internos.
- **Pendiente**: los retornos de empresas propias (`intereses_retornos`) siguen sin desglosarse en este modal — si el rango tiene retornos, el KPI seguirá mostrando un total ligeramente mayor a `normales + libres`. Detalle completo en [[API Endpoints]].

### 2026-07-12 — Bugs del módulo Créditos Sin Cuotas Futuras (durante desarrollo)

| Bug | Causa | Fix |
|---|---|---|
| Fecha mostraba día anterior | `new Date("2026-05-01")` = medianoche UTC = abril 30 en Colombia (UTC-5) | Siempre `new Date(str + 'T12:00:00')` |
| Input capital rechazaba 1.000.000 | `<input type="number" step="1000">` generaba secuencia 1, 1001... | `type="text" inputMode="numeric"` con formateo manual |
| Se cobraba interés del mismo día | Validación usaba `<` en vez de `<=` | `if (fecha_corte <= anteriorStr)` rechaza |
| Error de constraint al insertar tipo | CHECK no incluía `sin_cuotas_futuras` | `DROP CONSTRAINT IF EXISTS` en `autoMigrar()` |
| Interés calculado con días reales (31 días) | No usaba convención 30/360 | Función `diasD360()` implementando 30/360 |

Detalle completo en [[Créditos Sin Cuotas Futuras]].

### 2026-07-03 — Interés fijo mal configurado en créditos planos

Ver [[Flujos de Negocio]] y [[Empeños, Congelación y Utilidades Admin]] (endpoint de backfill `fix-interes-fijo` creado para revertir el error — que a su vez introdujo el hallazgo crítico #3 de arriba por no validar rol admin).

### 2026-07-02 — Agotamiento de conexiones en producción (Vercel)

- **Síntoma**: la aplicación colapsaba con `"Sin conexión a la base de datos"` y el log `EMAXCONNSESSION max clients reached in session mode`.
- **Causa**: `DB_PORT=5432` conectaba al pooler Supavisor en modo "Session" — bajo Vercel serverless, cada invocación fría retenía un backend Postgres exclusivo durante todo su ciclo de vida, agotando el límite de 15 clientes concurrentes.
- **Fix**: redirigir `lib/db.js` al puerto `6543` (modo "Transaction" del pooler), compatible con `withTransaction()` porque libera la conexión al terminar cada bloque `BEGIN...COMMIT`.
- Detalle completo en [[Flujos de Negocio]].

### 2026-07-02 — Congelaciones creadas con tasa activa por error humano

- **Causa**: operadores dejaban la tasa del formulario activa al seleccionar tipo "Congelación".
- **Fix**: bloqueo forzado en dos capas — `useEffect` en frontend limpia el campo Tasa; variables `tasaSegura`/`conInteresSeguro` en backend destruyen cualquier valor > 0 antes de persistir.
- Detalle completo en [[Flujos de Negocio]].

### 2026-07 — Normalización de mora en `cred_cuotas` (migraciones 16 y 17)

- **Causa histórica**: en algún momento el sistema permitió persistir `estado='mora'` directamente en `cred_cuotas`, lo cual entra en conflicto con el cálculo dinámico de mora (`fecha_vencimiento < CURRENT_DATE`) usado en el resto del código.
- **Fix**: migración 16 normaliza retroactivamente todo `estado='mora'` a `pendiente`/`parcial`; migración 17 agrega el CHECK `chk_cred_cuotas_estado` que impide volver a persistirlo. Detalle en [[Base de Datos]].

---

## 🔵 Deudas técnicas y observaciones menores (no bloqueantes)

| Observación | Ubicación | Nota fuente |
|---|---|---|
| Password policy (mínimo 4 caracteres) solo se valida en frontend, nunca en backend | `app/api/usuarios/**` | [[Usuarios e Informes]] |
| Validación de formato de `/registro` duplicada a mano en frontend y backend, sin módulo compartido | `app/registro/page.js`, `app/api/registro/route.js` | [[Auto-registro y Recibos]] |
| Race condition benigna en `/api/registro`: dos requests simultáneas con la misma cédula pueden ambas pasar el `SELECT` de duplicado antes del INSERT — el `UNIQUE` de Postgres protege el dato, pero el segundo request recibe un mensaje de error genérico | `app/api/registro/route.js` | [[Auto-registro y Recibos]] |
| `BottomNav` (móvil) no expone enlaces a `/configuracion`, `/usuarios`, `/auditoria` ni `/backup` — un admin en móvil debe abrir el drawer del Sidebar | `components/BottomNav.jsx` | [[Componentes y Layout Frontend]] |
| El banner de "modo prueba" silencia por completo cualquier error de `fetch` (`.catch(() => {})`) — sin logging visible si el endpoint falla | `components/LayoutWrapper.jsx` | [[Componentes y Layout Frontend]] |
| `KPICard`: si `alerta=true`, siempre pinta rojo sin importar el `color` recibido — parámetro combinable pero con precedencia fija | `components/KPICard.jsx` | [[Componentes y Layout Frontend]] |
| Ninguna operación de `/api/migracion` (Excel) ni `/api/migracion/cargue-inicial` usa `withTransaction` de forma completa para prevenir estados parciales ante timeout/caída (cargue-inicial sí usa transacción por fila, pero el proceso global de import no) | `app/api/migracion/**` | [[Migración y Backup]] |
| Patrón de búsqueda de recibos `%REC-%fragmento%` no ancla el fragmento a los dígitos — puede devolver falsos positivos, sin paginación real | `app/api/recibos/route.js` | [[Auto-registro y Recibos]] |
| `.catch()` en llamadas fire-and-forget a `auditar()` es en la práctica redundante — el riesgo real es que Vercel congele el runtime serverless antes de que el INSERT fire-and-forget termine, perdiendo el registro sin error visible | Varios `route.js` que no usan `await auditar(...)` | [[Auditoría]] |

---

## Cómo usar esta nota

Al detectar un bug nuevo en producción: (1) documentar sección técnica completa en la nota del módulo afectado ([[Base de Datos]], [[API Endpoints]], [[Flujos de Negocio]], etc.) con el formato `> ⚠️ Bug corregido (fecha)`; (2) agregar una entrada resumida aquí con enlace a esa nota, para mantener un índice cronológico único. Ver protocolo completo en `CLAUDE.md`.
