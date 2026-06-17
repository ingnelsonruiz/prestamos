'use client'
import { useEffect, useState, useCallback } from 'react'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v||0)
const fmtFecha = d => d ? new Date(d+'T12:00:00').toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'

const TAB = { empresa:'empresa', personal:'personal', config:'config' }

export default function GastosPage() {
  const [tab, setTab]             = useState(TAB.empresa)
  const [empresas, setEmpresas]   = useState([])
  const [tiposGasto, setTiposGasto] = useState([])
  const [gastos, setGastos]       = useState([])
  const [empresaSel, setEmpresaSel] = useState(null)
  const [loading, setLoading]     = useState(false)

  // Modales
  const [modalGasto,    setModalGasto]    = useState(false)
  const [modalEmpresa,  setModalEmpresa]  = useState(false)
  const [modalTipo,     setModalTipo]     = useState(false)
  const [formGasto,     setFormGasto]     = useState({ empresa_id:'', tipo_gasto_id:'', descripcion:'', monto:'', fecha_gasto:new Date().toISOString().split('T')[0], es_personal:false, notas:'' })
  const [formEmpresa,   setFormEmpresa]   = useState({ nombre:'', descripcion:'' })
  const [formTipo,      setFormTipo]      = useState({ nombre:'' })
  const [errGasto,      setErrGasto]      = useState('')
  const [errEmpresa,    setErrEmpresa]    = useState('')
  const [errTipo,       setErrTipo]       = useState('')

  const cargarEmpresas = useCallback(() =>
    fetch('/api/empresas').then(r=>r.json()).then(d => setEmpresas(Array.isArray(d)?d:[])), [])

  const cargarTipos = useCallback(() =>
    fetch('/api/tipos-gasto').then(r=>r.json()).then(d => setTiposGasto(Array.isArray(d)?d:[])), [])

  const cargarGastos = useCallback((params='') =>
    fetch(`/api/gastos?${params}`).then(r=>r.json()).then(d => setGastos(Array.isArray(d)?d:[])), [])

  useEffect(() => {
    cargarEmpresas()
    cargarTipos()
  }, [cargarEmpresas, cargarTipos])

  useEffect(() => {
    if (tab === TAB.empresa && empresaSel) cargarGastos(`empresa_id=${empresaSel.id}`)
    if (tab === TAB.personal) cargarGastos('personal=true')
  }, [tab, empresaSel, cargarGastos])

  // ── Guardar gasto ──
  const guardarGasto = async e => {
    e.preventDefault()
    setErrGasto('')
    setLoading(true)
    const body = {
      ...formGasto,
      monto: parseFloat(formGasto.monto),
      empresa_id: tab === TAB.personal ? null : (formGasto.empresa_id || empresaSel?.id),
      es_personal: tab === TAB.personal,
    }
    const res = await fetch('/api/gastos', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setErrGasto(data.error); return }
    setModalGasto(false)
    setFormGasto({ empresa_id:'', tipo_gasto_id:'', descripcion:'', monto:'', fecha_gasto:new Date().toISOString().split('T')[0], es_personal:false, notas:'' })
    if (tab === TAB.empresa && empresaSel) {
      cargarGastos(`empresa_id=${empresaSel.id}`)
      cargarEmpresas() // refresca saldo
    } else {
      cargarGastos('personal=true')
    }
  }

  // ── Eliminar gasto ──
  const eliminarGasto = async (id) => {
    if (!confirm('¿Eliminar este gasto?')) return
    await fetch(`/api/gastos/${id}`, { method:'DELETE' })
    if (tab === TAB.empresa && empresaSel) {
      cargarGastos(`empresa_id=${empresaSel.id}`)
      cargarEmpresas()
    } else cargarGastos('personal=true')
  }

  // ── Guardar empresa ──
  const guardarEmpresa = async e => {
    e.preventDefault(); setErrEmpresa('')
    const res = await fetch('/api/empresas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(formEmpresa) })
    const data = await res.json()
    if (!res.ok) { setErrEmpresa(data.error); return }
    cargarEmpresas()
    setModalEmpresa(false)
    setFormEmpresa({ nombre:'', descripcion:'' })
  }

  // ── Guardar tipo ──
  const guardarTipo = async e => {
    e.preventDefault(); setErrTipo('')
    const res = await fetch('/api/tipos-gasto', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(formTipo) })
    const data = await res.json()
    if (!res.ok) { setErrTipo(data.error); return }
    cargarTipos()
    setModalTipo(false)
    setFormTipo({ nombre:'' })
  }

  const eliminarTipo = async (id) => {
    if (!confirm('¿Eliminar este tipo de gasto?')) return
    await fetch(`/api/tipos-gasto/${id}`, { method:'DELETE' })
    cargarTipos()
  }

  // Saldo empresa seleccionada
  const saldoEmpresa = empresaSel
    ? Number(empresaSel.saldo_prestamos||0) - Number(empresaSel.total_gastos||0)
    : 0

  const totalGastosVista = gastos.reduce((s,g) => s+Number(g.monto),0)
  const hoy = new Date().toISOString().split('T')[0]
  const gastosHoy = gastos.filter(g => g.fecha_gasto?.split('T')[0] === hoy || g.fecha_gasto === hoy)
  const totalHoy  = gastosHoy.reduce((s,g) => s+Number(g.monto),0)

  const tiposActivos = tiposGasto.filter(t => t.activo)

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">💸 Gastos</h2>
        <button onClick={() => { setModalGasto(true); setFormGasto(f=>({...f, es_personal: tab===TAB.personal})) }}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          + Registrar gasto
        </button>
      </div>

      {/* Tabs */}
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
              <button onClick={() => setModalEmpresa(true)}
                className="text-xs text-primary-600 hover:underline">+ Nueva</button>
            </div>
            {empresas.length === 0 && (
              <p className="text-sm text-gray-400 italic">Sin empresas. Crea la primera.</p>
            )}
            {empresas.map(emp => {
              const saldo = Number(emp.saldo_prestamos||0) - Number(emp.total_gastos||0)
              return (
                <button key={emp.id} onClick={() => { setEmpresaSel(emp); cargarGastos(`empresa_id=${emp.id}`) }}
                  className={`w-full text-left rounded-xl border p-4 transition-colors
                    ${empresaSel?.id === emp.id ? 'border-primary-500 bg-primary-50' : 'bg-white hover:bg-gray-50'}`}>
                  <p className="font-semibold text-gray-800 text-sm">{emp.nombre}</p>
                  {emp.descripcion && <p className="text-xs text-gray-400 mt-0.5 truncate">{emp.descripcion}</p>}
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="text-gray-500">Presupuesto: <span className="font-medium text-blue-600">{fmt(emp.saldo_prestamos)}</span></span>
                    <span className={`font-bold ${saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      Saldo: {fmt(saldo)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Panel empresa seleccionada */}
          <div className="lg:col-span-2 space-y-4">
            {!empresaSel ? (
              <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                <p className="text-4xl mb-3">🏢</p>
                <p className="text-sm">Selecciona una empresa para ver sus gastos</p>
              </div>
            ) : (
              <>
                {/* KPIs empresa */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
                    <p className="text-xs text-blue-500 font-medium">Presupuesto total</p>
                    <p className="text-lg font-bold text-blue-700 mt-1">{fmt(empresaSel.saldo_prestamos)}</p>
                  </div>
                  <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
                    <p className="text-xs text-red-500 font-medium">Total gastado</p>
                    <p className="text-lg font-bold text-red-600 mt-1">{fmt(empresaSel.total_gastos)}</p>
                  </div>
                  <div className={`border rounded-xl p-4 text-center ${saldoEmpresa >= 0 ? 'bg-green-50 border-green-100' : 'bg-orange-50 border-orange-100'}`}>
                    <p className={`text-xs font-medium ${saldoEmpresa >= 0 ? 'text-green-500' : 'text-orange-500'}`}>Saldo disponible</p>
                    <p className={`text-lg font-bold mt-1 ${saldoEmpresa >= 0 ? 'text-green-700' : 'text-orange-600'}`}>{fmt(saldoEmpresa)}</p>
                  </div>
                </div>

                {/* Tabla de gastos */}
                <div className="bg-white rounded-xl border overflow-hidden">
                  <div className="px-4 py-3 border-b flex items-center justify-between">
                    <h4 className="font-semibold text-gray-700 text-sm">Gastos — {empresaSel.nombre}</h4>
                    <span className="text-xs text-gray-400">Total: <strong>{fmt(totalGastosVista)}</strong></span>
                  </div>
                  {gastos.length === 0
                    ? <p className="text-center text-gray-400 py-8 text-sm">Sin gastos registrados</p>
                    : <table className="w-full text-sm">
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
                              <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtFecha(g.fecha_gasto)}</td>
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
                  }
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TAB PERSONAL ── */}
      {tab === TAB.personal && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <div className="bg-white border rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500">Gastos hoy</p>
              <p className="text-xl font-bold text-gray-800 mt-1">{gastosHoy.length}</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
              <p className="text-xs text-red-500">Total hoy</p>
              <p className="text-xl font-bold text-red-600 mt-1">{fmt(totalHoy)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h4 className="font-semibold text-gray-700 text-sm">Gastos personales</h4>
              <span className="text-xs text-gray-400">Total: <strong>{fmt(totalGastosVista)}</strong></span>
            </div>
            {gastos.length === 0
              ? <p className="text-center text-gray-400 py-8 text-sm">Sin gastos personales registrados</p>
              : <table className="w-full text-sm">
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
                      <tr key={g.id} className={`hover:bg-gray-50 ${g.fecha_gasto?.split('T')[0] === hoy || g.fecha_gasto === hoy ? 'bg-yellow-50/30' : ''}`}>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtFecha(g.fecha_gasto)}</td>
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
            }
          </div>
        </div>
      )}

      {/* ── TAB CONFIGURAR ── */}
      {tab === TAB.config && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Empresas */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">🏢 Empresas propias</h3>
              <button onClick={() => setModalEmpresa(true)}
                className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700">+ Nueva</button>
            </div>
            {empresas.map(emp => (
              <div key={emp.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800">{emp.nombre}</p>
                  {emp.descripcion && <p className="text-xs text-gray-400">{emp.descripcion}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${emp.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {emp.activo ? 'Activa' : 'Inactiva'}
                </span>
              </div>
            ))}
            {empresas.length === 0 && <p className="text-sm text-gray-400 italic">Sin empresas registradas</p>}
          </div>

          {/* Tipos de gasto */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">🏷️ Tipos de gasto</h3>
              <button onClick={() => setModalTipo(true)}
                className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700">+ Nuevo</button>
            </div>
            {tiposGasto.map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-800">{t.nombre}</span>
                  {t.es_sistema && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">Sistema</span>}
                </div>
                {!t.es_sistema && (
                  <button onClick={() => eliminarTipo(t.id)} className="text-gray-300 hover:text-red-500 text-xs">🗑️</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modal registrar gasto ── */}
      {modalGasto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-4">
              {tab === TAB.personal ? '👤 Gasto personal' : '🏢 Gasto de empresa'}
            </h3>
            {errGasto && <p className="text-red-500 text-sm mb-3">⚠️ {errGasto}</p>}
            <form onSubmit={guardarGasto} className="space-y-3">

              {/* Empresa — solo si tab empresa y no hay empresa seleccionada ya */}
              {tab === TAB.empresa && !empresaSel && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Empresa *</label>
                  <select required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={formGasto.empresa_id} onChange={e => setFormGasto(f=>({...f,empresa_id:e.target.value}))}>
                    <option value="">— Seleccionar —</option>
                    {empresas.filter(e=>e.activo).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                </div>
              )}
              {tab === TAB.empresa && empresaSel && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700">
                  🏢 Empresa: <strong>{empresaSel.nombre}</strong> — Saldo: <strong>{fmt(saldoEmpresa)}</strong>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600">Tipo de gasto *</label>
                <select required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formGasto.tipo_gasto_id} onChange={e => setFormGasto(f=>({...f,tipo_gasto_id:e.target.value}))}>
                  <option value="">— Seleccionar —</option>
                  {tiposActivos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Descripción *</label>
                <input type="text" required placeholder="Detalle del gasto"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm uppercase"
                  value={formGasto.descripcion}
                  onChange={e => setFormGasto(f=>({...f,descripcion:e.target.value.toUpperCase()}))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Monto *</label>
                  <input type="number" required min="1" placeholder="0"
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={formGasto.monto}
                    onChange={e => setFormGasto(f=>({...f,monto:e.target.value}))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Fecha</label>
                  <input type="date"
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={formGasto.fecha_gasto}
                    onChange={e => setFormGasto(f=>({...f,fecha_gasto:e.target.value}))} />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Notas <span className="text-gray-400">(opcional)</span></label>
                <input type="text" placeholder="Observaciones adicionales"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formGasto.notas}
                  onChange={e => setFormGasto(f=>({...f,notas:e.target.value}))} />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalGasto(false)}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                  {loading ? 'Guardando...' : 'Registrar gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal nueva empresa ── */}
      {modalEmpresa && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-4">🏢 Nueva empresa</h3>
            {errEmpresa && <p className="text-red-500 text-sm mb-3">⚠️ {errEmpresa}</p>}
            <form onSubmit={guardarEmpresa} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input type="text" required placeholder="Nombre de la empresa"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm uppercase"
                  value={formEmpresa.nombre}
                  onChange={e => setFormEmpresa(f=>({...f,nombre:e.target.value.toUpperCase()}))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <input type="text" placeholder="Actividad o descripción"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={formEmpresa.descripcion}
                  onChange={e => setFormEmpresa(f=>({...f,descripcion:e.target.value}))} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalEmpresa(false)}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit"
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal nuevo tipo de gasto ── */}
      {modalTipo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-4">🏷️ Nuevo tipo de gasto</h3>
            {errTipo && <p className="text-red-500 text-sm mb-3">⚠️ {errTipo}</p>}
            <form onSubmit={guardarTipo} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input type="text" required placeholder="Ej: Herramientas, Combustible..."
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm uppercase"
                  value={formTipo.nombre}
                  onChange={e => setFormTipo({ nombre: e.target.value.toUpperCase() })} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalTipo(false)}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit"
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
