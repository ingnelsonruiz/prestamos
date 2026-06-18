'use client'
import { useEffect, useState } from 'react'

const COMPORTAMIENTOS = [
  { value: 'prestamo_normal', label: '💰 Préstamo normal',  desc: 'Genera cuotas con tasa e intereses (como préstamo o venta)' },
  { value: 'cuenta_abierta',  label: '🌿 Cuenta abierta',   desc: 'Sin cuotas fijas ni interés — saldo libre (como fiado o adelanto)' },
  { value: 'empeno',          label: '🔒 Empeño',           desc: 'Como préstamo normal + campos de bien y fecha límite de rescate' },
]

const ICONOS = ['💰','🛍️','🔒','🌿','⚡','📋','🏦','💳','🤝','🎯','📦','🔑','💎','🏠','🚗','📱','⚙️','🔧','💼','📊']

function TipoBadge({ tipo }) {
  const colors = {
    prestamo_normal: 'bg-blue-100 text-blue-700',
    cuenta_abierta:  'bg-teal-100 text-teal-700',
    empeno:          'bg-purple-100 text-purple-700',
  }
  const labels = {
    prestamo_normal: 'Préstamo normal',
    cuenta_abierta:  'Cuenta abierta',
    empeno:          'Empeño',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${colors[tipo] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[tipo] ?? tipo}
    </span>
  )
}

export default function ConfiguracionPage() {
  const [tipos,      setTipos]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  // ── Tipos de gasto ──
  const [tiposGasto,    setTiposGasto]    = useState([])
  const [loadingGasto,  setLoadingGasto]  = useState(true)
  const [modalGasto,    setModalGasto]    = useState(false)
  const [savingGasto,   setSavingGasto]   = useState(false)
  const [formGasto,     setFormGasto]     = useState({ nombre: '' })
  const [confirmDelG,   setConfirmDelG]   = useState(null)

  const EMPTY = { label: '', icono: '📋', descripcion: '', comportamiento: 'prestamo_normal', orden: 99 }
  const [form, setForm] = useState(EMPTY)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const cargar = async () => {
    setLoading(true)
    const res = await fetch('/api/configuracion/tipos')
    const data = await res.json()
    setTipos(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  const cargarGastos = async () => {
    setLoadingGasto(true)
    const res = await fetch('/api/tipos-gasto')
    const data = await res.json()
    setTiposGasto(Array.isArray(data) ? data : [])
    setLoadingGasto(false)
  }

  useEffect(() => { cargar(); cargarGastos() }, [])

  const flash = (ok, text) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const guardar = async () => {
    if (!form.label.trim()) return flash(false, 'El nombre es obligatorio')
    setSaving(true)
    const url    = editItem ? `/api/configuracion/tipos/${editItem.id}` : '/api/configuracion/tipos'
    const method = editItem ? 'PUT' : 'POST'
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data   = await res.json()
    setSaving(false)
    if (!res.ok) { flash(false, data.error); return }
    flash(true, editItem ? `Tipo "${form.label}" actualizado.` : `Tipo "${form.label}" creado correctamente.`)
    setModal(false); setEditItem(null); setForm(EMPTY)
    cargar()
  }

  const eliminar = async (tipo) => {
    const res  = await fetch(`/api/configuracion/tipos/${tipo.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { flash(false, data.error); setConfirmDel(null); return }
    flash(true, data.mensaje)
    setConfirmDel(null)
    cargar()
  }

  const toggleActivo = async (tipo) => {
    await fetch(`/api/configuracion/tipos/${tipo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !tipo.activo })
    })
    cargar()
  }

  const abrirEditar = (tipo) => {
    setForm({ label: tipo.label, icono: tipo.icono, descripcion: tipo.descripcion ?? '', comportamiento: tipo.comportamiento, orden: tipo.orden })
    setEditItem(tipo)
    setModal(true)
  }

  const cerrarModal = () => { setModal(false); setEditItem(null); setForm(EMPTY) }

  // ── CRUD tipos de gasto ──
  const guardarGasto = async () => {
    if (!formGasto.nombre.trim()) return flash(false, 'El nombre es obligatorio')
    setSavingGasto(true)
    const res = await fetch('/api/tipos-gasto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: formGasto.nombre }),
    })
    const data = await res.json()
    setSavingGasto(false)
    if (!res.ok) { flash(false, data.error); return }
    flash(true, `Tipo de gasto "${data.nombre}" creado`)
    setModalGasto(false); setFormGasto({ nombre: '' }); cargarGastos()
  }

  const eliminarGasto = async (tg) => {
    const res  = await fetch(`/api/tipos-gasto/${tg.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { flash(false, data.error); setConfirmDelG(null); return }
    flash(true, `Tipo "${tg.nombre}" eliminado`)
    setConfirmDelG(null); cargarGastos()
  }

  return (
    <div className="max-w-4xl space-y-6">

      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">⚙️ Configuración</h2>
          <p className="text-sm text-gray-500 mt-0.5">Gestiona los tipos de préstamo disponibles en el sistema</p>
        </div>
        <button onClick={() => { setForm(EMPTY); setEditItem(null); setModal(true) }}
          className="bg-[#1e3a5f] text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-900 transition-colors flex items-center gap-2">
          <span>+</span> Nuevo tipo
        </button>
      </div>

      {/* Flash message */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2
          ${msg.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          {msg.ok ? '✅' : '❌'} {msg.text}
        </div>
      )}

      {/* Tabla de tipos */}
      <div className="bg-white rounded-2xl border overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b bg-gray-50 flex items-center gap-2">
          <span>📋</span>
          <p className="text-sm font-bold text-gray-700">Tipos de préstamo configurados</p>
          <span className="ml-auto text-xs text-gray-400">{tipos.length} tipos</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
        ) : (
          <div className="divide-y">
            {tipos.map(t => (
              <div key={t.id}
                className={`flex items-center gap-4 px-6 py-4 transition-colors hover:bg-gray-50
                  ${!t.activo ? 'opacity-50' : ''}`}>

                {/* Ícono */}
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                  style={{ background: t.activo ? '#f1f5f9' : '#f8fafc' }}>
                  {t.icono}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-gray-800 text-sm">{t.label}</p>
                    <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{t.codigo}</span>
                    {t.es_sistema && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold">Sistema</span>}
                    {!t.activo && <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-semibold">Inactivo</span>}
                  </div>
                  {t.descripcion && <p className="text-xs text-gray-500 mt-0.5 truncate">{t.descripcion}</p>}
                  <div className="mt-1"><TipoBadge tipo={t.comportamiento} /></div>
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Toggle activo */}
                  <button onClick={() => toggleActivo(t)}
                    title={t.activo ? 'Desactivar' : 'Activar'}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors
                      ${t.activo
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {t.activo ? '● Activo' : '○ Inactivo'}
                  </button>

                  {/* Editar */}
                  <button onClick={() => abrirEditar(t)}
                    className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                    title="Editar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>

                  {/* Eliminar — solo no-sistema */}
                  {!t.es_sistema && (
                    <button onClick={() => setConfirmDel(t)}
                      className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                      title="Eliminar">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Tipos de gasto ── */}
      <div className="bg-white rounded-2xl border overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b bg-gray-50 flex items-center gap-2">
          <span>🏷️</span>
          <p className="text-sm font-bold text-gray-700">Tipos de gasto configurados</p>
          <span className="ml-auto text-xs text-gray-400">{tiposGasto.length} tipos</span>
          <button onClick={() => { setFormGasto({ nombre: '' }); setModalGasto(true) }}
            className="bg-[#1e3a5f] text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-900 transition-colors flex items-center gap-1">
            + Nuevo
          </button>
        </div>

        {loadingGasto ? (
          <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
        ) : (
          <div className="divide-y">
            {tiposGasto.map(tg => (
              <div key={tg.id} className={`flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 transition-colors ${!tg.activo ? 'opacity-50' : ''}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800 text-sm">{tg.nombre}</p>
                    {tg.es_sistema && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold">Sistema</span>}
                    {!tg.activo && <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Inactivo</span>}
                  </div>
                </div>
                {!tg.es_sistema && (
                  <button onClick={() => setConfirmDelG(tg)}
                    className="p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Eliminar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info de comportamientos */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <p className="text-sm font-bold text-blue-800 mb-3">📖 Guía de comportamientos</p>
        <div className="space-y-2">
          {COMPORTAMIENTOS.map(c => (
            <div key={c.value} className="flex items-start gap-3">
              <span className="text-base mt-0.5">{c.label.split(' ')[0]}</span>
              <div>
                <p className="text-sm font-semibold text-blue-700">{c.label.split(' ').slice(1).join(' ')}</p>
                <p className="text-xs text-blue-600">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ MODAL CREAR / EDITAR ══ */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">

            <div className="px-6 py-5 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-800">{editItem ? '✏️ Editar tipo' : '➕ Nuevo tipo de préstamo'}</h3>
              <button onClick={cerrarModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">

              {/* Ícono + Nombre */}
              <div className="flex gap-3">
                <div className="shrink-0">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Ícono</label>
                  <select value={form.icono} onChange={e => set('icono', e.target.value)}
                    className="border rounded-xl px-3 py-2.5 text-xl text-center w-16 focus:outline-none focus:ring-2 focus:ring-blue-400">
                    {ICONOS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Nombre *</label>
                  <input type="text" value={form.label} onChange={e => set('label', e.target.value)}
                    placeholder="Ej: Crédito vehicular"
                    className="w-full border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              {/* Comportamiento */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Comportamiento *</label>
                <div className="space-y-2">
                  {COMPORTAMIENTOS.map(c => (
                    <label key={c.value}
                      className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors
                        ${form.comportamiento === c.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="comp" value={c.value}
                        checked={form.comportamiento === c.value}
                        onChange={() => set('comportamiento', c.value)}
                        className="mt-0.5 accent-blue-600" />
                      <div>
                        <p className="text-sm font-bold text-gray-700">{c.label}</p>
                        <p className="text-xs text-gray-500">{c.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Descripción <span className="text-gray-300">(opcional)</span></label>
                <textarea value={form.descripcion} onChange={e => set('descripcion', e.target.value)}
                  rows={2} placeholder="Breve descripción del uso de este tipo..."
                  className="w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>

              {/* Orden */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Orden en el selector</label>
                <input type="number" min="1" max="99" value={form.orden} onChange={e => set('orden', e.target.value)}
                  className="w-24 border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <p className="text-xs text-gray-400 mt-1">Número menor = aparece primero</p>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex gap-3 justify-end bg-gray-50 rounded-b-2xl">
              <button onClick={cerrarModal}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors">
                Cancelar
              </button>
              <button onClick={guardar} disabled={saving}
                className="px-5 py-2 bg-[#1e3a5f] text-white rounded-xl text-sm font-bold hover:bg-blue-900 disabled:opacity-50 transition-colors">
                {saving ? 'Guardando...' : editItem ? 'Guardar cambios' : 'Crear tipo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CONFIRMAR ELIMINACIÓN (préstamo) ══ */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <p className="text-4xl mb-2">⚠️</p>
              <h3 className="font-bold text-gray-800">¿Eliminar tipo?</h3>
              <p className="text-sm text-gray-500 mt-1">
                Se eliminará <strong>"{confirmDel.label}"</strong>. Si tiene productos activos, solo se desactivará.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 py-2.5 rounded-xl border text-sm font-semibold text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => eliminar(confirmDel)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL NUEVO TIPO DE GASTO ══ */}
      {modalGasto && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-5 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-800">🏷️ Nuevo tipo de gasto</h3>
              <button onClick={() => setModalGasto(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Nombre *</label>
              <input type="text" value={formGasto.nombre}
                onChange={e => setFormGasto({ nombre: e.target.value.toUpperCase() })}
                placeholder="Ej: Veterinario, Publicidad..."
                className="w-full border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase" />
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end bg-gray-50 rounded-b-2xl">
              <button onClick={() => setModalGasto(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-200">Cancelar</button>
              <button onClick={guardarGasto} disabled={savingGasto}
                className="px-5 py-2 bg-[#1e3a5f] text-white rounded-xl text-sm font-bold hover:bg-blue-900 disabled:opacity-50">
                {savingGasto ? 'Guardando...' : 'Crear tipo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CONFIRMAR ELIMINACIÓN (gasto) ══ */}
      {confirmDelG && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <p className="text-4xl mb-2">⚠️</p>
              <h3 className="font-bold text-gray-800">¿Eliminar tipo de gasto?</h3>
              <p className="text-sm text-gray-500 mt-1">Se eliminará <strong>"{confirmDelG.nombre}"</strong>.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelG(null)}
                className="flex-1 py-2.5 rounded-xl border text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={() => eliminarGasto(confirmDelG)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
