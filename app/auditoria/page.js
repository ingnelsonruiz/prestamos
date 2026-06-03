'use client'
import { useEffect, useState } from 'react'

const moduloColor = {
  'Autenticación': 'bg-gray-100 text-gray-600',
  'Clientes':      'bg-blue-100 text-blue-700',
  'Préstamos':     'bg-yellow-100 text-yellow-700',
  'Cobros':        'bg-green-100 text-green-700',
  'Usuarios':      'bg-purple-100 text-purple-700',
}

const accionIcon = {
  'Inicio de sesión':    '🔐',
  'Cierre de sesión':    '🚪',
  'Crear cliente':       '➕',
  'Editar cliente':      '✏️',
  'Eliminar cliente':    '🗑️',
  'Crear préstamo':      '💰',
  'Editar préstamo':     '✏️',
  'Eliminar préstamo':   '🗑️',
  'Refinanciar préstamo':'🔄',
  'Registrar pago':      '💳',
  'Crear usuario':       '👤',
  'Cambiar contraseña':  '🔑',
  'Desactivar usuario':  '🚫',
}

export default function AuditoriaPage() {
  const [logs, setLogs]       = useState([])
  const [filtros, setFiltros] = useState({ modulo:'', usuario:'', fecha:'' })
  const [loading, setLoading] = useState(false)

  const cargar = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtros.modulo)  params.set('modulo',  filtros.modulo)
    if (filtros.usuario) params.set('usuario', filtros.usuario)
    if (filtros.fecha)   params.set('fecha',   filtros.fecha)
    params.set('limite', '200')

    const res = await fetch('/api/auditoria?' + params.toString())
    const data = await res.json()
    setLogs(data)
    setLoading(false)
  }

  useEffect(() => { cargar() }, [])

  const set = (k,v) => setFiltros(f => ({...f,[k]:v}))

  const MODULOS = ['','Autenticación','Clientes','Préstamos','Cobros','Usuarios']

  return (
    <div className="space-y-6 max-w-6xl">
      <h2 className="text-2xl font-bold text-gray-800">📋 Auditoría del sistema</h2>

      {/* Filtros */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-gray-500">Módulo</label>
          <select className="mt-1 border rounded-lg px-3 py-2 text-sm"
            value={filtros.modulo} onChange={e=>set('modulo',e.target.value)}>
            {MODULOS.map(m=><option key={m} value={m}>{m||'Todos'}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Usuario</label>
          <input type="text" placeholder="Buscar usuario..."
            className="mt-1 border rounded-lg px-3 py-2 text-sm"
            value={filtros.usuario} onChange={e=>set('usuario',e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Fecha</label>
          <input type="date" className="mt-1 border rounded-lg px-3 py-2 text-sm"
            value={filtros.fecha} onChange={e=>set('fecha',e.target.value)} />
        </div>
        <button onClick={cargar}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          🔍 Filtrar
        </button>
        <button onClick={() => { setFiltros({modulo:'',usuario:'',fecha:''}); setTimeout(cargar,100) }}
          className="border text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
          Limpiar
        </button>
        <span className="text-xs text-gray-400 ml-auto">{logs.length} registro(s)</span>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Fecha y hora</th>
              <th className="text-left px-4 py-3">Usuario</th>
              <th className="text-left px-4 py-3">Módulo</th>
              <th className="text-left px-4 py-3">Acción</th>
              <th className="text-left px-4 py-3">Descripción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading
              ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">Cargando...</td></tr>
              : logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(log.fecha).toLocaleString('es-CO')}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{log.usuario_nombre}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${moduloColor[log.modulo]||'bg-gray-100 text-gray-600'}`}>
                      {log.modulo}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">
                    {accionIcon[log.accion]||'📌'} {log.accion}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate">
                    {log.descripcion}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
        {!loading && logs.length === 0 && (
          <p className="text-center text-gray-400 py-10 text-sm">Sin registros</p>
        )}
      </div>
    </div>
  )
}
