'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import { useState } from 'react'

const RUTAS_PUBLICAS = ['/login', '/estado']

export default function LayoutWrapper({ children }) {
  const pathname  = usePathname()
  const esPublica = RUTAS_PUBLICAS.some(r => pathname.startsWith(r))
  const [sidebarAbierto, setSidebarAbierto] = useState(false)

  if (esPublica) return <>{children}</>

  return (
    <div className="flex min-h-screen bg-gray-50">

      {/* Sidebar desktop */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Sidebar móvil — drawer */}
      {sidebarAbierto && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarAbierto(false)} />
          <div className="fixed left-0 top-0 h-full z-50 lg:hidden">
            <Sidebar onClose={() => setSidebarAbierto(false)} />
          </div>
        </>
      )}

      {/* Contenido principal */}
      <div className="flex-1 flex flex-col min-h-screen">

        {/* Header móvil */}
        <header className="lg:hidden bg-[#1e3a5f] text-white px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setSidebarAbierto(true)}
            className="p-2 rounded-lg hover:bg-blue-800 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-center">
            <p className="font-bold text-sm leading-tight">💼 Inversiones</p>
            <p className="text-blue-300 text-xs">Tata Liñan</p>
          </div>
          <div className="w-10" /> {/* spacer */}
        </header>

        {/* Página */}
        <main className="flex-1 p-4 lg:p-8 pb-24 lg:pb-8 overflow-auto">
          {children}
        </main>
      </div>

      {/* Navegación inferior móvil */}
      <BottomNav />
    </div>
  )
}
