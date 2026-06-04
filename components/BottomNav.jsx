'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/',          label: 'Inicio',    icon: '📊' },
  { href: '/clientes',  label: 'Clientes',  icon: '👥' },
  { href: '/prestamos', label: 'Créditos',  icon: '💰' },
  { href: '/cobros',    label: 'Cobros',    icon: '💳' },
  { href: '/empenos',   label: 'Empeños',   icon: '🔒' },
  { href: '/recibos',   label: 'Recibos',   icon: '🧾' },
  { href: '/informes',  label: 'Informes',  icon: '📊' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-30 safe-area-pb">
      <div className="flex">
        {nav.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href}
              className={`flex-1 flex flex-col items-center py-2 pt-2.5 text-xs transition-colors
                ${active ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="text-3xl leading-none mb-0.5">{item.icon}</span>
              <span className={`text-[10px] font-medium ${active?'text-blue-600':'text-gray-400'}`}>
                {item.label}
              </span>
              {active && <span className="absolute bottom-0 w-8 h-0.5 bg-blue-600 rounded-t-full" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
