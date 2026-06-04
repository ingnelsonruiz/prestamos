'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

function ModalQR({ clienteId, nombre, telefono, onClose }) {
  const url    = `${window.location.origin}/estado/${clienteId}`
  const qrUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`
  const [copiado, setCopiado]     = useState(false)
  const [copiandoQR, setCopiandoQR] = useState(false)
  const [qrCopiado, setQrCopiado] = useState(false)

  const mensajeWA = `Hola *${nombre}* 👋\n\nPuedes consultar tu estado de cuenta y saldos en el siguiente enlace:\n\n${url}\n\nTambién puedes escanear el código QR que te compartimos. 📱`

  const copiarEnlace = () => {
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })
      } else {
        const el = document.createElement('textarea')
        el.value = url; el.style.position = 'fixed'; el.style.opacity = '0'
        document.body.appendChild(el); el.focus(); el.select()
        document.execCommand('copy'); document.body.removeChild(el)
        setCopiado(true); setTimeout(() => setCopiado(false), 2000)
      }
    } catch { alert('URL: ' + url) }
  }

  const descargarQR = () => {
    const a = document.createElement('a')
    a.href = qrUrl
    a.download = `QR_${nombre.replace(/\s+/g,'_')}.png`
    a.target = '_blank'
    a.click()
  }

  const copiarQR = async () => {
    try {
      setCopiandoQR(true)
      const res  = await fetch(qrUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setQrCopiado(true)
      setTimeout(() => setQrCopiado(false), 2000)
    } catch {
      // Fallback: descargar si no se puede copiar
      descargarQR()
    } finally {
      setCopiandoQR(false)
    }
  }

  const abrirWhatsApp = (conQR = false) => {
    const tel    = telefono ? `57${telefono.replace(/\D/g,'')}` : ''
    const texto  = conQR
      ? `Hola *${nombre}* 👋\n\nTe comparto tu código QR de estado de cuenta.\nTambién puedes consultar directamente en:\n${url}`
      : mensajeWA
    const waBase = tel ? `https://wa.me/${tel}` : `https://wa.me/`
    window.open(`${waBase}?text=${encodeURIComponent(texto)}`, '_blank')
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b">
          <h3 className="text-base font-bold text-gray-800">📱 QR Estado de cuenta</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-500 text-center">Estado de cuenta de <strong className="text-gray-800">{nombre}</strong></p>

          {/* QR */}
          <div className="flex justify-center">
            <div className="p-3 bg-white rounded-2xl border-2 border-gray-100 shadow-inner">
              <img src={qrUrl} alt="QR" className="w-52 h-52 rounded-lg" />
            </div>
          </div>

          {/* URL */}
          <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-400 break-all font-mono text-center">{url}</div>

          {/* Acciones QR */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400 text-center">Para enviar el QR como imagen por WhatsApp:</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={copiarQR} disabled={copiandoQR}
                className="flex items-center justify-center gap-1.5 border-2 rounded-xl py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {qrCopiado ? '✅ ¡QR copiado!' : copiandoQR ? '⏳...' : '🖼️ Copiar QR'}
              </button>
              <button onClick={descargarQR}
                className="flex items-center justify-center gap-1.5 border-2 rounded-xl py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                ⬇️ Descargar QR
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center bg-gray-50 rounded-lg px-3 py-2">
              💡 Copia o descarga el QR → abre WhatsApp → adjunta la imagen al chat
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gray-100"/>
            <span className="text-xs text-gray-400">compartir enlace</span>
            <div className="flex-1 h-px bg-gray-100"/>
          </div>

          {/* Acciones enlace */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={copiarEnlace}
              className={`flex items-center justify-center gap-1.5 border-2 rounded-xl py-2.5 text-xs font-semibold transition-all
                ${copiado ? 'bg-green-500 text-white border-green-500' : 'text-gray-700 hover:bg-gray-50'}`}>
              {copiado ? '✅ ¡Copiado!' : '📋 Copiar enlace'}
            </button>
            <button onClick={() => window.open(url,'_blank')}
              className="flex items-center justify-center gap-1.5 border-2 border-[#1e3a5f] text-[#1e3a5f] rounded-xl py-2.5 text-xs font-semibold hover:bg-[#1e3a5f] hover:text-white transition-all">
              👁 Ver página
            </button>
          </div>

          {/* WhatsApp */}
          <div className="space-y-2">
            <button onClick={() => abrirWhatsApp(false)}
              className="w-full flex items-center justify-center gap-2 bg-[#25D366] text-white rounded-xl py-2.5 text-sm font-bold hover:bg-[#1ebe5d] transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.558 4.122 1.532 5.856L.057 23.7a.75.75 0 00.918.919l5.98-1.527A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.694-.5-5.241-1.377l-.374-.216-3.893.995.982-3.81-.233-.386A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
              {telefono ? `Enviar a ${telefono}` : 'Compartir por WhatsApp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const fmt     = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)
const initials = n => n ? n.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase() : '?'

const tipoIcon  = { prestamo:'💰', venta:'🛍️', empeno:'🔒', fiado:'🌿', adelanto:'🤝' }
const tipoLabel = { prestamo:'Préstamo', venta:'Venta crédito', empeno:'Empeño', fiado:'Fiado', adelanto:'Adelanto' }

const estadoStyle = {
  activo:       'bg-blue-100 text-blue-700 border border-blue-200',
  al_dia:       'bg-emerald-100 text-emerald-700 border border-emerald-200',
  en_mora:      'bg-red-100 text-red-700 border border-red-200',
  saldado:      'bg-green-100 text-green-700 border border-green-200',
  refinanciado: 'bg-purple-100 text-purple-700 border border-purple-200',
  decomisado:   'bg-gray-100 text-gray-500 border border-gray-200',
}

export default function PerfilCliente() {
  const { id }  = useParams()
  const [data, setData]           = useState(null)
  const [showQR, setShowQR]       = useState(false)
  const [filtro, setFiltro]       = useState('activos')

  useEffect(() => {
    fetch(`/api/clientes/${id}`).then(r=>r.json()).then(setData)
  }, [id])

  if (!data) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Cargando perfil...</p>
      </div>
    </div>
  )

  const prods       = data.productos || []
  const activos     = prods.filter(p => !['saldado','refinanciado','decomisado'].includes(p.estado))
  const saldados    = prods.filter(p => p.estado === 'saldado')
  const refinanciados = prods.filter(p => p.estado === 'refinanciado')
  const tieneMora   = activos.some(p => parseInt(p.cuotas_mora||0) > 0)
  const deudaTotal  = activos.reduce((s,p) => s + parseFloat(p.saldo_total||0), 0)

  const prodsFiltrados = prods.filter(p => {
    if (filtro === 'todos')       return true
    if (filtro === 'activos')     return !['saldado','refinanciado','decomisado'].includes(p.estado)
    if (filtro === 'saldado')     return p.estado === 'saldado'
    if (filtro === 'refinanciado') return p.estado === 'refinanciado'
    return true
  })

  return (
    <div className="max-w-4xl space-y-5">
      {showQR && <ModalQR clienteId={id} nombre={data.nombre} telefono={data.telefono} onClose={() => setShowQR(false)} />}

      {/* ── BREADCRUMB ── */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/clientes" className="hover:text-gray-600 transition-colors">← Clientes</Link>
        <span>/</span>
        <span className="text-gray-600 font-medium truncate">{data.nombre}</span>
      </div>

      {/* ── HERO CARD ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Barra de acento superior */}
        <div className="h-1.5 w-full" style={{ background: tieneMora ? '#ef4444' : deudaTotal > 0 ? '#1e3a5f' : '#10b981' }} />

        <div className="px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            {/* Avatar + datos */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black shadow-md flex-shrink-0"
                style={{ background: '#1e3a5f' }}>
                {initials(data.nombre)}
              </div>
              <div>
                <h1 className="text-gray-900 text-xl font-bold leading-tight">{data.nombre}</h1>
                <p className="text-gray-500 text-sm mt-0.5">CC / NIT: <span className="font-mono font-semibold text-gray-700">{data.documento}</span></p>
                <div className="mt-1.5">
                  {tieneMora
                    ? <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 border border-red-200 px-2.5 py-0.5 rounded-full font-semibold">⚠️ Con mora</span>
                    : activos.length > 0
                      ? <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full font-semibold">✅ Al día</span>
                      : <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 border border-gray-200 px-2.5 py-0.5 rounded-full">Sin créditos activos</span>
                  }
                </div>
              </div>
            </div>
            {/* Botón QR */}
            <button onClick={() => setShowQR(true)}
              className="flex-shrink-0 border-2 border-[#1e3a5f] text-[#1e3a5f] hover:bg-[#1e3a5f] hover:text-white rounded-xl px-4 py-2 font-bold transition-all flex items-center gap-2 text-sm">
              <span>📱</span>
              <span>Ver QR</span>
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="rounded-xl p-3 text-center border border-gray-100 bg-gray-50">
              <p className="text-gray-400 text-xs">Créditos activos</p>
              <p className="text-gray-900 text-2xl font-black mt-0.5">{activos.length}</p>
            </div>
            <div className="rounded-xl p-3 text-center border" style={{ borderColor: '#1e3a5f22', background: '#1e3a5f08' }}>
              <p className="text-gray-500 text-xs">Deuda total</p>
              <p className="text-lg font-black mt-0.5 leading-tight" style={{ color: '#1e3a5f' }}>{fmt(deudaTotal)}</p>
            </div>
            <div className="rounded-xl p-3 text-center border border-emerald-100 bg-emerald-50">
              <p className="text-gray-400 text-xs">Saldados</p>
              <p className="text-emerald-700 text-2xl font-black mt-0.5">{saldados.length}</p>
            </div>
          </div>

          {/* Contacto */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
            {data.telefono
              ? <a href={`tel:${data.telefono}`} className="flex items-center gap-1.5 bg-green-50 hover:bg-green-100 border border-green-200 text-green-700 text-xs px-3 py-1.5 rounded-full font-semibold transition-colors">📞 {data.telefono}</a>
              : <span className="text-xs text-gray-400 border border-gray-200 px-3 py-1.5 rounded-full">📞 Sin teléfono</span>
            }
            {data.email && <span className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 text-blue-600 text-xs px-3 py-1.5 rounded-full">✉️ {data.email}</span>}
            {data.direccion && <span className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-full">📍 {data.direccion}</span>}
          </div>
        </div>
      </div>

      {/* ── SECCIÓN PRODUCTOS ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        {/* Encabezado + botón nuevo */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-gray-800 text-lg">Productos financieros</h2>
            <p className="text-gray-400 text-xs mt-0.5">{prods.length} en total · {activos.length} activo(s)</p>
          </div>
          <Link href={`/prestamos/nuevo?cliente=${id}`}
            className="flex items-center gap-2 bg-[#1e3a5f] hover:bg-[#16304f] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-md transition-all">
            + Nuevo crédito
          </Link>
        </div>

        {/* Filtros tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {[
            { k:'activos',      l:'Activos',       n: activos.length,     on:'bg-[#1e3a5f] text-white border-[#1e3a5f]',       off:'bg-white text-gray-500 border-gray-200 hover:border-gray-300' },
            { k:'saldado',      l:'Saldados',       n: saldados.length,    on:'bg-emerald-600 text-white border-emerald-600',     off:'bg-white text-gray-500 border-gray-200 hover:border-gray-300' },
            { k:'refinanciado', l:'Refinanciados',  n: refinanciados.length,on:'bg-purple-600 text-white border-purple-600',     off:'bg-white text-gray-500 border-gray-200 hover:border-gray-300' },
            { k:'todos',        l:'Todos',           n: prods.length,       on:'bg-gray-700 text-white border-gray-700',          off:'bg-white text-gray-500 border-gray-200 hover:border-gray-300' },
          ].map(f => (
            <button key={f.k} onClick={() => setFiltro(f.k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all flex items-center gap-2
                ${filtro === f.k ? f.on + ' shadow-md' : f.off}`}>
              {f.l}
              <span className={`text-xs px-2 py-0.5 rounded-full font-black
                ${filtro === f.k ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {f.n}
              </span>
            </button>
          ))}
        </div>

        {/* Cards de productos */}
        <div className="space-y-3">
          {prodsFiltrados.map(p => {
            const pendiente = parseFloat(p.saldo_total || 0)
            const totalCu   = parseInt(p.total_cuotas || 0)
            const pagadas   = parseInt(p.cuotas_pagadas || 0)
            const progreso  = totalCu > 0 ? Math.round((pagadas / totalCu) * 100) : 0
            const enMora    = parseInt(p.cuotas_mora || 0) > 0

            return (
              <Link key={p.id} href={`/prestamos/${p.id}`}
                className={`block bg-white rounded-2xl border-2 p-5 hover:shadow-lg transition-all group
                  ${enMora ? 'border-red-200 hover:border-red-300' : 'border-gray-100 hover:border-blue-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  {/* Icono + info */}
                  <div className="flex items-start gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0
                      ${enMora ? 'bg-red-50' : 'bg-blue-50'}`}>
                      {tipoIcon[p.tipo] || '📄'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-800">{tipoLabel[p.tipo] || p.tipo}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoStyle[p.estado] || estadoStyle.activo}`}>
                          {p.estado}
                        </span>
                        {enMora && (
                          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold animate-pulse">
                            ⚠️ {p.cuotas_mora} en mora
                          </span>
                        )}
                      </div>
                      <p className="text-gray-400 text-xs mt-1">
                        {fmt(p.monto_capital)} · {p.tasa_interes}% {p.periodo_tasa} · {p.metodo_calculo}
                      </p>
                      {p.descripcion_bien && (
                        <p className="text-gray-400 text-xs mt-0.5 italic">{p.descripcion_bien}</p>
                      )}
                    </div>
                  </div>

                  {/* Monto pendiente */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-400">Pendiente</p>
                    <p className={`text-lg font-black ${enMora ? 'text-red-600' : 'text-gray-800'}`}>
                      {fmt(pendiente)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 group-hover:text-blue-500 transition-colors">
                      Ver detalle →
                    </p>
                  </div>
                </div>

                {/* Barra de progreso */}
                {p.tipo !== 'fiado' && totalCu > 0 && (
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                      <span>{pagadas} de {totalCu} cuotas pagadas</span>
                      <span className="font-semibold">{progreso}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${enMora ? 'bg-red-400' : progreso === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                        style={{ width: `${progreso}%` }} />
                    </div>
                  </div>
                )}
              </Link>
            )
          })}

          {prodsFiltrados.length === 0 && (
            <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-semibold text-gray-500">Sin productos en esta categoría</p>
              <Link href={`/prestamos/nuevo?cliente=${id}`}
                className="inline-block mt-4 text-sm text-blue-600 hover:underline">
                + Crear primer crédito
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

