'use client'
import { useEffect, useState } from 'react'

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState([])
  const [modal, setModal]       = useState(false)
  const [modalPass, setModalPass] = useState(null)
  const [form, setForm]         = useState({ nombre:'', usuario:'', password:'', rol:'operador' })
  const [nuevaPass, setNuevaPass] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const cargar = () => fetch('/api/usuarios').then(r=>r.json()).then(setUsuarios)
  useEffect(() => { cargar() }, [])

  const guardar = async e => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/usuarios', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form)
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    setModal(false)
    setForm({ nombre:'', usuario:'', password:'', rol:'operador' })
    cargar()
  }

  const cambiarPass = async () => {
    if (!nuevaPass || nuevaPass.length < 4) { alert('Mínimo 4 caracteres'); return }
    setLoading(true)
    await fetch(`/api/usuarios/${modalPass.id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: nuevaPass })
    })
    setLoading(false)
    setModalPass(null)
    setNuevaPass('')
    alert('Contraseña actualizada')
  }

  const toggleActivo = async u => {
    await fetch(`/api/usuarios/${u.id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ activo: !u.activo })
    })
    cargar()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Usuarios</h2>
        <button onClick={() => setModal(true)}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          + Nuevo usuario
        </button>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="text-left px-5 py-3">Nombre</th>
              <th className="text-left px-4 py-3">Usuario</th>
              <th className="text-left px-4 py-3">Rol</th>
              <th className="text-left px-4 py-3">Último acceso</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {usuarios.map(u => (
              <tr key={u.id} className={`hover:bg-gray-50 ${!u.activo?'opacity-50':''}`}>
                <td className="px-5 py-3 font-medium">{u.nombre}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{u.usuario}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                    ${u.rol==='admin'?'bg-purple-100 text-purple-700':'bg-blue-100 text-blue-700'}`}>
                    {u.rol}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleString('es-CO') : 'Nunca'}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                    ${u.activo?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'}`}>
                    {u.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => { setModalPass(u); setNuevaPass('') }}
                      className="text-xs text-blue-600 hover:underline">🔑 Clave</button>
                    <button onClick={() => toggleActivo(u)}
                      className={`text-xs ${u.activo?'text-red-500':'text-green-600'} hover:underline`}>
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal nuevo usuario */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-4">Nuevo usuario</h3>
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <form onSubmit={guardar} className="space-y-3">
              {[
                { name:'nombre',   label:'Nombre completo *', type:'text' },
                { name:'usuario',  label:'Usuario (para login) *', type:'text' },
                { name:'password', label:'Contraseña *', type:'password' },
              ].map(f => (
                <div key={f.name}>
                  <label className="text-xs font-medium text-gray-600">{f.label}</label>
                  <input type={f.type} required
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none"
                    value={form[f.name]} onChange={e => setForm(p=>({...p,[f.name]:e.target.value}))} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-gray-600">Rol</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.rol} onChange={e=>setForm(p=>({...p,rol:e.target.value}))}>
                  <option value="operador">Operador — acceso normal</option>
                  <option value="admin">Admin — gestión de usuarios</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setModal(false)}
                  className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                  {loading?'Guardando...':'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal cambiar contraseña */}
      {modalPass && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-lg font-bold">Cambiar contraseña</h3>
            <p className="text-sm text-gray-500">Usuario: <strong>{modalPass.usuario}</strong></p>
            <div>
              <label className="text-xs font-medium text-gray-600">Nueva contraseña</label>
              <input type="password" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Mínimo 4 caracteres"
                value={nuevaPass} onChange={e=>setNuevaPass(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setModalPass(null)}
                className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={cambiarPass} disabled={loading}
                className="flex-1 bg-primary-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {loading?'Guardando...':'Actualizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
