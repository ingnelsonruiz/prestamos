'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

/* ── SVG Icons ── */
const IconTarget = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
  </svg>
)
const IconTelescope = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M14.5 10.5 3 7l2-4 18 7-8.5 1.5z"/><path d="m14.5 10.5-2 5"/><path d="m10 14-2 5"/><path d="M8 19h8"/>
  </svg>
)
const IconDiamond = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>
  </svg>
)
const IconRocket = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
    <path d="m3.5 11.5 2.5 2.5m6-7-4.5 4.5m9-9C19 3 21 5 21 7s-2 4-4 4-4-2-4-4 2-4 4-4z"/>
    <path d="M12 12 9.5 14.5"/>
  </svg>
)
const IconFinance = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
    <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
  </svg>
)
const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)
const IconEye = ({ off }) => off ? (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
) : (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
)
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
)
const IconLock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)
const IconArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const IconBolt = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
)

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm]     = useState({ usuario: '', password: '' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

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
    <div className="min-h-screen flex flex-col lg:flex-row font-sans">

      {/* ══════════════ PANEL IZQUIERDO ══════════════ */}
      <div
        className="relative lg:w-[58%] flex flex-col justify-between px-8 py-10 lg:px-14 lg:py-12 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #060d1f 0%, #0a1628 40%, #0d1f3c 70%, #091830 100%)' }}
      >
        {/* Grid pattern */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)',
            backgroundSize: '48px 48px'
          }} />

        {/* Orbs de luz */}
        <div className="absolute top-[-80px] left-[-80px] w-[380px] h-[380px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-60px] right-[-60px] w-[320px] h-[320px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(234,179,8,0.08) 0%, transparent 70%)' }} />
        <div className="absolute top-[45%] left-[40%] w-[500px] h-[200px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)' }} />

        {/* ── LOGO ── */}
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-3">
            {/* Ícono principal */}
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl blur-md opacity-60"
                style={{ background: 'linear-gradient(135deg, #eab308, #ca8a04)' }} />
              <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center text-white"
                style={{ background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 50%, #a16207 100%)', boxShadow: '0 8px 32px rgba(234,179,8,0.35)' }}>
                <IconFinance />
              </div>
            </div>
            <div>
              <h1 className="text-[2rem] lg:text-[2.4rem] font-black text-white tracking-tight leading-none">
                Inversiones
              </h1>
              <p className="font-bold tracking-widest text-lg lg:text-xl" style={{ color: '#eab308', letterSpacing: '0.15em' }}>
                HNOS LIÑÁN
              </p>
            </div>
          </div>
          {/* Línea acento */}
          <div className="flex items-center gap-2">
            <div className="h-[2px] w-16 rounded-full" style={{ background: 'linear-gradient(90deg, #eab308, transparent)' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 opacity-80" />
          </div>
        </div>

        {/* ── CONTENIDO CENTRAL ── */}
        <div className="relative z-10 space-y-7 my-8 lg:my-0">

          {/* Misión */}
          <div className="group relative">
            <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full"
              style={{ background: 'linear-gradient(180deg, #3b82f6, transparent)' }} />
            <div className="pl-5">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-400"
                  style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
                  <IconTarget />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: '#eab308' }}>Misión</span>
              </div>
              <p className="text-sm lg:text-base leading-relaxed" style={{ color: 'rgba(191,219,254,0.85)' }}>
                Facilitar soluciones financieras ágiles y confiables para familias y pequeños empresarios,
                con un servicio personalizado que impulse su crecimiento económico.
              </p>
            </div>
          </div>

          {/* Visión */}
          <div className="group relative">
            <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full"
              style={{ background: 'linear-gradient(180deg, #eab308, transparent)' }} />
            <div className="pl-5">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-yellow-400"
                  style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
                  <IconTelescope />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: '#eab308' }}>Visión</span>
              </div>
              <p className="text-sm lg:text-base leading-relaxed" style={{ color: 'rgba(191,219,254,0.85)' }}>
                Ser la empresa prestamista líder de la región para 2030, reconocida por su innovación,
                integridad y compromiso con el bienestar financiero de cada cliente.
              </p>
            </div>
          </div>

          {/* Valores */}
          <div className="group relative">
            <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full"
              style={{ background: 'linear-gradient(180deg, #a855f7, transparent)' }} />
            <div className="pl-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-purple-400"
                  style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)' }}>
                  <IconDiamond />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: '#eab308' }}>Nuestros Valores</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Confianza', color: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.3)', text: '#93c5fd' },
                  { label: 'Integridad', color: 'rgba(234,179,8,0.1)', border: 'rgba(234,179,8,0.25)', text: '#fde68a' },
                  { label: 'Crecimiento', color: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.25)', text: '#86efac' },
                  { label: 'Innovación', color: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.25)', text: '#d8b4fe' },
                  { label: 'Compromiso', color: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', text: '#fca5a5' },
                  { label: 'Cercanía', color: 'rgba(20,184,166,0.1)', border: 'rgba(20,184,166,0.25)', text: '#99f6e4' },
                ].map(v => (
                  <span key={v.label}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: v.color, border: `1px solid ${v.border}`, color: v.text }}>
                    <span className="w-1 h-1 rounded-full inline-block" style={{ background: v.text }} />
                    {v.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Futuro */}
          <div className="group relative">
            <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full"
              style={{ background: 'linear-gradient(180deg, #10b981, transparent)' }} />
            <div className="pl-5">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-400"
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <IconRocket />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: '#eab308' }}>Hacia el Futuro</span>
              </div>
              <p className="text-sm lg:text-base leading-relaxed" style={{ color: 'rgba(191,219,254,0.85)' }}>
                Transformación digital total de la cartera crediticia — analítica inteligente,
                alertas automatizadas y atención omnicanal para cada cliente.
              </p>
            </div>
          </div>
        </div>

        {/* ── FOOTER DESARROLLADOR ── */}
        <div className="relative z-10 pt-5" style={{ borderTop: '1px solid rgba(59,130,246,0.2)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(147,197,253,0.5)' }}>
                Desarrollado por
              </p>
              <p className="text-white text-sm font-bold">Ing. Nelson Javier Ruiz Lozano</p>
            </div>
            {/* Badge DataDevs */}
            <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl"
              style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', boxShadow: '0 0 16px rgba(234,179,8,0.06)' }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-yellow-400"
                style={{ background: 'rgba(234,179,8,0.15)' }}>
                <IconBolt />
              </div>
              <div className="leading-none">
                <p className="text-[11px] font-black tracking-widest" style={{ color: '#fde68a' }}>DATADEVS</p>
                <p className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(253,230,138,0.5)' }}>Systems</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════ PANEL DERECHO — LOGIN ══════════════ */}
      <div className="lg:w-[42%] flex flex-col items-center justify-center px-6 py-10 lg:px-12"
        style={{ background: 'linear-gradient(160deg, #f8fafc 0%, #f1f5f9 100%)' }}>

        <div className="w-full max-w-[360px]">

          {/* Cabecera */}
          <div className="text-center mb-8">
            <div className="relative inline-flex items-center justify-center mb-4">
              <div className="absolute inset-0 rounded-2xl blur-lg opacity-30"
                style={{ background: 'linear-gradient(135deg, #1e3a5f, #3b82f6)' }} />
              <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #0d1f3c 0%, #1e3a5f 100%)', boxShadow: '0 8px 24px rgba(13,31,60,0.25)' }}>
                <IconShield />
                <span className="text-white absolute" style={{ fontSize: '1.4rem' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-7 h-7">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              </div>
            </div>
            <h2 className="text-2xl font-black text-gray-900">Acceso al Sistema</h2>
            <p className="text-gray-500 text-sm mt-1 font-medium">Inversiones Hnos Liñán</p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm mb-5 flex items-center gap-2.5 font-medium"
              style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#dc2626' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          {/* Formulario */}
          <form onSubmit={login} className="space-y-4">
            {/* Usuario */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-gray-500 mb-1.5">
                Usuario
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <IconUser />
                </span>
                <input type="text" required autoFocus
                  className="w-full rounded-xl pl-10 pr-4 py-3.5 text-sm font-semibold text-gray-800 transition-all"
                  style={{
                    background: 'white',
                    border: '2px solid #e2e8f0',
                    outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  placeholder="Ingresa tu usuario"
                  value={form.usuario}
                  onChange={e => setForm(f => ({...f, usuario: e.target.value}))} />
              </div>
            </div>

            {/* Contraseña */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-gray-500 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <IconLock />
                </span>
                <input type={showPass ? 'text' : 'password'} required
                  className="w-full rounded-xl pl-10 pr-11 py-3.5 text-sm font-semibold text-gray-800 transition-all"
                  style={{
                    background: 'white',
                    border: '2px solid #e2e8f0',
                    outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  placeholder="••••••••••••"
                  value={form.password}
                  onChange={e => setForm(f => ({...f, password: e.target.value}))} />
                <button type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-0.5">
                  <IconEye off={showPass} />
                </button>
              </div>
            </div>

            {/* Botón */}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl py-3.5 font-black text-sm text-white flex items-center justify-center gap-2.5 transition-all mt-2"
              style={{
                background: loading ? '#334155' : 'linear-gradient(135deg, #0d1f3c 0%, #1e3a5f 50%, #1e40af 100%)',
                boxShadow: loading ? 'none' : '0 8px 24px rgba(13,31,60,0.3)',
                opacity: loading ? 0.7 : 1,
              }}>
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Verificando credenciales...
                </>
              ) : (
                <>
                  Ingresar al Sistema
                  <IconArrow />
                </>
              )}
            </button>
          </form>

          {/* Info de seguridad */}
          <div className="mt-6 rounded-xl p-4 space-y-2.5"
            style={{ background: 'white', border: '1px solid #e2e8f0' }}>
            {[
              { icon: <IconShield />, text: 'Conexión cifrada · JWT HS256 · Sesión 8h', color: '#3b82f6' },
              { icon: <IconCheck />, text: 'Auditoría completa por usuario e IP', color: '#10b981' },
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, text: 'Gestión de cartera crediticia · v2.0', color: '#a855f7' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2.5 text-xs text-gray-500 font-medium">
                <span style={{ color: item.color }}>{item.icon}</span>
                {item.text}
              </div>
            ))}
          </div>

          {/* Crédito móvil */}
          <p className="lg:hidden text-center text-xs mt-5 font-semibold"
            style={{ color: 'rgba(100,116,139,0.7)' }}>
            ⚡ DataDevs Systems · Ing. Nelson J. Ruiz Lozano
          </p>
        </div>
      </div>
    </div>
  )
}
