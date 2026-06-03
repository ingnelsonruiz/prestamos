'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

function ModalQR({ clienteId, nombre, onClose }) {
  const url = `${window.location.origin}/estado/${clienteId}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`

  const copiar = () => {
    navigator.clipboard.writeText(url)
    alert('¡Enlace copiado!')
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center space-y-4">
        <h3 className="text-lg font-bold">Estado de cuenta — QR</h3>
        <p className="text-sm text-gray-500">Comparte con <strong>{nombre}</strong> para que consulte su deuda</p>

        <div className="flex justify-center">
          <img src={qrUrl} alt="QR estado de cuenta" className="rounded-xl border p-2 w-56 h-56" />
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 break-all">{url}</div>

        <div className="flex gap-3">
          <button onClick={copiar}
            className="flex-1 border rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            📋 Copiar enlace
          </button>
          <button onClick={() => window.open(url,'_blank')}
            className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700">
            👁 Ver página
          </button>
        </div>

        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Cerrar</button>
      </div>
    </div>
  )
}

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)

export default function PerfilCliente() {
  const { id } = useParams()
  const [data, setData]     = useState(null)
  const [showQR, setShowQR] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('activos')

  useEffect(() => {
    fetch(`/api/clientes/${id}`).then(r=>r.json()).then(setData)
  }, [id])

  if (!data) return <div className="text-gray-400 p-4">Cargando...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <Link href="/clientes" className="text-gray-400 hover:text-gray-600 text-sm">← Clientes</Link>
        <button onClick={() => setShowQR(true)}
          className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 flex items-center gap-2">
          📱 Ver QR / Estado de cuenta
        </button>
      </div>

      {showQR && <ModalQR clienteId={id} nombre={data.nombre} onClose={() => setShowQR(false)} />}

      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-xl font-bold">{data.nombre}</h2>
        <p className="text-gray-500 text-sm mt-1">{data.documento}</p>
        <div className="grid grid-cols-3 gap-4 mt-4 text-sm text-gray-600">
          <div><span className="font-medium">Teléfono:</span> {data.telefono||'—'}</div>
          <div><span className="font-medium">Email:</span> {data.email||'—'}</div>
          <div><span className="font-medium">Dirección:</span> {data.direccion||'—'}</div>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-700">Productos ({data.productos?.length || 0})</h3>
          <Link href={`/prestamos/nuevo?cliente=${id}`}
            className="text-sm bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700">
            + Nuevo
          </Link>
        </div>

        {/* Segmentadores por estado */}
        {(() => {
          const prods = data.productos || []
          const conteos = {
            activos:      prods.filter(p => !['saldado','refinanciado','decomisado'].includes(p.estado)).length,
            saldado:      prods.filter(p => p.estado === 'saldado').length,
            refinanciado: prods.filter(p => p.estado === 'refinanciado').length,
            todos:        prods.length,
          }
          return (
            <div className="flex gap-2 flex-wrap mb-4">
              {[
                { k:'activos',      l:'Activos',       color:'bg-blue-100 text-blue-700 border-blue-200' },
                { k:'saldado',      l:'Saldados',      color:'bg-green-100 text-green-700 border-green-200' },
                { k:'refinanciado', l:'Refinanciados', color:'bg-purple-100 text-purple-700 border-purple-200' },
                { k:'todos',        l:'Todos',         color:'bg-gray-100 text-gray-600 border-gray-200' },
              ].map(f => (
                <button key={f.k} onClick={() => setFiltroEstado(f.k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                    ${filtroEstado === f.k
                      ? f.color + ' ring-2 ring-offset-1 ring-current'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                  {f.l}
                  <span className="ml-1.5 bg-white/60 px-1.5 py-0.5 rounded-full text-xs font-bold">
                    {conteos[f.k]}
                  </span>
                </button>
              ))}
            </div>
          )
        })()}

        <div className="space-y-3">
          {(data.productos||[]).filter(p => {
            if (filtroEstado === 'todos') return true
            if (filtroEstado === 'activos') return !['saldado','refinanciado','decomisado'].includes(p.estado)
            return p.estado === filtroEstado
          }).map(p => (
            <Link key={p.id} href={`/prestamos/${p.id}`}
              className="block bg-white border rounded-xl p-4 hover:border-primary-300 transition-colors">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs uppercase font-bold text-primary-600">{p.tipo}</span>
                  <p className="font-medium mt-1">{fmt(p.monto_capital)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {p.total_cuotas} cuotas · {p.tasa_interes}% {p.periodo_tasa} · {p.metodo_calculo}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium
                  ${p.estado==='saldado' ? 'bg-green-100 text-green-700' :
                    p.estado==='en_mora' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'}`}>
                  {p.estado}
                </span>
              </div>
              {p.cuotas_mora > 0 && (
                <p className="text-xs text-red-500 mt-2">⚠️ {p.cuotas_mora} cuota(s) en mora</p>
              )}
            </Link>
          ))}
          {(!data.productos || data.productos.length===0) &&
            <p className="text-sm text-gray-400">Sin productos registrados</p>
          }
        </div>
      </div>
    </div>
  )
}
