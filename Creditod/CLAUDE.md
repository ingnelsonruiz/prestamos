# CLAUDE.md — Base de Conocimiento Principal: Programa Créditos

> Sistema web de gestión de créditos, empeños y fiados para una empresa prestamista (Inversiones Tata Liñán).
> Stack: Next.js 15 (App Router) + PostgreSQL (Supabase) + Tailwind CSS.
> Proyecto Supabase: `fecnicckenqlmpqefkth` — HERMANOS_LIÑÁN — región us-east-2.

---

## 🔄 Protocolo de Actualización de la Base de Conocimiento

1. **Actualización Modular**: cambios de BD → `[[Base de Datos]]`, flujos → `[[Flujos de Negocio]]`, endpoints → `[[API Endpoints]]`, módulo completo nuevo → archivo propio + enlace aquí.
2. **Registro Obligatorio de Incidentes**: cada bug crítico en producción se registra con fecha, síntoma, causa y corrección en el módulo afectado.
3. **Wiki Links**: usar `[[Nombre de la Nota]]` al referenciar otros archivos de la bóveda.
4. **Sincronización con Código**: nombres de esquemas, prefijos, constantes y códigos de error deben coincidir exactamente con el código fuente.

---

## 🗺️ Índice de la Bóveda

### Núcleo

| Archivo | Contenido |
|---------|-----------|
| [[Stack Tecnológico]] | Framework, librerías, hashing, despliegue |
| [[Estructura de Directorios]] | Árbol completo de carpetas y archivos |
| [[Base de Datos]] | Esquema, diccionario de tablas, migraciones SQL 03–26 |
| [[API Endpoints]] | Catálogo completo de rutas del backend |
| [[Lógica Financiera y Calificación]] | Amortización plana/francesa, score de clientes |
| [[Flujos de Negocio]] | Pagos, congelaciones, interés fijo, incidentes críticos |
| [[Créditos Sin Cuotas Futuras]] | Módulo independiente — crédito por fecha de corte, 30/360 |
| [[Empresas y Gastos]] | Módulo de empresas propias, gastos, retornos, auto-registro |

### Módulos y capas (ampliación 2026-08-05)

| Archivo | Contenido |
|---------|-----------|
| [[Autenticación y Seguridad]] | `middleware.js`, JWT, cookie de sesión, `/login` — hallazgos de seguridad |
| [[Auditoría]] | `lib/auditoria.js`, catálogo `ACCIONES`/`MODULOS`, huecos de trazabilidad |
| [[Componentes y Layout Frontend]] | `Sidebar`, `BottomNav`, `LayoutWrapper`, `KPICard`, layout raíz |
| [[Migración y Backup]] | Importación Excel, cargue inicial, reset, backup/restore — todos de alto riesgo |
| [[Auto-registro y Recibos]] | `/registro`, `/autoregistro/[id]`, búsqueda de recibos |
| [[Unificar Créditos]] | Consolidación N:1 de créditos, vs. refinanciación 1:1 |
| [[Usuarios e Informes]] | CRUD de usuarios, `/api/informes`, exportación Excel |
| [[Dashboard y KPIs]] | Las 16 queries de `GET /api/dashboard` explicadas query por query |
| [[Empeños, Congelación y Utilidades Admin]] | `/empenos`, `fix-interes-fijo`, `GET /api/cuotas` |
| [[Glosario]] | Términos de negocio, enums, consecutivos, convenciones transversales |
| [[Incidentes y Bugs Conocidos]] | Registro cronológico único de bugs corregidos y riesgos abiertos |

---

## 📌 Estado del sistema (verificado 2026-07-12)

### Supabase — Tablas y filas reales

| Tabla | Filas |
|-------|-------|
| `cred_clientes` | 308 |
| `cred_productos` | 292 |
| `cred_cuotas` | 2.163 |
| `cred_pagos` | 165 |
| `cred_movimientos_caja` | 547 |
| `cred_historial_recalculos` | 394 |
| `cred_auditoria` | 127 |
| `cred_tipos_prestamo` | 7 (todos los tipos de sistema activos) |
| `cred_backups` | 7 |
| `cred_empresas_propias` | 3 (ALMACO, INMETAL, FINCA MONSERRATE) |
| `cred_tipos_gasto` | 10 (7 base + 3 personalizados) |
| `cred_gastos` | 0 |
| `cred_retornos_empresa` | 0 |

### Consecutivos actuales

| Consecutivo | Valor |
|-------------|-------|
| Crédito (`CRED-XXXXXX`) | 396 |
| Recibo (`REC-XXXXXX`) | 260 |
| Empresa (`EMPRE-XXX`) | 7 |
| Gasto (`GASTO-XXXXXX`) | 14 |

### Tipos de préstamo activos (7)
💰 Préstamo · 🛍️ Venta · 🔒 Empeño · 🌿 Fiado · ⚡ Adelanto · ❄️ Congelación · 📅 Crédito Sin Cuotas

---

## ⚠️ Reglas críticas — no se pueden romper

1. **No tocar `lib/calculos.js`** para el módulo de créditos libres — tiene su propio motor con convención 30/360.
2. **No llamar `/api/pagos`** desde `/api/creditos-libres/*` — son sistemas paralelos.
3. **No almacenar `estado='mora'` en `cred_cuotas`** — la mora se deriva dinámicamente por `fecha_vencimiento < CURRENT_DATE`.
4. **No filtrar mora por `p.estado === 'en_mora'`** — usar `cuotas_mora > 0`.
5. **No crear congelación con tasa > 0** — forzar `tasa=0` y `con_interes=false` en frontend Y backend.
6. **Siempre usar `fecha_primer_pago`** como inicio del interés en créditos libres.
7. **Siempre leer el archivo antes de editarlo** con `Read` antes de `Write`/`Edit`.
8. **`cliente_id` puede ser NULL** en `cred_productos`, `cred_cuotas` y `cred_pagos` desde las migraciones 23 y 25 — no asumir NOT NULL en código nuevo.
9. **Nombres de clientes y empresas siempre en MAYÚSCULAS** — normalizar en backend antes de INSERT/UPDATE.
10. **Cualquier agregación de capital/mora por cliente o por cartera debe excluir `p.estado IN ('saldado','decomisado','refinanciado')`** — de lo contrario se sobreconteo o falso-positivo de mora en créditos ya cerrados/refinanciados/unificados. Ver [[Incidentes y Bugs Conocidos]].
11. **`cred_cuotas.abono_interes` DEBERÍA ser siempre `0` para `tipo='credito_libre'`, pero NO asumirlo en código nuevo** — se verificaron 11 productos en producción cuya cuota placeholder está mal formada (fecha real y montos reales en vez del patrón esperado). El interés real de créditos libres siempre se lee de `cred_pagos.monto_interes`, nunca de la cuota. Ver hallazgo crítico en [[Incidentes y Bugs Conocidos]].
12. **Toda query que calcule mora/vencimiento sobre `cred_cuotas` debe excluir explícitamente `p.tipo='credito_libre'`** (además de excluir `estado IN ('saldado','decomisado','refinanciado')`, regla 10) — el filtro `fecha_vencimiento <> '2099-12-31'` NO es suficiente por sí solo, porque no todas las cuotas de créditos libres en esta base de datos siguen el patrón placeholder. Corregido en `GET /api/dashboard` (queries de mora y cartera vencida) el 2026-08-05 tras detectar $87.7M de mora falsa — ver [[Incidentes y Bugs Conocidos]].

---

## 🔴 Hallazgos de seguridad pendientes de corregir

La revisión de código del 2026-08-05 encontró que **varios endpoints administrativos y destructivos no verifican rol de usuario**, incluyendo exportación/restauración de backup completo (con hashes de contraseña), gestión de usuarios, reverso masivo de interés fijo y lectura de auditoría. Ver el detalle completo, archivo por archivo, en [[Incidentes y Bugs Conocidos]] antes de tocar cualquiera de esos módulos — son riesgos reales verificados en el código fuente, no hipótesis.

## 🟣 Hallazgo crítico de integridad financiera — corregido, pero con dato pendiente de revisar

El mismo día se verificó contra la base de datos real que **la mora y cartera vencida del dashboard estaban infladas $87.777.732 (27,5%)** por dos causas: cuotas de créditos ya refinanciados que nunca se cierran, y 11 créditos "Sin Cuotas Futuras" con la cuota placeholder mal formada (fecha y montos reales en vez del patrón esperado). El código ya se corrigió. **Queda pendiente decidir con el usuario si esas 11 cuotas se resetean al patrón estándar** — ver detalle completo y la lista de créditos afectados en [[Incidentes y Bugs Conocidos]].
