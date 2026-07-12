---

### Archivo 7: `Flujos de Negocio.md`

```markdown
# Flujos de Negocio y Operaciones

## 💵 Flujo Transaccional de Pagos (`POST /api/pagos`)

El registro de abonos no corre bajo una transacción SQL global de base de datos (`withTransaction`), sino que opera mediante procesos concurrentes utilizando `Promise.all` para optimizar el rendimiento y escalas en la nube[cite: 1]:

1. **Control de Topes de Pago**: En el método `plano`, el sistema impide recibir montos superiores a la ecuación `capital_pendiente + interés del período actual`[cite: 1]. Esto evita cobrar intereses futuros por adelantado, lo cual constituiría un sobrecobro al cliente[cite: 1].
2. **Estrategia de Distribución**:
   - **En Amortización Plana**: Se liquida estrictamente el interés correspondiente a la cuota pendiente más antigua, y absolutamente todo el dinero excedente se inyecta directamente como abono a **CAPITAL**[cite: 1]. Inmediatamente después, el backend ejecuta `recalcularCuotasPlano()` para recalcular a la baja las cuotas restantes[cite: 1].
   - **En Amortización Francesa**: Distribución tradicional secuencial cuota por cuota (interés de la cuota, luego su capital)[cite: 1].
3. **Cierre Contable**: Actualiza en bloque el estado de las cuotas, genera el registro físico del pago en `cred_pagos`, calcula el nuevo saldo acumulado de caja e inserta el movimiento contable en `cred_movimientos_caja`[cite: 1].

---

## ❄️ Reglas de Blindaje: Congelaciones e Interés Fijo

### 1. Créditos de Congelación
- Es un tipo especial de sistema (`comportamiento='prestamo_normal'`) ideado para diferir deudas en mora severa, unificando el capital y el interés causado en un nuevo préstamo a **tasa 0% y sin nuevos intereses**[cite: 1].
- **Blindaje Técnico (2026-07-02)**: Para evitar errores humanos donde operadores dejaran tasas activas en el formulario al seleccionar "Congelación", se implementó un bloqueo forzado en dos capas[cite: 1]. En el frontend, un `useEffect` limpia y desactiva el campo Tasa en `/prestamos/nuevo` y en `/migracion/cargue-inicial`[cite: 1]. En el backend, las variables `tasaSegura` y `conInteresSeguro` interceptan el `POST`, destruyendo cualquier valor superior a 0[cite: 1].

### 2. Parámetro de Interés Fijo
- Modificación introducida el 2026-07-03 para créditos planos nuevos[cite: 1]. Al activarse (`interes_fijo = true`), el motor de recálculo altera su comportamiento básico: en lugar de calcular el interés del periodo sobre el `saldoCapital` decreciente, fuerza la ecuación para que la base del cálculo se mantenga estática sobre el `monto_capital` original desembolsado[cite: 1].

---

## 🛠️ Registro Histórico de Incidentes Críticos

### ⚠️ Incidente del 2026-07-02 — Agotamiento de Conexiones en Producción (Vercel)
- **Síntoma**: Toda la aplicación colapsaba con el mensaje en rojo: *"Sin conexión a la base de datos"* acompañado del log `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`.
- **Causa**: La variable `DB_PORT=5432` conectaba la aplicación al pooler Supavisor de Supabase en **modo "Session"**. Bajo la arquitectura serverless de Vercel, cada invocación fría generaba pools individuales que retenían de manera exclusiva un backend de Postgres durante todo su ciclo de vida. Al concurrir peticiones paralelas del dashboard y cobros, los 15 clientes concurrentes del plan se agotaban instantáneamente.
- **Solución Ejecutada**: Se modificó `lib/db.js` y `.env.local` para redirigir las conexiones al puerto **`6543`**, activando el **modo "Transaction"** del pooler. En este modo, PgBouncer libera la conexión de Postgres inmediatamente después de finalizar cada transacción corta. Compatible con `withTransaction()` ya que mantiene al cliente dedicado solo durante el bloque `BEGIN...COMMIT`.
- **Acción pendiente**: Actualizar `DB_PORT=6543` en **Vercel → Settings → Environment Variables** y redesplegar.

### ⚠️ Incidente del 2026-07-08 — EMAXCONN limit:200 en plan de pago (Supabase)
- **Síntoma**: Login y páginas mostraban `(EMAXCONN) max client connections reached, limit: 200` incluso con un solo usuario activo, después de migrar al plan de pago de Supabase y configurar el pooler en puerto 6543.
- **Causa raíz — arquitectura serverless mal entendida**: En Vercel, **cada ruta API corre en su propio proceso aislado** — `globalThis.__pg_pool` NO se comparte entre rutas distintas, solo entre invocaciones cálidas de la MISMA ruta. Por lo tanto, cuando el dashboard dispara 8-10 llamadas API en paralelo (`/api/dashboard`, `/api/productos`, `/api/cuotas`, etc.), se crean 8-10 pools independientes. Con la configuración anterior (`max:3`, `idleTimeoutMillis:30000`, `keepAlive:true`), las instancias "warm" de Vercel acumulaban conexiones abiertas durante 30 segundos en cada ruta, alcanzando fácilmente 200 conexiones con un único usuario navegando activamente.
- **Solución aplicada en `lib/db.js` (2026-07-08)**:

| Parámetro | Antes | Después | Razón |
|---|---|---|---|
| `max` | `3` | `1` | Serverless procesa 1 request por instancia; más conexiones solo se acumulan idle |
| `idleTimeoutMillis` | `30000` | `10000` | Libera conexiones ociosas en 10s, no 30s |
| `allowExitOnIdle` | ausente | `true` | El pool se destruye cuando no hay queries activas |
| `keepAlive` | `true` | omitido (false) | Evita mantener conexiones TCP vivas innecesariamente |
| Puerto por defecto | `'5432'` | `'6543'` | Seguro de falla: si DB_PORT no está en Vercel, cae a PgBouncer Transaction en vez de Session |

- **Patrón a recordar**: `max:1` es correcto y seguro con PgBouncer Transaction mode. El pooler libera la conexión de servidor tras cada transacción; un `max` mayor solo genera acumulación de conexiones idle en instancias serverless warm. `withTransaction()` es compatible porque toma un cliente dedicado del pool durante `BEGIN...COMMIT` y lo libera en `finally`.
- **Acción pendiente**: Confirmar en Vercel → Settings → Environment Variables que `DB_HOST=aws-1-us-east-2.pooler.supabase.com` y `DB_PORT=6543`, luego redesplegar sin caché.