'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm]   = useState({ usuario: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const login = async e => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#1e3a5f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo / nombre */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">💼</div>
          <h1 className="text-2xl font-bold text-white">Inversiones</h1>
          <p className="text-blue-300 text-lg font-medium">Hnos Liñan</p>
        </div>

        {/* Card login */}
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">Iniciar sesión</h2>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={login} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Usuario</label>
              <input type="text" required autoFocus
                className="mt-1 w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ej: admin"
                value={form.usuario}
                onChange={e => setForm(f => ({...f, usuario: e.target.value}))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Contraseña</label>
              <input type="password" required
                className="mt-1 w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(f => ({...f, password: e.target.value}))} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-[#1e3a5f] text-white rounded-lg py-3 font-semibold text-sm hover:bg-blue-900 disabled:opacity-50 transition-colors mt-2">
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-blue-400 text-xs mt-6">
          Sistema de gestión de créditos
        </p>
      </div>
    </div>
  )
}
