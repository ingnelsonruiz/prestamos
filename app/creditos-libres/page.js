'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const fmt = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
const fmtDate = s => {
  if (!s) return '—'
  const str = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10)
  return new Date(str + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

const estadoBadge = {
  activo:      'bg-blue-100 text-blue-700',
  saldado:     'bg-emerald-100 text-emerald-700',
  refinanciado:'bg-purple-100 text-purple-700',
}

export default function CreditosLibresPage() {
  const [creditos, setCreditos]   = useState([])
  const [buscar, setBuscar]       = useState('')
  const [filtro, setFiltro]       = useState('activos') // 'activos' | 'saldados' | 'todos'
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    fetch('/api/creditos-libres')
      .then(r => r.json())
      .then(d => { setCreditos(Array.isArray(d) ? d : []); setLoading(false) })
  }, [])

  const filtrados = creditos.filter(c => {
    const q = buscar.toLowerCase()
    const matchBuscar = !q
      || c.nombre_cliente?.toLowerCase().includes(q)
      || c.documento?.toLowerCase().includes(q)
      || c.referencia?.toLowerCase().includes(q)
    const matchFiltro = filtro === 'todos'
      || (filtro === 'activos'  && c.estado !== 'saldado')
      || (filtro === 'saldados' && c.estado === 'saldado')
    return matchBuscar && matchFiltro
  })

  const totalCapital   = filtrados.reduce((s, c) => s + parseFloat(c.capital_pendiente || 0), 0)
  const totalIntereses = filtrados.reduce((s, c) => s + parseFloat(c.intereses_pagados || 0), 0)

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">📅 Créditos Sin Cuotas Futuras</h2>
          <p className="text-sm text-gray-500 mt-0.5">Interés calculado por fecha de corte — abono libre a capital o intereses</p>
        </div>
        <Link href="/creditos-libres/nuevo"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
          + Nuevo crédito
        </Link>
      </div>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Créditos activos</p>
          <p className="text-2xl font-bold text-blue-700">{creditos.filter(c => c.estado !== 'saldado').length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Capital en calle</p>
          <p className="text-xl font-bold text-gray-800 truncate">{fmt(totalCapital)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Intereses cobrados</p>
          <p className="text-xl font-bold text-emerald-700 truncate">{fmt(totalIntereses)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Total créditos</p>
          <p className="text-2xl font-bold text-gray-700">{creditos.length}</p>
        </div>
      </div>

      {/* Filtros y búsqueda */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Buscar por nombre, documento o referencia..."
          value={buscar}
          onChange={e => setBuscar(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {[['activos','Activos'],['saldados','Saldados'],['todos','Todos']].map(([v,l]) => (
            <button key={v} onClick={() => setFiltro(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${filtro === v ? 'bg-white text-blue-700 shadow' : 'text-gray-600 hover:text-gray-800'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-medium">No hay créditos sin cuotas futuras</p>
          <Link href="/creditos-libres/nuevo" className="text-blue-600 text-sm hover:underline mt-2 inline-block">
            Crear el primero
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filtrados.map(c => {
            const diasSinCorte = parseInt(c.dias_sin_corte ?? 0)
            const alertaDias   = diasSinCorte > 30
            return (
              <Link key={c.id} href={`/creditos-libres/${c.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-4">
                  {/* Info cliente */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 truncate">{c.nombre_cliente}</span>
                      <span className="text-xs text-gray-400">CC {c.documento}</span>
                      {c.telefono && (
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
                          📞 {c.telefono}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs font-mono text-gray-500">{c.referencia}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoBadge[c.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                        {c.estado}
                      </span>
                      {alertaDias && c.estado !== 'saldado' && (
                        <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full">
                          ⚠️ {diasSinCorte} días sin corte
                        </span>
                      )}
                    </div>
                    {c.descripcion_bien && (
                      <p className="text-xs text-gray-500 mt-1 truncate">{c.descripcion_bien}</p>
                    )}
                  </div>

                  {/* Montos */}
                  <div className="text-right shrink-0">
                    <p className="text-sm text-gray-500">Capital pendiente</p>
                    <p className="text-lg font-bold text-gray-900">{fmt(c.capital_pendiente)}</p>
                    <p className="text-xs text-gray-400">
                      Tasa {c.tasa_interes}% {c.periodo_tasa}
                    </p>
                    <p className="text-xs text-emerald-600 mt-0.5">
                      Intereses cobrados: {fmt(c.intereses_pagados)}
                    </p>
                    {c.ultima_fecha_corte && (
                      <p className="text-xs text-gray-400">Último corte: {fmtDate(c.ultima_fecha_corte)}</p>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
