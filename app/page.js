'use client'
import { useEffect, useState } from 'react'
import KPICard from '@/components/KPICard'
import Link from 'next/link'

const fmt = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function Dashboard() {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const [fechaHoy, setFechaHoy] = useState('')

  useEffect(() => {
    setFechaHoy(new Date().toLocaleDateString('es-CO', { weekday:'long', year:'numeric', month:'long', day:'numeric' }))
  }, [])

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
  }, [])

  if (error) return <div className="text-red-600 p-4 bg-red-50 rounded-lg">❌ Error: {error}</div>
  if (!data)  return <div className="text-gray-400 p-4">Cargando dashboard...</div>
  if (data.error) return <div className="text-red-600 p-4 bg-red-50 rounded-lg">❌ Error BD: {data.error}</div>
  if (!data.kpis) return <div className="text-red-600 p-4 bg-red-50 rounded-lg">❌ Respuesta inesperada de la API</div>

  const { kpis, cuotas_hoy, cuotas_semana, empenos_vencer } = data

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <p className="text-sm text-gray-500 mt-1">{fechaHoy}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard titulo="Capital en la calle"   valor={fmt(kpis.capital_en_calle)}    icono="💵" color="blue" />
        <KPICard titulo="Intereses ganados"      valor={fmt(kpis.intereses_ganados)}   icono="📈" color="green" />
        <KPICard titulo="Clientes en mora"       valor={kpis.clientes_en_mora}          icono="⚠️" alerta={kpis.clientes_en_mora > 0} />
        <KPICard titulo="Recaudo del día"        valor={fmt(kpis.recaudo_hoy)}          icono="💳" color="green" />
        <KPICard titulo="Cartera vencida +30d"   valor={fmt(kpis.cartera_vencida_30d)} icono="🔴" alerta={kpis.cartera_vencida_30d > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cuotas vencen hoy */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">⏰ Vencen hoy ({cuotas_hoy.length})</h3>
          {cuotas_hoy.length === 0
            ? <p className="text-sm text-gray-400">Sin cuotas para hoy</p>
            : <ul className="space-y-2">
                {cuotas_hoy.map(c => (
                  <li key={c.id} className="flex justify-between text-sm">
                    <span className="font-medium">{c.nombre_cliente}</span>
                    <span className="text-blue-600 font-semibold">{fmt(c.monto_cuota)}</span>
                  </li>
                ))}
              </ul>
          }
        </div>

        {/* Cuotas semana */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">📅 Esta semana ({cuotas_semana.length})</h3>
          {cuotas_semana.length === 0
            ? <p className="text-sm text-gray-400">Sin cuotas esta semana</p>
            : <ul className="space-y-2">
                {cuotas_semana.slice(0,8).map(c => (
                  <li key={c.id} className="flex justify-between text-sm">
                    <span>{c.nombre_cliente}</span>
                    <span className="text-gray-500">{new Date(c.fecha_vencimiento).toLocaleDateString('es-CO')}</span>
                  </li>
                ))}
              </ul>
          }
        </div>

        {/* Empeños por vencer */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">🔒 Empeños por vencer ({empenos_vencer.length})</h3>
          {empenos_vencer.length === 0
            ? <p className="text-sm text-gray-400">Sin empeños próximos</p>
            : <ul className="space-y-2">
                {empenos_vencer.map(e => {
                  const dias = Math.ceil((new Date(e.fecha_limite_rescate) - new Date()) / (1000*60*60*24))
                  return (
                    <li key={e.id} className="flex justify-between text-sm">
                      <span>{e.nombre_cliente}</span>
                      <span className={`font-semibold ${dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-orange-500' : 'text-yellow-600'}`}>
                        {dias}d
                      </span>
                    </li>
                  )
                })}
              </ul>
          }
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="flex gap-3">
        <Link href="/prestamos/nuevo" className="bg-primary-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors">
          + Nuevo préstamo
        </Link>
        <Link href="/clientes" className="bg-white border text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
          Ver clientes
        </Link>
        <Link href="/cobros" className="bg-white border text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
          Registrar cobro
        </Link>
      </div>
    </div>
  )
}
