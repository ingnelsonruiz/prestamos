'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v||0)

function InputPesos({ value, onChange, placeholder='0', required=false }) {
  const [display, setDisplay] = useState(value ? Number(value).toLocaleString('es-CO') : '')
  useEffect(() => {
    setDisplay(value ? Number(value).toLocaleString('es-CO') : '')
  }, [value])
  const handleChange = e => {
    const raw = e.target.value.replace(/\./g,'').replace(/[^\d]/g,'')
    setDisplay(raw ? Number(raw).toLocaleString('es-CO') : '')
    onChange(raw || '')
  }
  return (
    <input type="text" inputMode="numeric" required={required} placeholder={placeholder}
      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
      value={display} onChange={handleChange} />
  )
}
const fmtFecha = d => {
  if (!d) return '—'
  // Soporta tanto 'YYYY-MM-DD' como timestamp completo 'YYYY-MM-DDTHH:...'
  const solo = typeof d === 'string' ? d.split('T')[0] : d
  return new Date(solo + 'T12:00:00').toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'})
}

const TAB = { empresa:'empresa', personal:'personal', config:'config' }

export default function GastosPage() {
  const [tab, setTab]               = useState(TAB.empresa)
  const [empresas, setEmpresas]     = useState([])
  const [tiposGasto, setTiposGasto] = useState([])
  const [gastos, setGastos]         = useState([])
  const [retornos, setRetornos]       = useState([])
  const [inversiones, setInversiones] = useState([])
  const [empresaSel, setEmpresaSel]   = useState(null)
  const [loading, setLoading]         = useState(false)
  const [vistaEmpresa, setVistaEmpresa] = useState('gastos') // 'gastos' | 'retornos' | 'inversiones'
  const [usuarioActual, setUsuarioActual] = useState(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r=>r.json()).then(d => setUsuarioActual(d.user || null))
  }, [])

  // Modales
  const [modalGasto,    setModalGasto]    = useState(false)
  const [modalEmpresa,  setModalEmpresa]  = useState(false)
  const [modalTipo,     setModalTipo]     = useState(false)
  const [modalRetorno,  setModalRetorno]  = useState(false)

  const [formGasto,   setFormGasto]   = useState({ empresa_id:'', tipo_gasto_id:'', descripcion:'', monto:'', fecha_gasto:new Date().toISOString().split('T')[0], es_personal:false, notas:'' })
  const [formEmpresa, setFormEmpresa] = useState({ nombre:'', nit:'', descripcion:'' })
  const [formTipo,    setFormTipo]    = useState({ nombre:'' })
  const [formRetorno, setFormRetorno] = useState({ producto_id:'', monto_capital:'', modo:'libre', tasa:'', monto_interes:'', fecha_retorno:new Date().toISOString().split('T')[0], notas:'' })

  const [errGasto,   setErrGasto]   = useState('')
  const [errEmpresa, setErrEmpresa] = useState('')
  const [errTipo,    setErrTipo]    = useState('')
  const [errRetorno, setErrRetorno] = useState('')

  const cargarEmpresas = useCallback(() =>
    fetch('/api/empresas').then(r=>r.json()).then(d => setEmpresas(Array.isArray(d)?d:[])), [])

  const cargarTipos = useCallback(() =>
    fetch('/api/tipos-gasto').then(r=>r.json()).then(d => setTiposGasto(Array.isArray(d)?d:[])), [])

  const cargarGastos = useCallback((params='') =>
    fetch(`/api/gastos?${params}`).then(r=>r.json()).then(d => setGastos(Array.isArray(d)?d:[])), [])

  const cargarRetornos = useCallback((empresaId) =>
    fetch(`/api/empresas/${empresaId}/retornos`).then(r=>r.json()).then(d => setRetornos(Array.isArray(d)?d:[])), [])

  const cargarInversiones = useCallback((empresaId) =>
    fetch(`/api/productos?empresa_id=${empresaId}`).then(r=>r.json()).then(d => setInversiones(Array.isArray(d)?d:[])), [])

  useEffect(() => { cargarEmpresas(); cargarTipos() }, [cargarEmpresas, cargarTipos])

  useEffect(() => {
    if (tab === TAB.empresa && empresaSel) {
      cargarGastos(`empresa_id=${empresaSel.id}`)
      cargarRetornos(empresaSel.id)
      cargarInversiones(empresaSel.id)
    }
    if (tab === TAB.personal) cargarGastos('personal=true')
  }, [tab, empresaSel, cargarGastos, cargarRetornos, cargarInversiones])

  const seleccionarEmpresa = emp => {
    setEmpresaSel(emp)
    setVistaEmpresa('gastos')
    cargarGastos(`empresa_id=${emp.id}`)
    cargarRetornos(emp.id)
    cargarInversiones(emp.id)
  }

  // ── Guardar gasto ──
  const guardarGasto = async e => {
    e.preventDefault(); setErrGasto(''); setLoading(true)
    const montoGasto = parseFloat(formGasto.monto) || 0

    // Validar que el gasto no supere el saldo operativo de la empresa
    if (tab === TAB.empresa && empresaSel && !formGasto.es_personal) {
      const empData = empresas.find(em => em.id === (formGasto.empresa_id || empresaSel?.id)) || empresaSel
      const saldo = Number(empData?.saldo_prestamos || 0) + Number(empData?.total_retornos_capital || 0) - Number(empData?.total_gastos || 0)
      if (montoGasto > saldo) {
        setLoading(false)
        setErrGasto(
          `⚠️ El gasto ($${montoGasto.toLocaleString('es-CO')}) supera el saldo operativo disponible ($${saldo.toLocaleString('es-CO')}). ` +
          `Debes registrar una nueva inversión para esta empresa antes de continuar.`
        )
        return
      }
    }

    const body = {
      ...formGasto,
      monto: montoGasto,
      empresa_id: tab === TAB.personal ? null : (formGasto.empresa_id || empresaSel?.id),
      es_personal: tab === TAB.personal,
    }
    const res  = await fetch('/api/gastos', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setErrGasto(data.error); return }
    setModalGasto(false)
    setFormGasto({ empresa_id:'', tipo_gasto_id:'', descripcion:'', monto:'', fecha_gasto:new Date().toISOString().split('T')[0], es_personal:false, notas:'' })
    if (tab === TAB.empresa && empresaSel) { cargarGastos(`empresa_id=${empresaSel.id}`); cargarEmpresas() }
    else cargarGastos('personal=true')
  }

  const eliminarGasto = async (id) => {
    if (!confirm('¿Eliminar este gasto?')) return
    await fetch(`/api/gastos/${id}`, { method:'DELETE' })
    if (tab === TAB.empresa && empresaSel) { cargarGastos(`empresa_id=${empresaSel.id}`); cargarEmpresas() }
    else cargarGastos('personal=true')
  }

  // ── Guardar retorno ──
  const interesCalculado = () => {
    if (formRetorno.modo === 'tasa') {
      const cap  = parseFloat(formRetorno.monto_capital) || 0
      const tasa = parseFloat(formRetorno.tasa) || 0
      return Math.round(cap * tasa / 100)
    }
    return parseFloat(formRetorno.monto_interes) || 0
  }

  const guardarRetorno = async e => {
    e.preventDefault(); setErrRetorno(''); setLoading(true)
    const interes = interesCalculado()
    const montoCapital = parseFloat(formRetorno.monto_capital)

    // 1. Registrar retorno
    const body = {
      monto_capital: montoCapital,
      monto_interes: interes,
      fecha_retorno: formRetorno.fecha_retorno,
      notas: formRetorno.notas,
      producto_id: formRetorno.producto_id || null,
    }
    const res  = await fetch(`/api/empresas/${empresaSel.id}/retornos`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { setLoading(false); setErrRetorno(data.error); return }

    // 2. Si se eligió una inversión, registrar pago real contra ella
    if (formRetorno.producto_id) {
      const cuotasRes = await fetch(`/api/cuotas?producto_id=${formRetorno.producto_id}&estado=todas`)
      const cuotas = await cuotasRes.json()
      const cuotaPend = Array.isArray(cuotas) ? cuotas.find(c => c.estado !== 'pagada') : null
      if (cuotaPend) {
        const pagoRes = await fetch('/api/pagos', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            cuota_id:   cuotaPend.id,
            monto:      montoCapital,
            metodo_pago:'efectivo',
            notas:      `Retorno empresa${formRetorno.notas ? ' — ' + formRetorno.notas : ''}`,
            fecha_pago: formRetorno.fecha_retorno,
          })
        })
        if (!pagoRes.ok) {
          const pe = await pagoRes.json()
          setLoading(false)
          setErrRetorno('Retorno guardado pero fallo el pago: ' + pe.error)
          cargarRetornos(empresaSel.id); cargarEmpresas(); cargarInversiones(empresaSel.id)
          return
        }
      }
    }

    setLoading(false)
    setModalRetorno(false)
    setFormRetorno({ producto_id:'', monto_capital:'', modo:'libre', tasa:'', monto_interes:'', fecha_retorno:new Date().toISOString().split('T')[0], notas:'' })
    cargarRetornos(empresaSel.id)
    cargarEmpresas()
    cargarInversiones(empresaSel.id)
  }

  const eliminarRetorno = async (retorno_id) => {
    if (!confirm('¿Eliminar este retorno? Nota: el pago registrado en la inversión no se revierte automáticamente.')) return
    await fetch(`/api/empresas/${empresaSel.id}/retornos`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ retorno_id }) })
    cargarRetornos(empresaSel.id)
    cargarEmpresas()
  }

  // ── Guardar empresa ──
  const guardarEmpresa = async e => {
    e.preventDefault(); setErrEmpresa('')
    const res  = await fetch('/api/empresas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(formEmpresa) })
    const data = await res.json()
    if (!res.ok) { setErrEmpresa(data.error); return }
    cargarEmpresas(); setModalEmpresa(false); setFormEmpresa({ nombre:'', nit:'', descripcion:'' })
  }

  // ── Guardar tipo ──
  const guardarTipo = async e => {
    e.preventDefault(); setErrTipo('')
    const res  = await fetch('/api/tipos-gasto', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(formTipo) })
    const data = await res.json()
    if (!res.ok) { setErrTipo(data.error); return }
    cargarTipos(); setModalTipo(false); setFormTipo({ nombre:'' })
  }

  const eliminarTipo = async (id) => {
    if (!confirm('¿Eliminar este tipo de gasto?')) return
    await fetch(`/api/tipos-gasto/${id}`, { method:'DELETE' }); cargarTipos()
  }

  const eliminarEmpresa = async (emp) => {
    if (!confirm(`¿Eliminar "${emp.nombre}"? Solo es posible si no tiene préstamos ni gastos.`)) return
    const res  = await fetch('/api/empresas', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: emp.id }) })
    const data = await res.json()
    if (!res.ok) { alert(data.error); return }
    cargarEmpresas()
    if (empresaSel?.id === emp.id) setEmpresaSel(null)
  }

  // KPIs empresa seleccionada (sincroniza con datos frescos de la lista)
  const empActual = empresas.find(e => e.id === empresaSel?.id) || empresaSel
  const inversion        = Number(empActual?.saldo_prestamos         || 0)
  const totalGastado     = Number(empActual?.total_gastos            || 0)
  const totalRetornado   = Number(empActual?.total_retornos          || 0)
  const totalInteres     = Number(empActual?.total_retornos_interes  || 0)
  const capitalRetornado = Number(empActual?.total_retornos_capital  || 0)
  // Saldo = inversión activa + capital que ya volvió - gastos ejecutados
  // El interés (ganancia) NO entra en el balance operativo
  const saldoOperativo   = inversion + capitalRetornado - totalGastado

  const totalGastosVista  = gastos.reduce((s,g) => s+Number(g.monto),0)
  const totalRetornosVista = retornos.reduce((s,r) => s+Number(r.monto_total),0)
  const hoy = new Date().toISOString().split('T')[0]
  const gastosHoy = gastos.filter(g => g.fecha_gasto?.split('T')[0] === hoy || g.fecha_gasto === hoy)
  const totalHoy  = gastosHoy.reduce((s,g) => s+Number(g.monto),0)
  const tiposActivos = tiposGasto.filter(t => t.activo)

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">🏢 Módulo Empresas</h2>
        <div className="flex gap-2">
          {tab === TAB.empresa && empresaSel && vistaEmpresa === 'retornos' && (
            <button onClick={() => { setModalRetorno(true) }}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
              + Registrar retorno
            </button>
          )}
          {tab === TAB.empresa && (vistaEmpresa === 'gastos' || !empresaSel) && (
            <button onClick={() => { setModalGasto(true); setFormGasto(f=>({...f, es_personal: false})) }}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
              + Registrar gasto
            </button>
          )}
          {tab === TAB.personal && (
            <button onClick={() => { setModalGasto(true); setFormGasto(f=>({...f, es_personal: true})) }}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
              + Registrar gasto
            </button>
          )}
        </div>
      </div>

      {/* Tabs principales */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: TAB.empresa,  label: '🏢 Por empresa' },
          { key: TAB.personal, label: '👤 Personales del día' },
          { key: TAB.config,   label: '⚙️ Configurar' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB EMPRESA ── */}
      {tab === TAB.empresa && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Lista de empresas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-700 text-sm">Empresas</h3>
              <button onClick={() => setModalEmpresa(true)} className="text-xs text-primary-600 hover:underline">+ Nueva</button>
            </div>
            {empresas.length === 0 && <p className="text-sm text-gray-400 italic">Sin empresas. Crea la primera.</p>}
            {empresas.map(emp => {
              const saldo = Number(emp.saldo_prestamos||0) + Number(emp.total_retornos_capital||0) - Number(emp.total_gastos||0)
              const sinMovimientos = Number(emp.saldo_prestamos||0) === 0
                && Number(emp.total_gastos||0) === 0
                && Number(emp.total_retornos||0) === 0
              return (
                <div key={emp.id}
                  className={`relative w-full text-left rounded-xl border p-4 transition-colors cursor-pointer
                    ${empresaSel?.id === emp.id ? 'border-primary-500 bg-primary-50' : 'bg-white hover:bg-gray-50'}`}
                  onClick={() => seleccionarEmpresa(emp)}>
                  <div className="flex items-center gap-2 pr-6">
                    <p className="font-semibold text-gray-800 text-sm">{emp.nombre}</p>
                    {emp.codigo && <span className="text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-mono">{emp.codigo}</span>}
                  </div>
                  {emp.nit && <p className="text-xs text-gray-400 mt-0.5">NIT: {emp.nit}</p>}
                  {!emp.nit && emp.descripcion && <p className="text-xs text-gray-400 mt-0.5 truncate">{emp.descripcion}</p>}
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="text-gray-500">Inversión: <span className="font-medium text-blue-600">{fmt(emp.saldo_prestamos)}</span></span>
                    <span className={`font-bold ${saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>Saldo: {fmt(saldo)}</span>
                  </div>
                  {/* Botón eliminar — solo visible si no tiene movimientos */}
                  {sinMovimientos && (
                    <button
                      title="Eliminar empresa"
                      onClick={e => { e.stopPropagation(); eliminarEmpresa(emp) }}
                      className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:bg-red-100 hover:text-red-500 transition-colors text-sm">
                      🗑️
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Panel empresa seleccionada */}
          <div className="lg:col-span-2 space-y-4">
            {!empresaSel ? (
              <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                <p className="text-4xl mb-3">🏢</p>
                <p className="text-sm">Selecciona una empresa para ver su información</p>
              </div>
            ) : (
              <>
                {/* KPIs empresa — 4 tarjetas */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                    <p className="text-xs text-blue-500 font-medium">💰 Inversión activa</p>
                    <p className="text-base font-bold text-blue-700 mt-1">{fmt(inversion)}</p>
                    {capitalRetornado > 0 && (
                      <p className="text-xs text-blue-400 mt-0.5">retornado: {fmt(capitalRetornado)}</p>
                    )}
                  </div>
                  <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                    <p className="text-xs text-red-500 font-medium">📤 Total gastado</p>
                    <p className="text-base font-bold text-red-600 mt-1">{fmt(totalGastado)}</p>
                  </div>
                  <div className={`border rounded-xl p-3 text-center ${saldoOperativo >= 0 ? 'bg-green-50 border-green-100' : 'bg-orange-50 border-orange-100'}`}>
                    <p className={`text-xs font-medium ${saldoOperativo >= 0 ? 'text-green-500' : 'text-orange-500'}`}>📊 Saldo operativo</p>
                    <p className={`text-base font-bold mt-1 ${saldoOperativo >= 0 ? 'text-green-700' : 'text-orange-600'}`}>{fmt(saldoOperativo)}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">activa + retornado − gastos</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
                    <p className="text-xs text-purple-500 font-medium">📥 Retornado</p>
                    <p className="text-base font-bold text-purple-700 mt-1">{fmt(capitalRetornado)}</p>
                    {totalInteres > 0 && (
                      <p className="text-xs text-emerald-600 font-semibold mt-0.5">+ {fmt(totalInteres)} ganancia</p>
                    )}
                  </div>
                </div>

                {/* Sub-tabs: Gastos | Retornos | Inversiones */}
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                  {[
                    { key:'gastos',      label:`📤 Gastos (${gastos.length})` },
                    { key:'retornos',    label:`📥 Retornos (${retornos.length})` },
                    { key:'inversiones', label:`💼 Inversiones (${inversiones.length})` },
                  ].map(t => (
                    <button key={t.key} onClick={() => setVistaEmpresa(t.key)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                        ${vistaEmpresa === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* ── Vista Gastos ── */}
                {vistaEmpresa === 'gastos' && (() => {
                  // Cobertura automática: orden por referencia (GASTO-000001 → más antiguo),
                  // con fallback a fecha_gasto + fecha_creacion para gastos sin referencia (datos previos)
                  const ordenados = [...gastos].sort((a,b) => {
                    if (a.referencia && b.referencia) return a.referencia.localeCompare(b.referencia)
                    if (a.referencia) return -1
                    if (b.referencia) return 1
                    const fd = (a.fecha_gasto||'').localeCompare(b.fecha_gasto||'')
                    if (fd !== 0) return fd
                    return (a.fecha_creacion||'').localeCompare(b.fecha_creacion||'')
                  })
                  // 3 estados: 'total' | 'parcial' | false
                  let acum = 0
                  const conCobertura = ordenados.map(g => {
                    const m = Number(g.monto)
                    const antes = acum
                    acum += m
                    if (acum <= capitalRetornado) {
                      return { ...g, cobertura: 'total',   monto_cubierto: m,                       monto_sin_cubrir: 0 }
                    } else if (antes < capitalRetornado) {
                      const cubierto = capitalRetornado - antes
                      return { ...g, cobertura: 'parcial', monto_cubierto: cubierto,                 monto_sin_cubrir: m - cubierto }
                    } else {
                      return { ...g, cobertura: false,     monto_cubierto: 0,                        monto_sin_cubrir: m }
                    }
                  })
                  const cubiertos   = conCobertura.filter(g => g.cobertura === 'total')
                  const parciales   = conCobertura.filter(g => g.cobertura === 'parcial')
                  const sinCubrir   = conCobertura.filter(g => g.cobertura === false)
                  const totalCub    = cubiertos.reduce((s,g)=>s+Number(g.monto),0)
                                    + parciales.reduce((s,g)=>s+g.monto_cubierto,0)
                  const totalPend   = parciales.reduce((s,g)=>s+g.monto_sin_cubrir,0)
                                    + sinCubrir.reduce((s,g)=>s+Number(g.monto),0)
                  const pct         = totalGastosVista > 0 ? Math.min(100, (totalCub/totalGastosVista)*100) : 0

                  const FilaGasto = ({g}) => {
                    const bgRow = g.cobertura==='total' ? 'bg-green-50/50 hover:bg-green-50'
                                : g.cobertura==='parcial' ? 'bg-yellow-50/60 hover:bg-yellow-50'
                                : 'hover:bg-red-50/30'
                    return (
                    <tr className={`transition-colors ${bgRow}`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {g.referencia && <span className="block text-[10px] font-mono font-bold text-indigo-500 mb-0.5">{g.referencia}</span>}
                        <span className="text-gray-500 text-xs">{fmtFecha(g.fecha_gasto)}</span>
                      </td>
                      <td className="px-4 py-3"><span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{g.tipo_nombre}</span></td>
                      <td className="px-4 py-3">
                        <span className={g.cobertura==='total' ? 'text-gray-400' : 'text-gray-800 font-medium'}>{g.descripcion}</span>
                        {g.cobertura==='parcial' && (
                          <div className="mt-1 flex items-center gap-1 flex-wrap">
                            <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded">✅ {fmt(g.monto_cubierto)} cubierto</span>
                            <span className="text-[10px] bg-orange-100 text-orange-700 font-bold px-1.5 py-0.5 rounded">⏳ {fmt(g.monto_sin_cubrir)} pendiente</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {g.cobertura==='parcial' ? (
                          <span className="text-yellow-700">{fmt(g.monto)}</span>
                        ) : g.cobertura==='total' ? (
                          <span className="text-green-600">{fmt(g.monto)}</span>
                        ) : (
                          <span className="text-red-600">{fmt(g.monto)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {g.cobertura==='total'   && <span className="text-green-600 text-base">✅</span>}
                        {g.cobertura==='parcial' && <span className="text-yellow-500 text-base">🟡</span>}
                        {g.cobertura===false     && <span className="text-orange-400 text-base">⏳</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => eliminarGasto(g.id)} className="text-gray-300 hover:text-red-500 text-xs">🗑️</button>
                      </td>
                    </tr>
                    )
                  }

                  return (
                  <div className="space-y-3">
                    {/* Barra de progreso de cobertura */}
                    <div className="bg-white rounded-xl border p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-semibold text-gray-700">Cobertura de gastos por retorno de capital</span>
                        <span className="text-sm font-bold text-gray-800">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all" style={{width:`${pct}%`}}/>
                      </div>
                      <div className="flex justify-between mt-2 text-xs">
                        <span className="text-green-700 font-semibold">✅ Cubiertos: {fmt(totalCub)}</span>
                        {totalPend > 0
                          ? <span className="text-orange-600 font-semibold">⏳ Sin cubrir: {fmt(totalPend)}</span>
                          : <span className="text-green-700 font-semibold">🎉 Todos cubiertos</span>
                        }
                      </div>
                    </div>

                    {gastos.length === 0
                      ? <div className="bg-white rounded-xl border"><p className="text-center text-gray-400 py-8 text-sm">Sin gastos registrados</p></div>
                      : <>
                          {/* Tabla cubiertos */}
                          {cubiertos.length > 0 && (
                            <div className="bg-white rounded-xl border overflow-hidden">
                              <div className="px-4 py-2.5 bg-green-50 border-b flex items-center justify-between flex-wrap gap-2">
                                <span className="text-sm font-semibold text-green-800">✅ Cubiertos por retorno</span>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-green-600">{cubiertos.length} gasto(s)</span>
                                  <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                                    Total: {fmt(cubiertos.reduce((s,g)=>s+Number(g.monto),0))}
                                  </span>
                                </div>
                              </div>
                              <table className="w-full text-sm">
                                <thead className="bg-green-50/50 text-xs text-gray-500 uppercase">
                                  <tr>
                                    <th className="text-left px-4 py-2">Fecha</th>
                                    <th className="text-left px-4 py-2">Tipo</th>
                                    <th className="text-left px-4 py-2">Descripción</th>
                                    <th className="text-right px-4 py-2">Monto</th>
                                    <th className="text-center px-4 py-2">Estado</th>
                                    <th className="text-center px-4 py-2">Estado</th>
                                    <th className="px-4 py-2"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {cubiertos.map(g => <FilaGasto key={g.id} g={g}/>)}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Tabla parcialmente cubiertos */}
                          {parciales.length > 0 && (
                            <div className="bg-white rounded-xl border border-yellow-200 overflow-hidden">
                              <div className="px-4 py-2.5 bg-yellow-50 border-b border-yellow-200 flex items-center justify-between flex-wrap gap-2">
                                <span className="text-sm font-semibold text-yellow-800">🟡 Parcialmente cubierto</span>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                                    ✅ {fmt(parciales.reduce((s,g)=>s+g.monto_cubierto,0))} cubierto
                                  </span>
                                  <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                                    ⏳ {fmt(parciales.reduce((s,g)=>s+g.monto_sin_cubrir,0))} pendiente
                                  </span>
                                </div>
                              </div>
                              <table className="w-full text-sm">
                                <thead className="bg-yellow-50/40 text-xs text-gray-500 uppercase">
                                  <tr>
                                    <th className="text-left px-4 py-2">Fecha</th>
                                    <th className="text-left px-4 py-2">Tipo</th>
                                    <th className="text-left px-4 py-2">Descripción</th>
                                    <th className="text-right px-4 py-2">Monto</th>
                                    <th className="text-center px-4 py-2">Estado</th>
                                    <th className="px-4 py-2"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {parciales.map(g => <FilaGasto key={g.id} g={g}/>)}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Tabla sin cubrir */}
                          {sinCubrir.length > 0 && (
                            <div className="bg-white rounded-xl border overflow-hidden">
                              <div className="px-4 py-2.5 bg-orange-50 border-b flex items-center justify-between flex-wrap gap-2">
                                <span className="text-sm font-semibold text-orange-800">⏳ Sin cubrir</span>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-orange-600">{sinCubrir.length} gasto(s)</span>
                                  <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                                    Total: {fmt(sinCubrir.reduce((s,g)=>s+Number(g.monto),0))}
                                  </span>
                                </div>
                              </div>
                              <table className="w-full text-sm">
                                <thead className="bg-orange-50/30 text-xs text-gray-500 uppercase">
                                  <tr>
                                    <th className="text-left px-4 py-2">Fecha</th>
                                    <th className="text-left px-4 py-2">Tipo</th>
                                    <th className="text-left px-4 py-2">Descripción</th>
                                    <th className="text-right px-4 py-2">Monto</th>
                                    <th className="text-center px-4 py-2">Estado</th>
                                    <th className="px-4 py-2"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {sinCubrir.map(g => <FilaGasto key={g.id} g={g}/>)}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                    }
                  </div>
                  )
                })()}

                {/* ── Vista Retornos ── */}
                {vistaEmpresa === 'retornos' && (
                  <div className="bg-white rounded-xl border overflow-hidden">
                    <div className="px-4 py-3 border-b flex items-center justify-between">
                      <h4 className="font-semibold text-gray-700 text-sm">Retornos — {empresaSel.nombre}</h4>
                      <span className="text-xs text-gray-400">Total: <strong>{fmt(totalRetornosVista)}</strong></span>
                    </div>
                    {retornos.length === 0
                      ? <p className="text-center text-gray-400 py-8 text-sm">Sin retornos registrados</p>
                      : <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <tr>
                              <th className="text-left px-4 py-2">Fecha</th>
                              <th className="text-right px-4 py-2">Capital</th>
                              <th className="text-right px-4 py-2">Interés</th>
                              <th className="text-right px-4 py-2">Total</th>
                              <th className="text-left px-4 py-2">Notas</th>
                              <th className="px-4 py-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {retornos.map(r => (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtFecha(r.fecha_retorno)}</td>
                                <td className="px-4 py-3 text-right font-semibold text-blue-600">{fmt(r.monto_capital)}</td>
                                <td className="px-4 py-3 text-right font-semibold text-emerald-600">{fmt(r.monto_interes)}</td>
                                <td className="px-4 py-3 text-right font-bold text-purple-700">{fmt(Number(r.monto_capital)+Number(r.monto_interes))}</td>
                                <td className="px-4 py-3 text-gray-500 text-xs max-w-[160px] truncate">{r.notas||'—'}</td>
                                <td className="px-4 py-3">
                                  <button onClick={() => eliminarRetorno(r.id)} className="text-gray-300 hover:text-red-500 text-xs">🗑️</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-violet-50 border-t-2 border-violet-200">
                            <tr>
                              <td className="px-4 py-3 text-xs font-bold text-violet-700">TOTAL</td>
                              <td className="px-4 py-3 text-right font-bold text-blue-700">{fmt(retornos.reduce((s,r)=>s+Number(r.monto_capital||0),0))}</td>
                              <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmt(retornos.reduce((s,r)=>s+Number(r.monto_interes||0),0))}</td>
                              <td className="px-4 py-3 text-right font-bold text-purple-700">{fmt(totalRetornosVista)}</td>
                              <td colSpan={2}/>
                            </tr>
                          </tfoot>
                        </table>
                    }
                  </div>
                )}

                {/* ── Vista Inversiones ── */}
                {vistaEmpresa === 'inversiones' && (
                  <div className="bg-white rounded-xl border overflow-hidden">
                    <div className="px-4 py-3 border-b flex items-center justify-between">
                      <h4 className="font-semibold text-gray-700 text-sm">Inversiones — {empresaSel.nombre}</h4>
                      <span className="text-xs text-gray-400">
                        Total activo: <strong className="text-blue-600">
                          {fmt(inversiones.filter(p=>!['saldado','decomisado','refinanciado'].includes(p.estado)).reduce((s,p)=>s+Number(p.monto_capital||0),0))}
                        </strong>
                      </span>
                    </div>
                    {inversiones.length === 0
                      ? (
                        <div className="text-center py-10">
                          <p className="text-3xl mb-2">💼</p>
                          <p className="text-gray-400 text-sm">Sin inversiones registradas</p>
                          <Link href="/prestamos/nuevo" className="mt-3 inline-block text-xs bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700">
                            + Nueva inversión
                          </Link>
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <tr>
                              <th className="text-left px-4 py-2">Referencia</th>
                              <th className="text-left px-4 py-2">Descripción</th>
                              <th className="text-right px-4 py-2">Capital</th>
                              <th className="text-right px-4 py-2">Pendiente</th>
                              <th className="text-left px-4 py-2">Estado</th>
                              <th className="px-4 py-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {inversiones.map(p => (
                              <tr key={p.id} className={`hover:bg-gray-50 ${p.estado==='saldado'?'opacity-60':''}`}>
                                <td className="px-4 py-3 font-mono text-xs font-bold text-indigo-600">{p.referencia||'—'}</td>
                                <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate">{p.descripcion_bien||'—'}</td>
                                <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(p.monto_capital)}</td>
                                <td className="px-4 py-3 text-right font-semibold text-blue-700">{fmt(p.capital_pendiente||0)}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${p.estado==='saldado'?'bg-emerald-100 text-emerald-700':p.estado==='en_mora'?'bg-red-100 text-red-700':'bg-blue-100 text-blue-700'}`}>
                                    {p.estado}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <Link href={`/prestamos/${p.id}`} className="text-primary-600 text-xs hover:underline">Ver →</Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    }
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TAB PERSONAL ── */}
      {tab === TAB.personal && (
        <div className="space-y-4">
          {gastos.length === 0
            ? <div className="bg-white rounded-xl border p-10 text-center text-gray-400 text-sm">Sin gastos personales hoy</div>
            : (
              <div className="bg-white rounded-xl border overflow-hidden">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h4 className="font-semibold text-gray-700 text-sm">Gastos personales del día</h4>
                  <span className="text-xs text-gray-400">Total hoy: <strong className="text-red-600">{fmt(totalHoy)}</strong></span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">Fecha</th>
                      <th className="text-left px-4 py-2">Tipo</th>
                      <th className="text-left px-4 py-2">Descripción</th>
                      <th className="text-right px-4 py-2">Monto</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {gastos.map(g => (
                      <tr key={g.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmtFecha(g.fecha_gasto)}</td>
                        <td className="px-4 py-3"><span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{g.tipo_nombre}</span></td>
                        <td className="px-4 py-3 text-gray-700">{g.descripcion}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600">{fmt(g.monto)}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => eliminarGasto(g.id)} className="text-gray-300 hover:text-red-500 text-xs">🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* ── TAB CONFIG ── */}
      {tab === TAB.config && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-gray-700">Tipos de gasto</h3>
            <button onClick={() => setModalTipo(true)}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
              + Nuevo tipo
            </button>
          </div>
          {tiposGasto.length === 0
            ? <p className="text-gray-400 text-sm italic">Sin tipos configurados.</p>
            : (
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-3">Nombre</th>
                      <th className="text-right px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {tiposGasto.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-700">{t.nombre}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => eliminarTipo(t.id)} className="text-gray-300 hover:text-red-500 text-xs">🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* ── MODAL GASTO ── */}
      {modalGasto && (() => {
        // Saldo disponible en tiempo real
        const empData = empresas.find(em => em.id === (formGasto.empresa_id || empresaSel?.id)) || empresaSel
        const saldoDisp = !formGasto.es_personal && empData
          ? Number(empData?.saldo_prestamos||0) + Number(empData?.total_retornos_capital||0) - Number(empData?.total_gastos||0)
          : null
        const montoActual = parseFloat(formGasto.monto) || 0
        const excedeSaldo = saldoDisp !== null && montoActual > saldoDisp
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b">
              <h3 className="text-lg font-bold text-gray-800">
                {formGasto.es_personal ? '👤 Gasto personal' : '📤 Registrar gasto'}
              </h3>
              {!formGasto.es_personal && empresaSel && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xl">🏢</span>
                  <div>
                    <p className="text-sm font-bold text-gray-800">{empresaSel.nombre}</p>
                    {empresaSel.codigo && <p className="text-xs text-violet-500 font-mono">{empresaSel.codigo}</p>}
                  </div>
                </div>
              )}
            </div>
            <form onSubmit={guardarGasto} className="p-6 space-y-4">
              {!formGasto.es_personal && !empresaSel && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Empresa</label>
                  <select required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={formGasto.empresa_id || ''}
                    onChange={e => setFormGasto(f=>({...f, empresa_id: e.target.value}))}>
                    <option value="">— Selecciona empresa —</option>
                    {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Tipo de gasto</label>
                <select required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formGasto.tipo_gasto_id}
                  onChange={e => setFormGasto(f=>({...f, tipo_gasto_id: e.target.value}))}>
                  <option value="">— Selecciona tipo —</option>
                  {tiposActivos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Descripción</label>
                <input type="text" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formGasto.descripcion}
                  onChange={e => setFormGasto(f=>({...f, descripcion: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Monto</label>
                <InputPesos required value={formGasto.monto} onChange={v => setFormGasto(f=>({...f, monto: v}))} />
                {saldoDisp !== null && (
                  <p className={`text-xs mt-1 font-medium ${excedeSaldo ? 'text-red-600' : 'text-green-600'}`}>
                    {excedeSaldo
                      ? `⛔ Supera el saldo disponible (${fmt(saldoDisp)}). Debes registrar una nueva inversión.`
                      : `✅ Saldo disponible: ${fmt(saldoDisp)}`
                    }
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Fecha</label>
                <input type="date" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formGasto.fecha_gasto}
                  onChange={e => setFormGasto(f=>({...f, fecha_gasto: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notas (opcional)</label>
                <textarea rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formGasto.notas}
                  onChange={e => setFormGasto(f=>({...f, notas: e.target.value}))} />
              </div>
              {usuarioActual && (
                <div className="flex items-center gap-2 bg-gray-50 border rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400">Registrado por:</span>
                  <span className="text-xs font-semibold text-gray-700">👤 {usuarioActual.nombre}</span>
                  <span className="ml-auto text-[10px] text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">{usuarioActual.rol}</span>
                </div>
              )}
              {errGasto && <p className="text-red-600 text-sm">{errGasto}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setModalGasto(false); setErrGasto('') }}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading || excedeSaldo}
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                  {loading ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
        )
      })()}

      {/* ── MODAL EMPRESA ── */}
      {modalEmpresa && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b">
              <h3 className="text-lg font-bold text-gray-800">🏢 Nueva empresa</h3>
            </div>
            <form onSubmit={guardarEmpresa} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre *</label>
                <input type="text" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formEmpresa.nombre}
                  onChange={e => setFormEmpresa(f=>({...f, nombre: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">NIT (opcional)</label>
                <input type="text" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formEmpresa.nit}
                  onChange={e => setFormEmpresa(f=>({...f, nit: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Descripción (opcional)</label>
                <textarea rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formEmpresa.descripcion}
                  onChange={e => setFormEmpresa(f=>({...f, descripcion: e.target.value}))} />
              </div>
              {errEmpresa && <p className="text-red-600 text-sm">{errEmpresa}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setModalEmpresa(false); setErrEmpresa('') }}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit"
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700">
                  Crear empresa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL TIPO ── */}
      {modalTipo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 border-b">
              <h3 className="text-lg font-bold text-gray-800">⚙️ Nuevo tipo de gasto</h3>
            </div>
            <form onSubmit={guardarTipo} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre</label>
                <input type="text" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formTipo.nombre}
                  onChange={e => setFormTipo(f=>({...f, nombre: e.target.value}))} />
              </div>
              {errTipo && <p className="text-red-600 text-sm">{errTipo}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setModalTipo(false); setErrTipo('') }}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit"
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700">
                  Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL RETORNO ── */}
      {modalRetorno && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b">
              <h3 className="text-lg font-bold text-gray-800">📥 Registrar retorno</h3>
              {empresaSel && <p className="text-sm text-gray-500 mt-1">{empresaSel.nombre}</p>}
            </div>
            <form onSubmit={guardarRetorno} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Inversión asociada (opcional)</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formRetorno.producto_id}
                  onChange={e => setFormRetorno(f=>({...f, producto_id: e.target.value}))}>
                  <option value="">— Retorno general —</option>
                  {inversiones.filter(p=>p.estado!=='saldado').map(p => (
                    <option key={p.id} value={p.id}>{p.referencia} — {p.descripcion_bien||'Inversión'} ({fmt(p.capital_pendiente||0)} pendiente)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Capital retornado *</label>
                <InputPesos required value={formRetorno.monto_capital} onChange={v => setFormRetorno(f=>({...f, monto_capital: v}))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Interés / Ganancia</label>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setFormRetorno(f=>({...f, modo:'libre'}))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${formRetorno.modo==='libre'?'bg-primary-600 text-white border-primary-600':'border-gray-300 text-gray-600'}`}>
                    Monto libre
                  </button>
                  <button type="button" onClick={() => setFormRetorno(f=>({...f, modo:'tasa'}))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${formRetorno.modo==='tasa'?'bg-primary-600 text-white border-primary-600':'border-gray-300 text-gray-600'}`}>
                    Por tasa %
                  </button>
                </div>
                {formRetorno.modo === 'libre'
                  ? <InputPesos value={formRetorno.monto_interes} onChange={v => setFormRetorno(f=>({...f, monto_interes: v}))} placeholder="0 si solo es capital" />
                  : (
                    <div className="flex gap-2 mt-2 items-center">
                      <input type="number" step="0.01" min="0" max="100" placeholder="Tasa %"
                        className="w-24 border rounded-lg px-3 py-2 text-sm"
                        value={formRetorno.tasa}
                        onChange={e => setFormRetorno(f=>({...f, tasa: e.target.value}))} />
                      <span className="text-sm text-gray-500">= {fmt(interesCalculado())} de interés</span>
                    </div>
                  )
                }
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Fecha de retorno</label>
                <input type="date" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formRetorno.fecha_retorno}
                  onChange={e => setFormRetorno(f=>({...f, fecha_retorno: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notas (opcional)</label>
                <textarea rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formRetorno.notas}
                  onChange={e => setFormRetorno(f=>({...f, notas: e.target.value}))} />
              </div>
              {errRetorno && <p className="text-red-600 text-sm">{errRetorno}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setModalRetorno(false); setErrRetorno('') }}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                  {loading ? 'Guardando...' : 'Registrar retorno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
