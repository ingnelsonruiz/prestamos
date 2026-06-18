'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const navPrincipal = [
  { href: '/',          label: 'Inicio',    icon: '📊' },
  { href: '/cobros',    label: 'Cobros',    icon: '💳' },
  { href: '/clientes',  label: 'Clientes',  icon: '👥' },
  { href: '/prestamos', label: 'Créditos',  icon: '💰' },
]

const navSecundario = [
  { href: '/gastos',    label: 'Empresas',  icon: '🏢' },
  { href: '/empenos',   label: 'Empeños',   icon: '🔒' },
  { href: '/recibos',   label: 'Recibos',   icon: '🧾' },
  { href: '/informes',  label: 'Informes',  icon: '📈' },
  { href: '/migracion', label: 'Migración', icon: '📦' },
]

export default function BottomNav() {
  const pathname = usePathname()
  const [masAbierto, setMasAbierto] = useState(false)

  const enSecundario = navSecundario.some(item =>
    pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
  )

  return (
    <>
      {/* Drawer "Más" */}
      {masAbierto && (
        <>
          <div
            className="fixed inset-0 z-40 lg:hidden"
            onClick={() => setMasAbierto(false)}
          />
          <div className="fixed bottom-16 left-0 right-0 z-50 lg:hidden bg-white border-t border-gray-200 shadow-2xl rounded-t-2xl pb-2">
            <div className="flex justify-center pt-2 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 mb-2">Más opciones</p>
            <div className="grid grid-cols-5 gap-1 px-3">
              {navSecundario.map(item => {
                const active = pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href))
                return (
                  <Link key={item.href} href={item.href}
                    onClick={() => setMasAbierto(false)}
                    className={`flex flex-col items-center py-3 rounded-xl transition-colors
                      ${active ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}>
                    <span className="text-2xl leading-none mb-1">{item.icon}</span>
                    <span className="text-[11px] font-medium">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Barra principal */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-30">
        <div className="flex h-16">
          {navPrincipal.map(item => {
            const active = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href}
                className="relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors">
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-blue-600 rounded-b-full" />
                )}
                <span className="text-2xl leading-none">{item.icon}</span>
                <span className={`text-[10px] font-semibold ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                  {item.label}
                </span>
              </Link>
            )
          })}

          {/* Botón Más */}
          <button
            onClick={() => setMasAbierto(v => !v)}
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors">
            {enSecundario && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-blue-600 rounded-b-full" />
            )}
            <span className="text-2xl leading-none">{masAbierto ? '✕' : '⋯'}</span>
            <span className={`text-[10px] font-semibold ${enSecundario ? 'text-blue-600' : 'text-gray-400'}`}>
              Más
            </span>
          </button>
        </div>
      </nav>
    </>
  )
}
