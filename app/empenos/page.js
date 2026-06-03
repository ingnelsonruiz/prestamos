'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)

export default function EmpenosPage() {
  const [empenos, setEmpenos] = useState([])

  useEffect(() => {
    fetch('/api/productos?tipo=empeno')
      .then(r=>r.json())
      .then(d => setEmpenos(d.filter(p=>p.tipo==='empeno')))
  },[])

  const diasRestantes = fechaLimite => {
    if (!fechaLimite) return null
    return Math.ceil((new Date(fechaLimite) - new Date()) / (1000*60*60*24))
  }

  const alertaColor = dias => {
    if (dias === null) return ''
    if (dias <= 3)  return 'bg-red-50 border-red-300'
    if (dias <= 7)  return 'bg-orange-50 border-orange-300'
    if (dias <= 15) return 'bg-yellow-50 border-yellow-200'
    return 'bg-white'
  }

  const diasLabel = dias => {
    if (dias === null) return null
    if (dias < 0)  return <span className="text-red-600 font-bold text-xs">VENCIDO</span>
    if (dias === 0) return <span className="text-red-600 font-bold text-xs">HOY</span>
    return <span className={`font-semibold text-xs ${dias<=3?'text-red-600':dias<=7?'text-orange-500':'text-yellow-600'}`}>
      {dias} días
    </span>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Empeños</h2>
        <Link href="/prestamos/nuevo" className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          + Nuevo empeño
        </Link>
      </div>

      {/* Leyenda alertas */}
      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block"></span> ≤ 3 días</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 inline-block"></span> ≤ 7 días</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 inline-block"></span> ≤ 15 días</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {empenos.map(e => {
          const dias = diasRestantes(e.fecha_limite_rescate)
          return (
            <div key={e.id} className={`rounded-xl border p-5 ${alertaColor(dias)}`}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-semibold">{e.nombre_cliente}</p>
                  <p className="text-xs text-gray-500">{e.documento}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium
                  ${e.estado==='rescatado'?'bg-green-100 text-green-700':
                    e.estado==='decomisado'?'bg-gray-100 text-gray-600':
                    'bg-blue-100 text-blue-700'}`}>
                  {e.estado}
                </span>
              </div>

              <p className="text-sm font-medium text-gray-700 mb-1">{e.descripcion_bien||'Sin descripción'}</p>
              {e.valor_comercial_bien && (
                <p className="text-xs text-gray-500">Valor comercial: {fmt(e.valor_comercial_bien)}</p>
              )}
              <p className="text-sm font-bold text-blue-700 mt-2">{fmt(e.monto_capital)}</p>

              <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
                <div>
                  {e.fecha_limite_rescate && (
                    <p className="text-xs text-gray-500">
                      Vence: {new Date(e.fecha_limite_rescate).toLocaleDateString('es-CO')}
                    </p>
                  )}
                  {diasLabel(dias)}
                </div>
                <Link href={`/prestamos/${e.id}`} className="text-primary-600 hover:underline text-xs font-medium">
                  Ver cuotas →
                </Link>
              </div>
            </div>
          )
        })}
        {empenos.length===0 && (
          <div className="col-span-3 text-center text-gray-400 py-16 text-sm">
            Sin empeños registrados
          </div>
        )}
      </div>
    </div>
  )
}
