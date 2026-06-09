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

export default function ClientesPage() {
  const [clientes, setClientes] = useState([])
  const [buscar, setBuscar]     = useState('')
  const [modal, setModal]       = useState(false)
  const [form, setForm]         = useState({ documento:'', nombre:'', telefono:'', direccion:'', email:'' })
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const cargar = (q='') => {
    fetch(`/api/clientes?q=${q}`)
      .then(r => r.json())
      .then(data => setClientes(Array.isArray(data) ? data : []))
  }

  useEffect(() => { cargar() }, [])

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
    setModal(false)
    setForm({ documento:'', nombre:'', telefono:'', direccion:'', email:'' })
    cargar()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Clientes</h2>
        <button onClick={() => setModal(true)}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          + Nuevo cliente
        </button>
      </div>

      {/* Búsqueda */}
      <input
        type="text" placeholder="Buscar por nombre o documento..."
        className="w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        value={buscar}
        onChange={e => { setBuscar(e.target.value); cargar(e.target.value) }}
      />

      {/* ── Vista móvil: tarjetas ── */}
      <div className="lg:hidden space-y-2">
        {clientes.length === 0 && (
          <p className="text-center text-gray-400 py-10 text-sm">Sin clientes registrados</p>
        )}
        {clientes.map(c => (
          <Link key={c.id} href={`/clientes/${c.id}`}
            className="block bg-white rounded-xl border px-4 py-3 hover:bg-gray-50 transition-colors active:scale-[0.99]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">{c.nombre}</p>
                <p className="text-xs text-gray-500 mt-0.5">{c.documento}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${estadoColor[c.estado_calculado] || estadoColor.sin_prestamos}`}>
                  {(c.estado_calculado||'sin préstamos').replace('_',' ')}
                </span>
                <span className="text-gray-300">›</span>
              </div>
            </div>
            {(c.telefono || (c.productos_activos > 0)) && (
              <div className="flex items-center gap-3 mt-1.5">
                {c.telefono && (
                  <span className="text-xs text-gray-500">📞 {c.telefono}</span>
                )}
                {c.productos_activos > 0 && (
                  <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                    {c.productos_activos} activo{c.productos_activos !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </Link>
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
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {clientes.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{c.nombre}</td>
                <td className="px-4 py-3 text-gray-500">{c.documento}</td>
                <td className="px-4 py-3 text-gray-500">{c.telefono || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${estadoColor[c.estado_calculado] || estadoColor.sin_prestamos}`}>
                    {(c.estado_calculado||'sin_prestamos').replace('_',' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">{c.productos_activos || 0}</td>
                <td className="px-4 py-3">
                  <Link href={`/clientes/${c.id}`} className="text-primary-600 hover:underline text-xs font-medium">
                    Ver →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {clientes.length === 0 && (
          <p className="text-center text-gray-400 py-10 text-sm">Sin clientes registrados</p>
        )}
      </div>

      {/* Modal nuevo cliente */}
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
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)}
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
    </div>
  )
}
