# Lógica Financiera y Calificación

El núcleo financiero y los algoritmos de evaluación del sistema se rigen bajo reglas estrictas centralizadas en la aplicación[cite: 1].

## 📐 Motores de Amortización (`lib/calculos.js`)

Para realizar proyecciones de cobro temporales se utiliza un mapa estricto de conversión de días:
`const DIAS = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }`[cite: 1].

### 1. Método Plano
- **Conversión de Tasa**: Se calcula de forma lineal proporcional:  
  `tasa_periodo = (tasa% / 100) * (días_destino / días_origen)`[cite: 1].
- **Comportamiento Estándar**: La cuota se mantiene constante y los intereses se calculan originalmente sobre el capital inicial[cite: 1]. En condiciones normales (`interes_fijo = false`), cada abono a capital gatilla una redistribución mediante `recalcularCuotasPlano()`, disminuyendo el interés de las cuotas restantes basándose en el saldo de capital decreciente[cite: 1].

### 2. Método Francés
- **Conversión de Tasa**: Utiliza una conversión de tipo efectiva compuesta:  
  `(1 + i)^(d2/d1) - 1`[cite: 1].
- **Comportamiento**: Calcula cuotas fijas inalterables mediante la fórmula:  
  `P * i*(1+i)^n / ((1+i)^n - 1)`[cite: 1].  
  El cronograma es estático y no se altera ni redistribuye ante abonos directos a capital[cite: 1].

### 3. Cuentas Abiertas (`fiado` y `adelanto`)
- No devengan tasas de interés ni cuotas periódicas[cite: 1]. Generan automáticamente una única cuota global con una fecha límite fijada por sistema al `2099-12-31`[cite: 1].

---

## 💎 Algoritmo de Calificación del Cliente

El score del cliente se calcula dinámicamente en el lado del cliente (Frontend) basándose únicamente en aquellas cuotas que registran actividad real (cuotas pagadas, parciales o que se encuentren vencidas, ignorando la fecha comodín `2099-12-31`)[cite: 1].

```js
// Si no hay pagos registrados o no existen cuotas evaluables, retorna null (Sin historial)[cite: 1]
score = ((pagadas * 1.0) + (parciales * 0.5)) / evaluables.length * 100;
if (refinanciado) score -= 20; // Penalización por refinanciación[cite: 1]
---

## 📅 Motor de Créditos Sin Cuotas Futuras (2026-07-12)

Motor **completamente independiente** de `lib/calculos.js`. No interactúa con el motor de amortización plana ni francesa.

### Convención 30/360
```js
function diasD360(inicioStr, finStr) {
  const [y1, m1, d1] = inicioStr.split('-').map(Number)
  const [y2, m2, d2] = finStr.split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}
```
Ejemplo: 1 mayo → 1 julio = `(0×360) + (2×30) + 0 = 60 días` (no 61 como en calendario real).

### Fórmula de interés
```
interés = capital_pendiente × (tasa% / 100 / diasBase) × diasD360(inicio, corte)
```
Donde `diasBase` según `periodo_tasa`:
- `diario` → 1, `semanal` → 7, `quincenal` → 15, `mensual` → 30, `anual` → 360

### Aislamiento garantizado
- NO modifica `lib/calculos.js`
- NO llama `POST /api/pagos`
- NO ejecuta `recalcularCuotasPlano`
- Los créditos existentes (préstamos, fiados, empeños) no se ven afectados en ningún caso
