'use client'
import { useState, useEffect, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

const fmt     = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0)
// Siempre forzar mediodía local para evitar desfase UTC-5 (Colombia)
const fmtDate = s => {
  if (!s) return '—'
  const str = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10)
  return new Date(str + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}
const todayStr = () => new Date().toISOString().slice(0, 10)

const METODOS = [
  { value: 'efectivo',      label: '💵 Efectivo'      },
  { value: 'transferencia', label: '🏦 Transferencia' },
  { value: 'nequi',         label: '🟣 Nequi'         },
  { value: 'daviplata',     label: '🔵 Daviplata'     },
  { value: 'otro',          label: '💳 Otro'           },
]

export default function DetalleCreditoLibrePage({ params }) {
  const { id }       = use(params)
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [credito, setCredito]       = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error,   setError]         = useState('')

  // Modal de abono — se abre automáticamente si viene ?abrir=1 (desde Cobros)
  const [modalAbierto, setModalAbierto] = useState(searchParams.get('abrir') === '1')
  const [tipoAbono,    setTipoAbono]    = useState('interes')     // 'interes'|'capital'|'ambos'
  const [fechaCorte,   setFechaCorte]   = useState(todayStr())
  const [calcReady,    setCalcReady]    = useState(null)           // resultado del cálculo
  const [calculando,   setCalculando]   = useState(false)
  const [montoInteres, setMontoInteres] = useState('')
  const [montoCapital, setMontoCapital] = useState('')
  const [metodoPago,   setMetodoPago]   = useState('efectivo')
  const [notasAbono,   setNotasAbono]   = useState('')
  const [guardando,    setGuardando]    = useState(false)
  const [abonoError,   setAbonoError]   = useState('')
  const [abonoOk,      setAbonoOk]      = useState(null)

  const cargar = () => {
    setLoading(true)
    fetch(`/api/creditos-libres/${id}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setCredito(d); setLoading(false) })
  }

  useEffect(() => { cargar() }, [id])

  // Calcular interés al cambiar fecha_corte (solo cuando tipo incluye interés)
  useEffect(() => {
    if (!modalAbierto || !fechaCorte || tipoAbono === 'capital') {
      setCalcReady(null)
      return
    }
    setCalculando(true)
    fetch(`/api/creditos-libres/${id}/calcular?fecha_corte=${fechaCorte}`)
      .then(r => r.json())
      .then(d => {
        setCalcReady(d)
        if (!d.error) {
          setMontoInteres(String(d.interes_calculado))
        }
        setCalculando(false)
      })
  }, [fechaCorte, tipoAbono, modalAbierto])

  const abrirModal = () => {
    setTipoAbono('interes')
    setFechaCorte(todayStr())
    setMontoInteres('')
    setMontoCapital('')
    setMetodoPago('efectivo')
    setNotasAbono('')
    setCalcReady(null)
    setAbonoError('')
    setAbonoOk(null)
    setModalAbierto(true)
  }

  const handleAbonar = async () => {
    setAbonoError('')
    setGuardando(true)
    try {
      const res = await fetch(`/api/creditos-libres/${id}/abonar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_abono:    tipoAbono,
          fecha_corte:   (tipoAbono === 'interes' || tipoAbono === 'ambos') ? fechaCorte : undefined,
          monto_interes: parseFloat(montoInteres || 0),
          monto_capital: parseFloat(montoCapital || 0),
          metodo_pago:   metodoPago,
          notas:         notasAbono,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setAbonoError(data.error || 'Error al registrar el abono'); setGuardando(false); return }
      setAbonoOk(data)
      setGuardando(false)
      cargar()   // refrescar datos
    } catch {
      setAbonoError('Error de red. Intente de nuevo.')
      setGuardando(false)
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">Cargando crédito...</div>
  if (error)   return <div className="text-center py-16 text-red-500">⚠️ {error}</div>
  if (!credito) return null

  const saldado = credito.estado === 'saldado'
  // "Unificar Créditos" (CLAUDE.md §21) puede consolidar créditos libres en
  // un crédito nuevo — una vez unificado, ya no se puede seguir abonando aquí.
  const unificado = credito.estado === 'refinanciado'
  const pct     = credito.monto_capital > 0
    ? Math.min(100, Math.round(credito.capital_pagado / credito.monto_capital * 100))
    : 0

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
          <div>
            <h2 className="text-xl font-bold text-gray-800">📅 {credito.referencia}</h2>
            <p className="text-sm text-gray-500">{credito.nombre_cliente} · CC {credito.documento}</p>
          </div>
        </div>
        {!saldado && !unificado && (
          <button onClick={abrirModal}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-blue-700 transition-colors text-sm">
            💰 Registrar abono
          </button>
        )}
      </div>

      {/* Estado */}
      {saldado && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <p className="text-emerald-700 font-bold text-lg">✅ Crédito saldado</p>
          <p className="text-emerald-600 text-sm">El capital ha sido pagado en su totalidad</p>
        </div>
      )}
      {unificado && credito.unificado_en && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-800 flex items-start gap-2.5">
          <span className="text-lg leading-none">🔗</span>
          <p className="flex-1">
            <strong>Este crédito fue unificado</strong> junto con otros en el crédito{' '}
            <Link href={`/prestamos/${credito.unificado_en.credito_nuevo_id}`} className="font-bold underline">
              {credito.unificado_en.referencia || credito.unificado_en.credito_nuevo_id}
            </Link>
            , aportando <strong>{fmt(credito.unificado_en.capital_aportado)}</strong> de capital. Los abonos de aquí en adelante se
            registran en ese crédito.
          </p>
        </div>
      )}

      {/* ── Ficha principal del crédito ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Banda superior: datos del desembolso */}
        <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-5 py-4 text-white">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wide">Capital desembolsado</p>
              <p className="text-2xl font-bold mt-0.5">{fmt(credito.monto_capital)}</p>
            </div>
            <div>
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wide">Tasa de interés</p>
              <p className="text-2xl font-bold mt-0.5">{credito.tasa_interes}%</p>
              <p className="text-blue-300 text-xs capitalize">{credito.periodo_tasa}</p>
            </div>
            <div>
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wide">Interés mensual aprox.</p>
              <p className="text-2xl font-bold mt-0.5">
                {fmt(parseFloat(credito.monto_capital) * (parseFloat(credito.tasa_interes) / 100) / (credito.periodo_tasa === 'diario' ? 1/30 : credito.periodo_tasa === 'semanal' ? 7/30 : credito.periodo_tasa === 'quincenal' ? 15/30 : credito.periodo_tasa === 'anual' ? 360/30 : 1))}
              </p>
              <p className="text-blue-300 text-xs">sobre capital original</p>
            </div>
            <div>
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wide">Método desembolso</p>
              <p className="text-xl font-bold mt-0.5 capitalize">{credito.metodo_desembolso || 'Efectivo'}</p>
              {credito.entidad_desembolso && <p className="text-blue-300 text-xs">{credito.entidad_desembolso}</p>}
              {credito.referencia_desembolso && <p className="text-blue-300 text-xs">{credito.referencia_desembolso}</p>}
            </div>
          </div>
        </div>

        {/* Cuerpo: estado financiero */}
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Capital pagado</p>
              <p className="text-xl font-bold text-blue-700">{fmt(credito.capital_pagado)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Capital pendiente</p>
              <p className="text-xl font-bold text-red-600">{fmt(credito.capital_pendiente)}</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Intereses cobrados</p>
              <p className="text-xl font-bold text-emerald-700">{fmt(credito.intereses_pagados)}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Total recaudado</p>
              <p className="text-xl font-bold text-amber-700">{fmt(parseFloat(credito.capital_pagado) + parseFloat(credito.intereses_pagados))}</p>
            </div>
          </div>

          {/* Barra de progreso capital */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Avance de capital</span>
              <span className="font-semibold">{pct}%</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Fechas y condiciones */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm border-t border-gray-100 pt-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Fecha de inicio</p>
              <p className="font-semibold text-gray-800 mt-0.5">{fmtDate(credito.fecha_inicio_credito || credito.fecha_primer_pago || credito.fecha_creacion)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Último corte de intereses</p>
              <p className="font-semibold text-gray-800 mt-0.5">
                {credito.ultima_fecha_corte ? fmtDate(credito.ultima_fecha_corte) : '— Sin cortes aún'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Estado</p>
              <p className="font-semibold mt-0.5">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${saldado ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                  {saldado ? '✅ Saldado' : '🔵 Activo'}
                </span>
              </p>
            </div>
            {credito.descripcion_bien && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Concepto</p>
                <p className="font-semibold text-gray-800 mt-0.5">{credito.descripcion_bien}</p>
              </div>
            )}
            {credito.notas && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Notas internas</p>
                <p className="text-gray-600 italic text-sm mt-0.5">{credito.notas}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Historial de pagos */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-700 mb-3">Historial de abonos</h3>
        {credito.pagos?.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Sin abonos registrados</p>
        ) : (
          <div className="space-y-3">
            {credito.pagos?.map(p => {
              const montoInt = parseFloat(p.monto_interes || 0)
              const montoCap = parseFloat(p.monto_capital || 0)
              const esInteres = montoInt > 0 && montoCap === 0
              const esCapital = montoCap > 0 && montoInt === 0
              const esAmbos   = montoInt > 0 && montoCap > 0

              const tipoChip  = esInteres ? 'bg-amber-100 text-amber-700'
                : esCapital ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
              const tipoLabel = esInteres ? '📈 Intereses'
                : esCapital ? '🏛️ Capital'
                : '💎 Ambos'

              // Descripción del período de interés
              const periodoInteres = p.fecha_desde_periodo && p.fecha_corte_interes
                ? `Del ${fmtDate(p.fecha_desde_periodo)} al ${fmtDate(p.fecha_corte_interes)}`
                : p.fecha_corte_interes ? `Hasta ${fmtDate(p.fecha_corte_interes)}` : null

              return (
                <div key={p.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <div className="flex items-start justify-between gap-3">
                    {/* Izquierda */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span className={`mt-0.5 shrink-0 text-xs px-2 py-1 rounded-lg font-semibold ${tipoChip}`}>
                        {tipoLabel}
                      </span>
                      <div className="min-w-0">
                        {/* Recibo y fecha de registro */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-mono font-semibold text-gray-700">{p.numero_recibo}</span>
                          <span className="text-xs text-gray-400">
                            Pagado: {new Date(p.fecha_pago).toLocaleDateString('es-CO')}
                          </span>
                          {p.usuario_nombre && (
                            <span className="text-xs text-gray-400">· {p.usuario_nombre}</span>
                          )}
                        </div>

                        {/* Período de interés cubierto */}
                        {periodoInteres && (
                          <p className="text-xs font-medium text-amber-700 mt-0.5">
                            🗓️ {periodoInteres}
                          </p>
                        )}

                        {/* Desglose si es ambos */}
                        {esAmbos && (
                          <div className="flex gap-3 mt-1 text-xs">
                            <span className="text-amber-600">Intereses: <strong>{fmt(montoInt)}</strong></span>
                            <span className="text-blue-600">Capital: <strong>{fmt(montoCap)}</strong></span>
                          </div>
                        )}
                        {esInteres && (
                          <p className="text-xs text-amber-600 mt-0.5">Intereses cobrados: <strong>{fmt(montoInt)}</strong></p>
                        )}
                        {esCapital && (
                          <p className="text-xs text-blue-600 mt-0.5">Abono a capital: <strong>{fmt(montoCap)}</strong></p>
                        )}

                        {/* Método de pago */}
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">
                          Método: {p.metodo_pago}
                          {p.notas ? ` · ${p.notas}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Derecha: monto total */}
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-gray-900">{fmt(p.monto)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ────────────────────── MODAL DE ABONO ────────────────────── */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto py-6 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">Registrar abono</h3>
              <button onClick={() => setModalAbierto(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            {/* ── Ficha resumen del crédito ── */}
            {!abonoOk && (
              <div className="mx-6 mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-2">Información del crédito</p>
                <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Préstamo</p>
                    <p className="font-semibold text-gray-800">{credito.referencia}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Fecha inicio</p>
                    <p className="font-semibold text-gray-800">{fmtDate(credito.fecha_inicio_credito || credito.fecha_primer_pago || credito.fecha_creacion)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Tasa de interés</p>
                    <p className="font-semibold text-blue-700">{credito.tasa_interes}% {credito.periodo_tasa}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Capital original</p>
                    <p className="font-semibold text-gray-800">{fmt(credito.monto_capital)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Capital pendiente</p>
                    <p className="font-semibold text-red-600">{fmt(credito.capital_pendiente)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Último corte</p>
                    <p className="font-semibold text-gray-800">
                      {credito.ultima_fecha_corte ? fmtDate(credito.ultima_fecha_corte) : '— Primer cobro'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {abonoOk ? (
              <div className="p-6 text-center space-y-3">
                <p className="text-4xl">✅</p>
                <p className="text-lg font-bold text-emerald-700">Abono registrado</p>
                <p className="text-sm text-gray-600">Recibo: <span className="font-mono font-semibold">{abonoOk.numero_recibo}</span></p>
                <p className="text-sm text-gray-600">Total pagado: <strong>{fmt(abonoOk.monto_total)}</strong></p>
                {!abonoOk.saldado && (
                  <p className="text-sm text-gray-500">Capital pendiente: {fmt(abonoOk.capital_pendiente_nuevo)}</p>
                )}
                {abonoOk.saldado && (
                  <p className="text-sm font-semibold text-emerald-600">🎉 ¡Crédito saldado por completo!</p>
                )}
                <button onClick={() => setModalAbierto(false)}
                  className="mt-2 w-full bg-blue-600 text-white py-2.5 rounded-xl font-semibold hover:bg-blue-700 transition-colors">
                  Cerrar
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {/* Tipo de abono */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">¿Qué desea abonar?</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: 'interes', l: '📈 Intereses', desc: 'Solo cobro de interés del período' },
                      { v: 'capital', l: '🏛️ Capital',   desc: 'Solo abono al capital prestado'   },
                      { v: 'ambos',   l: '💎 Ambos',     desc: 'Intereses + capital en un pago'    },
                    ].map(({ v, l, desc }) => (
                      <button key={v} type="button" onClick={() => setTipoAbono(v)}
                        className={`p-3 rounded-xl border-2 text-left transition-all
                          ${tipoAbono === v ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200'}`}>
                        <p className="text-sm font-semibold">{l}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selector de fecha de corte (interés / ambos) */}
                {(tipoAbono === 'interes' || tipoAbono === 'ambos') && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Fecha de corte *
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      El interés se calculará desde <strong>{credito.ultima_fecha_corte ? fmtDate(credito.ultima_fecha_corte) : 'la fecha de inicio del crédito'}</strong> hasta esta fecha.
                    </p>
                    <input type="date" value={fechaCorte} onChange={e => setFechaCorte(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

                    {/* Resultado del cálculo */}
                    {calculando && <p className="text-xs text-gray-400 mt-2">Calculando...</p>}
                    {calcReady && !calcReady.error && (
                      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                        <div className="grid grid-cols-2 gap-y-1">
                          <span className="text-gray-600">Período</span>
                          <span className="font-medium">{calcReady.dias_transcurridos} días</span>
                          <span className="text-gray-600">Capital base</span>
                          <span className="font-medium">{fmt(calcReady.capital_pendiente)}</span>
                          <span className="text-gray-600">Tasa diaria</span>
                          <span className="font-medium">{(calcReady.tasa_diaria * 100).toFixed(4)}%</span>
                          <span className="text-gray-600 font-semibold">Interés calculado</span>
                          <span className="font-bold text-amber-700 text-base">{fmt(calcReady.interes_calculado)}</span>
                        </div>
                      </div>
                    )}
                    {calcReady?.error && (
                      <p className="text-xs text-red-600 mt-2">⚠️ {calcReady.error}</p>
                    )}
                  </div>
                )}

                {/* Montos */}
                <div className="space-y-3">
                  {(tipoAbono === 'interes' || tipoAbono === 'ambos') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Monto intereses *
                        {calcReady && !calcReady.error && (
                          <span className="text-amber-600 text-xs ml-2">(sugerido: {fmt(calcReady.interes_calculado)})</span>
                        )}
                      </label>
                      <input type="number" min="0" step="100"
                        value={montoInteres}
                        onChange={e => setMontoInteres(e.target.value)}
                        placeholder="Monto de intereses a cobrar"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}

                  {(tipoAbono === 'capital' || tipoAbono === 'ambos') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Monto capital *
                        <span className="text-blue-600 text-xs ml-2">(pendiente: {fmt(credito.capital_pendiente)})</span>
                      </label>
                      <input type="number" min="0" step="100"
                        value={montoCapital}
                        onChange={e => setMontoCapital(e.target.value)}
                        placeholder="Monto a abonar al capital"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                </div>

                {/* Total visual */}
                {(parseFloat(montoInteres || 0) > 0 || parseFloat(montoCapital || 0) > 0) && (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm flex justify-between items-center">
                    <span className="text-gray-600">Total a recibir</span>
                    <span className="text-lg font-bold text-gray-800">
                      {fmt(parseFloat(montoInteres || 0) + parseFloat(montoCapital || 0))}
                    </span>
                  </div>
                )}

                {/* Método de pago */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Método de pago</label>
                  <div className="flex flex-wrap gap-2">
                    {METODOS.map(m => (
                      <button key={m.value} type="button" onClick={() => setMetodoPago(m.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                          ${metodoPago === m.value ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas adicionales</label>
                  <input type="text" value={notasAbono} onChange={e => setNotasAbono(e.target.value)}
                    placeholder="Observaciones (opcional)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                {abonoError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    ⚠️ {abonoError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setModalAbierto(false)}
                    className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl font-medium hover:bg-gray-50 transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={handleAbonar} disabled={guardando}
                    className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50">
                    {guardando ? 'Guardando...' : '✅ Confirmar abono'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
