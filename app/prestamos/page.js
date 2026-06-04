'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)

const tipoColor  = { prestamo:'bg-blue-100 text-blue-700', venta:'bg-yellow-100 text-yellow-700', empeno:'bg-purple-100 text-purple-700', fiado:'bg-green-100 text-green-700' }
const estadoBadge = { activo:'bg-blue-100 text-blue-700', al_dia:'bg-green-100 text-green-700', en_mora:'bg-red-100 text-red-700', saldado:'bg-emerald-100 text-emerald-700', refinanciado:'bg-purple-100 text-purple-700' }

export default function PrestamosPage() {
  const [productos, setProductos] = useState([])
  const [buscar, setBuscar]       = useState('')
  const [filtroEstado, setFiltroEstado] = useState('activos')

  useEffect(() => {
    fetch('/api/productos').then(r=>r.json()).then(setProductos)
  },[])

  const filtrados = productos.filter(p => {
    const q = buscar.toLowerCase()
    const matchBuscar = !q || p.nombre_cliente?.toLowerCase().includes(q) || p.documento?.toLowerCase().includes(q)
    const matchEstado = filtroEstado === 'todos' || (filtroEstado === 'activos' && !['saldado','refinanciado'].includes(p.estado)) || filtroEstado === p.estado
    return matchBuscar && matchEstado
  })

  // Agrupar por cliente para resumen
  const porCliente = filtrados.reduce((acc, p) => {
    if (!acc[p.cliente_id]) acc[p.cliente_id] = { nombre: p.nombre_cliente, documento: p.documento, items: [] }
    acc[p.cliente_id].items.push(p)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Préstamos</h2>
        <Link href="/prestamos/nuevo" className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          + Nuevo
        </Link>
      </div>

      {/* Búsqueda + filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input type="text" placeholder="Buscar por nombre o cédula..."
          className="flex-1 border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={buscar} onChange={e => setBuscar(e.target.value)} />
        <div className="flex gap-2">
          {[['activos','Activos'],['todos','Todos'],['saldado','Saldados'],['en_mora','En mora'],['refinanciado','Refinanciados']].map(([key,label]) => (
            <button key={key} onClick={() => setFiltroEstado(key)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors
                ${filtroEstado===key ? 'bg-primary-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Resultado */}
      <p className="text-xs text-gray-400">{filtrados.length} registro(s)</p>

      {Object.values(porCliente).length === 0
        ? <div className="bg-white rounded-xl border p-10 text-center text-gray-400 text-sm">Sin resultados</div>
        : Object.values(porCliente).map(cli => (
            <div key={cli.documento} className="bg-white rounded-xl border overflow-hidden">
              {/* Encabezado cliente */}
              <div className="px-5 py-3 bg-gray-50 border-b flex justify-between items-center">
                <div>
                  <span className="font-semibold text-gray-800">{cli.nombre}</span>
                  <span className="ml-2 text-xs text-gray-400">{cli.documento}</span>
                </div>
                <div className="flex items-center gap-4">
                  <Link href={`/prestamos/nuevo?cliente=${cli.items[0]?.cliente_id}`}
                    className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 font-medium whitespace-nowrap">
                    + Nuevo crédito
                  </Link>
                  <div className="text-right">
                  <span className="text-sm text-gray-500">Deuda total: </span>
                  <span className="font-bold text-red-600 text-xl">
                    {fmt(cli.items.filter(p=>!['saldado','refinanciado'].includes(p.estado)).reduce((s,p)=>s+parseFloat(p.capital_pendiente||0),0))}
                  </span>
                  </div>
                </div>
              </div>

              {/* Productos del cliente */}
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {cli.items.map(p => (
                    <tr key={p.id} className={`hover:bg-gray-50 ${p.estado==='en_mora'?'bg-red-50/40':p.estado==='refinanciado'?'opacity-60':''}`}>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tipoColor[p.tipo]||'bg-gray-100 text-gray-600'}`}>
                          {p.tipo}
                        </span>
                        {p.descripcion_bien && <span className="ml-2 text-xs text-gray-400 italic">{p.descripcion_bien.slice(0,40)}{p.descripcion_bien.length>40?'...':''}</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 font-medium text-base">{fmt(p.monto_capital)}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-700 text-lg">{fmt(p.capital_pendiente||0)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${estadoBadge[p.estado]||'bg-gray-100 text-gray-600'}`}>
                          {p.estado}
                        </span>
                        {p.cuotas_mora > 0 && <span className="ml-1 text-red-500 text-xs">⚠️ {p.cuotas_mora} mora</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/prestamos/${p.id}`} className="text-primary-600 hover:underline text-xs font-medium">Ver →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
      }
    </div>
  )
}
