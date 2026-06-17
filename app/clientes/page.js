'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const estadoColor = {
  sin_prestamos: 'bg-gray-100 text-gray-600',
  al_dia:        'bg-green-100 text-green-700',
  activo:        'bg-blue-100 text-blue-700',
  en_mora:       'bg-red-100 text-red-700',
  solvente:      'bg-emerald-100 text-emerald-700',
}

const FORM_VACIO = { documento:'', nombre:'', telefono:'', direccion:'', email:'', es_prueba: false }

export default function ClientesPage() {
  const [clientes, setClientes]     = useState([])
  const [buscar, setBuscar]         = useState('')
  const [filtroPrueba, setFiltroPrueba] = useState('todos') // 'todos' | 'reales' | 'prueba'
  const [modal, setModal]           = useState(false)
  const [form, setForm]             = useState(FORM_VACIO)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [eliminando, setEliminando]       = useState(null)  // id del cliente en proceso
  const [confirmElim, setConfirmElim]     = useState(null)  // cliente individual a confirmar
  const [confirmLimpiar, setConfirmLimpiar] = useState(false) // modal limpiar todos
  const [limpiando, setLimpiando]         = useState(false)

  const cargar = (q = '', prueba = filtroPrueba) => {
    const params = new URLSearchParams({ q })
    if (prueba === 'reales') params.set('solo_prueba', 'false')
    if (prueba === 'prueba') params.set('solo_prueba', 'true')
    fetch(`/api/clientes?${params}`)
      .then(r => r.json())
      .then(data => setClientes(Array.isArray(data) ? data : []))
  }

  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cambiarFiltro = (nuevo) => {
    setFiltroPrueba(nuevo)
    cargar(buscar, nuevo)
  }

  const guardar = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    setClientes(prev => [...prev, {
      ...data,
      productos_activos: 0,
      total_productos:   0,
      total_pagos:       0,
      cuotas_en_mora:    0,
      estado_calculado:  'sin_prestamos',
    }].sort((a, b) => a.es_prueba - b.es_prueba || a.nombre.localeCompare(b.nombre)))
    setModal(false)
    setForm(FORM_VACIO)
  }

  const togglePrueba = async (cliente) => {
    const nuevo = !cliente.es_prueba
    // Optimista: actualiza UI de inmediato
    setClientes(prev => prev.map(c => c.id === cliente.id ? { ...c, es_prueba: nuevo } : c))
    const res = await fetch(`/api/clientes/${cliente.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre:    cliente.nombre,
        telefono:  cliente.telefono,
        direccion: cliente.direccion,
        email:     cliente.email,
        es_prueba: nuevo,
      })
    })
    if (!res.ok) {
      // Revertir si falla
      setClientes(prev => prev.map(c => c.id === cliente.id ? { ...c, es_prueba: !nuevo } : c))
    }
  }

  const eliminar = async (cliente) => {
    setEliminando(cliente.id)
    const res = await fetch(`/api/clientes/${cliente.id}`, { method: 'DELETE' })
    const data = await res.json()
    setEliminando(null)
    setConfirmElim(null)
    if (!res.ok) { alert(data.error); return }
    setClientes(prev => prev.filter(c => c.id !== cliente.id))
  }

  // Un cliente es eliminable si no tiene ningún producto ni pago registrado
  const esEliminable = c =>
    Number(c.total_productos || 0) === 0 && Number(c.total_pagos || 0) === 0

  const compartir = (cliente) => {
    const url = `${window.location.origin}/autoregistro/${cliente.id}`
    const texto = `Hola ${cliente.nombre}, por favor completa tus datos aquí: ${url}`
    if (navigator.share) {
      navigator.share({ title: 'Completa tus datos', text: texto, url })
    } else {
      // Fallback: abrir WhatsApp Web
      const wa = cliente.telefono
        ? `https://wa.me/57${cliente.telefono.replace(/\D/g,'')}?text=${encodeURIComponent(texto)}`
        : `https://wa.me/?text=${encodeURIComponent(texto)}`
      window.open(wa, '_blank')
    }
  }

  const pruebaSinMovimientos = clientes.filter(c => c.es_prueba && esEliminable(c))
  const pruebaCONMovimientos = clientes.filter(c => c.es_prueba && !esEliminable(c))

  const limpiarPrueba = async () => {
    setLimpiando(true)
    const candidatos = clientes.filter(c => c.es_prueba && esEliminable(c))
    await Promise.all(
      candidatos.map(c => fetch(`/api/clientes/${c.id}`, { method: 'DELETE' }))
    )
    setClientes(prev => prev.filter(c => !candidatos.some(d => d.id === c.id)))
    setLimpiando(false)
    setConfirmLimpiar(false)
  }

  const numPrueba = clientes.filter(c => c.es_prueba).length

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-800">Clientes</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const url = `${window.location.origin}/registro`
              if (navigator.share) {
                navigator.share({ title: 'Registro de clientes', url })
              } else {
                navigator.clipboard.writeText(url)
                  .then(() => alert('✅ Enlace copiado:\n' + url))
              }
            }}
            title="Compartir enlace para que nuevos clientes se registren solos"
            className="border border-green-500 text-green-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-50 flex items-center gap-1.5">
            📱 Enlace de registro
          </button>
          <button onClick={() => setModal(true)}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
            + Nuevo cliente
          </button>
        </div>
      </div>

      {/* Búsqueda */}
      <input
        type="text" placeholder="Buscar por nombre o documento..."
        className="w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        value={buscar}
        onChange={e => { setBuscar(e.target.value); cargar(e.target.value) }}
      />

      {/* Filtros de tipo + botón limpiar prueba */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: 'todos',   label: 'Todos' },
          { key: 'reales',  label: '✅ Reales' },
          { key: 'prueba',  label: `🧪 Prueba${numPrueba > 0 ? ` (${numPrueba})` : ''}` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => cambiarFiltro(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
              ${filtroPrueba === key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'}`}>
            {label}
          </button>
        ))}

        {pruebaSinMovimientos.length > 0 && (
          <button onClick={() => setConfirmLimpiar(true)}
            className="ml-2 px-3 py-1.5 rounded-full text-xs font-medium border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 transition-colors">
            🗑️ Borrar prueba sin movimientos ({pruebaSinMovimientos.length})
          </button>
        )}
      </div>

      {/* ── Vista móvil: tarjetas ── */}
      <div className="lg:hidden space-y-2">
        {clientes.length === 0 && (
          <p className="text-center text-gray-400 py-10 text-sm">Sin clientes registrados</p>
        )}
        {clientes.map(c => (
          <div key={c.id} className={`rounded-xl border px-4 py-3 ${c.es_prueba ? 'bg-amber-50' : 'bg-white'}`}>
            <div className="flex items-center justify-between gap-3">
              <Link href={`/clientes/${c.id}`} className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">{c.nombre}</p>
                <p className="text-xs text-gray-500 mt-0.5">{c.documento}</p>
              </Link>
              <div className="flex items-center gap-2 flex-shrink-0">
                <label className="flex items-center gap-1 text-xs text-amber-700 cursor-pointer">
                  <input type="checkbox" checked={!!c.es_prueba} onChange={() => togglePrueba(c)}
                    className="w-3.5 h-3.5 accent-amber-500" />
                  Prueba
                </label>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${estadoColor[c.estado_calculado] || estadoColor.sin_prestamos}`}>
                  {(c.estado_calculado||'sin préstamos').replace('_',' ')}
                </span>
                <button onClick={() => compartir(c)} title="Enviar formulario al cliente"
                  className="text-green-600 text-sm p-1">📱</button>
                {esEliminable(c) && (
                  <button onClick={() => setConfirmElim(c)}
                    className="text-red-400 hover:text-red-600 text-sm p-1" title="Eliminar cliente">
                    🗑️
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Vista desktop: tabla ── */}
      <div className="hidden lg:block bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Nombre</th>
              <th className="text-left px-4 py-3">Documento</th>
              <th className="text-left px-4 py-3">Teléfono</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-left px-4 py-3">Activos</th>
              <th className="text-center px-4 py-3" title="Marcar como cliente de prueba">🧪 Prueba</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {clientes.map(c => (
              <tr key={c.id} className={`hover:bg-gray-50 ${c.es_prueba ? 'bg-amber-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{c.nombre}</td>
                <td className="px-4 py-3 text-gray-500">{c.documento}</td>
                <td className="px-4 py-3 text-gray-500">{c.telefono || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${estadoColor[c.estado_calculado] || estadoColor.sin_prestamos}`}>
                    {(c.estado_calculado||'sin_prestamos').replace('_',' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">{c.productos_activos || 0}</td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={!!c.es_prueba}
                    onChange={() => togglePrueba(c)}
                    title={c.es_prueba ? 'Cliente de prueba — click para marcar como real' : 'Click para marcar como prueba'}
                    className="w-4 h-4 accent-amber-500 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 justify-end">
                    <Link href={`/clientes/${c.id}`} className="text-primary-600 hover:underline text-xs font-medium">
                      Ver →
                    </Link>
                    <button onClick={() => compartir(c)}
                      title="Enviar enlace para que el cliente complete sus datos"
                      className="text-green-600 hover:text-green-800 text-xs font-medium">
                      📱
                    </button>
                    {esEliminable(c) && (
                      <button onClick={() => setConfirmElim(c)}
                        className="text-red-400 hover:text-red-600 text-xs font-medium" title="Eliminar cliente sin movimientos">
                        🗑️
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {clientes.length === 0 && (
          <p className="text-center text-gray-400 py-10 text-sm">Sin clientes registrados</p>
        )}
      </div>

      {/* ── Modal nuevo cliente ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-4">Nuevo cliente</h3>
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <form onSubmit={guardar} className="space-y-3">
              {[
                { name:'documento', label:'Documento *', type:'text' },
                { name:'nombre',    label:'Nombre completo *', type:'text' },
                { name:'telefono',  label:'Teléfono', type:'text' },
                { name:'direccion', label:'Dirección', type:'text' },
                { name:'email',     label:'Email', type:'email' },
              ].map(f => (
                <div key={f.name}>
                  <label className="text-xs font-medium text-gray-600">{f.label}</label>
                  <input type={f.type} required={f.label.includes('*')}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={form[f.name]}
                    onChange={e => setForm(p => ({...p, [f.name]: e.target.value}))}
                  />
                </div>
              ))}

              {/* Checkbox cliente de prueba */}
              <div className="flex items-center gap-2 pt-1 p-3 rounded-lg border border-dashed border-amber-300 bg-amber-50">
                <input
                  type="checkbox"
                  id="chk_es_prueba"
                  checked={form.es_prueba}
                  onChange={e => setForm(p => ({ ...p, es_prueba: e.target.checked }))}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
                <label htmlFor="chk_es_prueba" className="text-sm text-amber-800 cursor-pointer select-none">
                  🧪 Marcar como <strong>cliente de prueba</strong>
                  <span className="block text-xs text-amber-600 font-normal">
                    Los clientes de prueba se pueden eliminar si no tienen movimientos
                  </span>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setModal(false); setForm(FORM_VACIO); setError('') }}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                  {loading ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal limpiar todos los de prueba ── */}
      {confirmLimpiar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-2 text-red-600">🗑️ Borrar clientes de prueba</h3>

            <div className="mb-4 space-y-2 text-sm text-gray-700">
              <p>Se eliminarán <strong className="text-red-600">{pruebaSinMovimientos.length} cliente(s)</strong> de prueba sin movimientos:</p>
              <ul className="text-xs text-gray-500 max-h-32 overflow-y-auto border rounded p-2 bg-gray-50">
                {pruebaSinMovimientos.map(c => <li key={c.id}>• {c.nombre} ({c.documento})</li>)}
              </ul>
              {pruebaCONMovimientos.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  ⚠️ {pruebaCONMovimientos.length} cliente(s) de prueba <strong>no se eliminarán</strong> porque tienen movimientos registrados.
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setConfirmLimpiar(false)}
                className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={limpiarPrueba} disabled={limpiando}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {limpiando ? 'Eliminando...' : `Sí, borrar ${pruebaSinMovimientos.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal confirmación eliminación ── */}
      {confirmElim && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-2 text-red-600">Eliminar cliente</h3>
            <p className="text-sm text-gray-700 mb-1">
              ¿Eliminar a <strong>{confirmElim.nombre}</strong>?
            </p>
            <p className="text-xs text-gray-500 mb-5">
              Esta acción es irreversible. Solo es posible porque el cliente no tiene productos ni pagos registrados.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmElim(null)}
                className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => eliminar(confirmElim)} disabled={eliminando === confirmElim.id}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {eliminando === confirmElim.id ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
