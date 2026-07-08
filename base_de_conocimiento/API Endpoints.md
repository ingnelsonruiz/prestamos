# API Endpoints

Documentación técnica de los Route Handlers expuestos en la arquitectura Next.js[cite: 1]:

### 🔐 Autenticación
- `POST /api/auth/login`: Genera sesión JWT almacenada en cookie `itl_session` (8 horas)[cite: 1].
- `POST /api/auth/logout`: Invalida la sesión limpiando la cookie del navegador[cite: 1].
- `GET /api/auth/me`: Retorna los datos del usuario autenticado actual[cite: 1].

### 👥 Módulo de Clientes
- `GET /api/clientes?q=`: Búsqueda flexible[cite: 1]. Permite segmentar mediante parámetros query (`solo_prueba` y filtrado dinámico de estados)[cite: 1].
- `POST /api/clientes`: Registra un nuevo deudor. Retorna un código 409 si el documento ya existe[cite: 1].
- `GET/PUT/DELETE /api/clientes/[id]`: Operaciones de lectura, edición y borrado de clientes[cite: 1].

### 💰 Gestión de Productos Financieros
- `GET /api/productos?cliente_id=`: Lista los productos de un deudor desglosando `capital_pendiente_real` e `interes_pendiente` con fórmulas ponderadas[cite: 1].
- `POST /api/productos`: Crea préstamos, empeños o cuentas abiertas[cite: 1]. Genera el cronograma de cuotas y guarda el snapshot inicial en `cred_historial_recalculos`[cite: 1].
- `POST /api/productos/[id]/liquidar`: Aplica la liquidación anticipada de un crédito con un valor acordado[cite: 1].

### 📝 Pagos y Recibos
- `GET /api/cuotas?estado=&cliente_id=&producto_id=`: Retorna cuotas bajo criterios específicos de cobro[cite: 1].
- `POST /api/pagos`: Procesa abonos en memoria, calcula distribuciones por amortización, actualiza cuotas en lote e incrementa el contador de recibos atómicamente (`UPDATE...RETURNING`)[cite: 1].
- `GET /api/pagos?producto_id=&cliente_id=&fecha=`: Utilizado para el cierre y arqueo de caja diario[cite: 1].
- `GET /api/recibos?q=`: Búsqueda exacta o parcial de tiquetes de pago (`REC-000001` o número simple `1`)[cite: 1].

### ⚙️ Monitoreo, Backups y Configuración
- `GET /api/dashboard`: Retorna KPIs globales en tiempo real e históricos para la gerencia[cite: 1].
- `POST /api/migracion/reset-cliente`: Recibe un arreglo de `productoIds` y limpia de forma parcial los créditos de un único deudor sin alterar sus otros registros[cite: 1].
- `GET/POST /api/backup`: Exporta la base de datos completa (8 tablas) a JSON, o restaura datos de forma masiva sin alterar al usuario actual[cite: 1].
- `GET /api/health`: Healthcheck operativo que corre un `SELECT 1` para medir tiempos de respuesta en milisegundos[cite: 1].