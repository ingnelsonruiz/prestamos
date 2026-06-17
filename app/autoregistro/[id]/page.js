'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function AutoregistroPage() {
  const { id } = useParams()

  const [cliente, setCliente] = useState(null)
  const [form, setForm]       = useState({ documento:'', telefono:'', telefono2:'', direccion:'', email:'' })
  const [estado, setEstado]   = useState('cargando') // cargando | listo | enviando | exito | error | invalido
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    fetch(`/api/autoregistro/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setEstado('invalido'); return }
        setCliente(data)
        setForm({
          documento: data.documento || '',
          telefono:  data.telefono  || '',
          telefono2: data.telefono2 || '',
          direccion: data.direccion || '',
          email:     data.email     || '',
        })
        setEstado('listo')
      })
      .catch(() => setEstado('invalido'))
  }, [id])

  const enviar = async e => {
    e.preventDefault()
    setEstado('enviando')
    setMensaje('')
    const res = await fetch(`/api/autoregistro/${id}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) {
      setMensaje(data.error || 'Ocurrió un error. Intenta de nuevo.')
      setEstado('listo')
      return
    }
    setEstado('exito')
  }

  const cambiar = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  /* ── Pantallas de estado ── */
  if (estado === 'cargando') return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-400 text-sm animate-pulse">Cargando...</p>
    </div>
  )

  if (estado === 'invalido') return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <span className="text-5xl mb-4">🔗</span>
      <h1 className="text-xl font-bold text-gray-800 mb-2">Enlace no válido</h1>
      <p className="text-sm text-gray-500">Este enlace no existe o ya no está disponible.</p>
    </div>
  )

  if (estado === 'exito') return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-green-50 px-6 text-center">
      <span className="text-6xl mb-4">✅</span>
      <h1 className="text-2xl font-bold text-green-800 mb-2">¡Datos guardados!</h1>
      <p className="text-sm text-green-700 mb-1">
        Gracias, <strong>{cliente?.nombre}</strong>.
      </p>
      <p className="text-sm text-green-600">Tu información fue actualizada correctamente.</p>
    </div>
  )

  /* ── Formulario principal ── */
  const docEsPlaceholder = !cliente?.documento || /^[0-9]{1,3}$/.test(cliente.documento.trim())

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-5 py-4 flex items-center gap-3 shadow-sm">
        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          ITL
        </div>
        <div>
          <p className="text-xs text-gray-500 leading-none">Inversiones Tata Liñán</p>
          <p className="text-sm font-semibold text-gray-800 leading-tight mt-0.5">Actualiza tus datos</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-6 max-w-md mx-auto w-full">
        {/* Saludo */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm font-medium text-blue-800">
            Hola, <strong>{cliente?.nombre}</strong> 👋
          </p>
          <p className="text-xs text-blue-600 mt-1 leading-snug">
            Por favor completa o verifica tus datos de contacto. Esta información es confidencial y solo la usa Inversiones Tata Liñán.
          </p>
        </div>

        {mensaje && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
            ⚠️ {mensaje}
          </div>
        )}

        <form onSubmit={enviar} className="space-y-4">

          {/* Cédula */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Número de cédula *
            </label>
            {docEsPlaceholder ? (
              <input
                type="text" name="documento" inputMode="numeric" required
                placeholder="Ej: 1067712345"
                value={form.documento}
                onChange={cambiar}
                className="w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            ) : (
              <div className="w-full border rounded-xl px-4 py-3 text-sm bg-gray-100 text-gray-600 flex items-center gap-2">
                <span>🔒</span> {cliente?.documento}
                <span className="ml-auto text-xs text-gray-400">Ya registrado</span>
              </div>
            )}
          </div>

          {/* Teléfono */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Teléfono / Celular
            </label>
            <input
              type="tel" name="telefono" inputMode="numeric"
              placeholder="Ej: 3001234567"
              value={form.telefono}
              onChange={cambiar}
              className="w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          {/* Teléfono 2 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Teléfono adicional <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              type="tel" name="telefono2" inputMode="numeric"
              placeholder="Número de un familiar o alterno"
              value={form.telefono2}
              onChange={cambiar}
              className="w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          {/* Dirección */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Dirección
            </label>
            <input
              type="text" name="direccion"
              placeholder="Barrio, calle, casa o apartamento"
              value={form.direccion}
              onChange={cambiar}
              className="w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Correo electrónico <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              type="email" name="email" inputMode="email"
              placeholder="tucorreo@ejemplo.com"
              value={form.email}
              onChange={cambiar}
              className="w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          <button
            type="submit"
            disabled={estado === 'enviando'}
            className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold
                       hover:bg-blue-700 active:scale-[0.98] transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed mt-2">
            {estado === 'enviando' ? 'Guardando...' : '✅ Guardar mis datos'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Tus datos están protegidos y solo son usados por Inversiones Tata Liñán.
        </p>
      </div>
    </div>
  )
}
