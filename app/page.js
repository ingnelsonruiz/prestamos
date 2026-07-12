'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const fmt = v =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0)

const fmtK = v => {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return fmt(v)
}

/* ─── Tarjeta hero con 1 cifra grande ─────────────────────────────────────── */
function HeroCard({ titulo, valor, sub, bg, textColor = 'text-white', subColor, onDoubleClick }) {
  return (
    <div
      className={`${bg} rounded-2xl p-5 shadow-lg ${onDoubleClick ? 'cursor-pointer select-none' : ''}`}
      onDoubleClick={onDoubleClick}
      title={onDoubleClick ? 'Doble clic para ver el detalle' : undefined}
    >
      <p className={`text-xs uppercase tracking-wide font-semibold opacity-80 ${textColor}`}>{titulo}</p>
      <p className={`text-3xl font-black mt-1 ${textColor}`}>{valor}</p>
      {sub && <p className={`text-xs mt-1 ${subColor ?? 'opacity-60 ' + textColor}`}>{sub}</p>}
    </div>
  )
}

/* ─── Tarjeta con desglose hoy / semana / mes / total ─────────────────────── */
function KPIDesglose({ titulo, icono, color, hoy, semana, mes, total, extra }) {
  const colors = {
    green:  { bg: 'bg-emerald-50',  border: 'border-emerald-200', title: 'text-emerald-700', total: 'text-emerald-700' },
    red:    { bg: 'bg-red-50',      border: 'border-red-200',     title: 'text-red-700',     total: 'text-red-700'     },
    blue:   { bg: 'bg-blue-50',     border: 'border-blue-200',    title: 'text-blue-700',    total: 'text-blue-700'    },
    amber:  { bg: 'bg-amber-50',    border: 'border-amber-200',   title: 'text-amber-700',   total: 'text-amber-700'   },
  }
  const c = colors[color] ?? colors.blue

  return (
    <div className={`${c.bg} border ${c.border} rounded-2xl p-5`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{icono}</span>
        <p className={`text-xs uppercase tracking-wide font-bold ${c.title}`}>{titulo}</p>
      </div>

      {/* Total grande */}
      <p className={`text-2xl font-black ${c.total} mb-3`}>{total}</p>

      {/* Desglose */}
      <div className="space-y-1.5 border-t border-current border-opacity-20 pt-3">
        {hoy    != null && <Row label="Hoy"         val={hoy}    />}
        {semana != null && <Row label="Esta semana" val={semana} />}
        {mes    != null && <Row label="Este mes"    val={mes}    />}
        {extra && extra.map((e, i) => <Row key={i} label={e.label} val={e.val} highlight={e.highlight} />)}
      </div>
    </div>
  )
}

function Row({ label, val, highlight }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold ${highlight ? 'text-red-600' : 'text-gray-700'}`}>{val}</span>
    </div>
  )
}

/* ─── Tarjeta estado cartera ──────────────────────────────────────────────── */
function EstadoCard({ label, icono, capital, count, bg, border, text, filtro }) {
  const router = useRouter()
  return (
    <div
      className={`${bg} border ${border} rounded-xl p-4 cursor-pointer select-none
        transition-transform hover:scale-[1.02] active:scale-[0.98]`}
      onDoubleClick={() => router.push(`/prestamos?filtro=${filtro}`)}
      title="Doble clic para ver estos créditos"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-lg">{icono}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${bg} ${border} border ${text}`}>
          {count} crédito{count !== 1 ? 's' : ''}
        </span>
      </div>
      <p className={`text-[11px] uppercase tracking-wide font-semibold ${text} opacity-70`}>{label}</p>
      <p className={`text-lg font-black ${text} mt-0.5`}>{fmt(capital)}</p>
      <p className={`text-[10px] ${text} opacity-50`}>capital desembolsado (no es el saldo pendiente)</p>
      <p className={`text-[10px] mt-1 ${text} opacity-40`}>↗ doble clic para ver</p>
    </div>
  )
}

/* ─── Componente principal ────────────────────────────────────────────────── */
export default function Dashboard() {
  const router = useRouter()
  const [data,     setData]     = useState(null)
  const [error,    setError]    = useState(null)
  const [fechaHoy, setFechaHoy] = useState('')

  // Filtro de rango de fechas
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [rango, setRango] = useState(null)   // { desde, hasta } aplicado

  // Modal detalle intereses proyectados
  const [modalIntereses, setModalIntereses] = useState(false)
  const [detalleIntereses, setDetalleIntereses] = useState(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  const [modalRecogidos, setModalRecogidos] = useState(false)
  const [detalleRecogidos, setDetalleRecogidos] = useState(null)
  const [cargandoRecogidos, setCargandoRecogidos] = useState(false)

  // Modal detalle capital en la calle
  const [modalCapital, setModalCapital] = useState(false)
  const [detalleCapital, setDetalleCapital] = useState(null)
  const [cargandoCapital, setCargandoCapital] = useState(false)

  const abrirDetalleCapital = async () => {
    setModalCapital(true)
    setCargandoCapital(true)
    setDetalleCapital(null)
    // No usa el rango de fechas: la tarjeta "Capital en la calle" tampoco lo usa.
    const res = await fetch('/api/dashboard/capital-detalle')
    const json = await res.json()
    setDetalleCapital(json)
    setCargandoCapital(false)
  }

  const abrirDetalleRecogidos = async () => {
    setModalRecogidos(true)
    setCargandoRecogidos(true)
    setDetalleRecogidos(null)
    const qs = rango ? `?desde=${rango.desde}&hasta=${rango.hasta}` : ''
    const res = await fetch(`/api/dashboard/intereses-recogidos-detalle${qs}`)
    const json = await res.json()
    setDetalleRecogidos(json)
    setCargandoRecogidos(false)
  }

  const abrirDetalleIntereses = async () => {
    setModalIntereses(true)
    setCargandoDetalle(true)
    setDetalleIntereses(null)
    const qs = rango ? `?desde=${rango.desde}&hasta=${rango.hasta}` : ''
    const res = await fetch(`/api/dashboard/intereses-detalle${qs}`)
    const json = await res.json()
    setDetalleIntereses(json)
    setCargandoDetalle(false)
  }

  useEffect(() => {
    setFechaHoy(
      new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    )
  }, [])

  useEffect(() => {
    const qs = rango ? `?desde=${rango.desde}&hasta=${rango.hasta}` : ''
    fetch(`/api/dashboard${qs}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
  }, [rango])

  const aplicarRango = () => {
    if (desde && hasta && desde <= hasta) setRango({ desde, hasta })
  }
  const limpiarRango = () => { setDesde(''); setHasta(''); setRango(null) }

  const fmtFecha = s => new Date(s + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })

  if (error)       return <div className="text-red-600 p-4 bg-red-50 rounded-lg">❌ Error: {error}</div>
  if (!data)       return <div className="text-gray-400 p-6 text-center">Cargando dashboard…</div>
  if (data.error)  return <div className="text-red-600 p-4 bg-red-50 rounded-lg">❌ Error BD: {data.error}</div>

  const { cartera, intereses, mora, recaudo, cartera_vencida, capital, cuotas_hoy, cuotas_semana, empenos_vencer, otros_rubros = [], creditos_libres = {} } = data

  const roi = recaudo.total > 0
    ? ((intereses.total / (recaudo.total - intereses.total)) * 100).toFixed(1)
    : 0

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5 capitalize">{fechaHoy}</p>
        </div>
        <span className="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-full self-start md:self-auto">
          ROI histórico: <strong>{roi}%</strong>
        </span>
      </div>

      {/* ═══ Filtro de rango de fechas ═══ */}
      <div className="bg-white border rounded-xl p-4 flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
        <div className="flex flex-col">
          <label className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} max={hasta || undefined}
            onChange={e => setDesde(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex flex-col">
          <label className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} min={desde || undefined}
            onChange={e => setHasta(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <button onClick={aplicarRango} disabled={!desde || !hasta || desde > hasta}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          Aplicar rango
        </button>
        {rango && (
          <button onClick={limpiarRango}
            className="bg-white border text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors">
            Limpiar
          </button>
        )}
        {rango && (
          <span className="text-xs text-gray-500 sm:ml-auto self-center">
            Mostrando recaudo e intereses del <strong>{fmtFecha(rango.desde)}</strong> al <strong>{fmtFecha(rango.hasta)}</strong>
          </span>
        )}
      </div>

      {/* ═══ FILA 1 — Tres cifras clave para el dueño (capital, proyectado, recogido) ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeroCard
          titulo="💰 Capital en la calle"
          valor={fmt(capital.en_calle)}
          sub="Saldo pendiente de créditos activos"
          bg="bg-gradient-to-br from-[#1e3a5f] to-[#1a4a7a]"
          onDoubleClick={abrirDetalleCapital}
        />
        <HeroCard
          titulo="📈 Intereses proyectados"
          valor={fmt(capital.intereses_proyectados_total ?? capital.intereses_proyectados)}
          sub={rango
            ? capital.intereses_libres_proyectados > 0
              ? `Normales: ${fmt(capital.intereses_proyectados)} · Sin cuotas (30/360): ${fmt(capital.intereses_libres_proyectados)}`
              : `Cuotas pendientes del ${fmtFecha(rango.desde)} al ${fmtFecha(rango.hasta)} · ⚠️ Cred. Sin Cuotas: requiere fecha Hasta`
            : 'Por cobrar en cuotas pendientes · ⚠️ Cred. Sin Cuotas: selecciona rango de fechas para proyectar'}
          bg="bg-gradient-to-br from-emerald-600 to-emerald-500"
          onDoubleClick={abrirDetalleIntereses}
        />
        <HeroCard
          titulo="💵 Intereses recogidos"
          valor={rango ? fmt(intereses.rango) : fmt(intereses.total)}
          sub={rango
            ? `Recogido del ${fmtFecha(rango.desde)} al ${fmtFecha(rango.hasta)}`
            : 'Ganancia por intereses ya cobrada'}
          bg="bg-gradient-to-br from-amber-500 to-orange-500"
          onDoubleClick={abrirDetalleRecogidos}
        />
      </div>

      {/* ═══ FILA 2 — Estado de cartera por tipo ═══ */}
      <div>
        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Estado de la cartera</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <EstadoCard
            label="Créditos activos"   icono="✅"
            capital={cartera.capital_activo}      count={cartera.num_activos}
            bg="bg-blue-50"  border="border-blue-200"  text="text-blue-700"
            filtro="activos"
          />
          <EstadoCard
            label="Créditos saldados"  icono="🏁"
            capital={cartera.capital_saldado}     count={cartera.num_saldados}
            bg="bg-green-50" border="border-green-200" text="text-green-700"
            filtro="saldado"
          />
          <EstadoCard
            label="Créditos en mora"   icono="⚠️"
            capital={cartera.capital_mora}        count={cartera.num_mora}
            bg="bg-red-50"   border="border-red-200"   text="text-red-700"
            filtro="en_mora"
          />
          <EstadoCard
            label="Refinanciados"      icono="🔄"
            capital={cartera.capital_refinanciado} count={cartera.num_refinanciados}
            bg="bg-purple-50" border="border-purple-200" text="text-purple-700"
            filtro="refinanciado"
          />
        </div>
      </div>

      {/* ═══ OTROS RUBROS — fiado, adelanto, venta, empeño (siempre visibles) ═══ */}
      {(() => {
        const RUBROS = [
          { tipo: 'fiado',    icono: '🌿', label: 'Fiados',    bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-700'   },
          { tipo: 'adelanto', icono: '⚡', label: 'Adelantos', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
          { tipo: 'venta',    icono: '🛍️', label: 'Ventas',    bg: 'bg-pink-50',   border: 'border-pink-200',   text: 'text-pink-700'   },
          { tipo: 'empeno',   icono: '🔒', label: 'Empeños',   bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700' },
        ]
        return (
          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Otros rubros activos</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

              {/* Créditos Sin Cuotas — PRIMERO: capital pendiente real, intereses por corte */}
              <div
                className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]"
                onDoubleClick={() => window.location.href = '/creditos-libres'}
                title="Doble clic para ver créditos sin cuotas">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xl">📅</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-cyan-50 border-cyan-200 text-cyan-700">
                    {creditos_libres.cantidad ?? 0} registro{(creditos_libres.cantidad ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-cyan-700 opacity-70">Cred. Sin Cuotas</p>
                <p className="text-lg font-black text-cyan-700 mt-0.5">{fmt(creditos_libres.capital_pendiente ?? 0)}</p>
                <div className="text-[10px] mt-1 text-cyan-700 opacity-50 flex justify-between">
                  <span>Int. cobrados: {fmt(creditos_libres.intereses_cobrados ?? 0)}</span>
                  <span>Capital pend.</span>
                </div>
                <p className="text-[9px] text-cyan-600 opacity-60 mt-1">⚠️ Proyección no aplica</p>
              </div>

              {RUBROS.map(cfg => {
                const r = otros_rubros.find(x => x.tipo === cfg.tipo) || { cantidad: 0, capital_total: 0, saldo_pendiente: 0 }
                return (
                  <div key={cfg.tipo}
                    className={`${cfg.bg} border ${cfg.border} rounded-xl p-4 cursor-pointer
                      transition-transform hover:scale-[1.02] active:scale-[0.98]`}
                    onDoubleClick={() => window.location.href = '/prestamos?filtro=activos'}
                    title="Doble clic para ver en préstamos">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xl">{cfg.icono}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                        {r.cantidad} registro{r.cantidad !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <p className={`text-[11px] uppercase tracking-wide font-semibold ${cfg.text} opacity-70`}>{cfg.label}</p>
                    <p className={`text-lg font-black ${cfg.text} mt-0.5`}>{fmt(r.saldo_pendiente)}</p>
                    <div className={`text-[10px] mt-1 ${cfg.text} opacity-50 flex justify-between`}>
                      <span>Capital: {fmt(r.capital_total)}</span>
                      <span>Pendiente</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ═══ FILA 3 — KPIs con desglose temporal ═══ */}
      <div>
        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Métricas operativas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">

          {/* Intereses ganados */}
          <KPIDesglose
            titulo="Intereses cobrados"
            icono="📊"
            color="green"
            hoy={fmt(intereses.hoy)}
            semana={fmt(intereses.semana)}
            mes={fmt(intereses.mes)}
            total={fmt(intereses.total)}
            extra={rango ? [{ label: '📅 Rango seleccionado', val: fmt(intereses.rango) }] : undefined}
          />

          {/* Mora */}
          <KPIDesglose
            titulo="Cartera en mora"
            icono="🔴"
            color="red"
            total={fmt(mora.monto_total)}
            extra={[
              { label: `0–30 días (${mora.clientes_total} clientes)`, val: fmt(mora.monto_0_30d) },
              { label: '31–60 días',                                  val: fmt(mora.monto_31_60d), highlight: mora.monto_31_60d > 0 },
              { label: 'Más de 60 días',                              val: fmt(mora.monto_mas60d), highlight: mora.monto_mas60d > 0 },
              { label: `Clientes críticos (>30d)`,                    val: `${mora.clientes_30d} cliente${mora.clientes_30d !== 1 ? 's' : ''}`, highlight: mora.clientes_30d > 0 },
            ]}
          />

          {/* Recaudo */}
          <KPIDesglose
            titulo="Recaudo"
            icono="💳"
            color="blue"
            hoy={fmt(recaudo.hoy)}
            semana={fmt(recaudo.semana)}
            mes={fmt(recaudo.mes)}
            total={fmt(recaudo.total)}
            extra={rango ? [
              { label: '📅 Rango seleccionado', val: fmt(recaudo.rango) },
              { label: 'Pagos en el rango',     val: `${recaudo.rango_pagos} pago${recaudo.rango_pagos !== 1 ? 's' : ''}` },
            ] : undefined}
          />

          {/* Cartera vencida */}
          <KPIDesglose
            titulo="Cartera vencida"
            icono="📋"
            color="amber"
            total={fmt(cartera_vencida.total)}
            extra={[
              { label: 'Venció hoy',       val: fmt(cartera_vencida.vencio_hoy),    highlight: cartera_vencida.vencio_hoy > 0 },
              { label: 'Esta semana',      val: fmt(cartera_vencida.vencio_semana), highlight: cartera_vencida.vencio_semana > 0 },
              { label: 'Este mes',         val: fmt(cartera_vencida.vencio_mes) },
              { label: 'Más de 30 días',   val: fmt(cartera_vencida.mas_30d),       highlight: cartera_vencida.mas_30d > 0 },
            ]}
          />
        </div>
      </div>

      {/* ═══ FILA 4 — Agenda del día / semana / empeños ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Cuotas vencen hoy */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">⏰ Vencen hoy ({cuotas_hoy.length})</h3>
          {cuotas_hoy.length === 0
            ? <p className="text-sm text-gray-400">Sin cuotas para hoy</p>
            : (
              <ul className="space-y-2">
                {cuotas_hoy.map(c => (
                  <li key={c.id} className="flex justify-between text-sm">
                    <span className="font-medium truncate pr-2">{c.nombre_cliente}</span>
                    <span className="text-blue-600 font-semibold whitespace-nowrap">{fmt(c.monto_cuota)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </div>

        {/* Cuotas semana */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">📅 Próximos 7 días ({cuotas_semana.length})</h3>
          {cuotas_semana.length === 0
            ? <p className="text-sm text-gray-400">Sin cuotas esta semana</p>
            : (
              <ul className="space-y-2">
                {cuotas_semana.slice(0, 8).map(c => (
                  <li key={c.id} className="flex justify-between text-sm">
                    <span className="truncate pr-2">{c.nombre_cliente}</span>
                    <span className="text-gray-500 whitespace-nowrap text-xs">
                      {new Date(c.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                      {' · '}{fmt(c.monto_cuota)}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </div>

        {/* Empeños por vencer */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">🔒 Empeños por vencer ({empenos_vencer.length})</h3>
          {empenos_vencer.length === 0
            ? <p className="text-sm text-gray-400">Sin empeños próximos</p>
            : (
              <ul className="space-y-2">
                {empenos_vencer.map(e => {
                  const dias = Math.ceil(
                    (new Date(e.fecha_limite_rescate + 'T12:00:00') - new Date()) / (1000 * 60 * 60 * 24)
                  )
                  return (
                    <li key={e.id} className="flex justify-between text-sm">
                      <span className="truncate pr-2">{e.nombre_cliente}</span>
                      <span className={`font-semibold whitespace-nowrap ${
                        dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-orange-500' : 'text-yellow-600'
                      }`}>
                        {dias <= 0 ? '¡VENCIDO!' : `${dias}d`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )
          }
        </div>
      </div>

      {/* Modal detalle intereses recogidos */}
      {modalRecogidos && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setModalRecogidos(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-amber-500 rounded-t-2xl">
              <div>
                <h3 className="text-white font-bold text-lg">Detalle de intereses recogidos</h3>
                <p className="text-amber-100 text-xs mt-0.5">
                  {rango ? `Pagos del ${fmtFecha(rango.desde)} al ${fmtFecha(rango.hasta)}` : 'Todos los pagos historicos'}
                </p>
              </div>
              <button onClick={() => setModalRecogidos(false)}
                className="text-white/80 hover:text-white text-2xl leading-none font-bold px-2">x</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {cargandoRecogidos && <div className="text-center text-gray-400 py-12">Cargando...</div>}
              {!cargandoRecogidos && detalleRecogidos && detalleRecogidos.length === 0 && (
                <div className="text-center text-gray-400 py-12">Sin pagos en el periodo</div>
              )}
              {!cargandoRecogidos && detalleRecogidos && detalleRecogidos.length > 0 && (
                <table className="w-full text-sm border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-gray-400">
                      <th className="text-left px-3 py-2">Cliente</th>
                      <th className="text-left px-3 py-2">Credito</th>
                      <th className="text-center px-3 py-2">Pagos</th>
                      <th className="text-left px-3 py-2">Ultimo pago</th>
                      <th className="text-right px-3 py-2 text-amber-600">Interes cobrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleRecogidos.map(d => (
                      <tr key={d.producto_id} className="bg-gray-50 hover:bg-amber-50 rounded-lg transition-colors">
                        <td className="px-3 py-2 rounded-l-lg">
                          <a href={'/clientes/' + d.cliente_id} className="font-semibold text-gray-800 hover:text-amber-700 hover:underline block">{d.nombre_cliente}</a>
                          <span className="text-[11px] text-gray-400">{d.documento}</span>
                        </td>
                        <td className="px-3 py-2">
                          <a href={'/prestamos/' + d.producto_id} className="text-blue-600 hover:underline font-mono text-xs">{d.referencia || d.producto_id.slice(0,8)}</a>
                          <span className="block text-[11px] text-gray-400 capitalize">{d.tipo_producto} - {fmt(d.monto_capital)}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-600 font-semibold">{d.num_pagos}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                          {d.ultimo_pago ? new Date(d.ultimo_pago + 'T12:00:00').toLocaleDateString('es-CO', {day:'2-digit', month:'short', year:'numeric'}) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right rounded-r-lg font-bold text-amber-600">{fmt(d.interes_cobrado)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="4" className="px-3 pt-3 text-sm font-semibold text-gray-600">
                        Total ({detalleRecogidos.length} credito{detalleRecogidos.length !== 1 ? 's' : ''})
                      </td>
                      <td className="px-3 pt-3 text-right text-base font-black text-amber-600">
                        {fmt(detalleRecogidos.reduce((s, d) => s + d.interes_cobrado, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle intereses proyectados */}
      {modalIntereses && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setModalIntereses(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-emerald-600 rounded-t-2xl">
              <div>
                <h3 className="text-white font-bold text-lg">Detalle de intereses proyectados</h3>
                <p className="text-emerald-100 text-xs mt-0.5">
                  {rango ? `Del ${fmtFecha(rango.desde)} al ${fmtFecha(rango.hasta)}` : 'Todos los periodos pendientes'}
                </p>
              </div>
              <button onClick={() => setModalIntereses(false)}
                className="text-white/80 hover:text-white text-2xl leading-none font-bold px-2">x</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-5">
              {cargandoDetalle && <div className="text-center text-gray-400 py-12">Cargando...</div>}

              {/* ── SECCIÓN 1: Créditos normales (cuotas programadas) ── */}
              {!cargandoDetalle && detalleIntereses && (() => {
                const normales = detalleIntereses.normales ?? detalleIntereses ?? []
                const libres   = detalleIntereses.libres   ?? []
                const totales  = detalleIntereses.totales  ?? null
                return (
                  <>
                    {/* Resumen total si hay dos tipos */}
                    {libres.length > 0 && totales && (
                      <div className="grid grid-cols-3 gap-3 bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                        <div className="text-center">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Créditos normales</p>
                          <p className="text-sm font-black text-emerald-700">{fmt(totales.interes_normales)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Cred. Sin Cuotas (30/360)</p>
                          <p className="text-sm font-black text-cyan-700">{fmt(totales.interes_libres)}</p>
                        </div>
                        <div className="text-center border-l border-emerald-200">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total combinado</p>
                          <p className="text-sm font-black text-gray-800">{fmt(totales.total)}</p>
                        </div>
                      </div>
                    )}

                    {/* Tabla créditos normales */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 px-1">
                        📋 Créditos con cuotas programadas ({normales.length})
                      </h4>
                      {normales.length === 0
                        ? <p className="text-center text-gray-400 py-6 text-sm">Sin cuotas pendientes en el periodo</p>
                        : (
                          <table className="w-full text-sm border-separate border-spacing-y-1">
                            <thead>
                              <tr className="text-xs uppercase tracking-wide text-gray-400">
                                <th className="text-left px-3 py-2">Cliente</th>
                                <th className="text-left px-3 py-2">Crédito</th>
                                <th className="text-center px-3 py-2">Cuotas</th>
                                <th className="text-left px-3 py-2">Próx. vence</th>
                                <th className="text-right px-3 py-2 text-emerald-700">Interés</th>
                              </tr>
                            </thead>
                            <tbody>
                              {normales.map(d => (
                                <tr key={d.producto_id} className="bg-gray-50 hover:bg-emerald-50 rounded-lg transition-colors">
                                  <td className="px-3 py-2 rounded-l-lg">
                                    <a href={'/clientes/' + d.cliente_id} className="font-semibold text-gray-800 hover:text-emerald-700 hover:underline block">{d.nombre_cliente}</a>
                                    <span className="text-[11px] text-gray-400">{d.documento}</span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <a href={'/prestamos/' + d.producto_id} className="text-blue-600 hover:underline font-mono text-xs">{d.referencia}</a>
                                    <span className="block text-[11px] text-gray-400 capitalize">{d.tipo_producto} · {fmt(d.monto_capital)}</span>
                                  </td>
                                  <td className="px-3 py-2 text-center text-gray-600 font-semibold">{d.cuotas_pendientes}</td>
                                  <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                                    {d.proxima_fecha ? new Date(d.proxima_fecha + 'T12:00:00').toLocaleDateString('es-CO', {day:'2-digit', month:'short', year:'numeric'}) : '-'}
                                  </td>
                                  <td className="px-3 py-2 text-right rounded-r-lg font-bold text-emerald-700">{fmt(d.interes_proyectado)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan="4" className="px-3 pt-2 text-xs font-semibold text-gray-500">Subtotal normales</td>
                                <td className="px-3 pt-2 text-right font-black text-emerald-700">{fmt(normales.reduce((s, d) => s + d.interes_proyectado, 0))}</td>
                              </tr>
                            </tfoot>
                          </table>
                        )
                      }
                    </div>

                    {/* Tabla créditos libres */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 px-1">
                        📅 Créditos Sin Cuotas — interés 30/360
                        {totales?.fecha_corte_libres && (
                          <span className="ml-2 font-normal text-cyan-600 normal-case">
                            (corte al {fmtFecha(totales.fecha_corte_libres)})
                          </span>
                        )}
                      </h4>
                      {!rango || !rango.hasta
                        ? <p className="text-center text-gray-400 py-6 text-sm">⚠️ Selecciona una fecha Hasta en el filtro para proyectar el interés de créditos sin cuotas</p>
                        : libres.length === 0
                          ? <p className="text-center text-gray-400 py-6 text-sm">Sin créditos libres activos o sin interés acumulado en el período</p>
                          : (
                            <table className="w-full text-sm border-separate border-spacing-y-1">
                              <thead>
                                <tr className="text-xs uppercase tracking-wide text-gray-400">
                                  <th className="text-left px-3 py-2">Cliente</th>
                                  <th className="text-left px-3 py-2">Crédito</th>
                                  <th className="text-center px-3 py-2">Capital pend.</th>
                                  <th className="text-center px-3 py-2">Días (30/360)</th>
                                  <th className="text-right px-3 py-2 text-cyan-700">Interés</th>
                                </tr>
                              </thead>
                              <tbody>
                                {libres.map(d => (
                                  <tr key={d.producto_id} className="bg-cyan-50 hover:bg-cyan-100 rounded-lg transition-colors">
                                    <td className="px-3 py-2 rounded-l-lg">
                                      <a href={'/clientes/' + d.cliente_id} className="font-semibold text-gray-800 hover:text-cyan-700 hover:underline block">{d.nombre_cliente}</a>
                                      <span className="text-[11px] text-gray-400">{d.documento}</span>
                                    </td>
                                    <td className="px-3 py-2">
                                      <a href={'/creditos-libres/' + d.producto_id} className="text-cyan-600 hover:underline font-mono text-xs">{d.referencia}</a>
                                      <span className="block text-[11px] text-gray-400">{d.tasa_interes}% {d.periodo_tasa}</span>
                                    </td>
                                    <td className="px-3 py-2 text-center text-gray-600 font-semibold">{fmt(d.capital_pendiente)}</td>
                                    <td className="px-3 py-2 text-center text-gray-500 text-xs">
                                      {d.dias_calculados} días
                                      <span className="block text-[10px] text-gray-400">desde {d.inicio_periodo}</span>
                                    </td>
                                    <td className="px-3 py-2 text-right rounded-r-lg font-bold text-cyan-700">{fmt(d.interes_proyectado)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <td colSpan="4" className="px-3 pt-2 text-xs font-semibold text-gray-500">Subtotal Sin Cuotas</td>
                                  <td className="px-3 pt-2 text-right font-black text-cyan-700">{fmt(libres.reduce((s, d) => s + d.interes_proyectado, 0))}</td>
                                </tr>
                              </tfoot>
                            </table>
                          )
                      }
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle capital en la calle */}
      {modalCapital && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setModalCapital(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b rounded-t-2xl bg-gradient-to-br from-[#1e3a5f] to-[#1a4a7a]">
              <div>
                <h3 className="text-white font-bold text-lg">Detalle de capital en la calle</h3>
                <p className="text-blue-100 text-xs mt-0.5">Saldo de capital pendiente por crédito activo (no depende del rango de fechas)</p>
              </div>
              <button onClick={() => setModalCapital(false)}
                className="text-white/80 hover:text-white text-2xl leading-none font-bold px-2">x</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {cargandoCapital && <div className="text-center text-gray-400 py-12">Cargando...</div>}
              {!cargandoCapital && detalleCapital && detalleCapital.length === 0 && (
                <div className="text-center text-gray-400 py-12">Sin capital pendiente</div>
              )}
              {!cargandoCapital && detalleCapital && detalleCapital.length > 0 && (
                <table className="w-full text-sm border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-gray-400">
                      <th className="text-left px-3 py-2">Cliente</th>
                      <th className="text-left px-3 py-2">Credito</th>
                      <th className="text-center px-3 py-2">Cuotas</th>
                      <th className="text-left px-3 py-2">Prox. vence</th>
                      <th className="text-right px-3 py-2 text-[#1a4a7a]">Capital pendiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleCapital.map(d => (
                      <tr key={d.producto_id} className="bg-gray-50 hover:bg-blue-50 rounded-lg transition-colors">
                        <td className="px-3 py-2 rounded-l-lg">
                          <a href={'/clientes/' + d.cliente_id} className="font-semibold text-gray-800 hover:text-[#1a4a7a] hover:underline block">{d.nombre_cliente}</a>
                          <span className="text-[11px] text-gray-400">{d.documento}</span>
                        </td>
                        <td className="px-3 py-2">
                          <a href={'/prestamos/' + d.producto_id} className="text-blue-600 hover:underline font-mono text-xs">{d.referencia || d.producto_id.slice(0,8)}</a>
                          <span className="block text-[11px] text-gray-400 capitalize">{d.tipo_producto} - {fmt(d.monto_capital)}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-600 font-semibold">{d.cuotas_pendientes}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                          {d.proxima_fecha ? new Date(d.proxima_fecha + 'T12:00:00').toLocaleDateString('es-CO', {day:'2-digit', month:'short', year:'numeric'}) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right rounded-r-lg font-bold text-[#1a4a7a]">{fmt(d.capital_pendiente)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="4" className="px-3 pt-3 text-sm font-semibold text-gray-600">
                        Total ({detalleCapital.length} credito{detalleCapital.length !== 1 ? 's' : ''})
                      </td>
                      <td className="px-3 pt-3 text-right text-base font-black text-[#1a4a7a]">
                        {fmt(detalleCapital.reduce((s, d) => s + d.capital_pendiente, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3 pt-2">
        <Link href="/prestamos/nuevo"
          className="flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
          ➕ Nuevo préstamo
        </Link>
        <Link href="/clientes"
          className="flex items-center justify-center gap-2 bg-white border text-gray-700 px-5 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
          👥 Clientes
        </Link>
        <Link href="/cobros"
          className="flex items-center justify-center gap-2 bg-white border text-gray-700 px-5 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
          💳 Cobros
        </Link>
        <Link href="/informes"
          className="flex items-center justify-center gap-2 bg-white border text-gray-700 px-5 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
          📈 Informes
        </Link>
      </div>
    </div>
  )
}
