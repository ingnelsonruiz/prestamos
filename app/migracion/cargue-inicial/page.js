'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { generarCuotas } from '@/lib/calculos'

const fmt = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0)

// Fecha de hoy en zona LOCAL (no UTC) → 'YYYY-MM-DD' (convención del proyecto)
function hoyLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Días entre dos fechas 'YYYY-MM-DD' (>=0), zona local con split('-')
function diasEntre(desde, hasta) {
  if (!desde || !hasta) return 0
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  const diff = new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0
}

// ── Input numérico con separador de miles ──────────────────────────────────
function InputMiles({ value, onChange, placeholder = '0', className = '' }) {
  const [display, setDisplay] = useState(value ? Number(value).toLocaleString('es-CO') : '')
  useEffect(() => { setDisplay(value ? Number(value).toLocaleString('es-CO') : '') }, [value])
  return (
    <input type="text" inputMode="numeric" placeholder={placeholder}
      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${className}`}
      value={display}
      onChange={e => {
        const raw = e.target.value.replace(/\./g, '').replace(/[^\d]/g, '')
        setDisplay(raw ? Number(raw).toLocaleString('es-CO') : '')
        onChange(raw || '')
      }} />
  )
}

// ── Selector de cliente con búsqueda ────────────────────────────────────────
function SelectorCliente({ clientes, value, onChange }) {
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState(false)
  const sel = clientes.find(c => c.id === value)
  const filtrados = clientes.filter(c =>
    !buscar || c.nombre?.toLowerCase().includes(buscar.toLowerCase()) || c.documento?.includes(buscar)
  )
  return (
    <div className="relative">
      <div className="mt-1 w-full border rounded-lg px-3 py-2 text-sm cursor-pointer flex justify-between items-center bg-white"
        onClick={() => setAbierto(!abierto)}>
        <span className={sel ? 'text-gray-800' : 'text-gray-400'}>
          {sel ? `${sel.nombre} (${sel.documento})` : '— Seleccionar cliente —'}
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

const FORM_INICIAL = {
  cliente_id: '', tipo: 'prestamo',
  monto_capital: '', tasa_interes: '10', periodo_tasa: 'mensual',
  frecuencia_cobro: 'mensual', num_cuotas: '4', metodo_calculo: 'plano',
  metodo_desembolso: 'efectivo', entidad_desembolso: '', referencia_desembolso: '',
  fecha_desembolso: '', fecha_primer_pago: '', fecha_corte: hoyLocal(),
  descripcion_bien: '', notas: '',
}

export default function CargueInicialPage() {
  const router = useRouter()
  const [clientes, setClientes] = useState([])
  const [tipos, setTipos] = useState([])
  const [paso, setPaso] = useState(1)
  const [form, setForm] = useState(FORM_INICIAL)
  const [cuotas, setCuotas] = useState([])    // filas interactivas del paso 2
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    fetch('/api/clientes').then(r => r.json()).then(d => setClientes(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/configuracion/tipos').then(r => r.json()).then(d => {
      // Solo tipos amortizables (préstamo/venta/empeño). Las cuentas abiertas
      // (fiado/adelanto) no aplican a un cargue con cronograma de cuotas.
      const aptos = (Array.isArray(d) ? d : []).filter(t => t.activo && t.comportamiento !== 'cuenta_abierta')
      setTipos(aptos)
    }).catch(() => {})
  }, [])

  const tipoSel = tipos.find(t => t.codigo === form.tipo)
  const esEmpeno = tipoSel?.comportamiento === 'empeno'
  const requiereDesemb = form.metodo_desembolso !== 'efectivo'

  // ── Paso 1 → 2: generar cronograma teórico ────────────────────────────────
  function generarTabla() {
    setError('')
    if (!form.cliente_id)  return setError('Selecciona un cliente.')
    if (!form.monto_capital || parseFloat(form.monto_capital) <= 0) return setError('Ingresa el monto de capital.')
    if (!form.num_cuotas || parseInt(form.num_cuotas) < 1) return setError('El número de cuotas debe ser mayor a 0.')
    if (!form.fecha_desembolso) return setError('Ingresa la fecha de desembolso (en el pasado).')
    if (!form.fecha_corte) return setError('Ingresa la fecha de corte.')
    if (requiereDesemb && !form.entidad_desembolso.trim())
      return setError('Indica la entidad/billetera del desembolso.')

    const primerPago = form.fecha_primer_pago || form.fecha_desembolso
    const generadas = generarCuotas({
      id: 'preview', cliente_id: form.cliente_id,
      monto_capital: parseFloat(form.monto_capital),
      tasa_interes: parseFloat(form.tasa_interes || 0),
      periodo_tasa: form.periodo_tasa,
      frecuencia_cobro: form.frecuencia_cobro,
      num_cuotas: parseInt(form.num_cuotas),
      fecha_primer_pago: primerPago,
      metodo_calculo: form.metodo_calculo,
    })

    setCuotas(generadas.map(c => {
      const esHistorica = c.fecha_vencimiento <= form.fecha_corte
      return {
        numero_cuota: c.numero_cuota,
        fecha_vencimiento: c.fecha_vencimiento,
        monto_cuota: c.monto_cuota,
        abono_capital: c.abono_capital,
        abono_interes: c.abono_interes,
        esHistorica,
        pagada: false,
        monto_pagado: String(c.monto_cuota),
        fecha_pago: c.fecha_vencimiento,
      }
    }))
    setPaso(2)
  }

  // ── Botón mágico: marcar todas las vencidas como pagadas en su fecha exacta ─
  function marcarTodasVencidas() {
    setCuotas(cs => cs.map(c => c.esHistorica
      ? { ...c, pagada: true, monto_pagado: String(c.monto_cuota), fecha_pago: c.fecha_vencimiento }
      : c))
  }
  function limpiarMarcas() {
    setCuotas(cs => cs.map(c => ({ ...c, pagada: false, monto_pagado: String(c.monto_cuota), fecha_pago: c.fecha_vencimiento })))
  }
  const setCuota = (idx, patch) => setCuotas(cs => cs.map((c, i) => i === idx ? { ...c, ...patch } : c))

  // ── Resumen en vivo del paso 2 ─────────────────────────────────────────────
  const resumen = useMemo(() => {
    const totalProyectado = cuotas.reduce((s, c) => s + c.monto_cuota, 0)
    let cobrado = 0, capitalRec = 0, enMora = 0
    for (const c of cuotas) {
      if (c.pagada && parseFloat(c.monto_pagado) > 0) {
        const m = Math.min(parseFloat(c.monto_pagado) || 0, c.monto_cuota)
        cobrado += m
        capitalRec += Math.max(0, m - c.abono_interes)
      } else if (c.esHistorica) {
        enMora++
      }
    }
    const saldoCapital = Math.max(0, parseFloat(form.monto_capital || 0) - capitalRec)
    const todasPagadas = cuotas.length > 0 && cuotas.every(c => c.pagada && parseFloat(c.monto_pagado) >= c.monto_cuota - 0.5)
    const estado = todasPagadas ? 'saldado' : enMora > 0 ? 'en_mora' : 'activo'
    return { totalProyectado, cobrado, capitalRec, saldoCapital, enMora, estado }
  }, [cuotas, form.monto_capital])

  // ── Finalizar: POST al backend ─────────────────────────────────────────────
  async function finalizar() {
    setError(''); setEnviando(true)
    try {
      const pagos = cuotas
        .filter(c => c.pagada && parseFloat(c.monto_pagado) > 0)
        .map(c => ({
          numero_cuota: c.numero_cuota,
          monto_pagado: parseFloat(c.monto_pagado),
          fecha_pago: c.fecha_pago,
        }))

      const res = await fetch('/api/migracion/cargue-inicial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto: {
            cliente_id: form.cliente_id, tipo: form.tipo,
            monto_capital: parseFloat(form.monto_capital),
            tasa_interes: parseFloat(form.tasa_interes || 0),
            periodo_tasa: form.periodo_tasa, frecuencia_cobro: form.frecuencia_cobro,
            num_cuotas: parseInt(form.num_cuotas), metodo_calculo: form.metodo_calculo,
            con_interes: parseFloat(form.tasa_interes || 0) > 0,
            fecha_desembolso: form.fecha_desembolso,
            fecha_primer_pago: form.fecha_primer_pago || form.fecha_desembolso,
            fecha_corte: form.fecha_corte,
            metodo_desembolso: form.metodo_desembolso,
            entidad_desembolso: form.entidad_desembolso,
            referencia_desembolso: form.referencia_desembolso,
            descripcion_bien: esEmpeno ? form.descripcion_bien : null,
            notas: form.notas,
          },
          pagos,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al registrar el cargue.')
      setExito(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  // ── Pantalla de éxito ───────────────────────────────────────────────────────
  if (exito) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-xl font-bold text-gray-800">Cargue inicial completado</h1>
          <p className="text-gray-500 mt-1">El crédito histórico quedó registrado.</p>
          <div className="grid grid-cols-2 gap-3 mt-6 text-left">
            <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400">Referencia</p><p className="font-bold text-gray-800">{exito.referencia}</p></div>
            <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400">Estado</p><p className="font-bold text-gray-800 capitalize">{exito.estado?.replace('_', ' ')}</p></div>
            <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400">Cuotas generadas</p><p className="font-bold text-gray-800">{exito.cuotas_generadas}</p></div>
            <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400">Pagos históricos</p><p className="font-bold text-gray-800">{exito.pagos_registrados}</p></div>
          </div>
          <div className="flex gap-3 justify-center mt-7">
            <Link href={`/prestamos/${exito.producto_id}`} className="px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold">Ver crédito</Link>
            <button onClick={() => { setExito(null); setForm(FORM_INICIAL); setCuotas([]); setPaso(1) }}
              className="px-5 py-2.5 rounded-lg border text-sm font-semibold text-gray-600 hover:bg-gray-50">Cargar otro</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <Link href="/migracion" className="text-xs text-primary-600 hover:underline">← Volver a Migración</Link>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">📥 Cargue Inicial de Saldos</h1>
          <p className="text-sm text-gray-500">Legaliza créditos antiguos reconstruyendo su historial de pagos hasta una fecha de corte.</p>
        </div>
      </div>

      {/* Indicador de pasos */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        {[{ n: 1, t: 'Parámetros del crédito' }, { n: 2, t: 'Reconstrucción de pagos' }].map((p, i) => (
          <div key={p.n} className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center font-bold ${paso === p.n ? 'bg-primary-600 text-white' : paso > p.n ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {paso > p.n ? '✓' : p.n}
            </span>
            <span className={paso === p.n ? 'font-semibold text-gray-800' : 'text-gray-400'}>{p.t}</span>
            {i === 0 && <span className="text-gray-300 mx-1">───</span>}
          </div>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {/* ───────────────── PASO 1 ───────────────── */}
      {paso === 1 && (
        <div className="bg-white rounded-2xl shadow-sm border p-5 sm:p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-gray-700">Cliente *</label>
              <SelectorCliente clientes={clientes} value={form.cliente_id} onChange={v => set('cliente_id', v)} />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Tipo de préstamo *</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                {tipos.map(t => <option key={t.id} value={t.codigo}>{t.icono} {t.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Método de cálculo *</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={form.metodo_calculo} onChange={e => set('metodo_calculo', e.target.value)}>
                <option value="plano">Plano (interés sobre capital inicial)</option>
                <option value="frances">Francés (cuota fija, saldo decreciente)</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Monto capital inicial *</label>
              <div className="mt-1"><InputMiles value={form.monto_capital} onChange={v => set('monto_capital', v)} placeholder="500.000" /></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Tasa interés (%)</label>
                <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={form.tasa_interes} onChange={e => set('tasa_interes', e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Período tasa</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={form.periodo_tasa} onChange={e => set('periodo_tasa', e.target.value)}>
                  <option value="diario">Diario</option><option value="semanal">Semanal</option>
                  <option value="quincenal">Quincenal</option><option value="mensual">Mensual</option>
                  <option value="anual">Anual</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Frecuencia de cobro</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={form.frecuencia_cobro} onChange={e => set('frecuencia_cobro', e.target.value)}>
                  <option value="diario">Diario</option><option value="semanal">Semanal</option>
                  <option value="quincenal">Quincenal</option><option value="mensual">Mensual</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Número de cuotas *</label>
                <input type="number" min="1" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={form.num_cuotas} onChange={e => set('num_cuotas', e.target.value)} />
              </div>
            </div>
          </div>

          {esEmpeno && (
            <div>
              <label className="text-sm font-medium text-gray-700">Descripción del bien (empeño)</label>
              <input type="text" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={form.descripcion_bien} onChange={e => set('descripcion_bien', e.target.value)} placeholder="Ej: Anillo de oro 18k" />
            </div>
          )}

          {/* Fechas */}
          <div className="border-t pt-5 grid sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Fecha de desembolso (pasado) *</label>
              <input type="date" max={hoyLocal()} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={form.fecha_desembolso} onChange={e => set('fecha_desembolso', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Fecha del primer pago</label>
              <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={form.fecha_primer_pago} onChange={e => set('fecha_primer_pago', e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Si se deja vacío, usa la fecha de desembolso.</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Fecha de corte *</label>
              <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={form.fecha_corte} onChange={e => set('fecha_corte', e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Cuotas que vencen después se marcan futuras.</p>
            </div>
          </div>

          {/* Desembolso */}
          <div className="border-t pt-5 grid sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Medio de desembolso</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={form.metodo_desembolso} onChange={e => set('metodo_desembolso', e.target.value)}>
                <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option>
                <option value="nequi">Nequi</option><option value="daviplata">Daviplata</option>
                <option value="llave_breb">Llave Bre-B</option><option value="otro">Otro</option>
              </select>
            </div>
            {requiereDesemb && (
              <>
                <div>
                  <label className="text-sm font-medium text-gray-700">Entidad / billetera</label>
                  <input type="text" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={form.entidad_desembolso} onChange={e => set('entidad_desembolso', e.target.value)} placeholder="Bancolombia / Nequi" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Referencia destino</label>
                  <input type="text" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={form.referencia_desembolso} onChange={e => set('referencia_desembolso', e.target.value)} placeholder="N° cuenta / celular / llave" />
                </div>
              </>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Notas (opcional)</label>
            <textarea className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={2} value={form.notas} onChange={e => set('notas', e.target.value)} placeholder="Origen del cargue, observaciones del cuaderno, etc." />
          </div>

          <div className="flex justify-end pt-2">
            <button onClick={generarTabla}
              className="px-6 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold">
              Generar tabla de cuotas →
            </button>
          </div>
        </div>
      )}

      {/* ───────────────── PASO 2 ───────────────── */}
      {paso === 2 && (
        <div className="space-y-4">
          {/* Resumen superior */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Total proyectado</p><p className="font-bold text-gray-800">{fmt(resumen.totalProyectado)}</p></div>
            <div className="bg-green-50 rounded-xl border border-green-100 p-4"><p className="text-xs text-green-600">Cobrado (histórico)</p><p className="font-bold text-green-700">{fmt(resumen.cobrado)}</p></div>
            <div className="bg-blue-50 rounded-xl border border-blue-100 p-4"><p className="text-xs text-blue-600">Capital recuperado</p><p className="font-bold text-blue-700">{fmt(resumen.capitalRec)}</p></div>
            <div className="bg-amber-50 rounded-xl border border-amber-100 p-4"><p className="text-xs text-amber-600">Saldo capital</p><p className="font-bold text-amber-700">{fmt(resumen.saldoCapital)}</p></div>
          </div>

          {/* Acciones rápidas */}
          <div className="bg-white rounded-xl border p-4 flex flex-wrap items-center gap-3">
            <button onClick={marcarTodasVencidas}
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold">
              ✨ Marcar todas las vencidas como pagadas en su fecha exacta
            </button>
            <button onClick={limpiarMarcas}
              className="px-4 py-2 rounded-lg border text-sm font-semibold text-gray-600 hover:bg-gray-50">
              Limpiar marcas
            </button>
            <span className="text-sm text-gray-500 ml-auto">
              Estado proyectado:{' '}
              <span className={`font-bold capitalize ${resumen.estado === 'en_mora' ? 'text-red-600' : resumen.estado === 'saldado' ? 'text-green-600' : 'text-blue-600'}`}>
                {resumen.estado.replace('_', ' ')}
              </span>
            </span>
          </div>

          {/* Tabla de cuotas */}
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="px-3 py-2.5">#</th>
                  <th className="px-3 py-2.5">Vencimiento</th>
                  <th className="px-3 py-2.5 text-right">Capital</th>
                  <th className="px-3 py-2.5 text-right">Interés</th>
                  <th className="px-3 py-2.5 text-right">Valor cuota</th>
                  <th className="px-3 py-2.5 text-center">¿Pagó?</th>
                  <th className="px-3 py-2.5 text-right">Monto pagado</th>
                  <th className="px-3 py-2.5">Fecha real del pago</th>
                </tr>
              </thead>
              <tbody>
                {cuotas.map((c, idx) => (
                  <tr key={c.numero_cuota} className={`border-b last:border-0 ${!c.esHistorica ? 'bg-gray-50/60' : c.pagada ? 'bg-green-50/40' : ''}`}>
                    <td className="px-3 py-2 font-medium text-gray-700">#{c.numero_cuota}</td>
                    <td className="px-3 py-2">
                      <span className="text-gray-700">{c.fecha_vencimiento}</span>
                      {!c.esHistorica
                        ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">futura</span>
                        : !c.pagada && diasEntre(c.fecha_vencimiento, form.fecha_corte) > 0
                          ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">en mora</span>
                          : null}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{fmt(c.abono_capital)}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{fmt(c.abono_interes)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-800">{fmt(c.monto_cuota)}</td>
                    {c.esHistorica ? (
                      <>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" className="w-4 h-4 accent-green-600"
                            checked={c.pagada} onChange={e => setCuota(idx, { pagada: e.target.checked })} />
                        </td>
                        <td className="px-3 py-2">
                          <div className={c.pagada ? '' : 'opacity-40 pointer-events-none'}>
                            <InputMiles value={c.monto_pagado} onChange={v => setCuota(idx, { monto_pagado: v })} className="text-right" />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input type="date" max={form.fecha_corte}
                            className={`w-full border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${c.pagada ? '' : 'opacity-40 pointer-events-none'}`}
                            value={c.fecha_pago} onChange={e => setCuota(idx, { fecha_pago: e.target.value })} />
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="px-3 py-2 text-center text-gray-400 text-xs">Pendiente (vence después del corte)</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Navegación */}
          <div className="flex justify-between items-center pt-1">
            <button onClick={() => setPaso(1)} className="px-5 py-2.5 rounded-lg border text-sm font-semibold text-gray-600 hover:bg-gray-50">← Atrás</button>
            <button onClick={finalizar} disabled={enviando}
              className="px-6 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold">
              {enviando ? 'Registrando…' : '✅ Finalizar cargue inicial'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
