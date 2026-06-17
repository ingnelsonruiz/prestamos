'use client'
import { useState, useCallback } from 'react'

const VACIO = { nombre:'', documento:'', telefono:'', telefono2:'', direccion:'', email:'' }

// Validaciones locales (espejo de las del backend)
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
  else if (!/^\d+$/.test(tel)) e.telefono = 'Solo números.'
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

export default function RegistroPage() {
  const [form, setForm]           = useState(VACIO)
  const [tocados, setTocados]     = useState({}) // campos que el usuario ya editó
  const [cedulaExiste, setCedulaExiste] = useState(false)
  const [verificando, setVerificando]   = useState(false)
  const [estado, setEstado]       = useState('listo') // listo | enviando | exito
  const [errorGlobal, setErrorGlobal] = useState('')

  // Verifica cédula contra la BD al salir del campo (onBlur)
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

  const errores = validar(form, cedulaExiste)
  const formValido = Object.keys(errores).length === 0

  const cambiar = (e) => {
    const { name, value } = e.target
    setForm(p => ({ ...p, [name]: value }))
    if (name === 'documento') setCedulaExiste(false)
  }

  // Evita que Enter en cualquier campo de texto dispare el submit
  const noEnter = (e) => { if (e.key === 'Enter') e.preventDefault() }

  const tocar = (name) => setTocados(p => ({ ...p, [name]: true }))

  const mostrarError = (campo) => tocados[campo] && errores[campo]

  const enviar = async (e) => {
    e.preventDefault()
    // Marcar todos como tocados para mostrar todos los errores
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

  /* ── Éxito ── */
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
  const Campo = ({ name, label, requerido, tipo='text', modo, placeholder, children }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        {label} {requerido && <span className="text-red-500">*</span>}
      </label>
      {children || (
        <input
          type={tipo} name={name} inputMode={modo}
          placeholder={placeholder}
          value={form[name]}
          onChange={cambiar}
          onKeyDown={noEnter}
          onBlur={() => {
            tocar(name)
            if (name === 'documento') verificarCedula(form.documento)
          }}
          className={`w-full border rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 transition-colors
            ${mostrarError(name)
              ? 'border-red-400 focus:ring-red-300 bg-red-50'
              : 'border-gray-300 focus:ring-blue-400'}`}
        />
      )}
      {mostrarError(name) && (
        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
          <span>⚠️</span> {errores[name]}
        </p>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-5 py-4 flex items-center gap-3 shadow-sm sticky top-0 z-10">
        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          ITL
        </div>
        <div>
          <p className="text-xs text-gray-500 leading-none">Inversiones Tata Liñán</p>
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

          {/* Nombre */}
          <Campo name="nombre" label="Nombre completo" requerido
            placeholder="Ej: Ana María García" />

          {/* Cédula con verificación en tiempo real */}
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
                className={`w-full border rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 transition-colors pr-10
                  ${mostrarError('documento')
                    ? 'border-red-400 focus:ring-red-300 bg-red-50'
                    : tocados.documento && !errores.documento
                      ? 'border-green-400 focus:ring-green-300'
                      : 'border-gray-300 focus:ring-blue-400'}`}
              />
              {/* Indicador de estado */}
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                {verificando ? '⏳' : tocados.documento && !errores.documento ? '✅' : ''}
              </span>
            </div>
            {mostrarError('documento') && (
              <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                <span>⚠️</span> {errores.documento}
              </p>
            )}
            {verificando && (
              <p className="text-xs text-gray-400 mt-1">Verificando cédula...</p>
            )}
          </div>

          {/* Teléfono */}
          <Campo name="telefono" label="Teléfono / Celular" requerido
            modo="numeric" placeholder="Ej: 3001234567" />

          {/* Teléfono 2 */}
          <Campo name="telefono2" label="Teléfono adicional"
            modo="numeric" placeholder="Número de familiar o alterno (opcional)" />

          {/* Dirección */}
          <Campo name="direccion" label="Dirección"
            placeholder="Barrio, calle, número de casa o apto" />

          {/* Email */}
          <Campo name="email" label="Correo electrónico" tipo="email" modo="email"
            placeholder="tucorreo@ejemplo.com (opcional)" />

          <button
            type="submit"
            disabled={estado === 'enviando'}
            className={`w-full rounded-xl py-3.5 text-sm font-semibold mt-2 transition-all active:scale-[0.98]
              ${estado === 'enviando'
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {estado === 'enviando' ? 'Registrando...' : '✅ Registrarme'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          Tu información es confidencial y solo será usada por Inversiones Tata Liñán.
        </p>
      </div>
    </div>
  )
}
