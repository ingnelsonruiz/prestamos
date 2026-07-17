'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { calcularInteresPlano, calcularFrances } from '@/lib/calculos'

const fmt = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0)

// Input numérico con formato de miles (igual que /prestamos/nuevo)
function InputMiles({ value, onChange, placeholder = '0', required = false }) {
  const [display, setDisplay] = useState(value ? Number(value).toLocaleString('es-CO') : '')
  useEffect(() => {
    if (!value) setDisplay('')
    else setDisplay(Number(value).toLocaleString('es-CO'))
  }, [value])
  const handleChange = e => {
    const raw = e.target.value.replace(/\./g, '').replace(/,/g, '.').replace(/[^\d]/g, '')
    setDisplay(raw ? Number(raw).toLocaleString('es-CO') : '')
    onChange(raw || '')
  }
  return (
    <input type="text" inputMode="numeric" required={required} placeholder={placeholder}
      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      value={display} onChange={handleChange} />
  )
}

// Selector de cliente con búsqueda (igual que /prestamos/nuevo)
function SelectorCliente({ clientes, value, onChange }) {
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState(false)
  const seleccionado = clientes.find(c => c.id === value)
  const filtrados = clientes.filter(c =>
    !buscar || c.nombre.toLowerCase().includes(buscar.toLowerCase()) || c.documento.includes(buscar)
  )
  return (
    <div className="relative">
      <div
        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm cursor-pointer flex justify-between items-center bg-white focus-within:ring-2 focus-within:ring-primary-500"
        onClick={() => setAbierto(!abierto)}>
        <span className={seleccionado ? 'text-gray-800' : 'text-gray-400'}>
          {seleccionado ? `${seleccionado.nombre} (${seleccionado.documento})` : '— Seleccionar cliente —'}
        </span>
        <span className="text-gray-400">{abierto ? '▲' : '▼'}</span>
      </div>
      {abierto && (
        <div className="absolute z-50 w-full bg-white border rounded-xl shadow-xl mt-1 max-h-64 flex flex-col">
          <div className="p-2 border-b">
            <input type="text" autoFocus placeholder="Buscar por nombre o cédula..."
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={buscar} onChange={e => setBuscar(e.target.value)} onClick={e => e.stopPropagation()} />
          </div>
          <div className="overflow-y-auto">
            {filtrados.length === 0
              ? <p className="text-center text-gray-400 text-sm py-4">Sin resultados</p>
              : filtrados.map(c => (
                <div key={c.id} className="px-4 py-2.5 hover:bg-primary-50 cursor-pointer text-sm border-b border-gray-50"
                  onClick={() => { onChange(c.id); setAbierto(false); setBuscar('') }}>
                  <p className="font-medium text-gray-800">{c.nombre}</p>
                  <p className="text-xs text-gray-400">{c.documento}</p>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

const tipoLabel = { prestamo: '💰 Préstamo', venta: '🛍 Venta', empeno: '🔒 Empeño', congelacion: '❄️ Congelación', fiado: '🌿 Fiado', adelanto: '🤝 Adelanto', credito_libre: '📅 Crédito Sin Cuotas' }

const MEDIOS_DESEMBOLSO = [
  { v: 'efectivo', label: '💵 Efectivo' },
  { v: 'transferencia', label: '🏦 Transferencia bancaria' },
  { v: 'nequi', label: '📱 Nequi' },
  { v: 'daviplata', label: '📱 Daviplata' },
  { v: 'llave_breb', label: '🔑 Llave (Bre-B)' },
]
const REF_CONFIG = {
  transferencia: { labelRef: 'N° de cuenta', phRef: 'Ej: 123-456789-00' },
  nequi: { labelRef: 'N° de celular', phRef: 'Ej: 3001234567' },
  daviplata: { labelRef: 'N° de celular', phRef: 'Ej: 3001234567' },
  llave_breb: { labelRef: 'Llave Bre-B', phRef: 'Celular, cédula, correo o @alfanumérica' },
}

// Capital pendiente REAL de un crédito, calculado con la MISMA fórmula que
// usará el backend al unificar (interés primero, el resto es capital puro —
// ver CLAUDE.md convención de cálculo). Se calcula aquí en el cliente para
// que el número que ve el usuario antes de confirmar sea idéntico al que
// se va a consolidar.
function saldoCapitalDe(detalle) {
  return (detalle.cuotas || []).filter(c => c.estado !== 'pagada').reduce((s, c) => {
    const montoPagado = parseFloat(c.monto_pagado || 0)
    const abonoCapital = parseFloat(c.abono_capital || 0)
    const abonoInteres = parseFloat(c.abono_interes || 0)
    const capitalPagado = Math.max(0, montoPagado - abonoInteres)
    return s + Math.max(0, abonoCapital - capitalPagado)
  }, 0)
}

export default function UnificarCreditosPage() {
  const router = useRouter()
  const [clientes, setClientes] = useState([])
  const [clienteId, setClienteId] = useState('')
  const [creditos, setCreditos] = useState([])
  const [cargandoCreditos, setCargandoCreditos] = useState(false)
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [montoInyeccion, setMontoInyeccion] = useState('0')
  const [cuotasPreview, setCuotasPreview] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    tipo: 'prestamo', tasa_interes: '10', periodo_tasa: 'mensual',
    frecuencia_cobro: 'mensual', num_cuotas: '4', fecha_primer_pago: '',
    metodo_calculo: 'plano', interes_fijo: false,
    metodo_desembolso: 'efectivo', entidad_desembolso: '', referencia_desembolso: '',
    notas: '', fecha_desembolso: '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    fetch('/api/clientes').then(r => r.json()).then(d => setClientes(Array.isArray(d) ? d : []))
    const hoy = new Date().toISOString().split('T')[0]
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    setForm(f => ({ ...f, fecha_desembolso: hoy, fecha_primer_pago: d.toISOString().split('T')[0] }))
  }, [])

  // Al elegir cliente: traer sus créditos elegibles (no saldado/refinanciado,
  // sin cuenta abierta bloqueada) y calcular el capital pendiente real de
  // cada uno consultando su detalle completo (cuotas). Los "credito_libre"
  // (Créditos Sin Cuotas Futuras) SÍ son elegibles: su cuota placeholder
  // permite calcular el capital pendiente con la misma fórmula genérica.
  useEffect(() => {
    if (!clienteId) { setCreditos([]); setSeleccionados(new Set()); return }
    setCargandoCreditos(true)
    fetch(`/api/productos?cliente_id=${clienteId}`)
      .then(r => r.json())
      .then(async lista => {
        const elegibles = (Array.isArray(lista) ? lista : []).filter(p =>
          !['saldado', 'refinanciado'].includes(p.estado)
        )
        const detalles = await Promise.all(
          elegibles.map(p => fetch(`/api/productos/${p.id}`).then(r => r.json()).catch(() => null))
        )
        const conSaldo = elegibles
          .map((p, i) => ({ ...p, saldoCapitalPendiente: detalles[i] ? saldoCapitalDe(detalles[i]) : 0 }))
          .filter(c => c.saldoCapitalPendiente > 0.5)
        setCreditos(conSaldo)
        setSeleccionados(new Set())
        setCargandoCreditos(false)
      })
      .catch(() => setCargandoCreditos(false))
  }, [clienteId])

  const toggleSeleccion = pid => setSeleccionados(s => {
    const n = new Set(s)
    n.has(pid) ? n.delete(pid) : n.add(pid)
    return n
  })

  const totalSeleccionado = creditos
    .filter(c => seleccionados.has(c.id))
    .reduce((s, c) => s + c.saldoCapitalPendiente, 0)
  const capitalNuevo = totalSeleccionado + (parseFloat(montoInyeccion) || 0)

  // Vista previa de amortización del crédito nuevo (no escribe nada, solo referencia)
  const calcular = useCallback(() => {
    const P = capitalNuevo
    const n = parseInt(form.num_cuotas)
    const t = parseFloat(form.tasa_interes)
    if (!P || P <= 0 || !n || !form.fecha_primer_pago) { setCuotasPreview([]); return }
    const fn = form.metodo_calculo === 'frances' ? calcularFrances : calcularInteresPlano
    setCuotasPreview(fn('preview', 'preview', P, t, form.periodo_tasa, form.frecuencia_cobro, n, form.fecha_primer_pago))
  }, [capitalNuevo, form.num_cuotas, form.tasa_interes, form.periodo_tasa, form.frecuencia_cobro, form.metodo_calculo, form.fecha_primer_pago])
  useEffect(() => { calcular() }, [calcular])

  const guardar = async e => {
    e.preventDefault()
    if (!clienteId) { setError('Selecciona un cliente'); return }
    if (seleccionados.size < 2) { setError('Selecciona al menos 2 créditos para unificar'); return }
    if (form.metodo_desembolso !== 'efectivo' && !form.referencia_desembolso?.trim()) {
      setError(`Indica el ${REF_CONFIG[form.metodo_desembolso]?.labelRef?.toLowerCase() || 'dato del destino'} del desembolso`)
      return
    }
    setLoading(true); setError('')
    const entidadFinal = form.metodo_desembolso === 'nequi' ? 'Nequi'
      : form.metodo_desembolso === 'daviplata' ? 'Daviplata'
      : form.metodo_desembolso === 'transferencia' ? (form.entidad_desembolso || null)
      : null
    const res = await fetch('/api/productos/unificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cliente_id: clienteId,
        credito_ids: [...seleccionados],
        tipo: form.tipo,
        tasa_interes: parseFloat(form.tasa_interes),
        periodo_tasa: form.periodo_tasa,
        frecuencia_cobro: form.frecuencia_cobro,
        num_cuotas: parseInt(form.num_cuotas),
        fecha_primer_pago: form.fecha_primer_pago,
        metodo_calculo: form.metodo_calculo,
        interes_fijo: form.interes_fijo,
        metodo_desembolso: form.metodo_desembolso,
        entidad_desembolso: entidadFinal,
        referencia_desembolso: form.referencia_desembolso,
        monto_inyectado: parseFloat(montoInyeccion) || 0,
        notas: form.notas,
        fecha_desembolso: form.fecha_desembolso,
      }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    router.push(`/prestamos/${data.producto.id}`)
  }

  const clienteSel = clientes.find(c => c.id === clienteId)
  const totalPagar = cuotasPreview.reduce((s, c) => s + c.monto_cuota, 0)
  const totalInteres = cuotasPreview.reduce((s, c) => s + c.abono_interes, 0)

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/prestamos" className="hover:text-gray-700">← Préstamos</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Unificar créditos</span>
      </div>

      <div className="relative overflow-hidden rounded-2xl text-white shadow-lg bg-gradient-to-r from-indigo-800 via-indigo-600 to-blue-500">
        <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-white/10" />
        <div className="relative px-6 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center text-2xl shrink-0">🔗</div>
          <div>
            <p className="text-lg font-extrabold tracking-tight leading-tight">Unificar créditos</p>
            <p className="text-white/75 text-xs mt-0.5">
              Selecciona varios créditos activos del mismo cliente, consolida <strong className="text-white">solo el capital pendiente</strong> (sin
              interés aún no causado) y crea un solo crédito nuevo con condiciones propias. Queda registro de qué créditos se unificaron y
              cuánto aportó cada uno.
            </p>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-600">Cliente *</label>
          <SelectorCliente clientes={clientes} value={clienteId} onChange={setClienteId} />
        </div>

        {clienteId && (
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">
              Créditos activos de {clienteSel?.nombre} — selecciona al menos 2
            </p>
            {cargandoCreditos ? (
              <p className="text-sm text-gray-400 py-4">Cargando créditos...</p>
            ) : creditos.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 italic">Este cliente no tiene créditos elegibles para unificar.</p>
            ) : (
              <div className="border rounded-lg divide-y overflow-hidden">
                {creditos.map(c => (
                  <label key={c.id}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      seleccionados.has(c.id) ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}>
                    <input type="checkbox" className="w-4 h-4 accent-indigo-600"
                      checked={seleccionados.has(c.id)} onChange={() => toggleSeleccion(c.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">
                        {c.referencia || c.id} — {tipoLabel[c.tipo] || c.tipo}
                      </p>
                      {c.descripcion_bien && <p className="text-xs text-gray-400 truncate">{c.descripcion_bien}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-400">Capital pendiente</p>
                      <p className="text-sm font-bold text-blue-700">{fmt(c.saldoCapitalPendiente)}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {seleccionados.size >= 2 && (
          <div className="space-y-3 border border-indigo-200 bg-indigo-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
              🔗 {seleccionados.size} créditos seleccionados
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Capital pendiente consolidado</label>
                <div className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white text-indigo-700 font-semibold select-none">
                  {fmt(totalSeleccionado)}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">💰 Dinero nuevo a prestar (opcional)</label>
                <InputMiles value={montoInyeccion} onChange={setMontoInyeccion} placeholder="0" />
              </div>
            </div>
            <div className="flex justify-between items-center border-t border-indigo-200 pt-2">
              <span className="text-xs font-medium text-indigo-700">= Capital total del nuevo crédito</span>
              <span className="text-lg font-black text-indigo-800">{fmt(capitalNuevo)}</span>
            </div>
          </div>
        )}

        {seleccionados.size >= 2 && (
          <>
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div>
                <label className="text-xs font-medium text-gray-600">Tipo del crédito nuevo</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                  <option value="prestamo">💰 Préstamo</option>
                  <option value="empeno">🔒 Empeño</option>
                  <option value="venta">🛍 Venta</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Método</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.metodo_calculo} onChange={e => set('metodo_calculo', e.target.value)}>
                  <option value="plano">Interés plano</option>
                  <option value="frances">Sistema francés</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Tasa (%)</label>
                <input type="number" step="0.01" min="0" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.tasa_interes} onChange={e => set('tasa_interes', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Período tasa</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.periodo_tasa} onChange={e => set('periodo_tasa', e.target.value)}>
                  {['diario', 'semanal', 'quincenal', 'mensual', 'anual'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">N° cuotas *</label>
                <input type="number" required min="1" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.num_cuotas} onChange={e => set('num_cuotas', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Frecuencia cobro</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.frecuencia_cobro} onChange={e => set('frecuencia_cobro', e.target.value)}>
                  {['diario', 'semanal', 'quincenal', 'mensual'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600">Fecha primer pago *</label>
                <input type="date" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.fecha_primer_pago} onChange={e => set('fecha_primer_pago', e.target.value)} />
              </div>

              {form.metodo_calculo === 'plano' && (
                <div className="col-span-2">
                  <label className="flex items-start gap-2.5 border rounded-lg px-3 py-2.5 cursor-pointer hover:bg-cyan-50/50 transition-colors">
                    <input type="checkbox" className="mt-0.5 w-4 h-4 accent-cyan-600"
                      checked={form.interes_fijo} onChange={e => set('interes_fijo', e.target.checked)} />
                    <span>
                      <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">❄️ Congelar intereses</span>
                      <span className="text-xs text-gray-500 block mt-0.5">
                        El interés de cada cuota queda fijo sobre el capital inicial ({fmt(capitalNuevo)}). Si el cliente abona a capital,
                        el interés que se cobra NO baja.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600">Notas <span className="text-gray-400">(opcional)</span></label>
                <textarea rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-y"
                  placeholder="Se genera automáticamente con la lista de créditos unificados si se deja en blanco"
                  value={form.notas} onChange={e => set('notas', e.target.value)} />
              </div>
            </div>

            {/* Forma de entrega — solo relevante si hay dinero nuevo inyectado */}
            <div className="border-t pt-4 mt-1 space-y-3">
              <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">💸 ¿Cómo se entregó el dinero?</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">📅 Fecha de desembolso *</label>
                  <input type="date" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_desembolso} onChange={e => set('fecha_desembolso', e.target.value)} />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Fecha en que se hizo la unificación (y, si aplica, se entregó el dinero nuevo). Ajústala si registras el crédito días después.
                  </p>
                </div>
                <div className={form.metodo_desembolso === 'efectivo' ? 'col-span-2' : ''}>
                  <label className="text-xs font-medium text-gray-600">Medio de pago</label>
                  <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.metodo_desembolso}
                    onChange={e => { set('metodo_desembolso', e.target.value); set('entidad_desembolso', ''); set('referencia_desembolso', '') }}>
                    {MEDIOS_DESEMBOLSO.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                  </select>
                </div>
                {form.metodo_desembolso === 'transferencia' && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Banco / entidad</label>
                    <input type="text" placeholder="Ej: Bancolombia, Davivienda..."
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                      value={form.entidad_desembolso} onChange={e => set('entidad_desembolso', e.target.value)} />
                  </div>
                )}
                {form.metodo_desembolso !== 'efectivo' && (
                  <div className={form.metodo_desembolso === 'transferencia' ? '' : 'col-span-2'}>
                    <label className="text-xs font-medium text-gray-600">{REF_CONFIG[form.metodo_desembolso]?.labelRef} *</label>
                    <input type="text" placeholder={REF_CONFIG[form.metodo_desembolso]?.phRef}
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                      value={form.referencia_desembolso} onChange={e => set('referencia_desembolso', e.target.value)} />
                  </div>
                )}
              </div>
            </div>

            {cuotasPreview.length > 0 && (
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Vista previa de amortización</p>
                <div className="flex gap-3 mb-3">
                  <div className="flex-1 bg-blue-50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-blue-500 uppercase font-bold">Total a pagar</p>
                    <p className="text-sm font-bold text-blue-700">{fmt(totalPagar)}</p>
                  </div>
                  <div className="flex-1 bg-orange-50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-orange-500 uppercase font-bold">Total intereses</p>
                    <p className="text-sm font-bold text-orange-600">{fmt(totalInteres)}</p>
                  </div>
                  <div className="flex-1 bg-green-50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-green-600 uppercase font-bold">Cuota estándar</p>
                    <p className="text-sm font-bold text-green-700">{fmt(cuotasPreview[0]?.monto_cuota || 0)}</p>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left">#</th>
                        <th className="px-2 py-2 text-left">Vence</th>
                        <th className="px-2 py-2 text-right">Cuota</th>
                        <th className="px-2 py-2 text-right">Capital</th>
                        <th className="px-2 py-2 text-right">Interés</th>
                        <th className="px-2 py-2 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {cuotasPreview.map(c => (
                        <tr key={c.numero_cuota} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 font-medium">{c.numero_cuota}</td>
                          <td className="px-2 py-1.5 text-gray-500">{c.fecha_vencimiento}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{fmt(c.monto_cuota)}</td>
                          <td className="px-2 py-1.5 text-right text-blue-600">{fmt(c.abono_capital)}</td>
                          <td className="px-2 py-1.5 text-right text-orange-500">{fmt(c.abono_interes)}</td>
                          <td className="px-2 py-1.5 text-right text-gray-500">{fmt(c.saldo_pendiente)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <button onClick={guardar} disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-lg py-2.5 font-bold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all disabled:opacity-50">
              {loading ? 'Unificando...' : `🔗 Unificar ${seleccionados.size} créditos y generar cuotas`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
