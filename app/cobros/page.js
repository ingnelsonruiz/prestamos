'use client'
import { useEffect, useState } from 'react'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)

const tipoIcon  = { prestamo:'💰', venta:'🛍', empeno:'🔒', fiado:'🌿' }
const tipoLabel = { prestamo:'Préstamo', venta:'Venta crédito', empeno:'Empeño', fiado:'Fiado finca' }

export default function CobrosPage() {
  const [grupos, setGrupos]   = useState([])   // agrupado por producto
  const [abiertos, setAbiertos] = useState({}) // acordeón
  const [buscar, setBuscar]   = useState('')
  const [filtro, setFiltro]   = useState('todas')
  const [modal, setModal]     = useState(null)
  const [monto, setMonto]     = useState('')
  const [metodo, setMetodo]   = useState('efectivo')
  const [notas, setNotas]     = useState('')
  const [fechaPago, setFechaPago] = useState('')
  const [loading, setLoading] = useState(false)
  const [recibo, setRecibo]   = useState(null)
  const [error, setError]     = useState('')

  const hoy = new Date().toISOString().split('T')[0]

  const cargar = async () => {
    const [pend, parc] = await Promise.all([
      fetch('/api/cuotas?estado=pendiente').then(r=>r.json()),
      fetch('/api/cuotas?estado=parcial').then(r=>r.json()),
    ])
    const todas = [...pend, ...parc].sort((a,b) =>
      new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento)
    )
    // Agrupar por producto
    const map = {}
    todas.forEach(c => {
      if (!map[c.producto_id]) {
        map[c.producto_id] = {
          producto_id:    c.producto_id,
          nombre_cliente: c.nombre_cliente,
          tipo:           c.tipo_producto,
          descripcion:    c.descripcion_bien || c.descripcion || '',
          cuotas: []
        }
      }
      map[c.producto_id].cuotas.push(c)
    })
    setGrupos(Object.values(map))
    setAbiertos({}) // cerrado por defecto
  }

  useEffect(() => { cargar() }, [])

  const toggle = id => setAbiertos(a => ({...a, [id]: !a[id]}))

  const esFutura = c => c.fecha_vencimiento?.split('T')[0] > hoy
  const esMora   = c => c.fecha_vencimiento?.split('T')[0] < hoy
  const pendiente = c => parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado||0)

  const gruposFiltrados = grupos.filter(g => {
    const q = buscar.toLowerCase()
    if (q && !g.nombre_cliente?.toLowerCase().includes(q) && !g.descripcion?.toLowerCase().includes(q)) return false
    if (filtro === 'mora')  return g.cuotas.some(c => esMora(c))
    if (filtro === 'hoy')   return g.cuotas.some(c => c.fecha_vencimiento?.split('T')[0] === hoy)
    if (filtro === 'semana') {
      const fin = new Date(hoy); fin.setDate(fin.getDate()+7)
      return g.cuotas.some(c => {
        const fv = c.fecha_vencimiento?.split('T')[0]
        return fv >= hoy && fv <= fin.toISOString().split('T')[0]
      })
    }
    return true
  })

  const totalPendiente = gruposFiltrados.reduce((s,g) =>
    s + g.cuotas.reduce((ss,c) => ss + pendiente(c), 0), 0)

  const abrirModal = c => {
    setModal(c); setMonto(String(pendiente(c)))
    setNotas(''); setFechaPago(hoy); setError('')
  }

  const registrarPago = async () => {
    const montoNum = parseFloat(monto)
    if (!montoNum || montoNum <= 0) { setError('Monto inválido'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/pagos', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ cuota_id: modal.id, monto: montoNum, metodo_pago: metodo, notas, fecha_pago: fechaPago })
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    setRecibo(data.numero_recibo)
    setModal(null)
    cargar()
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-bold text-gray-800">Cobros</h2>

      {recibo && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex justify-between items-center">
          <span className="text-green-700 font-medium">✅ Pago registrado — {recibo}</span>
          <button onClick={()=>setRecibo(null)} className="text-green-500 text-sm">✕</button>
        </div>
      )}

      {/* Búsqueda + filtros */}
      <div className="flex flex-col gap-3">
        <input type="text" placeholder="🔍 Buscar cliente por nombre o cédula..."
          className="flex-1 border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={buscar}
          onChange={e => {
            const q = e.target.value
            setBuscar(q)
            // Auto-abrir acordeones que coinciden con la búsqueda
            if (q.trim()) {
              const nuevosAbiertos = {}
              grupos.forEach(g => {
                if (g.nombre_cliente?.toLowerCase().includes(q.toLowerCase()) ||
                    g.descripcion?.toLowerCase().includes(q.toLowerCase())) {
                  nuevosAbiertos[g.producto_id] = true
                }
              })
              setAbiertos(nuevosAbiertos)
            } else {
              setAbiertos({})
            }
          }} />
        <div className="flex gap-2">
          {[
            { k:'todas',  l:'Todas',    desc:'Todas las cuotas pendientes o con abono parcial',
              count: grupos.length },
            { k:'mora',   l:'En mora',  desc:'Cuotas vencidas sin pagar al 100%',
              count: grupos.filter(g=>g.cuotas.some(c=>esMora(c))).length,  color:'text-red-500' },
            { k:'hoy',    l:'Hoy',      desc:'Cuotas que vencen hoy',
              count: grupos.filter(g=>g.cuotas.some(c=>c.fecha_vencimiento?.split('T')[0]===hoy)).length, color:'text-orange-500' },
            { k:'semana', l:'Semana',   desc:'Vencen en los próximos 7 días',
              count: grupos.filter(g=>g.cuotas.some(c=>{
                const fin=new Date(hoy); fin.setDate(fin.getDate()+7)
                const fv=c.fecha_vencimiento?.split('T')[0]
                return fv>=hoy && fv<=fin.toISOString().split('T')[0]
              })).length, color:'text-yellow-600' },
          ].map(({k,l,desc,count,color})=>(
            <div key={k} className="relative group">
              <button onClick={()=>setFiltro(k)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
                  ${filtro===k?'bg-primary-600 text-white':'bg-white border text-gray-600 hover:bg-gray-50'}`}>
                {l}
                <span className={`text-xs font-bold ${filtro===k?'text-white/80':color||'text-gray-400'}`}>
                  {count}
                </span>
              </button>
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                <div className="bg-gray-800 text-white text-xs rounded-lg px-3 py-1.5 whitespace-nowrap shadow-lg">
                  {desc}
                </div>
                <div className="w-2 h-2 bg-gray-800 rotate-45 mx-auto -mt-1"></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sin búsqueda — pantalla vacía */}
      {!buscar.trim() && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <p className="text-4xl mb-3">🔍</p>
          <p className="font-semibold text-gray-600">Busca un cliente para ver sus cobros</p>
          <p className="text-sm text-gray-400 mt-1">Escribe el nombre o cédula en el campo de arriba</p>
        </div>
      )}

      {/* Con búsqueda — mostrar resultados */}
      {buscar.trim() && (
        <>
          <p className="text-sm text-gray-500">
            {gruposFiltrados.length} crédito(s) —
            <span className="font-semibold text-blue-600 ml-1">{fmt(totalPendiente)} pendiente</span>
          </p>
          <div className="space-y-3">
            {gruposFiltrados.map(g => {
          const totalG = g.cuotas.reduce((s,c)=>s+pendiente(c),0)
          const tieneMora = g.cuotas.some(c=>esMora(c))
          const abierto = abiertos[g.producto_id]

          return (
            <div key={g.producto_id} className={`bg-white rounded-xl border overflow-x-auto ${tieneMora?'border-red-300':''}`}>
              {/* Cabecera acordeón */}
              <button onClick={()=>toggle(g.producto_id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{tipoIcon[g.tipo]||'📄'}</span>
                  <div className="text-left">
                    <p className="font-semibold text-gray-800">{g.nombre_cliente}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {tipoLabel[g.tipo]||g.tipo}
                      {g.descripcion && <span className="ml-2 italic">— {g.descripcion.slice(0,50)}{g.descripcion.length>50?'...':''}</span>}
                    </p>
                  </div>
                  {tieneMora && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">⚠️ mora</span>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{g.cuotas.length} cuota(s)</p>
                    <p className="font-bold text-blue-600">{fmt(totalG)}</p>
                  </div>
                  <span className="text-gray-400 text-lg">{abierto ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Cuotas */}
              {abierto && (
                <table className="w-full text-sm border-t min-w-[500px]">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                    <tr>
                      <th className="text-left px-5 py-2">Cuota</th>
                      <th className="text-left px-4 py-2">Vencimiento</th>
                      <th className="text-right px-4 py-2">Valor</th>
                      <th className="text-right px-4 py-2">Pagado</th>
                      <th className="text-right px-4 py-2">Pendiente</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.cuotas.map(c => (
                      <tr key={c.id} className={`hover:bg-gray-50 ${esMora(c)?'bg-red-50/50':''}`}>
                        <td className="px-5 py-2.5">
                          {g.tipo==='fiado'
                            ? <div>
                                <span className="font-medium text-green-700">Cuenta abierta</span>
                                {g.descripcion && <p className="text-xs text-gray-500 mt-0.5 max-w-xs">{g.descripcion}</p>}
                              </div>
                            : <span className="font-medium text-gray-600">#{c.numero_cuota}</span>
                          }
                        </td>
                        <td className="px-4 py-2.5">
                          {g.tipo==='fiado'
                            ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Sin fecha fija</span>
                            : <span className={esMora(c)?'text-red-600 font-semibold':esFutura(c)?'text-blue-500 text-xs':''}>
                                {new Date(c.fecha_vencimiento).toLocaleDateString('es-CO')}
                                {esMora(c)   && <span className="ml-1 text-xs bg-red-100 text-red-600 px-1 rounded">mora</span>}
                                {esFutura(c) && <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1 rounded">anticipado</span>}
                              </span>
                          }
                        </td>
                        <td className="px-4 py-2.5 text-right">{fmt(c.monto_cuota)}</td>
                        <td className="px-4 py-2.5 text-right text-green-600">{fmt(c.monto_pagado||0)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{fmt(pendiente(c))}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={()=>abrirModal(c)}
                            className="bg-primary-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-primary-700">
                            💳 Abonar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
            {gruposFiltrados.length===0 && (
              <div className="bg-white rounded-xl border p-10 text-center text-gray-400 text-sm">
                Sin resultados para "<strong>{buscar}</strong>"
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal pago */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-lg font-bold">
              {modal.tipo_producto==='fiado' ? '🌿 Abono fiado finca' : '💳 Registrar pago'}
            </h3>
            {modal.tipo_producto==='fiado' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
                Cuenta abierta sin interés — abona lo que pueda.
              </div>
            )}
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <p><span className="text-gray-500">Cliente:</span> <strong>{modal.nombre_cliente}</strong></p>
              {modal.tipo_producto!=='fiado' && <p><span className="text-gray-500">Cuota:</span> #{modal.numero_cuota}</p>}
              <p><span className="text-gray-500">Pendiente:</span> <strong className="text-blue-600">{fmt(pendiente(modal))}</strong></p>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div>
              <label className="text-xs font-medium text-gray-600">Monto a recibir</label>
              <input type="number" min="1" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none"
                value={monto} onChange={e=>setMonto(e.target.value)} />
              <button onClick={()=>setMonto(String(pendiente(modal)))}
                className="text-xs text-primary-600 hover:underline mt-1">
                Pagar total ({fmt(pendiente(modal))})
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Fecha del pago</label>
              <input type="date" max={hoy} min="2020-01-01"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={fechaPago}
                onChange={e => {
                  if (e.target.value > hoy) return // bloquear fecha futura
                  setFechaPago(e.target.value)
                }} />
              {fechaPago < hoy && (
                <p className="text-xs text-amber-600 mt-1">⚠️ Estás registrando con fecha anterior a hoy ({new Date(fechaPago+'T12:00').toLocaleDateString('es-CO')})</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Método de pago</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={metodo} onChange={e=>setMetodo(e.target.value)}>
                {['efectivo','transferencia','nequi','daviplata','otro'].map(m=>
                  <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Notas (opcional)</label>
              <input type="text" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={notas} onChange={e=>setNotas(e.target.value)} />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={()=>setModal(null)} className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={registrarPago} disabled={loading}
                className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {loading ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
