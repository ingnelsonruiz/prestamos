import { v4 as uuidv4 } from 'uuid'

// Días por período (uso en francés y mora)
const DIAS = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }

// Cuotas equivalentes por mes — convención prestamistas (1 mes = 4 sem = 2 quin = 30 días)
const CUOTAS_POR_MES = { diario: 30, semanal: 4, quincenal: 2, mensual: 1, anual: 1 / 12 }

/**
 * Convierte tasa de un período a otro usando equivalencia efectiva compuesta
 */
export function convertirTasa(tasa, periodoOrigen, periodoDestino) {
  const diasOrigen  = DIAS[periodoOrigen]
  const diasDestino = DIAS[periodoDestino]
  return Math.pow(1 + tasa / 100, diasDestino / diasOrigen) - 1
}

/**
 * Extrae fecha YYYY-MM-DD como string seguro desde string o Date de pg (UTC midnight)
 */
function fechaAString(fecha) {
  if (!fecha) return null
  if (typeof fecha === 'string') return fecha.split('T')[0]
  // Date object de pg viene en UTC midnight → usar UTC para extraer la fecha correcta
  const d = new Date(fecha)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Calcula fecha de vencimiento de una cuota según frecuencia (zona local)
 */
function calcularFechaVencimiento(fechaInicio, numeroCuota, frecuencia) {
  const [year, month, day] = fechaAString(fechaInicio).split('-').map(Number)
  const fecha = new Date(year, month - 1, day) // local timezone
  const n = numeroCuota - 1
  switch (frecuencia) {
    case 'diario':    fecha.setDate(fecha.getDate() + n); break
    case 'semanal':   fecha.setDate(fecha.getDate() + n * 7); break
    case 'quincenal': fecha.setDate(fecha.getDate() + n * 15); break
    case 'mensual':   fecha.setMonth(fecha.getMonth() + n); break
  }
  const y  = fecha.getFullYear()
  const m  = String(fecha.getMonth() + 1).padStart(2, '0')
  const d  = String(fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Interés plano — interés siempre sobre capital inicial.
 * Calcula interés TOTAL primero para evitar error de redondeo acumulado.
 * Ej: $1.000.000 × 10% mensual × 2 meses (60 días) = $200.000 → cuota $20.000 exacto.
 * La última cuota absorbe el residuo de redondeo.
 */
export function calcularInteresPlano(productoId, clienteId, P, tasaPct, periodoTasa, frecuenciaCobro, n, fechaPrimerPago) {
  // Duración del préstamo en unidades de periodoTasa
  // Ej: 60 cuotas diarias con tasa mensual → 60 × (1/30) = 2 meses
  const cpmOrigen  = CUOTAS_POR_MES[periodoTasa]    || 1
  const cpmDestino = CUOTAS_POR_MES[frecuenciaCobro] || 1
  const numPeriodos = n * cpmOrigen / cpmDestino

  // Interés total exacto sobre capital inicial
  const interesTotal = Math.round(P * (tasaPct / 100) * numPeriodos)

  // Cuota fija: evita acumular error cuota a cuota
  const cuotaBase    = Math.floor((P + interesTotal) / n)
  const cuotaResiduo = (P + interesTotal) - cuotaBase * n  // centavos → última cuota

  // Capital distribuido uniformemente
  const abonoCapBase   = Math.floor(P / n)
  const capitalResiduo = P - abonoCapBase * n

  const cuotas = []
  let saldo = P

  for (let i = 1; i <= n; i++) {
    const isLast       = i === n
    const montoCuota   = isLast ? cuotaBase + cuotaResiduo : cuotaBase
    const thisAbonoCap = isLast ? abonoCapBase + capitalResiduo : abonoCapBase
    const thisAbonoInt = montoCuota - thisAbonoCap
    saldo              = saldo - thisAbonoCap

    cuotas.push({
      id:                uuidv4(),
      producto_id:       productoId,
      cliente_id:        clienteId,
      numero_cuota:      i,
      fecha_vencimiento: calcularFechaVencimiento(fechaPrimerPago, i, frecuenciaCobro),
      monto_cuota:       montoCuota,
      abono_interes:     thisAbonoInt,
      abono_capital:     thisAbonoCap,
      saldo_pendiente:   Math.max(Math.round(saldo), 0),
      monto_pagado:      0,
      dias_mora:         0,
      estado:            'pendiente',
    })
  }
  return cuotas
}

/**
 * Sistema francés — cuota fija sobre saldo decreciente (conversión efectiva compuesta)
 * La última cuota se ajusta para cerrar el saldo exactamente en 0
 */
export function calcularFrances(productoId, clienteId, P, tasaPct, periodoTasa, frecuenciaCobro, n, fechaPrimerPago) {
  const i = convertirTasa(tasaPct, periodoTasa, frecuenciaCobro)
  const cuotaFija = i === 0
    ? P / n
    : P * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)

  const cuotas = []
  let saldo = P

  for (let k = 1; k <= n; k++) {
    const isLast   = k === n
    const abonoInt = Math.round(saldo * i)
    // Última cuota: capital = saldo restante exacto para cerrar en 0
    const abonoCap = isLast ? Math.round(saldo) : Math.round(cuotaFija - saldo * i)
    const monto    = isLast ? Math.round(saldo) + abonoInt : Math.round(cuotaFija)
    saldo          = saldo - abonoCap

    cuotas.push({
      id:                uuidv4(),
      producto_id:       productoId,
      cliente_id:        clienteId,
      numero_cuota:      k,
      fecha_vencimiento: calcularFechaVencimiento(fechaPrimerPago, k, frecuenciaCobro),
      monto_cuota:       monto,
      abono_interes:     abonoInt,
      abono_capital:     abonoCap,
      saldo_pendiente:   isLast ? 0 : Math.max(Math.round(saldo), 0),
      monto_pagado:      0,
      dias_mora:         0,
      estado:            'pendiente',
    })
  }
  return cuotas
}

/**
 * Genera cuotas según el método del producto
 */
export function generarCuotas(producto) {
  const { id, cliente_id, monto_capital, tasa_interes, periodo_tasa,
          frecuencia_cobro, num_cuotas, fecha_primer_pago, metodo_calculo } = producto

  if (metodo_calculo === 'frances') {
    return calcularFrances(id, cliente_id, monto_capital, tasa_interes,
      periodo_tasa, frecuencia_cobro, num_cuotas, fecha_primer_pago)
  }
  return calcularInteresPlano(id, cliente_id, monto_capital, tasa_interes,
    periodo_tasa, frecuencia_cobro, num_cuotas, fecha_primer_pago)
}

/**
 * Calcula días de mora de una cuota al día de hoy
 * Usa zona horaria LOCAL para comparar fechas correctamente (evita bug UTC)
 */
export function calcularDiasMora(fechaVencimiento) {
  const hoy = new Date()
  // Construir fecha HOY en zona local (sin componente de hora)
  const hoyLocal  = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  // Extraer fecha de vencimiento en zona local (pg devuelve Date UTC midnight)
  const venceStr  = fechaAString(fechaVencimiento)
  if (!venceStr) return 0
  const [y, m, d] = venceStr.split('-').map(Number)
  const venceLocal = new Date(y, m - 1, d)
  const diffMs     = hoyLocal - venceLocal
  return diffMs > 0 ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : 0
}
