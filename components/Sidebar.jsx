'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const nav = [
  { href: '/',           label: 'Dashboard',  icon: '📊' },
  { href: '/clientes',   label: 'Clientes',   icon: '👥' },
  { href: '/prestamos',  label: 'Préstamos',  icon: '💰' },
  { href: '/cobros',     label: 'Cobros',     icon: '💳' },
  { href: '/empenos',    label: 'Empeños',    icon: '🔒' },
  { href: '/recibos',    label: 'Recibos',    icon: '🧾' },
  { href: '/informes',   label: 'Informes',   icon: '📊' },
  { href: '/migracion',  label: 'Migración',  icon: '📦' },
]

export default function Sidebar({ onClose }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [user, setUser] = useState(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r=>r.json()).then(d => setUser(d.user))
  }, [])

  const cerrarSesion = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-64 min-h-screen bg-[#1e3a5f] text-white flex flex-col">
      <div className="p-6 border-b border-blue-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold leading-tight">💼 Inversiones</h1>
          <p className="text-blue-300 text-sm font-medium">Hnos Liñan</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-blue-300 hover:text-white p-1 lg:hidden">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {nav.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href} onClick={onClose}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors
                ${active ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-800 hover:text-white'}`}>
              <span className="text-2xl">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}

        {/* Solo admin */}
        {user?.rol === 'admin' && (
          <>
            <Link href="/usuarios"
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors
                ${pathname.startsWith('/usuarios') ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-800 hover:text-white'}`}>
              <span>⚙️</span>
              Usuarios
            </Link>
            <Link href="/auditoria"
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors
                ${pathname.startsWith('/auditoria') ? 'bg-blue-700 text-white' : 'text-blue-100 hover:bg-blue-800 hover:text-white'}`}>
              <span>📋</span>
              Auditoría
            </Link>
          </>
        )}
      </nav>

      {/* Usuario logueado */}
      <div className="p-4 border-t border-blue-800">
        {user && (
          <div className="mb-3 px-2">
            <p className="text-xs text-blue-300">Conectado como</p>
            <p className="text-sm font-semibold text-white truncate">{user.nombre}</p>
            <p className="text-xs text-blue-400">{user.rol}</p>
          </div>
        )}
        <button onClick={cerrarSesion}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-red-300 hover:bg-red-900/30 hover:text-red-200 transition-colors">
          🚪 Cerrar sesión
        </button>
        <div className="mt-2 px-2 text-center">
          <p className="text-blue-500 text-xs leading-snug">Desarrollado por</p>
          <p className="text-blue-300 text-xs font-semibold leading-snug">Ing. Nelson Javier Ruiz Lozano</p>
          <div className="mt-1 inline-flex items-center gap-1.5 bg-blue-900/50 border border-blue-700/40 rounded-md px-2 py-0.5">
            <span className="text-yellow-400 text-xs font-black">⚡ DataDevs</span>
            <span className="text-blue-400 text-xs">Systems</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
