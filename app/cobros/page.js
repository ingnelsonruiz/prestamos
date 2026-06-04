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
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [modalWA, setModalWA]       = useState(null)
  const [copiado, setCopiado]       = useState(false)
  const [arqueo, setArqueo]         = useState(null)
  const [loadingArqueo, setLoadingArqueo] = useState(false)

  // Fecha local sin desfase UTC
  const hoy = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()

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
          telefono:       c.telefono_cliente,
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

  // Devuelve solo las cuotas que son relevantes para el filtro activo
  const cuotasParaMostrar = (cuotas) => {
    if (filtro === 'hoy')    return cuotas.filter(c => esMora(c) || c.fecha_vencimiento?.split('T')[0] === hoy)
    if (filtro === 'mora')   return cuotas.filter(c => esMora(c))
    if (filtro === 'semana') {
      const fin = new Date(hoy); fin.setDate(fin.getDate() + 7)
      const finStr = `${fin.getFullYear()}-${String(fin.getMonth()+1).padStart(2,'0')}-${String(fin.getDate()).padStart(2,'0')}`
      return cuotas.filter(c => { const fv = c.fecha_vencimiento?.split('T')[0]; return fv >= hoy && fv <= finStr })
    }
    if (filtro === 'rango') {
      return cuotas.filter(c => {
        const fv = c.fecha_vencimiento?.split('T')[0]
        if (fechaDesde && fv < fechaDesde) return false
        if (fechaHasta && fv > fechaHasta) return false
        return true
      })
    }
    return cuotas // "todas"
  }

  const gruposFiltrados = grupos.filter(g => {
    const q = buscar.toLowerCase()
    // Filtrar por búsqueda si hay texto
    if (q && !g.nombre_cliente?.toLowerCase().includes(q) && !g.descripcion?.toLowerCase().includes(q)) return false

    if (filtro === 'mora')   return g.cuotas.some(c => esMora(c))
    if (filtro === 'hoy')    return g.cuotas.some(c => esMora(c) || c.fecha_vencimiento?.split('T')[0] === hoy)
    if (filtro === 'semana') {
      const fin = new Date(hoy); fin.setDate(fin.getDate() + 7)
      const finStr = `${fin.getFullYear()}-${String(fin.getMonth()+1).padStart(2,'0')}-${String(fin.getDate()).padStart(2,'0')}`
      return g.cuotas.some(c => { const fv = c.fecha_vencimiento?.split('T')[0]; return fv >= hoy && fv <= finStr })
    }
    if (filtro === 'rango' && (fechaDesde || fechaHasta)) {
      return g.cuotas.some(c => {
        const fv = c.fecha_vencimiento?.split('T')[0]
        if (fechaDesde && fv < fechaDesde) return false
        if (fechaHasta && fv > fechaHasta) return false
        return true
      })
    }
    // "todas": mostrar siempre (el buscador filtra sobre lo visible)
    return true
  })

  const totalPendiente = gruposFiltrados.reduce((s,g) =>
    s + cuotasParaMostrar(g.cuotas).reduce((ss,c) => ss + pendiente(c), 0), 0)

  const abrirModal = c => {
    setModal(c); setMonto(String(pendiente(c)))
    setNotas(''); setFechaPago(hoy); setError('')
  }

  const abrirModalWA = (e, g) => {
    e.stopPropagation()
    const cuotasMora = g.cuotas.filter(c => esMora(c))
    const totalMora  = cuotasMora.reduce((s,c) => s + pendiente(c), 0)
    const totalTodo  = g.cuotas.reduce((s,c) => s + pendiente(c), 0)

    const lineasCuotas = cuotasMora.map(c => {
      const fv = new Date(c.fecha_vencimiento).toLocaleDateString('es-CO')
      const dias = Math.floor((new Date() - new Date(c.fecha_vencimiento)) / 86400000)
      return `  • Cuota #${c.numero_cuota} — Venció el ${fv} (${dias} día${dias !== 1 ? 's' : ''} de mora)\n    Valor pendiente: ${fmt(pendiente(c))}`
    }).join('\n')

    const mensaje =
`Hola *${g.nombre_cliente}* 👋,

Le contactamos de parte de *Inversiones Hnos Liñán* para informarle que tiene cuota(s) vencida(s):

${lineasCuotas}

💰 *Total en mora: ${fmt(totalMora)}*
📊 Saldo total del crédito: ${fmt(totalTodo)}

Le pedimos amablemente ponerse al día a la mayor brevedad posible.

Para cualquier acuerdo de pago comuníquese con nosotros. ¡Gracias! 🙏`

    setModalWA({ grupo: g, mensaje })
    setCopiado(false)
  }

  const copiarMensaje = () => {
    navigator.clipboard.writeText(modalWA.mensaje)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

  const cargarArqueo = async () => {
    setLoadingArqueo(true)
    const [dashRes, pagosRes] = await Promise.all([
      fetch('/api/dashboard').then(r => r.json()),
      fetch(`/api/pagos?fecha=${hoy}`).then(r => r.json()),
    ])
    // Total programado hoy = suma de cuotas que vencen hoy (pendiente + parcial)
    const programado = (dashRes.cuotas_hoy || []).reduce((s, c) =>
      s + (parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado || 0)), 0)
    // Pagos del día
    const pagosHoy = Array.isArray(pagosRes) ? pagosRes : []
    const cobrado  = pagosHoy.reduce((s, p) => s + parseFloat(p.monto), 0)
    // Desglose por método
    const porMetodo = pagosHoy.reduce((acc, p) => {
      const m = p.metodo_pago || 'efectivo'
      acc[m] = (acc[m] || 0) + parseFloat(p.monto)
      return acc
    }, {})
    setArqueo({ programado, cobrado, porMetodo, pagosHoy, cuotasHoy: dashRes.cuotas_hoy || [] })
    setLoadingArqueo(false)
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">Cobros</h2>
        <button onClick={() => { cargarArqueo(); }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 transition-colors shadow-sm">
          🧾 Arqueo del día
        </button>
      </div>

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
            // Si hay búsqueda, auto-abrir solo los que coinciden
            if (q.trim()) {
              const nuevosAbiertos = {}
              grupos.forEach(g => {
                if (g.nombre_cliente?.toLowerCase().includes(q.toLowerCase()) ||
                    g.descripcion?.toLowerCase().includes(q.toLowerCase())) {
                  nuevosAbiertos[g.producto_id] = true
                }
              })
              setAbiertos(nuevosAbiertos)
            }
            // Si se borra el texto, cerrar acordeones pero no ocultar la lista
          }} />
        <div className="flex gap-2 flex-wrap">
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
              <button onClick={()=>{
                setFiltro(k)
                // Auto-abrir acordeones para filtros distintos a "todas"
                if (k !== 'todas') {
                  const ab = {}
                  grupos.forEach(g => { ab[g.producto_id] = true })
                  setAbiertos(ab)
                } else {
                  setAbiertos({})
                }
              }}
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

          {/* Rango de fechas */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 font-medium">📅 Rango:</span>
            <input type="date" max={hoy}
              className="border rounded-lg px-2 py-1.5 text-sm"
              value={fechaDesde}
              onChange={e => { setFechaDesde(e.target.value); setFiltro('rango'); const ab={}; grupos.forEach(g=>{ab[g.producto_id]=true}); setAbiertos(ab) }} />
            <span className="text-xs text-gray-400">al</span>
            <input type="date" max={hoy}
              className="border rounded-lg px-2 py-1.5 text-sm"
              value={fechaHasta}
              onChange={e => { setFechaHasta(e.target.value); setFiltro('rango'); const ab={}; grupos.forEach(g=>{ab[g.producto_id]=true}); setAbiertos(ab) }} />
            {(fechaDesde||fechaHasta) && (
              <button onClick={()=>{setFechaDesde('');setFechaHasta('');setFiltro('todas');setAbiertos({})}}
                className="text-xs text-red-400 hover:text-red-600">✕ Limpiar</button>
            )}
          </div>
        </div>
      </div>

      {/* Contador de resultados */}
      {gruposFiltrados.length > 0 && (
        <p className="text-sm text-gray-500">
          {gruposFiltrados.length} crédito(s) —
          <span className="font-semibold text-blue-600 ml-1">{fmt(totalPendiente)} pendiente</span>
        </p>
      )}

      {/* Lista de cobros */}
      <div className="space-y-3">
        {gruposFiltrados.map(g => {
          const cuotasVista = cuotasParaMostrar(g.cuotas)
          const totalG      = cuotasVista.reduce((s,c) => s + pendiente(c), 0)
          const tieneMora   = g.cuotas.some(c => esMora(c))
          const abierto     = abiertos[g.producto_id]

          return (
            <div key={g.producto_id} className={`bg-white rounded-xl border overflow-x-auto ${tieneMora ? 'border-red-300' : ''}`}>
              {/* Cabecera acordeón */}
              <button onClick={() => toggle(g.producto_id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{tipoIcon[g.tipo] || '📄'}</span>
                  <div className="text-left">
                    <p className="font-semibold text-gray-800">{g.nombre_cliente}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <p className="text-xs text-gray-500">
                        {tipoLabel[g.tipo] || g.tipo}
                        {g.descripcion && <span className="ml-2 italic">— {g.descripcion.slice(0,40)}{g.descripcion.length > 40 ? '...' : ''}</span>}
                      </p>
                      {g.telefono
                        ? <a href={`tel:${g.telefono}`}
                             onClick={e => e.stopPropagation()}
                             className="flex items-center gap-2 text-base bg-green-100 text-green-700 px-4 py-1.5 rounded-full hover:bg-green-200 transition-colors font-semibold">
                            📞 {g.telefono}
                          </a>
                        : <span className="text-base bg-gray-100 text-gray-400 px-4 py-1.5 rounded-full font-medium">
                            📞 Sin teléfono
                          </span>
                      }
                    </div>
                  </div>
                  {tieneMora && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">⚠️ mora</span>
                      <button
                        onClick={e => abrirModalWA(e, g)}
                        className="flex items-center gap-1.5 bg-[#25D366] text-white text-sm px-3 py-1.5 rounded-full hover:bg-[#1ebe5d] transition-colors font-semibold shadow-sm">
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.558 4.122 1.532 5.856L.057 23.7a.75.75 0 00.918.919l5.98-1.527A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.694-.5-5.241-1.377l-.374-.216-3.893.995.982-3.81-.233-.386A9.956 9.956 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                        Cobro
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{cuotasVista.length} cuota(s)</p>
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
                    {cuotasVista.map(c => (
                      <tr key={c.id} className={`hover:bg-gray-50 ${esMora(c) ? 'bg-red-50/50' : ''}`}>
                        <td className="px-5 py-2.5">
                          {g.tipo === 'fiado'
                            ? <div>
                                <span className="font-medium text-green-700">Cuenta abierta</span>
                                {g.descripcion && <p className="text-xs text-gray-500 mt-0.5 max-w-xs">{g.descripcion}</p>}
                              </div>
                            : <span className="font-medium text-gray-600">#{c.numero_cuota}</span>
                          }
                        </td>
                        <td className="px-4 py-2.5">
                          {g.tipo === 'fiado'
                            ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Sin fecha fija</span>
                            : <span className={esMora(c) ? 'text-red-600 font-semibold' : esFutura(c) ? 'text-blue-500 text-xs' : ''}>
                                {new Date(c.fecha_vencimiento).toLocaleDateString('es-CO')}
                                {esMora(c)   && <span className="ml-1 text-xs bg-red-100 text-red-600 px-1 rounded">mora</span>}
                                {esFutura(c) && <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1 rounded">anticipado</span>}
                              </span>
                          }
                        </td>
                        <td className="px-4 py-2.5 text-right">{fmt(c.monto_cuota)}</td>
                        <td className="px-4 py-2.5 text-right text-green-600">{fmt(c.monto_pagado || 0)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{fmt(pendiente(c))}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => abrirModal(c)}
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

        {gruposFiltrados.length === 0 && grupos.length > 0 && (
          <div className="bg-white rounded-xl border p-10 text-center text-gray-400 text-sm">
            Sin resultados{buscar.trim() ? ` para "${buscar}"` : ' con el filtro seleccionado'}
          </div>
        )}

        {grupos.length === 0 && (
          <div className="bg-white rounded-xl border p-12 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="font-semibold text-gray-600">No hay cobros pendientes</p>
            <p className="text-sm text-gray-400 mt-1">Todas las cuotas están al día</p>
          </div>
        )}
      </div>

      {/* Modal Arqueo del día */}
      {(arqueo || loadingArqueo) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b bg-indigo-600 rounded-t-2xl">
              <div>
                <p className="font-bold text-white text-lg">🧾 Arqueo del día</p>
                <p className="text-indigo-200 text-xs">{new Date().toLocaleDateString('es-CO', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
              </div>
              <button onClick={() => setArqueo(null)} className="text-white/70 hover:text-white text-xl">✕</button>
            </div>

            {loadingArqueo
              ? <div className="flex items-center justify-center py-16 text-gray-400">Cargando arqueo...</div>
              : arqueo && (
                <div className="flex-1 overflow-y-auto">
                  {/* KPIs principales */}
                  <div className="grid grid-cols-3 divide-x border-b">
                    <div className="p-4 text-center">
                      <p className="text-xs text-gray-500 mb-1">📋 Programado hoy</p>
                      <p className="text-lg font-bold text-gray-800">{fmt(arqueo.programado)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{arqueo.cuotasHoy.length} cuota(s)</p>
                    </div>
                    <div className="p-4 text-center">
                      <p className="text-xs text-gray-500 mb-1">✅ Cobrado hoy</p>
                      <p className="text-lg font-bold text-green-600">{fmt(arqueo.cobrado)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{arqueo.pagosHoy.length} pago(s)</p>
                    </div>
                    <div className="p-4 text-center">
                      <p className="text-xs text-gray-500 mb-1">⏳ Por cobrar</p>
                      <p className={`text-lg font-bold ${arqueo.programado - arqueo.cobrado > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {fmt(Math.max(0, arqueo.programado - arqueo.cobrado))}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {arqueo.programado > 0 ? Math.round((arqueo.cobrado / arqueo.programado) * 100) : 100}% cumplido
                      </p>
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div className="px-5 py-3 border-b">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Avance del día</span>
                      <span className="font-semibold">{arqueo.programado > 0 ? Math.round((arqueo.cobrado / arqueo.programado) * 100) : 100}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div className="bg-green-500 h-3 rounded-full transition-all"
                        style={{ width: `${Math.min(100, arqueo.programado > 0 ? (arqueo.cobrado / arqueo.programado) * 100 : 100)}%` }} />
                    </div>
                  </div>

                  {/* Desglose por método de pago */}
                  {Object.keys(arqueo.porMetodo).length > 0 && (
                    <div className="px-5 py-3 border-b">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">💳 Por método de pago</p>
                      <div className="space-y-1.5">
                        {Object.entries(arqueo.porMetodo).map(([metodo, total]) => (
                          <div key={metodo} className="flex justify-between items-center">
                            <span className="text-sm capitalize text-gray-700">{metodo}</span>
                            <span className="text-sm font-semibold text-gray-800">{fmt(total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lista de pagos del día */}
                  <div className="px-5 py-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">📜 Pagos registrados hoy</p>
                    {arqueo.pagosHoy.length === 0
                      ? <p className="text-sm text-gray-400 text-center py-4">Aún no hay pagos registrados hoy</p>
                      : <div className="space-y-2">
                          {arqueo.pagosHoy.map(p => (
                            <div key={p.id} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                              <div>
                                <p className="text-sm font-medium text-gray-800">{p.nombre_cliente}</p>
                                <p className="text-xs text-gray-400">{p.numero_recibo} · Cuota #{p.numero_cuota} · {p.metodo_pago}</p>
                              </div>
                              <p className="text-sm font-bold text-green-600">+{fmt(p.monto)}</p>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* Modal WhatsApp */}
      {modalWA && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                <span className="text-2xl">📲</span>
                <div>
                  <p className="font-bold text-gray-800">Mensaje de cobro</p>
                  <p className="text-xs text-gray-500">{modalWA.grupo.nombre_cliente}</p>
                </div>
              </div>
              <button onClick={() => setModalWA(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Vista previa burbuja WhatsApp */}
            <div className="flex-1 overflow-y-auto p-4 bg-[#e5ddd5]" style={{backgroundImage:"url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH4wEECBMFEn+W3gAAABl0RVh0Q29tbWVudABDcmVhdGVkIHdpdGggR0lNUFeBDhcAAAAeSURBVDjLY2AYBaNgFAx9wMDAwMDw//9/BgYGBgAIMAQAcOatigAAAABJRU5ErkJggg==\")"}}>
              <div className="flex justify-end">
                <div className="bg-[#dcf8c6] rounded-2xl rounded-tr-sm px-4 py-3 max-w-xs shadow-sm">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{modalWA.mensaje}</pre>
                  <p className="text-right text-xs text-gray-400 mt-1">✓✓</p>
                </div>
              </div>
            </div>

            {/* Acciones */}
            <div className="px-5 py-4 border-t space-y-3">
              <button onClick={copiarMensaje}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all
                  ${copiado ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {copiado ? '✅ ¡Copiado!' : '📋 Copiar mensaje'}
              </button>

              {modalWA.grupo.telefono && (
                <a href={`https://wa.me/57${modalWA.grupo.telefono.replace(/\D/g,'')}?text=${encodeURIComponent(modalWA.mensaje)}`}
                   target="_blank" rel="noreferrer"
                   className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#1ebe5d] transition-colors">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.558 4.122 1.532 5.856L.057 23.7a.75.75 0 00.918.919l5.98-1.527A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.694-.5-5.241-1.377l-.374-.216-3.893.995.982-3.81-.233-.386A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                  Abrir en WhatsApp
                </a>
              )}

              {!modalWA.grupo.telefono && (
                <p className="text-center text-xs text-amber-600 bg-amber-50 rounded-lg py-2">
                  ⚠️ Este cliente no tiene teléfono registrado. Copia el mensaje manualmente.
                </p>
              )}
            </div>
          </div>
        </div>
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
