# Base de Datos

El sistema implementa PostgreSQL y encapsula todas sus entidades dentro del esquema lógico llamado `administrativo`[cite: 1]. En todo el backend, se define la constante global `const S = 'administrativo'` para calificar las consultas SQL[cite: 1].

## Diccionario de Tablas Principales[cite: 1]

### 1. `cred_clientes`
Almacena la información de contacto de los clientes deudores[cite: 1].
- `id` (TEXT PK): Identificador único UUID v4[cite: 1].
- `documento` (TEXT UNIQUE): Cédula de ciudadanía o NIT[cite: 1].
- `nombre` (TEXT): Nombre completo del cliente[cite: 1].
- `telefono`, `direccion`, `email` (TEXT): Campos de contacto nullables[cite: 1].

### 2. `cred_productos`
Entidad core que unifica préstamos, empeños, ventas a crédito, fiados y adelantos[cite: 1].
- `id` (TEXT PK): UUID v4[cite: 1].
- `referencia` (TEXT): Código legible consecutivo auto-incremental en formato `CRED-000001`[cite: 1].
- `tipo` (TEXT): Código dinámico de la tabla `cred_tipos_prestamo`[cite: 1].
- `metodo_calculo` (TEXT): Tipo de amortización financiera (`plano` o `frances`)[cite: 1].
- `metodo_desembolso` (TEXT): Restricción CHECK (`efectivo`, `transferencia`, `nequi`, `daviplata`, `llave_breb`, `otro`)[cite: 1].
- `interes_fijo` (BOOLEAN): Control opt-in para congelar intereses en método plano[cite: 1].
- `estado` (TEXT): Estado transaccional (`activo`, `al_dia`, `en_mora`, `saldado`, `decomisado`, `refinanciado`)[cite: 1].

### 3. `cred_cuotas`
Cronograma detallado de cobros programados por producto[cite: 1].
- `numero_cuota` (INTEGER), `fecha_vencimiento` (DATE), `monto_cuota` (NUMERIC)[cite: 1].
- `abono_interes`, `abono_capital`, `saldo_pendiente`, `monto_pagado` (NUMERIC)[cite: 1].
- `estado` (TEXT): Restringido estrictamente por CHECK a los estados `('pendiente', 'parcial', 'pagada')`[cite: 1].

### 4. `cred_pagos`
Historial inmutable de abonos recibidos en caja[cite: 1].
- Contiene relaciones a cuotas, montos desglosados de interés/capital cobrados al momento del pago, `numero_recibo` consecutivo (`REC-000001`) y el `usuario_nombre` que operó la transacción[cite: 1].

### 5. Tablas de Configuración y Soporte
- `cred_tipos_prestamo`: CRUD de configuraciones dinámicas de créditos y comportamientos (`prestamo_normal`, `cuenta_abierta`, `empeno`)[cite: 1].
- `cred_historial_recalculos`: Capturas fotográficas (snapshots) de estados de deuda durante creación y abonos a capital[cite: 1].
- `cred_movimientos_caja`: Registro contable diario con cálculo de saldo acumulado[cite: 1].
- `cred_backups`: Historial de exportaciones completas del sistema a archivos JSON[cite: 1].

---

## 📑 Control de Migraciones SQL

El ciclo evolutivo de la base de datos se rige por scripts estructurados[cite: 1]:
- **03 al 09**: Modificaciones para introducir la refinanciación, tipos de cuenta abierta (`fiado` / `adelanto`) y tablas estructurales de usuarios y auditorías[cite: 1].
- **10 (Múltiples scripts)**: Creación de consecutivos legibles (`CRED-XXXXXX`), snapshots de recálculos, eliminación del CHECK estático de productos y despliegue de la tabla `cred_tipos_prestamo`[cite: 1].
- **11 al 15**: Desglose inmutable de pagos, creación de índices compuestos de alto rendimiento, tablas de historial de backups, índices trigram (`pg_trgm`) para búsquedas rápidas y control de medios de desembolso[cite: 1].
- **16 y 17 (Blindaje de Mora)**: El script 16 normalizó cuotas antiguas erróneamente guardadas con `estado='mora'`[cite: 1]. El script 17 aplicó la restricción `CHECK` final[cite: 1]. **Regla de Negocio**: La mora no se almacena en las cuotas; se evalúa dinámicamente comparando `fecha_vencimiento < CURRENT_DATE` en cada consulta[cite: 1].
- **18 (Cuotas sobrepagadas)**: Automatización que ajusta `monto_cuota = monto_pagado` cuando un cliente paga de más, absorbiendo el excedente en el capital y previniendo saldos pendientes negativos[cite: 1].
- **19 (Interés Fijo)**: Inserción de la bandera `interes_fijo DEFAULT FALSE` para congelar intereses sobre el capital base original[cite: 1].