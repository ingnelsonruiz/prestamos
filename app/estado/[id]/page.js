'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const fmt     = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
const fmtFecha = f => f ? new Date(f).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
const fmtCorta = f => f ? new Date(f).toLocaleDateString('es-CO') : '—'

const tipoIcon  = { prestamo: '💰', venta: '🛍️', empeno: '🔒', fiado: '🌿' }
const tipoLabel = { prestamo: 'Préstamo', venta: 'Venta a crédito', empeno: 'Empeño', fiado: 'Fiado', adelanto: 'Adelanto' }

export default function EstadoCuenta() {
  const { id }    = useParams()
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const [abiertos, setAbiertos] = useState({})
  const [tab, setTab]           = useState('activos')

  useEffect(() => {
    fetch(`/api/estado/${id}`)
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setData(d))
      .catch(() => setError('No se pudo cargar'))
  }, [id])

  const toggle = key => setAbiertos(a => ({ ...a, [key]: !a[key] }))

  if (error) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <p className="text-red-500 text-center text-sm">❌ No se encontró la información</p>
    </div>
  )
  if (!data) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <p className="text-gray-400 animate-pulse">Cargando estado de cuenta...</p>
    </div>
  )

  const productos    = data.productos || []
  const historial    = data.historial || []
  const cuotas       = data.cuotas || {}
  const deudaTotal   = productos.reduce((s, p) => s + parseFloat(p.saldo_total || 0), 0)
  const pagadoTotal  = productos.reduce((s, p) => s + parseFloat(p.total_pagado || 0), 0)
  const tieneMora    = productos.some(p => parseInt(p.cuotas_mora || 0) > 0)
  const ultimosPagos = data.ultimos_pagos || []

  const productosTab = tab === 'activos' ? productos
    : tab === 'saldados'     ? historial.filter(p => p.estado === 'saldado')
    : tab === 'refinanciados'? historial.filter(p => p.estado === 'refinanciado')
    : [...productos, ...historial]

  return (
    <div className="min-h-screen bg-slate-100 pb-12" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── HEADER ── */}
      <div className="bg-[#1e3a5f] text-white px-5 pt-10 pb-6 text-center">
        <p className="text-blue-300 text-xs uppercase tracking-widest mb-1">💼 Inversiones Hnos Liñán</p>
        <p className="text-blue-300 text-xs mb-4">Estado de cuenta</p>
        <h1 className="text-2xl font-bold">{data.nombre}</h1>
        <p className="text-blue-300 text-sm mt-1">CC {data.documento}</p>
        <p className="text-blue-400 text-xs mt-0.5">Consultado el {fmtFecha(new Date())}</p>
      </div>

      {/* ── RESUMEN TOTAL ── */}
      <div className="mx-4 -mt-1">
        <div className="bg-white rounded-2xl shadow-lg p-5 border-t-4 border-[#1e3a5f]">
          <p className="text-xs text-gray-400 uppercase tracking-wide text-center mb-3">Resumen general</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 rounded-xl p-3 text-center border border-red-100">
              <p className="text-xs text-gray-500 mb-0.5">Total por pagar</p>
              <p className="text-xl font-black text-red-600">{fmt(deudaTotal)}</p>
            </div>
            <div className="bg-green-50 rounded-xl p-3 text-center border border-green-100">
              <p className="text-xs text-gray-500 mb-0.5">Total cancelado</p>
              <p className="text-xl font-black text-green-600">{fmt(pagadoTotal)}</p>
            </div>
          </div>
          <div className="mt-3">
            {tieneMora && (
              <div className="bg-red-500 text-white rounded-xl px-4 py-2.5 text-center">
                <p className="font-bold text-sm">⚠️ Tienes cuotas vencidas sin pagar</p>
                <p className="text-xs text-red-200 mt-0.5">Comunícate para ponerte al día</p>
              </div>
            )}
            {!tieneMora && deudaTotal > 0 && (
              <div className="bg-green-500 text-white rounded-xl px-4 py-2.5 text-center">
                <p className="font-bold text-sm">✅ Estás al día con tus pagos</p>
              </div>
            )}
            {deudaTotal === 0 && (
              <div className="bg-blue-500 text-white rounded-xl px-4 py-2.5 text-center">
                <p className="font-bold text-sm">🎉 ¡Sin deudas pendientes!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SEGMENTADORES ── */}
      <div className="mx-4 mt-5">
        <div className="flex gap-2 flex-wrap">
          {[
            { k:'activos',       l:'Activos',       n: productos.length,                           on:'bg-[#1e3a5f] text-white', off:'bg-white text-gray-500 border border-gray-200' },
            { k:'saldados',      l:'Saldados',       n: historial.filter(p=>p.estado==='saldado').length,       on:'bg-emerald-600 text-white', off:'bg-white text-gray-500 border border-gray-200' },
            { k:'refinanciados', l:'Refinanciados',  n: historial.filter(p=>p.estado==='refinanciado').length,  on:'bg-purple-600 text-white', off:'bg-white text-gray-500 border border-gray-200' },
            { k:'todos',         l:'Todos',           n: productos.length + historial.length,        on:'bg-gray-700 text-white', off:'bg-white text-gray-500 border border-gray-200' },
          ].map(f => (
            <button key={f.k} onClick={() => setTab(f.k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all
                ${tab === f.k ? f.on + ' shadow-md' : f.off}`}>
              {f.l}
              <span className={`text-xs px-2 py-0.5 rounded-full font-black ${tab === f.k ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {f.n}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── CRÉDITOS ── */}
      {productosTab.length > 0 && (
        <div className="mx-4 mt-4 space-y-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
            {productosTab.length} crédito(s)
          </p>

          {productosTab.map(p => {
            const pagadas    = parseInt(p.cuotas_pagadas  || 0)
            const total      = parseInt(p.total_cuotas    || 0)
            const mora       = parseInt(p.cuotas_mora     || 0)
            const pendientes = parseInt(p.cuotas_pendientes || 0)
            const proyectado = parseFloat(p.total_proyectado || 0)
            const pagado     = parseFloat(p.total_pagado   || 0)
            const saldo      = parseFloat(p.saldo_total    || 0)
            const intereses  = parseFloat(p.total_intereses || 0)
            const progreso   = total > 0 ? Math.round((pagadas / total) * 100) : 0
            const abierto    = abiertos[p.id]

            return (
              <div key={p.id} className={`bg-white rounded-2xl shadow-sm overflow-hidden border-l-4
                ${mora > 0 ? 'border-red-400' : p.estado === 'saldado' ? 'border-emerald-400' : p.estado === 'refinanciado' ? 'border-purple-400' : 'border-blue-400'}`}>

                {/* Cabecera del crédito */}
                <button onClick={() => toggle(p.id)}
                  className="w-full px-5 pt-5 pb-4 text-left">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{tipoIcon[p.tipo] || '📄'}</span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-gray-800">{tipoLabel[p.tipo] || p.tipo}</p>
                      {p.referencia && <span className="text-xs font-bold font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded border">{p.referencia}</span>}
                      {p.estado === 'saldado' && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">✅ Saldado</span>}
                      {p.estado === 'refinanciado' && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">🔄 Refinanciado</span>}
                    </div>
                        {p.descripcion_bien && <p className="text-xs text-gray-400">{p.descripcion_bien}</p>}
                        <p className="text-xs text-gray-400 mt-0.5">Desde {fmtCorta(p.fecha_creacion)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Saldo</p>
                      <p className="text-lg font-black text-gray-800">{fmt(saldo)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{abierto ? '▲ menos' : '▼ más'}</p>
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  {p.tipo !== 'fiado' && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{pagadas} de {total} cuotas pagadas</span>
                        <span>{progreso}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div className="bg-green-500 h-2.5 rounded-full transition-all"
                          style={{ width: `${progreso}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Alertas rápidas */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {mora > 0 && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full font-semibold">
                        ⚠️ {mora} cuota(s) vencida(s)
                      </span>
                    )}
                    {p.proxima_fecha && p.tipo !== 'fiado' && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                        📅 Próximo pago: {fmtCorta(p.proxima_fecha)}
                      </span>
                    )}
                  </div>
                </button>

                {/* Detalle expandible */}
                {abierto && (
                  <div className="border-t bg-gray-50 px-5 py-4 space-y-4">

                    {/* KPIs financieros */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white rounded-xl p-3 text-center border">
                        <p className="text-xs text-gray-400">Capital prestado</p>
                        <p className="font-bold text-gray-700 text-sm">{fmt(p.monto_capital)}</p>
                      </div>
                      <div className="bg-white rounded-xl p-3 text-center border">
                        <p className="text-xs text-gray-400">Total a pagar</p>
                        <p className="font-bold text-indigo-600 text-sm">{fmt(proyectado)}</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center border border-green-100">
                        <p className="text-xs text-gray-400">Ya pagaste</p>
                        <p className="font-bold text-green-600 text-sm">{fmt(pagado)}</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-3 text-center border border-red-100">
                        <p className="text-xs text-gray-400">Te falta</p>
                        <p className="font-bold text-red-600 text-sm">{fmt(saldo)}</p>
                      </div>
                    </div>

                    {/* Info del crédito */}
                    {p.tipo !== 'fiado' && (
                      <div className="bg-white rounded-xl border p-4 space-y-2 text-sm">
                        <p className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Condiciones del crédito</p>
                        <div className="flex justify-between"><span className="text-gray-400">Tasa de interés</span><span className="font-medium">{p.tasa_interes}% {p.periodo_tasa}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Frecuencia de pago</span><span className="font-medium capitalize">{p.frecuencia_cobro}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Total intereses</span><span className="font-medium text-orange-500">{fmt(intereses)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Cuotas totales</span><span className="font-medium">{total}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Cuotas pagadas</span><span className="font-medium text-green-600">{pagadas} ✓</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Cuotas pendientes</span><span className="font-medium text-blue-600">{pendientes}</span></div>
                        {mora > 0 && <div className="flex justify-between"><span className="text-gray-400">Cuotas vencidas</span><span className="font-bold text-red-600">{mora} ⚠️</span></div>}
                      </div>
                    )}

                    {/* Próxima cuota destacada */}
                    {p.proxima_fecha && p.tipo !== 'fiado' && (
                      <div className="bg-[#1e3a5f] text-white rounded-xl p-4">
                        <p className="text-xs text-blue-300 uppercase tracking-widest mb-1">📅 Próxima cuota a pagar</p>
                        <div className="flex justify-between items-center">
                          <p className="font-bold text-lg">{fmtFecha(p.proxima_fecha)}</p>
                          <p className="text-2xl font-black">{fmt(p.proxima_valor)}</p>
                        </div>
                      </div>
                    )}

                    {/* ── TABLA DE CUOTAS ── */}
                    {cuotas[p.id]?.length > 0 && (
                      <div className="bg-white rounded-xl border overflow-hidden">
                        <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
                          <span className="text-sm">📋</span>
                          <p className="text-xs font-black uppercase tracking-widest text-gray-600">Plan de pagos</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-gray-50">
                                <th className="text-left px-3 py-2 text-gray-400 font-semibold">#</th>
                                <th className="text-left px-3 py-2 text-gray-400 font-semibold">Fecha vencimiento</th>
                                <th className="text-right px-3 py-2 text-gray-400 font-semibold">Cuota</th>
                                <th className="text-center px-3 py-2 text-gray-400 font-semibold">Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cuotas[p.id].map((c, idx) => {
                                const hoyStr = new Date().toISOString().split('T')[0]
                                const vence  = c.fecha_vencimiento?.split('T')[0]
                                const esMora = vence < hoyStr && c.estado !== 'pagada'
                                return (
                                  <tr key={idx}
                                    className={`border-b last:border-0
                                      ${c.estado === 'pagada' ? 'bg-green-50' :
                                        esMora               ? 'bg-red-50' :
                                        c.estado === 'parcial'? 'bg-yellow-50' : ''}`}>
                                    <td className="px-3 py-2.5 font-bold text-gray-500">{c.numero_cuota}</td>
                                    <td className="px-3 py-2.5 font-semibold text-gray-700">
                                      {vence ? new Date(vence + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-gray-800">{fmt(c.monto_cuota)}</td>
                                    <td className="px-3 py-2.5 text-center">
                                      {c.estado === 'pagada'  && <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">✓ Pagada</span>}
                                      {c.estado === 'parcial' && <span className="inline-block px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-semibold">Parcial</span>}
                                      {c.estado === 'pendiente' && !esMora && <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 font-semibold">Pendiente</span>}
                                      {esMora && <span className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-semibold">⚠️ Vencida</span>}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── ÚLTIMOS PAGOS ── */}
      {ultimosPagos.length > 0 && (
        <div className="mx-4 mt-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">
            Últimos pagos registrados
          </p>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {ultimosPagos.map((pg, i) => (
              <div key={pg.numero_recibo + i}
                className={`flex justify-between items-center px-5 py-3.5 ${i > 0 ? 'border-t' : ''}`}>
                <div>
                  <p className="text-sm font-semibold text-gray-700">{pg.numero_recibo}</p>
                  <p className="text-xs text-gray-400">{fmtCorta(pg.fecha_pago)} · Cuota #{pg.numero_cuota} · {pg.metodo_pago}</p>
                </div>
                <p className="font-bold text-green-600">{fmt(pg.monto)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SIN CRÉDITOS EN ESTE SEGMENTO ── */}
      {productosTab.length === 0 && (
        <div className="mx-4 mt-8 bg-white rounded-2xl p-10 text-center shadow-sm">
          <p className="text-5xl mb-3">🎉</p>
          <p className="font-bold text-gray-700 text-lg">¡Sin deudas activas!</p>
          <p className="text-sm text-gray-400 mt-1">No tienes créditos pendientes</p>
        </div>
      )}

      {/* ── FOOTER ── */}
      <div className="text-center mt-8 px-4">
        <p className="text-xs text-gray-400">Inversiones Hnos Liñán · Información confidencial</p>
        <p className="text-xs text-gray-300 mt-0.5">Esta consulta es solo para el titular del crédito</p>
      </div>
    </div>
  )
}
