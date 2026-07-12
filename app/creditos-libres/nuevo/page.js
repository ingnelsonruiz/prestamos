'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const PERIODOS = [
  { value: 'diario',    label: 'Diario'     },
  { value: 'semanal',   label: 'Semanal'    },
  { value: 'quincenal', label: 'Quincenal'  },
  { value: 'mensual',   label: 'Mensual'    },
  { value: 'anual',     label: 'Anual'      },
]

const MEDIOS = [
  { value: 'efectivo',     label: '💵 Efectivo'      },
  { value: 'transferencia',label: '🏦 Transferencia' },
  { value: 'nequi',        label: '🟣 Nequi'         },
  { value: 'daviplata',    label: '🔵 Daviplata'     },
  { value: 'llave_breb',   label: '🔑 Llave Bre-B'  },
  { value: 'otro',         label: '💳 Otro'          },
]

export default function NuevoCreditoLibrePage() {
  const router = useRouter()
  const [form, setForm] = useState({
    cliente_id:            '',
    monto_capital:         '',
    tasa_interes:          '',
    periodo_tasa:          'mensual',
    fecha_inicio:          new Date().toISOString().split('T')[0],
    descripcion_bien:      '',
    notas:                 '',
    metodo_desembolso:     'efectivo',
    entidad_desembolso:    '',
    referencia_desembolso: '',
  })
  const [clientes, setClientes] = useState([])
  const [buscarCliente, setBuscarCliente]     = useState('')
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)
  const [mostrarDropdown, setMostrarDropdown] = useState(false)
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)

  // Capital: almacenamos el número puro en form.monto_capital
  // y el texto formateado ($ 1.000.000) en capitalDisplay
  const [capitalDisplay, setCapitalDisplay] = useState('')

  const handleCapitalChange = e => {
    const raw = e.target.value.replace(/[^0-9]/g, '') // solo dígitos
    const num = raw ? parseInt(raw, 10) : ''
    set('monto_capital', num === '' ? '' : String(num))
    setCapitalDisplay(num === '' ? '' : new Intl.NumberFormat('es-CO').format(num))
  }

  // Cargar clientes con búsqueda
  useEffect(() => {
    if (buscarCliente.length < 2) { setClientes([]); return }
    const t = setTimeout(() => {
      fetch(`/api/clientes?q=${encodeURIComponent(buscarCliente)}`)
        .then(r => r.json())
        .then(d => setClientes(Array.isArray(d) ? d : []))
    }, 300)
    return () => clearTimeout(t)
  }, [buscarCliente])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const necesitaReferencia = ['transferencia', 'nequi', 'daviplata', 'llave_breb'].includes(form.metodo_desembolso)

  // Proyección rápida del interés mensual
  const capital  = parseFloat(form.monto_capital || 0)
  const tasa     = parseFloat(form.tasa_interes || 0)
  const DIAS_PER = { diario: 1, semanal: 7, quincenal: 15, mensual: 30, anual: 360 }
  const diasBase = DIAS_PER[form.periodo_tasa] ?? 30
  const interesMensual = capital * (tasa / 100) / diasBase * 30

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (!clienteSeleccionado) { setError('Selecciona un cliente'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/creditos-libres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, cliente_id: clienteSeleccionado.id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Error al crear el crédito'); setSaving(false); return }
      router.push(`/creditos-libres/${data.id}`)
    } catch {
      setError('Error de red. Intente de nuevo.')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
          ← Volver
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Nuevo Crédito Sin Cuotas Futuras</h2>
          <p className="text-sm text-gray-500">El interés se calcula por fecha de corte, no por cuotas fijas</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Cliente */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-gray-700">Cliente</h3>
          <div className="relative">
            {clienteSeleccionado ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div>
                  <p className="font-semibold text-blue-800">{clienteSeleccionado.nombre}</p>
                  <p className="text-sm text-blue-600">CC {clienteSeleccionado.documento}</p>
                </div>
                <button type="button" onClick={() => { setClienteSeleccionado(null); setBuscarCliente('') }}
                  className="text-blue-400 hover:text-blue-600 text-xl">×</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar cliente por nombre o documento..."
                  value={buscarCliente}
                  onChange={e => { setBuscarCliente(e.target.value); setMostrarDropdown(true) }}
                  onFocus={() => setMostrarDropdown(true)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {mostrarDropdown && clientes.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {clientes.map(cl => (
                      <button key={cl.id} type="button"
                        onClick={() => { setClienteSeleccionado(cl); setMostrarDropdown(false) }}
                        className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm">
                        <span className="font-medium">{cl.nombre}</span>
                        <span className="text-gray-400 ml-2">CC {cl.documento}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Condiciones del crédito */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-700">Condiciones del crédito</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capital *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={capitalDisplay}
                  onChange={handleCapitalChange}
                  placeholder="0"
                  className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-right font-medium"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de inicio *</label>
              <input type="date" required
                value={form.fecha_inicio}
                onChange={e => set('fecha_inicio', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tasa de interés (%) *</label>
              <input type="number" min="0" step="any" required
                value={form.tasa_interes}
                onChange={e => set('tasa_interes', e.target.value)}
                placeholder="Ej: 10"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Período de la tasa *</label>
              <select value={form.periodo_tasa} onChange={e => set('periodo_tasa', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {PERIODOS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Proyección */}
          {capital > 0 && tasa > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p className="text-blue-700 font-medium">Proyección de interés mensual</p>
              <p className="text-blue-800 text-lg font-bold">
                {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(interesMensual)}
              </p>
              <p className="text-blue-600 text-xs">Tasa {tasa}% {form.periodo_tasa} sobre {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(capital)}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción / Concepto</label>
            <input type="text"
              value={form.descripcion_bien}
              onChange={e => set('descripcion_bien', e.target.value)}
              placeholder="Descripción del crédito o motivo"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas internas</label>
            <textarea rows={2}
              value={form.notas}
              onChange={e => set('notas', e.target.value)}
              placeholder="Observaciones adicionales..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* Desembolso */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-700">Método de desembolso</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {MEDIOS.map(m => (
              <button key={m.value} type="button"
                onClick={() => { set('metodo_desembolso', m.value); set('referencia_desembolso', ''); set('entidad_desembolso', '') }}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                  ${form.metodo_desembolso === m.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                {m.label}
              </button>
            ))}
          </div>

          {form.metodo_desembolso !== 'efectivo' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Entidad / Banco</label>
                <input type="text"
                  value={form.entidad_desembolso}
                  onChange={e => set('entidad_desembolso', e.target.value)}
                  placeholder="Ej: Bancolombia"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {form.metodo_desembolso === 'llave_breb' ? 'Llave Bre-B' : 'Cuenta / Celular'} *
                </label>
                <input type="text" required={necesitaReferencia}
                  value={form.referencia_desembolso}
                  onChange={e => set('referencia_desembolso', e.target.value)}
                  placeholder="Número de cuenta o celular"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            ⚠️ {error}
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50">
            {saving ? 'Creando...' : '📅 Crear crédito sin cuotas'}
          </button>
        </div>
      </form>
    </div>
  )
}
