'use client'
import { useState, useCallback } from 'react'

const VACIO = { nombre:'', documento:'', telefono:'', telefono2:'', direccion:'', email:'' }

function validar(form, cedulaExiste) {
  const e = {}
  const nom = form.nombre.trim()
  if (!nom) e.nombre = 'El nombre es obligatorio.'
  else if (nom.length < 3) e.nombre = 'Mínimo 3 caracteres.'
  else if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(nom)) e.nombre = 'Solo letras, sin números.'

  const doc = form.documento.trim()
  if (!doc) e.documento = 'La cédula es obligatoria.'
  else if (!/^\d+$/.test(doc)) e.documento = 'Solo números, sin puntos ni espacios.'
  else if (doc.length < 5)  e.documento = 'Mínimo 5 dígitos.'
  else if (doc.length > 12) e.documento = 'Máximo 12 dígitos.'
  else if (cedulaExiste)    e.documento = 'Esa cédula ya está registrada.'

  const tel = form.telefono.trim()
  if (!tel) e.telefono = 'El teléfono es obligatorio.'
  else if (!/^\d+$/.test(tel)) e.telefono = 'Solo números, sin espacios.'
  else if (tel.length < 7)  e.telefono = 'Mínimo 7 dígitos.'
  else if (tel.length > 10) e.telefono = 'Máximo 10 dígitos.'

  const tel2 = form.telefono2.trim()
  if (tel2) {
    if (!/^\d+$/.test(tel2)) e.telefono2 = 'Solo números.'
    else if (tel2.length < 7)  e.telefono2 = 'Mínimo 7 dígitos.'
    else if (tel2.length > 10) e.telefono2 = 'Máximo 10 dígitos.'
  }

  const email = form.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    e.email = 'Correo no válido.'

  return e
}

// ── Campo genérico — definido FUERA del componente para no recrearse en cada render ──
function InputField({ name, label, requerido, tipo='text', modo, placeholder,
                      value, onChange, onBlur, onKeyDown, error, toque, extra }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        {label} {requerido && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <input
          type={tipo} name={name} inputMode={modo}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className={`w-full border rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 transition-colors
            ${toque && error
              ? 'border-red-400 focus:ring-red-300 bg-red-50'
              : toque && !error
                ? 'border-green-400 focus:ring-green-300'
                : 'border-gray-300 focus:ring-blue-400'}
            ${extra || ''}`}
        />
        {extra && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none">
            {extra}
          </span>
        )}
      </div>
      {toque && error && (
        <p className="text-xs text-red-600 mt-1">⚠️ {error}</p>
      )}
    </div>
  )
}

// ── Componente principal ────────────────────────────────────────────────────
export default function RegistroPage() {
  const [form, setForm]                 = useState(VACIO)
  const [tocados, setTocados]           = useState({})
  const [cedulaExiste, setCedulaExiste] = useState(false)
  const [verificando, setVerificando]   = useState(false)
  const [estado, setEstado]             = useState('listo') // listo | enviando | exito
  const [errorGlobal, setErrorGlobal]   = useState('')

  const errores   = validar(form, cedulaExiste)
  const formValido = Object.keys(errores).length === 0

  const cambiar = useCallback((e) => {
    const { name, value } = e.target
    setForm(p => ({ ...p, [name]: value }))
    if (name === 'documento') setCedulaExiste(false)
  }, [])

  const noEnter = useCallback((e) => {
    if (e.key === 'Enter') e.preventDefault()
  }, [])

  const tocar = useCallback((name) => {
    setTocados(p => ({ ...p, [name]: true }))
  }, [])

  const verificarCedula = useCallback(async (doc) => {
    const d = doc.trim()
    if (!d || !/^\d{5,12}$/.test(d)) { setCedulaExiste(false); return }
    setVerificando(true)
    try {
      const r = await fetch(`/api/registro?documento=${encodeURIComponent(d)}`)
      const data = await r.json()
      setCedulaExiste(!!data.existe)
    } catch { setCedulaExiste(false) }
    setVerificando(false)
  }, [])

  const enviar = async (e) => {
    e.preventDefault()
    setTocados({ nombre:true, documento:true, telefono:true, telefono2:true, email:true })
    if (!formValido) return
    setEstado('enviando')
    setErrorGlobal('')
    const res = await fetch('/api/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) {
      setErrorGlobal(data.error || 'Ocurrió un error. Intenta de nuevo.')
      if (data.errores?.documento) setCedulaExiste(true)
      setEstado('listo')
      return
    }
    setEstado('exito')
  }

  /* ── Pantalla éxito ── */
  if (estado === 'exito') return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-green-50 px-6 text-center">
      <span className="text-6xl mb-4">🎉</span>
      <h1 className="text-2xl font-bold text-green-800 mb-2">¡Registro exitoso!</h1>
      <p className="text-sm text-green-700 mb-1">Gracias, <strong>{form.nombre.trim()}</strong>.</p>
      <p className="text-sm text-green-600 max-w-xs">
        Tus datos quedaron registrados. En breve nos comunicaremos contigo.
      </p>
      <button onClick={() => { setForm(VACIO); setTocados({}); setCedulaExiste(false); setEstado('listo') }}
        className="mt-8 px-6 py-2.5 bg-green-700 text-white rounded-xl text-sm font-medium hover:bg-green-800">
        Registrar otra persona
      </button>
    </div>
  )

  /* ── Formulario ── */
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b px-5 py-4 flex items-center gap-3 shadow-sm sticky top-0 z-10">
        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          ITL
        </div>
        <div>
          <p className="text-xs text-gray-500 leading-none">Inversiones Hnos Liñán</p>
          <p className="text-sm font-semibold text-gray-800 leading-tight mt-0.5">Formulario de registro</p>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 max-w-md mx-auto w-full">
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          Completa el formulario con tus datos. Los campos con <span className="text-red-500 font-bold">*</span> son obligatorios.
        </p>

        {errorGlobal && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-700">
            ⚠️ {errorGlobal}
          </div>
        )}

        <form onSubmit={enviar} noValidate className="space-y-4">

          <InputField name="nombre" label="Nombre completo" requerido
            placeholder="Ej: Ana María García"
            value={form.nombre} onChange={cambiar} onKeyDown={noEnter}
            onBlur={() => tocar('nombre')}
            error={errores.nombre} toque={tocados.nombre} />

          {/* Cédula con verificación */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Número de cédula <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text" name="documento" inputMode="numeric"
                placeholder="Ej: 1067712345"
                value={form.documento}
                onChange={cambiar}
                onKeyDown={noEnter}
                onBlur={() => { tocar('documento'); verificarCedula(form.documento) }}
                autoComplete="off"
                className={`w-full border rounded-xl px-4 py-3 pr-10 text-sm bg-white focus:outline-none focus:ring-2 transition-colors
                  ${tocados.documento && errores.documento
                    ? 'border-red-400 focus:ring-red-300 bg-red-50'
                    : tocados.documento && !errores.documento
                      ? 'border-green-400 focus:ring-green-300'
                      : 'border-gray-300 focus:ring-blue-400'}`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none">
                {verificando ? '⏳' : tocados.documento && !errores.documento ? '✅' : ''}
              </span>
            </div>
            {tocados.documento && errores.documento && (
              <p className="text-xs text-red-600 mt-1">⚠️ {errores.documento}</p>
            )}
            {verificando && <p className="text-xs text-gray-400 mt-1">Verificando cédula...</p>}
          </div>

          <InputField name="telefono" label="Teléfono / Celular" requerido
            modo="numeric" placeholder="Ej: 3001234567"
            value={form.telefono} onChange={cambiar} onKeyDown={noEnter}
            onBlur={() => tocar('telefono')}
            error={errores.telefono} toque={tocados.telefono} />

          <InputField name="telefono2" label="Teléfono adicional"
            modo="numeric" placeholder="Número de familiar o alterno (opcional)"
            value={form.telefono2} onChange={cambiar} onKeyDown={noEnter}
            onBlur={() => tocar('telefono2')}
            error={errores.telefono2} toque={tocados.telefono2} />

          <InputField name="direccion" label="Dirección"
            placeholder="Barrio, calle, número de casa o apto"
            value={form.direccion} onChange={cambiar} onKeyDown={noEnter}
            onBlur={() => tocar('direccion')}
            error={errores.direccion} toque={tocados.direccion} />

          <InputField name="email" label="Correo electrónico" tipo="email" modo="email"
            placeholder="tucorreo@ejemplo.com (opcional)"
            value={form.email} onChange={cambiar} onKeyDown={noEnter}
            onBlur={() => tocar('email')}
            error={errores.email} toque={tocados.email} />

          <button type="submit" disabled={estado === 'enviando'}
            className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold
                       hover:bg-blue-700 active:scale-[0.98] transition-all mt-2
                       disabled:opacity-50 disabled:cursor-not-allowed">
            {estado === 'enviando' ? 'Registrando...' : '✅ Registrarme'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          Tu información es confidencial y solo será usada por Inversiones Hnos Liñán.
        </p>
      </div>
    </div>
  )
}
