# Estructura de Directorios

Árbol del repositorio Next.js actualizado al 2026-07-12.

```
Programa_Creditos/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/route.js
│   │   │   ├── logout/route.js
│   │   │   └── me/route.js
│   │   ├── clientes/
│   │   │   └── [id]/route.js
│   │   ├── productos/
│   │   │   └── [id]/
│   │   │       ├── route.js
│   │   │       └── liquidar/route.js        # POST liquidación anticipada
│   │   ├── cuotas/route.js
│   │   ├── pagos/route.js
│   │   ├── recibos/route.js                 # Búsqueda por número de recibo
│   │   ├── historial/route.js               # GET snapshots + pagos + cuotas
│   │   ├── dashboard/
│   │   │   ├── route.js                     # KPIs globales
│   │   │   ├── capital-detalle/route.js     # Desglose capital en calle
│   │   │   ├── intereses-detalle/route.js   # Desglose intereses proyectados
│   │   │   └── intereses-recogidos-detalle/ # Desglose intereses cobrados
│   │   ├── estado/[id]/route.js             # PÚBLICO — estado de cuenta
│   │   ├── informes/route.js
│   │   │
│   │   ├── # ── MÓDULO EMPRESAS Y GASTOS ──────────────────────────
│   │   ├── empresas/
│   │   │   ├── route.js                     # GET lista / POST crear / DELETE
│   │   │   └── [id]/
│   │   │       ├── route.js                 # PUT editar / DELETE eliminar
│   │   │       └── retornos/route.js        # GET / POST / DELETE retornos
│   │   ├── gastos/
│   │   │   ├── route.js                     # GET / POST / PATCH
│   │   │   └── [id]/route.js                # DELETE
│   │   ├── tipos-gasto/
│   │   │   ├── route.js                     # GET / POST
│   │   │   └── [id]/route.js                # PUT / DELETE
│   │   │
│   │   ├── # ── AUTO-REGISTRO PÚBLICO ─────────────────────────────
│   │   ├── registro/route.js                # PÚBLICO — GET verificar / POST crear cliente
│   │   ├── autoregistro/[id]/route.js       # PÚBLICO — confirmación post-registro
│   │   │
│   │   ├── # ── MÓDULO CRÉDITOS LIBRES ────────────────────────────
│   │   ├── creditos-libres/
│   │   │   ├── route.js                     # GET lista / POST crear
│   │   │   └── [id]/
│   │   │       ├── route.js                 # GET detalle + métricas
│   │   │       ├── calcular/route.js        # GET proyección (solo lectura)
│   │   │       └── abonar/route.js          # POST registrar abono
│   │   │
│   │   ├── # ── CONFIGURACIÓN ─────────────────────────────────────
│   │   ├── configuracion/tipos/
│   │   │   ├── route.js                     # GET / POST tipos de préstamo
│   │   │   └── [id]/route.js                # PUT / DELETE
│   │   ├── config/modo-prueba/route.js      # GET / POST toggle fechas futuras
│   │   │
│   │   ├── # ── MIGRACIÓN Y BACKUP ────────────────────────────────
│   │   ├── migracion/
│   │   │   ├── route.js                     # POST importación masiva Excel
│   │   │   ├── cargue-inicial/route.js      # POST legalizar créditos existentes
│   │   │   ├── reset/route.js               # POST limpiar datos de prueba
│   │   │   └── reset-cliente/route.js       # POST borrar créditos de un cliente
│   │   ├── backup/
│   │   │   ├── route.js                     # GET exportar / POST restaurar JSON
│   │   │   ├── estructura/route.js          # POST recrear estructura BD
│   │   │   └── historial/route.js           # GET historial de backups
│   │   │
│   │   ├── usuarios/[id]/route.js
│   │   ├── auditoria/route.js
│   │   └── health/route.js                  # GET healthcheck SELECT 1
│   │
│   ├── # ── PÁGINAS UI ────────────────────────────────────────────
│   ├── page.js                              # Dashboard principal
│   ├── login/page.js
│   ├── clientes/[id]/page.js
│   ├── prestamos/
│   │   ├── page.js
│   │   ├── nuevo/page.js
│   │   └── [id]/page.js
│   ├── cobros/page.js
│   ├── empenos/page.js
│   ├── recibos/page.js
│   ├── informes/page.js
│   ├── estado/[id]/page.js                  # PÚBLICO
│   ├── gastos/page.js                       # Módulo de gastos
│   ├── registro/page.js                     # PÚBLICO — auto-registro de clientes
│   ├── autoregistro/[id]/page.js            # PÚBLICO — confirmación
│   ├── creditos-libres/
│   │   ├── page.js                          # Lista con KPIs y filtros
│   │   ├── nuevo/page.js                    # Formulario de creación
│   │   └── [id]/page.js                     # Detalle + modal de abono (?abrir=1)
│   ├── migracion/page.js
│   ├── configuracion/page.js
│   ├── backup/page.js
│   ├── usuarios/page.js
│   └── auditoria/page.js
│
├── components/
│   ├── Sidebar.jsx                          # Incluye enlace a Créditos Libres y Gastos
│   ├── BottomNav.jsx                        # Menú móvil con Créditos Libres
│   ├── LayoutWrapper.jsx                    # Banner modo prueba global
│   └── KPICard.jsx
│
├── lib/
│   ├── db.js                                # Doble modo: pg pool directo / proxy HTTP
│   ├── auth.js                              # JWT con jose v6
│   ├── calculos.js                          # Amortización plana y francesa
│   └── auditoria.js                         # Helper de auditoría
│
├── middleware.js                            # Verificación JWT en rutas protegidas
├── next.config.js
├── vercel.json                              # maxDuration 60s en app/api/**
├── .env.local
│
├── 00_schema_completo.sql                   # Estructura completa idempotente
├── 03_alter_refinanciacion.sql
├── 04_limpiar_datos_prueba.sql
├── 05_alter_fiado.sql
├── 06_crear_usuarios.sql
├── 07_crear_auditoria.sql
├── 08_alter_pagos_usuario.sql
├── 09_agregar_adelanto.sql
├── 10_agregar_referencia_credito.sql
├── 10_fix_cuotas_liquidacion.sql
├── 10_historial_recalculos.sql
├── 10_tipos_prestamo.sql
├── 11_pagos_monto_interes_capital.sql
├── 12_indices_rendimiento.sql
├── 13_backup_historial.sql
├── 14_indices_rendimiento_v2.sql
├── 15_metodo_desembolso.sql
├── 16_normalizar_mora_cuotas.sql
├── 17_check_estado_cuota.sql
├── 18_fix_cuotas_sobrepagadas.sql
├── 19_interes_fijo.sql
├── 19_clientes_prueba.sql
├── 20_sin_cuotas_futuras.sql               # Ejecutada automáticamente por autoMigrar()
├── 20_clientes_mayusculas.sql
├── 21_empresas_y_gastos.sql
├── 22_retornos_empresa.sql
├── 23_cliente_nullable_interno.sql
├── 24_empresa_codigo_nit.sql
├── 25_pagos_cliente_nullable.sql
├── 26_tipo_congelacion.sql
│
├── CLAUDE.md
├── PROMPT.md
├── Documentacion_TataLinan.docx
└── Creditod/                                # Bóveda Obsidian (esta base de conocimiento)
```

---

## Archivos modificados por módulo

### Módulo Créditos Libres (2026-07-12)
- `components/Sidebar.jsx` — enlace "📅 Cred. Sin Cuotas" → `/creditos-libres`
- `components/BottomNav.jsx` — ítem en menú secundario móvil
- `app/api/productos/route.js` — guardia POST: rechaza `tipo='credito_libre'` con 400
- `app/cobros/page.js` — detecta `g.tipo === 'credito_libre'` y redirige a `/creditos-libres/[id]?abrir=1`

### Módulo Empresas y Gastos (2026-07)
- `components/Sidebar.jsx` — enlace a `/gastos`
- `app/cobros/page.js` — no aplica (empresas no aparecen en cobros normales)

### Auto-registro (2026-07)
- `middleware.js` — rutas `/registro`, `/autoregistro/*` y `/api/registro` marcadas como públicas (sin JWT)
