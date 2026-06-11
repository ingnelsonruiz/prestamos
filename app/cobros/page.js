'use client'
import { useEffect, useState } from 'react'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)

const tipoIcon  = { prestamo:'💰', venta:'🛍', empeno:'🔒', fiado:'🌿', adelanto:'🤝' }
const tipoLabel = { prestamo:'Préstamo', venta:'Venta crédito', empeno:'Empeño', fiado:'Fiado finca', adelanto:'Adelanto' }

export default function CobrosPage() {
  const [grupos, setGrupos]   = useState([])   // agrupado por producto
  const [abiertos, setAbiertos] = useState({}) // acordeón
  const [buscar, setBuscar]   = useState('')
  const [filtro, setFiltro]   = useState('todas')
  const [modal, setModal]     = useState(null)
  const [monto, setMonto]     = useState('')
  const [tipoPago, setTipoPago] = useState('completo') // 'completo' | 'solo_interes' | 'abono_capital' | 'personalizado'
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
  const [historialPagos, setHistorialPagos] = useState({})  // keyed by producto_id
  const [alertaRefinanciar, setAlertaRefinanciar] = useState(null) // { productoId, capitalPendiente, nombreCliente }

  // Fecha local sin desfase UTC
  const hoy = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()

  const cargar = async () => {
    const [pend, parc] = await Promise.all([
      fetch('/api/cuotas?estado=pendiente').then(r=>r.json()).then(d=>Array.isArray(d)?d:[]),
      fetch('/api/cuotas?estado=parcial').then(r=>r.json()).then(d=>Array.isArray(d)?d:[]),
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
          fecha_prestamo: c.fecha_prestamo,
          capital:        c.capital_producto,
          referencia:     c.referencia_producto,
          num_cuotas:     c.num_cuotas_producto,
          cuotas: []
        }
      }
      map[c.producto_id].cuotas.push(c)
    })
    setGrupos(Object.values(map).sort((a,b) =>
      new Date(b.fecha_prestamo) - new Date(a.fecha_prestamo)
    ))
    setAbiertos({})         // cerrado por defecto
    setHistorialPagos({})   // limpiar historial para forzar re-fetch
  }

  useEffect(() => { cargar() }, [])

  const fetchHistorial = id => {
    fetch(`/api/historial?producto_id=${id}`)
      .then(r => r.json())
      .then(data => {
        setHistorialPagos(h => ({
          ...h,
          [id]: {
            recalculos:  Array.isArray(data.recalculos)  ? data.recalculos  : [],
            pagos:       Array.isArray(data.pagos)       ? data.pagos       : [],
            cuotasTodas: Array.isArray(data.cuotasTodas) ? data.cuotasTodas : [],
          }
        }))
      })
      .catch(() => {
        // En caso de error de red, dejar arrays vacíos para no quedar en "Cargando..."
        setHistorialPagos(h => ({
          ...h,
          [id]: { recalculos: [], pagos: [], cuotasTodas: [] }
        }))
      })
  }

  const toggle = id => {
    setAbiertos(a => {
      const abierto = !a[id]
      if (abierto && !historialPagos[id]) fetchHistorial(id)
      return { ...a, [id]: abierto }
    })
  }

  const esFutura = c => c.fecha_vencimiento?.split('T')[0] > hoy
  const esMora   = c => c.fecha_vencimiento?.split('T')[0] < hoy
  const pendiente = c => parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado||0)

  // Desglose pendiente de una cuota: el pago se aplica primero a intereses
  const interesBase    = c => parseFloat(c.abono_interes || 0)
  const capitalBase    = c => parseFloat(c.abono_capital || 0)
  const yaPagado       = c => parseFloat(c.monto_pagado  || 0)
  const interesPend    = c => Math.max(0, interesBase(c) - yaPagado(c))
  const capitalPend    = c => Math.max(0, capitalBase(c) - Math.max(0, yaPagado(c) - interesBase(c)))

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

  const abrirModal = (c, montoInicial) => {
    setModal(c)
    setTipoPago('completo')
    setMonto(montoInicial !== undefined ? String(montoInicial) : String(pendiente(c)))
    setNotas(''); setFechaPago(hoy); setError('')
  }

  // Seleccionar tipo de pago y pre-cargar monto
  const seleccionarTipo = (tipo, cuota) => {
    setTipoPago(tipo)
    setError('')
    if (tipo === 'completo')      setMonto(String(pendiente(cuota)))
    if (tipo === 'solo_interes')  setMonto(String(interesPend(cuota)))
    if (tipo === 'abono_capital') setMonto(String(capitalPend(cuota)))
    if (tipo === 'personalizado') setMonto('')
    if (tipo === 'recoger_credito') {
      const grupo = grupos.find(g => g.producto_id === cuota.producto_id)
      const totalCapital = grupo ? grupo.cuotas.reduce((s, c) => s + capitalPend(c), 0) : capitalPend(cuota)
      setMonto(String(interesPend(cuota) + totalCapital))
    }
  }

  // Abre el modal con la PRIMERA cuota pendiente y el total del crédito
  const abrirModalTodo = (g) => {
    const primera = g.cuotas[0]
    if (!primera) return
    const totalG = g.cuotas.reduce((s, c) => s + pendiente(c), 0)
    abrirModal(primera, totalG)
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
    // Prefijo automático según tipo para historial
    const prefijos = {
      solo_interes:    '💸 Solo intereses — ',
      abono_capital:   '💰 Abono a capital — ',
      personalizado:   '✏️ Monto personalizado — ',
      recoger_credito: '🏁 Recoger crédito — ',
    }
    const notaFinal = (prefijos[tipoPago] || '') + (notas || '')
    setLoading(true); setError('')
    const res = await fetch('/api/pagos', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ cuota_id: modal.id, monto: montoNum, metodo_pago: metodo, notas: notaFinal.trim() || null, fecha_pago: fechaPago })
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    const nombreCliente = modal.nombre_cliente
    const productoId    = modal.producto_id
    setRecibo(data.numero_recibo)
    setModal(null)

    // Recarga solo el grupo afectado — no toda la lista
    const [pend, parc] = await Promise.all([
      fetch(`/api/cuotas?estado=pendiente&producto_id=${productoId}`).then(r=>r.json()).then(d=>Array.isArray(d)?d:[]),
      fetch(`/api/cuotas?estado=parcial&producto_id=${productoId}`).then(r=>r.json()).then(d=>Array.isArray(d)?d:[]),
    ])
    const cuotasActivas = [...pend, ...parc].sort((a,b) =>
      new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento)
    )
    setGrupos(prev => {
      if (cuotasActivas.length === 0) {
        // Crédito saldado → quitar el grupo de la lista
        return prev.filter(g => g.producto_id !== productoId)
      }
      // Actualizar solo las cuotas de este grupo
      return prev.map(g => g.producto_id !== productoId ? g : { ...g, cuotas: cuotasActivas })
    })
    // Re-fetch inmediato del historial: el acordeón puede seguir abierto
    // (antes solo se borraba y quedaba "Cargando historial..." indefinido)
    setHistorialPagos(h => { const n = { ...h }; delete n[productoId]; return n })
    fetchHistorial(productoId)
    if (data.requiere_refinanciacion && data.capital_pendiente > 0) {
      setAlertaRefinanciar({ productoId, capitalPendiente: data.capital_pendiente, nombreCliente })
    }
  }

  return (
    <div className="flex gap-4 items-start">
    {/* ── Columna principal ─────────────────────────────────────────────── */}
    <div className="flex-1 min-w-0 space-y-5">
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
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">📅 Rango:</span>
            <div className="flex items-center gap-2">
              <input type="date" max={hoy}
                className="border rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0"
                value={fechaDesde}
                onChange={e => { setFechaDesde(e.target.value); setFiltro('rango'); const ab={}; grupos.forEach(g=>{ab[g.producto_id]=true}); setAbiertos(ab) }} />
              <span className="text-xs text-gray-400 flex-shrink-0">al</span>
              <input type="date" max={hoy}
                className="border rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0"
                value={fechaHasta}
                onChange={e => { setFechaHasta(e.target.value); setFiltro('rango'); const ab={}; grupos.forEach(g=>{ab[g.producto_id]=true}); setAbiertos(ab) }} />
              {(fechaDesde||fechaHasta) && (
                <button onClick={()=>{setFechaDesde('');setFechaHasta('');setFiltro('todas');setAbiertos({})}}
                  className="text-xs text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
              )}
            </div>
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
            <div key={g.producto_id} className={`bg-white rounded-xl border ${tieneMora ? 'border-red-300' : ''}`}>
              {/* Cabecera acordeón */}
              <div onClick={() => toggle(g.producto_id)}
                role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && toggle(g.producto_id)}
                className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition-colors cursor-pointer">

                {/* Izquierda: icono + info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-3xl flex-shrink-0">{tipoIcon[g.tipo] || '📄'}</span>
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-base font-bold text-gray-900 leading-tight truncate">{g.nombre_cliente}</p>
                    <p className="text-sm font-semibold text-gray-700 mt-0.5">
                      {tipoLabel[g.tipo] || g.tipo}
                      {g.descripcion && <span className="font-normal text-gray-500"> — {g.descripcion.slice(0,30)}{g.descripcion.length > 30 ? '…' : ''}</span>}
                    </p>
                    {/* Chips de estado — en móvil solo mora y teléfono */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {g.telefono
                        ? <a href={`tel:${g.telefono}`} onClick={e => e.stopPropagation()}
                             className="flex items-center gap-1 text-xs font-bold bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full">
                            📞 {g.telefono}
                          </a>
                        : null
                      }
                      {tieneMora && (
                        <>
                          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">⚠️ mora</span>
                          <button onClick={e => abrirModalWA(e, g)}
                            className="flex items-center gap-1 bg-[#25D366] text-white text-xs px-2.5 py-0.5 rounded-full font-bold">
                            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.558 4.122 1.532 5.856L.057 23.7a.75.75 0 00.918.919l5.98-1.527A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.694-.5-5.241-1.377l-.374-.216-3.893.995.982-3.81-.233-.386A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                            WA
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Derecha: monto + botón pagar todo + flecha */}
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{cuotasVista.length} cuota(s)</p>
                    <p className="text-lg font-black text-blue-600">{fmt(totalG)}</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); abrirModalTodo(g) }}
                    className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-2.5 rounded-lg transition-colors whitespace-nowrap shadow-sm">
                    💰 Pagar
                  </button>
                  <span className="text-gray-400 text-lg">{abierto ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Cuotas */}
              {abierto && (
                <div className="border-t">

                  {/* ── Vista móvil: tarjetas ── */}
                  <div className="lg:hidden divide-y divide-gray-100">
                    {cuotasVista.map(c => (
                      <div key={c.id} className={`px-4 py-3 ${esMora(c) ? 'bg-red-50/40' : ''}`}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            {g.tipo === 'fiado'
                              ? <p className="text-sm font-semibold text-green-700">Cuenta abierta</p>
                              : <p className="text-sm font-semibold text-gray-700">Cuota #{c.numero_cuota}</p>
                            }
                            {g.tipo !== 'fiado' && (
                              <p className={`text-xs mt-0.5 ${esMora(c) ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                                📅 {new Date(c.fecha_vencimiento).toLocaleDateString('es-CO')}
                                {esMora(c) && ' · ⚠️ mora'}
                                {esFutura(c) && ' · anticipado'}
                              </p>
                            )}
                          </div>
                          {(() => {
                              const esUltima = cuotasVista.length === 1 && parseFloat(c.abono_capital || 0) > 0
                              return esUltima
                                ? <a href={`/prestamos/${g.producto_id}`}
                                    className="bg-purple-600 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap flex-shrink-0 text-center">
                                    🔄 Refinanciar
                                  </a>
                                : <button onClick={() => abrirModal(c)}
                                    className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap flex-shrink-0">
                                    💳 Abonar
                                  </button>
                            })()}
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                          <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <p className="text-gray-400">Valor</p>
                            <p className="font-bold text-gray-800">{fmt(c.monto_cuota)}</p>
                          </div>
                          <div className="bg-green-50 rounded-lg p-2 text-center">
                            <p className="text-gray-400">Pagado</p>
                            <p className="font-bold text-green-700">{fmt(c.monto_pagado || 0)}</p>
                          </div>
                          <div className="bg-blue-50 rounded-lg p-2 text-center">
                            <p className="text-gray-400">Pendiente</p>
                            <p className="font-bold text-blue-700">{fmt(pendiente(c))}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {/* Total móvil */}
                    <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-500 uppercase">
                        Total {cuotasVista.length} cuota{cuotasVista.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-base font-black text-blue-700">
                        {fmt(cuotasVista.reduce((s,c) => s + pendiente(c), 0))}
                      </span>
                    </div>
                  </div>

                  {/* ── Vista desktop: tabla ── */}
                  <table className="hidden lg:table w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                      <tr>
                        <th className="text-left px-5 py-2">Cuota</th>
                        <th className="text-left px-4 py-2">Vencimiento</th>
                        <th className="text-right px-4 py-2">Capital</th>
                        <th className="text-right px-4 py-2">Interés</th>
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
                              ? <span className="font-medium text-green-700">Cuenta abierta</span>
                              : <span className="font-medium text-gray-600">#{c.numero_cuota}</span>
                            }
                            {/* Badge: esta cuota tuvo abono a capital */}
                            {parseFloat(c.monto_pagado||0) > parseFloat(c.abono_interes||0) + 0.5 && (
                              <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                💰 abono capital
                              </span>
                            )}
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
                          <td className="px-4 py-2.5 text-right text-blue-700">{fmt(c.abono_capital || 0)}</td>
                          <td className="px-4 py-2.5 text-right text-orange-500">{fmt(c.abono_interes || 0)}</td>
                          <td className="px-4 py-2.5 text-right font-medium">{fmt(c.monto_cuota)}</td>
                          <td className="px-4 py-2.5 text-right text-green-600">{fmt(c.monto_pagado || 0)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-red-600">{fmt(pendiente(c))}</td>
                          <td className="px-4 py-2.5 text-right">
                            {(() => {
                              const esUltima = cuotasVista.length === 1 && parseFloat(c.abono_capital || 0) > 0
                              return esUltima
                                ? <a href={`/prestamos/${g.producto_id}`}
                                    className="bg-purple-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-purple-700 whitespace-nowrap">
                                    🔄 Refinanciar crédito
                                  </a>
                                : <button onClick={() => abrirModal(c)}
                                    className="bg-primary-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-primary-700">
                                    💳 Abonar
                                  </button>
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                      <tr>
                        <td colSpan={2} className="px-5 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide">
                          Total ({cuotasVista.length} cuota{cuotasVista.length !== 1 ? 's' : ''})
                        </td>
                        <td className="px-4 py-2.5 text-right font-black text-blue-700">
                          {fmt(cuotasVista.reduce((s,c) => s + parseFloat(c.abono_capital || 0), 0))}
                        </td>
                        <td className="px-4 py-2.5 text-right font-black text-orange-500">
                          {fmt(cuotasVista.reduce((s,c) => s + parseFloat(c.abono_interes || 0), 0))}
                        </td>
                        <td className="px-4 py-2.5 text-right font-black text-gray-800">
                          {fmt(cuotasVista.reduce((s,c) => s + parseFloat(c.monto_cuota), 0))}
                        </td>
                        <td className="px-4 py-2.5 text-right font-black text-green-700">
                          {fmt(cuotasVista.reduce((s,c) => s + parseFloat(c.monto_pagado || 0), 0))}
                        </td>
                        <td className="px-4 py-2.5 text-right font-black text-red-600">
                          {fmt(cuotasVista.reduce((s,c) => s + pendiente(c), 0))}
                        </td>
                        <td className="px-4 py-2.5"></td>
                      </tr>
                    </tfoot>
                  </table>

                  {/* ── Historial del crédito ── */}
                  {(() => {
                    const data = historialPagos[g.producto_id]
                    if (!data) return (
                      <div className="px-5 py-3 text-xs text-gray-400 flex items-center gap-2 border-t bg-slate-50">
                        <span className="animate-spin inline-block">⏳</span> Cargando historial...
                      </div>
                    )

                    const { recalculos, pagos, cuotasTodas } = data

                    // Totales para el pie de la tabla de recibos
                    // Usa monto_interes/monto_capital guardados en el pago (exactos, pre-recálculo)
                    const totalCapitalCobrado = pagos.reduce((s, p) => s + parseFloat(p.monto_capital || 0), 0)
                    const totalInteresCobrado = pagos.reduce((s, p) => s + parseFloat(p.monto_interes || 0), 0)
                    const totalCobrado = pagos.reduce((s,p) => s + parseFloat(p.monto), 0)

                    // Cuotas pendientes para "estado actual" cuando no hay historial
                    const cuotasPendientes = cuotasTodas.filter(c => c.estado !== 'pagada')
                    const capitalOriginal  = parseFloat(g.capital || 0)
                    const saldoCapitalActual = Math.max(0, capitalOriginal - totalCapitalCobrado)

                    // Abonos de capital registrados en el historial
                    const abonosCapital = recalculos.filter(r => r.tipo === 'recalculo_capital')
                    const creacionSnap  = recalculos.find(r => r.tipo === 'creacion')
                    const huboAbonoCapital = abonosCapital.length > 0 || totalCapitalCobrado > 1

                    // Fallback (créditos sin historial — datos anteriores a esta versión)
                    const numCuotasTotal   = cuotasTodas.length
                    const cuotasPagadas    = cuotasTodas.filter(c => c.estado === 'pagada')
                    const interesOrigFallback = numCuotasTotal > 0
                      ? (cuotasPagadas.length > 0
                        ? Math.round((cuotasPagadas.reduce((s,c) => s + parseFloat(c.abono_interes||0), 0) / cuotasPagadas.length) * numCuotasTotal)
                        : cuotasTodas.reduce((s,c) => s + parseFloat(c.abono_interes||0), 0))
                      : 0

                    // Ordenar de primero a último: cuota #1 → #N
                    const pagosOrdenados = [...pagos].sort((a, b) =>
                      parseInt(a.numero_cuota) - parseInt(b.numero_cuota) ||
                      (a.numero_recibo || '').localeCompare(b.numero_recibo || '')
                    )

                    return (
                      <div className="border-t bg-slate-50">

                        {/* ─── Timeline de snapshots ─── */}
                        <div className="px-5 pt-4 pb-2 space-y-3">

                          {/* ── Creación del crédito ── */}
                          {creacionSnap ? (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2 flex items-center justify-between">
                                <span>📋 Crédito creado</span>
                                <span className="text-blue-400 font-normal normal-case">
                                  {new Date(creacionSnap.fecha).toLocaleDateString('es-CO', {day:'2-digit',month:'short',year:'numeric'})}
                                </span>
                              </p>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <p className="text-gray-400">Capital</p>
                                  <p className="font-bold text-blue-800">{fmt(parseFloat(creacionSnap.capital_original))}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">{creacionSnap.num_cuotas_total} cuota{creacionSnap.num_cuotas_total!==1?'s':''} de</p>
                                  <p className="font-bold text-blue-800">~{fmt(parseFloat(creacionSnap.monto_cuota_despues))}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Total proyectado</p>
                                  <p className="font-bold text-blue-900">{fmt(parseFloat(creacionSnap.total_pendiente_despues))}</p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* Fallback para créditos sin historial */
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">
                                📋 Pactado originalmente <span className="text-blue-400 font-normal">(estimado)</span>
                              </p>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <p className="text-gray-400">Capital</p>
                                  <p className="font-bold text-blue-800">{fmt(capitalOriginal)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">{numCuotasTotal} cuota{numCuotasTotal!==1?'s':''} de</p>
                                  <p className="font-bold text-blue-800">~{fmt(numCuotasTotal > 0 ? Math.round((capitalOriginal + interesOrigFallback) / numCuotasTotal) : 0)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Total proyectado</p>
                                  <p className="font-bold text-blue-900">{fmt(capitalOriginal + interesOrigFallback)}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* ── Abonos a capital (uno por uno) ── */}
                          {abonosCapital.map((r, idx) => (
                            <div key={r.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2 flex items-center justify-between">
                                <span>💰 Abono a capital #{idx + 1} — {r.numero_recibo || '—'}</span>
                                <span className="text-amber-400 font-normal normal-case">
                                  {new Date(r.fecha).toLocaleDateString('es-CO', {day:'2-digit',month:'short',year:'numeric'})}
                                </span>
                              </p>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {/* Antes */}
                                <div className="bg-white/60 rounded p-2 border border-amber-100">
                                  <p className="font-semibold text-gray-500 mb-1">Antes del abono</p>
                                  <div className="space-y-0.5">
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Saldo capital</span>
                                      <span className="font-semibold text-red-600">{fmt(parseFloat(r.capital_saldo_antes))}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Cuota</span>
                                      <span className="font-semibold text-gray-700">{fmt(parseFloat(r.monto_cuota_antes))}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Pend. total</span>
                                      <span className="font-semibold text-gray-800">{fmt(parseFloat(r.total_pendiente_antes))}</span>
                                    </div>
                                  </div>
                                </div>
                                {/* Después */}
                                <div className="bg-white/60 rounded p-2 border border-amber-100">
                                  <p className="font-semibold text-amber-700 mb-1">Después — abonó {fmt(parseFloat(r.capital_abonado))}</p>
                                  <div className="space-y-0.5">
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Saldo capital</span>
                                      <span className="font-semibold text-green-700">{fmt(parseFloat(r.capital_saldo_despues))}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Nueva cuota</span>
                                      <span className="font-semibold text-gray-700">{fmt(parseFloat(r.monto_cuota_despues))}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Nuevo total</span>
                                      <span className="font-semibold text-amber-900">{fmt(parseFloat(r.total_pendiente_despues))}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}

                          {/* ── Estado actual (si no hay historial de abonos, o si lo hay) ── */}
                          {abonosCapital.length === 0 && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">📊 Estado actual</p>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <p className="text-gray-400">Saldo capital</p>
                                  <p className="font-bold text-red-600">{fmt(saldoCapitalActual)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">{cuotasPendientes.length} cuota{cuotasPendientes.length!==1?'s':''} pend.</p>
                                  <p className="font-bold text-gray-700">
                                    ~{fmt(cuotasPendientes.length > 0 ? parseFloat(cuotasPendientes[0].monto_cuota||0) : 0)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Por cobrar</p>
                                  <p className="font-bold text-green-900">
                                    {fmt(cuotasPendientes.reduce((s,c) => s + parseFloat(c.monto_cuota||0) - parseFloat(c.monto_pagado||0), 0))}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Banner resumen si hubo abonos */}
                          {huboAbonoCapital && abonosCapital.length > 0 && (
                            <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5 text-xs text-amber-900 leading-relaxed">
                              ⚠️ {abonosCapital.length} abono{abonosCapital.length!==1?'s':''} a capital por <strong>{fmt(totalCapitalCobrado)}</strong> en total.
                              Saldo capital vigente: <strong>{fmt(saldoCapitalActual)}</strong>.
                              Las cuotas pendientes <strong>fueron recalculadas</strong> con interés sobre el nuevo saldo.
                            </div>
                          )}
                        </div>

                        {/* ─── Tabla de recibos: del primero al último ─── */}
                        <div className="px-5 pb-3">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                            🧾 Recibos — del primero al último ({pagosOrdenados.length})
                          </p>

                          {pagosOrdenados.length === 0 ? (
                            <p className="text-xs text-gray-400 py-2">Sin pagos registrados aún.</p>
                          ) : (
                            <>
                              {/* Desktop */}
                              {(() => {
                                // Desglose interés/capital — usa valores guardados en el pago
                                // (calculados antes del recálculo, por eso son exactos)
                                const breakdown = (p) => ({
                                  interes: parseFloat(p.monto_interes || 0),
                                  capital: parseFloat(p.monto_capital || 0),
                                })
                                // Descripción amigable sin el prefijo emoji
                                const desc = (p) => {
                                  if (!p.notas) return null
                                  // Quitar prefijos automáticos para mostrar solo la nota del cobrador
                                  return p.notas
                                    .replace(/^💸 Solo intereses — ?/, '')
                                    .replace(/^💰 Abono a capital — ?/, '')
                                    .replace(/^✏️ Monto personalizado — ?/, '')
                                    .replace(/^✅ Cuota completa — ?/, '')
                                    .trim() || null
                                }
                                return (
                                  <table className="hidden lg:table w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
                                    <thead className="bg-gray-100 text-gray-500 uppercase">
                                      <tr>
                                        <th className="text-center px-2 py-2 w-7">#</th>
                                        <th className="text-left px-3 py-2">Recibo</th>
                                        <th className="text-left px-3 py-2">Fecha</th>
                                        <th className="text-left px-2 py-2">Método</th>
                                        <th className="text-left px-3 py-2">Tipo de pago</th>
                                        <th className="text-right px-3 py-2">Interés</th>
                                        <th className="text-right px-3 py-2">Capital</th>
                                        <th className="text-right px-4 py-2">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                      {pagosOrdenados.map((p, i) => {
                                        const bd = breakdown(p)
                                        const tieneCapital = bd.capital > 1
                                        const nota = desc(p)
                                        return (
                                          <tr key={p.id} className={`hover:bg-slate-50 ${tieneCapital ? 'bg-blue-50/40' : ''}`}>
                                            <td className="px-2 py-2 text-center text-gray-400 font-mono">{i+1}</td>
                                            <td className="px-3 py-2 font-mono text-gray-500">{p.numero_recibo}</td>
                                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                              {new Date(p.fecha_pago).toLocaleDateString('es-CO', {day:'2-digit', month:'short', year:'numeric'})}
                                            </td>
                                            <td className="px-2 py-2">
                                              <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded capitalize">{p.metodo_pago}</span>
                                            </td>
                                            <td className="px-3 py-2">
                                              {/* Tipo de pago + nota extra si hay */}
                                              <div>
                                                {p.notas?.includes('💸 Solo intereses') && (
                                                  <span className="text-orange-600 font-medium">💸 Solo intereses</span>
                                                )}
                                                {p.notas?.includes('💰 Abono a capital') && (
                                                  <span className="text-blue-700 font-medium">💰 Abono a capital</span>
                                                )}
                                                {p.notas?.includes('✏️ Monto personalizado') && (
                                                  <span className={`font-medium ${tieneCapital ? 'text-blue-700' : 'text-gray-600'}`}>
                                                    {tieneCapital ? '💰 Personalizado c/ capital' : '✏️ Monto personalizado'}
                                                  </span>
                                                )}
                                                {!p.notas?.includes('💸') && !p.notas?.includes('💰') && !p.notas?.includes('✏️') && (
                                                  <span className="text-green-700 font-medium">✅ Cuota completa</span>
                                                )}
                                                {nota && (
                                                  <p className="text-gray-400 text-xs mt-0.5 truncate max-w-[160px]">{nota}</p>
                                                )}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-right text-orange-600 font-semibold">
                                              {bd.interes > 0 ? fmt(bd.interes) : <span className="text-gray-300">—</span>}
                                            </td>
                                            <td className="px-3 py-2 text-right font-semibold">
                                              {tieneCapital
                                                ? <span className="text-blue-700">{fmt(bd.capital)}</span>
                                                : <span className="text-gray-300">—</span>}
                                            </td>
                                            <td className="px-4 py-2 text-right font-bold text-green-700">{fmt(p.monto)}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                    <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                                      <tr>
                                        <td colSpan={4} className="px-3 py-2 text-xs font-bold text-gray-500 uppercase">
                                          Total ({pagosOrdenados.length} recibo{pagosOrdenados.length!==1?'s':''})
                                        </td>
                                        <td className="px-3 py-2"></td>
                                        <td className="px-3 py-2 text-right font-black text-orange-600">{fmt(totalInteresCobrado)}</td>
                                        <td className="px-3 py-2 text-right font-black text-blue-700">{fmt(totalCapitalCobrado)}</td>
                                        <td className="px-4 py-2 text-right font-black text-green-700">{fmt(totalCobrado)}</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                )
                              })()}

                              {/* Móvil */}
                              <div className="lg:hidden space-y-2">
                                {pagosOrdenados.map((p, i) => {
                                  const intPart = parseFloat(p.monto_interes || 0)
                                  const capPart = parseFloat(p.monto_capital || 0)
                                  return (
                                    <div key={p.id} className={`border rounded-lg px-3 py-2 ${capPart > 1 ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100'}`}>
                                      <div className="flex justify-between items-start gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs text-gray-400 font-mono">#{i+1}</span>
                                          <span className="text-xs font-mono text-gray-500">{p.numero_recibo}</span>
                                          <span className="text-xs text-gray-400">{new Date(p.fecha_pago).toLocaleDateString('es-CO')}</span>
                                        </div>
                                        <p className="text-sm font-bold text-green-700 flex-shrink-0">{fmt(p.monto)}</p>
                                      </div>
                                      <div className="flex gap-3 mt-1 text-xs">
                                        <span className="text-orange-600">💸 Int: {fmt(intPart)}</span>
                                        <span className={capPart > 1 ? 'text-blue-700 font-semibold' : 'text-gray-300'}>💰 Cap: {fmt(capPart)}</span>
                                      </div>
                                    </div>
                                  )
                                })}
                                <div className="flex justify-between text-xs font-bold px-1 pt-1 border-t border-gray-200">
                                  <span className="text-gray-500">Total cobrado</span>
                                  <span className="text-green-700">{fmt(totalCobrado)}</span>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                </div>
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
    </div>{/* fin columna principal */}

    {/* ── Panel lateral de pago (sticky, no solapa la tabla) ───────────── */}
    {modal && (
      <div className="w-80 flex-shrink-0 sticky top-4 self-start">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Cabecera */}
          <div className="flex items-center justify-between px-5 py-3 bg-primary-600 text-white">
            <h3 className="text-sm font-bold">
              {modal.tipo_producto === 'fiado' ? '🌿 Abono fiado' : '💳 Registrar pago'}
            </h3>
            <button onClick={() => setModal(null)} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
          </div>

          <div className="p-4 space-y-3 max-h-[calc(100vh-120px)] overflow-y-auto">
            {/* Info cliente + desglose */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <p><span className="text-gray-500">Cliente:</span> <strong>{modal.nombre_cliente}</strong></p>
              {modal.tipo_producto !== 'fiado' && (
                <p><span className="text-gray-500">Cuota #:</span> {modal.numero_cuota}</p>
              )}
              {modal.tipo_producto !== 'fiado' && modal.tipo_producto !== 'adelanto' && interesBase(modal) > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-3 gap-1 text-center">
                  <div>
                    <p className="text-xs text-gray-400">Interés</p>
                    <p className="font-semibold text-orange-500 text-xs">{fmt(interesPend(modal))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Capital</p>
                    <p className="font-semibold text-blue-600 text-xs">{fmt(capitalPend(modal))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Total</p>
                    <p className="font-semibold text-gray-800 text-xs">{fmt(pendiente(modal))}</p>
                  </div>
                </div>
              )}
              {tipoPago === 'completo' && (() => {
                const montoN = parseFloat(monto) || 0
                if (montoN <= 0) return null
                const grupo = grupos.find(g => g.producto_id === modal.producto_id)
                if (!grupo) return null
                let restante = montoN; let cnt = 0
                for (const c of grupo.cuotas) {
                  if (restante <= 0) break
                  restante -= pendiente(c); cnt++
                }
                if (cnt > 1) return (
                  <p className="text-green-600 font-semibold text-xs mt-1">
                    ✅ Cubre {cnt} cuotas automáticamente
                  </p>
                )
                return null
              })()}
            </div>

            {/* Chips tipo de pago */}
            {modal.tipo_producto !== 'fiado' && modal.tipo_producto !== 'adelanto' && interesBase(modal) > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">¿Qué paga el cliente?</label>
                <div className="grid grid-cols-2 gap-1.5 [&>*:last-child]:col-span-2">
                  {[
                    { key: 'completo',        label: '✅ Cuota completa',   monto: fmt(pendiente(modal)),   color: 'bg-green-600 text-white' },
                    { key: 'solo_interes',    label: '💸 Solo intereses',   monto: fmt(interesPend(modal)), color: 'bg-orange-500 text-white' },
                    { key: 'abono_capital',   label: '💰 Abono capital',    monto: fmt(capitalPend(modal)), color: 'bg-blue-600 text-white'   },
                    { key: 'recoger_credito', label: '🏁 Recoger crédito',  monto: (() => {
                        const grupo = grupos.find(g => g.producto_id === modal.producto_id)
                        const totalCap = grupo ? grupo.cuotas.reduce((s,c) => s + capitalPend(c), 0) : capitalPend(modal)
                        return fmt(interesPend(modal) + totalCap)
                      })(),                                                   color: 'bg-purple-600 text-white'  },
                    { key: 'personalizado',   label: '✏️ Personalizado',    monto: 'libre',                 color: 'bg-gray-600 text-white'   },
                  ].map(op => (
                    <button key={op.key}
                      onClick={() => seleccionarTipo(op.key, modal)}
                      className={`rounded-lg px-2 py-2 text-left transition-all border-2 ${
                        tipoPago === op.key
                          ? op.color + ' border-transparent shadow-md scale-[1.02]'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                      }`}>
                      <p className="text-xs font-semibold leading-tight">{op.label}</p>
                      <p className={`text-xs mt-0.5 ${tipoPago === op.key ? 'opacity-80' : 'text-gray-400'}`}>{op.monto}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Advertencia: última cuota con capital pendiente ── */}
            {(() => {
              const grupo    = grupos.find(g => g.producto_id === modal.producto_id)
              const esUltima = grupo?.cuotas.length === 1 && parseFloat(modal.abono_capital || 0) > 0
              if (!esUltima) return null
              return tipoPago === 'solo_interes' ? (
                <div className="bg-amber-50 border border-amber-400 rounded-lg p-3 text-xs">
                  <p className="font-bold text-amber-800 mb-1">⚠️ Última cuota — capital pendiente</p>
                  <p className="text-amber-700">
                    Al pagar solo intereses quedarán <strong className="text-red-600">{fmt(capitalPend(modal))}</strong> de capital sin cobrar.
                    El sistema te pedirá <strong>refinanciar el crédito</strong> para evitar que quede abierto indefinidamente.
                  </p>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-300 rounded-lg p-3 text-xs">
                  <p className="font-bold text-green-800 mb-1">✅ Última cuota del crédito</p>
                  <p className="text-green-700">Al pagar la cuota completa el crédito quedará <strong>saldado</strong>.</p>
                </div>
              )
            })()}

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div>
              <label className="text-xs font-medium text-gray-600">Monto a recibir</label>
              <input type="text"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none"
                value={monto !== '' ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(monto)) : ''}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g, '')
                  setMonto(raw)
                  setTipoPago('personalizado')
                }}
                readOnly={tipoPago !== 'personalizado'}
              />
              {tipoPago !== 'personalizado' && (
                <p className="text-xs text-gray-400 mt-1">Monto fijado por el tipo seleccionado</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Fecha del pago</label>
              <input type="date" min="2020-01-01"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={fechaPago}
                onChange={e => setFechaPago(e.target.value)} />
              {fechaPago > hoy && <p className="text-xs text-blue-500 mt-1">🧪 Fecha futura — modo prueba</p>}
              {fechaPago < hoy && <p className="text-xs text-amber-600 mt-1">⚠️ Fecha anterior a hoy ({new Date(fechaPago+'T12:00').toLocaleDateString('es-CO')})</p>}
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
            <div className="flex gap-3 pt-1 pb-2">
              <button onClick={() => setModal(null)} className="flex-1 border rounded-lg py-3 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={registrarPago} disabled={loading}
                className="flex-1 bg-primary-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {loading ? 'Guardando...' : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal Arqueo del día ── */}
    {(arqueo !== null || loadingArqueo) && (
      <div className="fixed inset-0 bg-black/50 flex items-start justify-end z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🧾</span>
              <div>
                <p className="font-bold text-gray-800">Arqueo del día</p>
                <p className="text-xs text-gray-500">{hoy}</p>
              </div>
            </div>
            <button onClick={() => setArqueo(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
          </div>

          {loadingArqueo
            ? <div className="flex items-center justify-center py-16 text-gray-400">Cargando arqueo...</div>
            : arqueo && (
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-3 divide-x border-b">
                  <div className="p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">📋 Programado hoy</p>
                    <p className="text-lg font-bold text-gray-800">{fmt(arqueo.programado)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{arqueo.cuotasHoy.length} cuota(s)</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">✅ Cobrado hoy</p>
                    <p className="text-lg font-bold text-green-600">{fmt(arqueo.cobrado)}</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">⏳ Pendiente</p>
                    <p className="text-lg font-bold text-red-500">{fmt(Math.max(0, arqueo.programado - arqueo.cobrado))}</p>
                  </div>
                </div>

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

          <div className="flex-1 overflow-y-auto p-4 bg-[#e5ddd5]">
            <div className="flex justify-end">
              <div className="bg-[#dcf8c6] rounded-2xl rounded-tr-sm px-4 py-3 max-w-xs shadow-sm">
                <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{modalWA.mensaje}</pre>
                <p className="text-right text-xs text-gray-400 mt-1">✓✓</p>
              </div>
            </div>
          </div>

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

    {/* ── Modal: crédito requiere refinanciación ── */}
    {alertaRefinanciar && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
          <div className="bg-amber-500 px-6 py-4 text-white text-center">
            <p className="text-3xl mb-1">⚠️</p>
            <p className="text-lg font-bold">Crédito requiere refinanciación</p>
          </div>
          <div className="px-6 py-5 space-y-3 text-sm">
            <p className="text-gray-700 text-center">
              <strong>{alertaRefinanciar.nombreCliente}</strong> pagó solo los intereses de la última cuota.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Capital pendiente sin cobrar</p>
              <p className="text-2xl font-black text-red-600">{fmt(alertaRefinanciar.capitalPendiente)}</p>
            </div>
            <p className="text-gray-500 text-xs text-center">
              Si no se refinancia, el crédito quedará abierto indefinidamente y afectará los informes y la cartera.
            </p>
          </div>
          <div className="px-6 pb-6 flex gap-3">
            <button onClick={() => setAlertaRefinanciar(null)}
              className="flex-1 border rounded-xl py-3 text-sm text-gray-600 hover:bg-gray-50">
              Hacer después
            </button>
            <a href={`/prestamos/${alertaRefinanciar.productoId}`}
              onClick={() => setAlertaRefinanciar(null)}
              className="flex-1 bg-purple-600 text-white rounded-xl py-3 text-sm font-bold text-center hover:bg-purple-700">
              🔄 Refinanciar ahora
            </a>
          </div>
        </div>
      </div>
    )}

  </div>
  )
}
