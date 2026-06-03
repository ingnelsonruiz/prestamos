import { v4 as uuidv4 } from 'uuid'

// Días por período
const DIAS = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }

/**
 * Convierte tasa de un período a otro usando equivalencia efectiva
 */
export function convertirTasa(tasa, periodoOrigen, periodoDestino) {
  const diasOrigen  = DIAS[periodoOrigen]
  const diasDestino = DIAS[periodoDestino]
  return Math.pow(1 + tasa / 100, diasDestino / diasOrigen) - 1
}

/**
 * Calcula fecha de vencimiento de una cuota según frecuencia
 */
function calcularFechaVencimiento(fechaInicio, numeroCuota, frecuencia) {
  // Parsear fecha evitando desfase de zona horaria
  const [year, month, day] = fechaInicio.split('-').map(Number)
  const fecha = new Date(year, month - 1, day) // local timezone
  const n = numeroCuota - 1
  switch (frecuencia) {
    case 'diario':     fecha.setDate(fecha.getDate() + n); break
    case 'semanal':    fecha.setDate(fecha.getDate() + n * 7); break
    case 'quincenal':  fecha.setDate(fecha.getDate() + n * 15); break
    case 'mensual':    fecha.setMonth(fecha.getMonth() + n); break
  }
  // Formato YYYY-MM-DD sin UTC
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2,'0')
  const d = String(fecha.getDate()).padStart(2,'0')
  return `${y}-${m}-${d}`
}

/**
 * Interés plano — interés siempre sobre capital inicial
 * Retorna array de cuotas listo para insertar en cred_cuotas
 */
export function calcularInteresPlano(productoId, clienteId, P, tasaPct, periodoTasa, frecuenciaCobro, n, fechaPrimerPago) {
  // Interés plano: conversión PROPORCIONAL (no compuesta)
  // Ej: 10% mensual → diario = 10%/30 = 0.333%
  const diasOrigen  = DIAS[periodoTasa]
  const diasDestino = DIAS[frecuenciaCobro]
  const tasaPeriodo = (tasaPct / 100) * (diasDestino / diasOrigen)

  const totalIntereses  = P * tasaPeriodo * n
  const totalAPagar     = P + totalIntereses
  const cuotaBase       = Math.floor(totalAPagar / n)
  const residuo         = totalAPagar - cuotaBase * n
  const abonoCap        = Math.floor(P / n)
  const abonoInt        = Math.floor(P * tasaPeriodo)

  const cuotas = []
  let saldo = P

  for (let i = 1; i <= n; i++) {
    const esPrimera   = i === 1
    const montoCuota  = esPrimera ? cuotaBase + residuo : cuotaBase
    saldo             = saldo - abonoCap

    cuotas.push({
      id:                uuidv4(),
      producto_id:       productoId,
      cliente_id:        clienteId,
      numero_cuota:      i,
      fecha_vencimiento: calcularFechaVencimiento(fechaPrimerPago, i, frecuenciaCobro),
      monto_cuota:       montoCuota,
      abono_interes:     abonoInt,
      abono_capital:     abonoCap,
      saldo_pendiente:   Math.max(saldo, 0),
      monto_pagado:      0,
      dias_mora:         0,
      estado:            'pendiente',
    })
  }
  return cuotas
}

/**
 * Sistema francés — cuota fija sobre saldo decreciente
 */
export function calcularFrances(productoId, clienteId, P, tasaPct, periodoTasa, frecuenciaCobro, n, fechaPrimerPago) {
  const i = convertirTasa(tasaPct, periodoTasa, frecuenciaCobro)
  const cuotaFija = i === 0
    ? P / n
    : P * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)

  const cuotas = []
  let saldo = P

  for (let k = 1; k <= n; k++) {
    const abonoInt = saldo * i
    const abonoCap = cuotaFija - abonoInt
    saldo          = saldo - abonoCap

    cuotas.push({
      id:                uuidv4(),
      producto_id:       productoId,
      cliente_id:        clienteId,
      numero_cuota:      k,
      fecha_vencimiento: calcularFechaVencimiento(fechaPrimerPago, k, frecuenciaCobro),
      monto_cuota:       Math.round(cuotaFija),
      abono_interes:     Math.round(abonoInt),
      abono_capital:     Math.round(abonoCap),
      saldo_pendiente:   Math.max(Math.round(saldo), 0),
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
 */
export function calcularDiasMora(fechaVencimiento) {
  const hoy      = new Date()
  const vence    = new Date(fechaVencimiento)
  const diffMs   = hoy - vence
  return diffMs > 0 ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : 0
}
