# Estructura de Directorios

Árbol estructural estructurado del repositorio de la aplicación Next.js:


Programa_Creditos/
├── app/
│   ├── api/
│   │   ├── auth/login|logout|me/
│   │   ├── clientes/[id]/
│   │   ├── productos/[id]/
│   │   │   └── liquidar/          # POST liquidación anticipada[cite: 1]
│   │   ├── cuotas/
│   │   ├── pagos/
│   │   ├── dashboard/
│   │   ├── estado/[id]/           # PÚBLICO[cite: 1]
│   │   ├── informes/
│   │   ├── recibos/               # Búsqueda por número de recibo[cite: 1]
│   │   ├── migracion/             # POST importación masiva[cite: 1]
│   │   │   └── reset/             # POST limpiar datos de prueba[cite: 1]
│   │   ├── config/modo-prueba/    # GET/POST toggle fechas futuras[cite: 1]
│   │   ├── configuracion/tipos/   # GET/POST tipos de préstamo dinámicos[cite: 1]
│   │   │   └── [id]/              # PUT/DELETE tipo[cite: 1]
│   │   ├── backup/                # GET export JSON / POST restaurar[cite: 1]
│   │   │   ├── estructura/        # POST recrear estructura BD (idempotente)[cite: 1]
│   │   │   └── historial/         # GET historial de backups[cite: 1]
│   │   ├── historial/             # GET snapshots + pagos + cuotas[cite: 1]
│   │   ├── health/                # GET healthcheck (SELECT 1)[cite: 1]
│   │   ├── usuarios/[id]/
│   │   └── auditoria/
│   ├── login/
│   ├── clientes/[id]/
│   ├── prestamos/[id]/ nuevo/
│   ├── cobros/
│   ├── empenos/
│   ├── recibos/                   # Módulo búsqueda de recibos[cite: 1]
│   ├── estado/[id]/               # PÚBLICO[cite: 1]
│   ├── informes/
│   ├── migracion/                 # Migración masiva + zona desarrollo[cite: 1]
│   ├── configuracion/             # Gestión de tipos de préstamo[cite: 1]
│   ├── backup/                    # Copias de seguridad y estructura[cite: 1]
│   ├── usuarios/
│   ├── auditoria/
│   └── page.js                    # Dashboard principal[cite: 1]
├── components/
│   ├── Sidebar.jsx
│   ├── BottomNav.jsx
│   ├── LayoutWrapper.jsx          # Banner modo prueba global[cite: 1]
│   └── KPICard.jsx
├── lib/
│   ├── db.js                      # Doble modo: pg pool / proxy HTTP[cite: 1]
│   ├── auth.js
│   ├── calculos.js
│   └── auditoria.js
├── middleware.js
├── next.config.js
├── vercel.json                    # maxDuration 60s en app/api/[cite: 1]
├── .env.local
├── 00_schema_completo.sql         # Estructura completa idempotente[cite: 1]
└── *.sql                          # Migraciones 03..15[cite: 1]