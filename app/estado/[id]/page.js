'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)
const tipoIcon  = { prestamo:'💰', venta:'🛍', empeno:'🔒', fiado:'🌿' }
const tipoLabel = { prestamo:'Préstamo', venta:'Venta a crédito', empeno:'Empeño', fiado:'Fiado' }

export default function EstadoCuenta() {
  const { id } = useParams()
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`/api/estado/${id}`)
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setData(d))
      .catch(() => setError('No se pudo cargar el estado de cuenta'))
  }, [id])

  if (error) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <p className="text-red-500 text-center text-sm">No se encontró la información</p>
    </div>
  )
  if (!data) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-400 animate-pulse">Cargando...</p>
    </div>
  )

  const productosActivos = (data.productos||[]).filter(p =>
    !['saldado','decomisado','refinanciado'].includes(p.estado)
  )
  const deudaTotal = productosActivos.reduce((s,p) => s + parseFloat(p.saldo_total||0), 0)
  const tieneMora  = productosActivos.some(p => parseInt(p.cuotas_mora||0) > 0)

  return (
    <div className="min-h-screen bg-slate-100">

      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-5 pt-10 pb-8 text-center">
        <p className="text-blue-300 text-xs uppercase tracking-widest mb-2">Estado de cuenta</p>
        <h1 className="text-2xl font-bold leading-tight">{data.nombre}</h1>
        <p className="text-blue-300 text-sm mt-1">CC {data.documento}</p>

        <div className="mt-6 bg-white/10 rounded-2xl p-5">
          <p className="text-blue-200 text-sm mb-1">Deuda total activa</p>
          <p className={`text-4xl font-bold ${deudaTotal > 0 ? 'text-white' : 'text-green-400'}`}>
            {fmt(deudaTotal)}
          </p>
          <p className="text-blue-300 text-xs mt-2">
            {productosActivos.length} crédito(s) activo(s)
          </p>
        </div>

        {tieneMora && (
          <div className="mt-4 bg-red-500/30 border border-red-400/50 rounded-xl px-4 py-3">
            <p className="text-red-200 text-sm font-semibold">⚠️ Tienes cuotas en mora</p>
            <p className="text-red-300 text-xs mt-1">Comunícate para ponerte al día</p>
          </div>
        )}
        {!tieneMora && deudaTotal > 0 && (
          <div className="mt-4 bg-green-500/20 border border-green-400/30 rounded-xl px-4 py-3">
            <p className="text-green-300 text-sm font-semibold">✅ Estás al día</p>
          </div>
        )}
        {deudaTotal === 0 && (
          <div className="mt-4 bg-green-500/20 border border-green-400/30 rounded-xl px-4 py-3">
            <p className="text-green-300 text-sm font-semibold">🎉 ¡Sin deudas pendientes!</p>
          </div>
        )}
      </div>

      {/* Detalle */}
      <div className="px-4 py-6 space-y-4">
        {productosActivos.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">Detalle de créditos</p>
            {productosActivos.map(p => (
              <div key={p.id} className={`bg-white rounded-2xl p-5 shadow-sm border-l-4
                ${parseInt(p.cuotas_mora||0)>0 ? 'border-red-400' : 'border-blue-300'}`}>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <span className="text-4xl">{tipoIcon[p.tipo]||'📄'}</span>
                    <div>
                      <p className="font-bold text-gray-800 text-base">{tipoLabel[p.tipo]||p.tipo}</p>
                      {p.descripcion_bien && (
                        <p className="text-xs text-gray-400 mt-0.5">{p.descripcion_bien}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-gray-800">{fmt(p.saldo_total||0)}</p>
                    <p className="text-xs text-gray-400">pendiente</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-400">Capital</p>
                    <p className="font-semibold text-gray-700 text-sm mt-0.5">{fmt(p.monto_capital)}</p>
                  </div>
                  {p.tipo !== 'fiado' && (
                    <div className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-400">Cuotas</p>
                      <p className="font-semibold text-gray-700 text-sm mt-0.5">{p.total_cuotas} total</p>
                    </div>
                  )}
                </div>

                {parseInt(p.cuotas_mora||0) > 0 && (
                  <div className="mt-3 bg-red-50 rounded-xl px-4 py-2.5 flex items-center gap-2">
                    <span className="text-red-500">⚠️</span>
                    <p className="text-red-600 text-sm font-medium">{p.cuotas_mora} cuota(s) en mora</p>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {productosActivos.length === 0 && (
          <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
            <p className="text-5xl mb-3">🎉</p>
            <p className="font-bold text-gray-700 text-lg">¡Sin deudas!</p>
            <p className="text-sm text-gray-400 mt-1">No tienes créditos activos</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center pb-8 px-4">
        <p className="text-xs text-gray-400">
          Consulta generada el {new Date().toLocaleDateString('es-CO')} · Inversiones Hnos Liñan
        </p>
      </div>

    </div>
  )
}
