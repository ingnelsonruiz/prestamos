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
function HeroCard({ titulo, valor, sub, bg, textColor = 'text-white', subColor }) {
  return (
    <div className={`${bg} rounded-2xl p-5 shadow-lg`}>
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
      <p className={`text-[10px] mt-1.5 ${text} opacity-40`}>↗ doble clic para ver</p>
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

  const { cartera, intereses, mora, recaudo, cartera_vencida, capital, cuotas_hoy, cuotas_semana, empenos_vencer, otros_rubros = [] } = data

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
        />
        <HeroCard
          titulo="📈 Intereses proyectados"
          valor={fmt(capital.intereses_proyectados)}
          sub="Por cobrar en cuotas pendientes"
          bg="bg-gradient-to-br from-emerald-600 to-emerald-500"
        />
        <HeroCard
          titulo="💵 Intereses recogidos"
          valor={rango ? fmt(intereses.rango) : fmt(intereses.total)}
          sub={rango
            ? `Recogido del ${fmtFecha(rango.desde)} al ${fmtFecha(rango.hasta)}`
            : 'Ganancia por intereses ya cobrada'}
          bg="bg-gradient-to-br from-amber-500 to-orange-500"
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
