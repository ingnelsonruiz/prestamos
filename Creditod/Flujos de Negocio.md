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
- **Síntoma**: Toda la aplicación colapsaba con el mensaje en rojo: *"Sin conexión a la base de datos"* acompañado del log `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`[cite: 1].
- **Causa**: La variable `DB_PORT=5432` conectaba la aplicación al pooler Supavisor de Supabase en **modo "Session"**[cite: 1]. Bajo la arquitectura serverless de Vercel, cada invocación fría generaba pools individuales que retenían de manera exclusiva un backend de Postgres durante todo su ciclo de vida[cite: 1]. Al concurrir peticiones paralelas del dashboard y cobros, los 15 clientes concurrentes del plan se agotaban instantáneamente[cite: 1].
- **Solución Ejecutada**: Se modificó el archivo `lib/db.js` y el entorno local para redirigir las conexiones al puerto **`6543`**, activando el **modo "Transaction"** del pooler[cite: 1]. En este modo, el proxy libera la conexión de Postgres inmediatamente después de finalizar cada transacción corta, permitiendo cientos de peticiones concurrentes sobre un pool pequeño[cite: 1]. Este patrón es totalmente compatible con `withTransaction()`, ya que mantiene al cliente dedicado únicamente durante el bloque `BEGIN...COMMIT`[cite: 1].
- **Acción de Mantenimiento**: Monitorear y asegurar que la variab
---

## 📅 Flujo de Créditos Sin Cuotas Futuras (2026-07-12)

Módulo **totalmente aislado** del motor de cuotas. No usa `lib/calculos.js`, no llama `POST /api/pagos`, no ejecuta `recalcularCuotasPlano`.

### Reglas de negocio
- **Convención 30/360**: cada mes = exactamente 30 días, independientemente de cuántos días tenga el mes real. Fórmula: `(Y2−Y1)×360 + (M2−M1)×30 + (D2−D1)`. Garantiza cobros mensuales consistentes.
- **Fórmula de interés**: `interés = capital_pendiente × (tasa/100 / diasBase) × dias30_360`, donde `diasBase` depende del `periodo_tasa` (diario=1, semanal=7, quincenal=15, mensual=30, anual=360).
- **Tipos de abono**: `interes` (solo interés del período), `capital` (abono libre al principal), `ambos` (interés + capital en un recibo).
- **Fecha de corte**: siempre estrictamente posterior al último corte registrado. Se rechaza si es igual o anterior.
- **Saldado**: cuando `capital_pagado >= monto_capital - 0.5`.
- **`fecha_primer_pago`**: es la fecha de inicio ingresada por el usuario en el formulario. Se usa como punto de partida para el primer período de interés.

### Flujo de creación
`POST /api/creditos-libres` → producto con `tipo='credito_libre'` → 1 cuota placeholder `2099-12-31` → desembolso en `cred_movimientos_caja`.

### Flujo de cobro de interés
1. Cobrador selecciona fecha de corte.
2. `GET /api/creditos-libres/[id]/calcular?fecha_corte=YYYY-MM-DD` proyecta el interés (solo lectura).
3. Sistema muestra monto sugerido editable.
4. Cobrador confirma → `POST /api/creditos-libres/[id]/abonar` guarda el pago en `cred_pagos` con `fecha_corte_interes`.

### Flujo de acceso desde Cobros
`app/cobros/page.js` detecta `g.tipo === 'credito_libre'` en los tres botones de pago y ejecuta `router.push('/creditos-libres/[id]?abrir=1')`. El parámetro `?abrir=1` inicializa `modalAbierto=true` en la página de detalle, abriendo el modal de abono de forma inmediata sin pasos adicionales.

### Patrón de auto-migración
```js
async function autoMigrar() {
  await query(`ALTER TABLE administrativo.cred_pagos ADD COLUMN IF NOT EXISTS fecha_corte_interes DATE NULL`)
  await query(`ALTER TABLE administrativo.cred_tipos_prestamo DROP CONSTRAINT IF EXISTS cred_tipos_prestamo_comportamiento_check`)
  await query(`INSERT INTO administrativo.cred_tipos_prestamo (...) ON CONFLICT (codigo) DO NOTHING`)
}
```
Se ejecuta al inicio de cada request en los 4 endpoints del módulo. Es idempotente — seguro de correr múltiples veces.

### Bugs corregidos durante el desarrollo
| Bug | Causa | Fix |
|-----|-------|-----|
| Fecha mostraba día anterior | `new Date("2026-05-01")` = medianoche UTC = abril 30 en Colombia (UTC-5) | Siempre usar `new Date(str + 'T12:00:00')` |
| Input capital rechazaba 1.000.000 | `<input type="number" step="1000">` genera secuencia 1, 1001... | `type="text" inputMode="numeric"` con handler de formateo manual |
| Se cobraba interés del mismo día | Validación usaba `<` en lugar de `<=` | `if (fecha_corte <= anteriorStr)` rechaza |
| Error constraint violado al insertar tipo | CHECK no incluía `sin_cuotas_futuras` | `DROP CONSTRAINT IF EXISTS` en `autoMigrar()` |
| Interés calculado con días reales (31 días) | No usaba convención 30/360 | Función `diasD360()` implementando 30/360 |
