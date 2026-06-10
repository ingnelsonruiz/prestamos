'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { calcularInteresPlano, calcularFrances, convertirTasa } from '@/lib/calculos'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)

// Input numérico con formato de miles
function InputMiles({ value, onChange, placeholder='0', required=false, className='' }) {
  const [display, setDisplay] = useState(value ? Number(value).toLocaleString('es-CO') : '')

  useEffect(() => {
    if (!value) setDisplay('')
    else setDisplay(Number(value).toLocaleString('es-CO'))
  }, [value])

  const handleChange = e => {
    const raw = e.target.value.replace(/\./g,'').replace(/,/g,'.').replace(/[^\d]/g,'')
    setDisplay(raw ? Number(raw).toLocaleString('es-CO') : '')
    onChange(raw || '')
  }

  return (
    <input type="text" inputMode="numeric" required={required} placeholder={placeholder}
      className={`mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${className}`}
      value={display} onChange={handleChange} />
  )
}

// Selector de cliente con búsqueda
function SelectorCliente({ clientes, value, onChange }) {
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState(false)
  const seleccionado = clientes.find(c => c.id === value)

  const filtrados = clientes.filter(c =>
    !buscar || c.nombre.toLowerCase().includes(buscar.toLowerCase()) ||
    c.documento.includes(buscar)
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
              value={buscar} onChange={e => setBuscar(e.target.value)}
              onClick={e => e.stopPropagation()} />
          </div>
          <div className="overflow-y-auto">
            {filtrados.length === 0
              ? <p className="text-center text-gray-400 text-sm py-4">Sin resultados</p>
              : filtrados.map(c => (
                  <div key={c.id}
                    className="px-4 py-2.5 hover:bg-primary-50 cursor-pointer text-sm border-b border-gray-50"
                    onClick={() => { onChange(c.id); setAbierto(false); setBuscar('') }}>
                    <p className="font-medium text-gray-800">{c.nombre}</p>
                    <p className="text-xs text-gray-400">{c.documento}</p>
                  </div>
                ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

const tipoLabel = { prestamo:'💰 Préstamo', venta:'🛍 Venta', empeno:'🔒 Empeño', fiado:'🌿 Fiado', adelanto:'🤝 Adelanto' }
const tipoColor = { prestamo:'bg-blue-50 text-blue-700', venta:'bg-yellow-50 text-yellow-700', empeno:'bg-purple-50 text-purple-700', fiado:'bg-green-50 text-green-700', adelanto:'bg-teal-50 text-teal-700' }

function FiadoResumen({ clienteId, montoNuevo, clientes }) {
  const [productos, setProductos] = useState([])
  const cliente = clientes.find(c => c.id === clienteId)

  useEffect(() => {
    if (!clienteId) { setProductos([]); return }
    fetch(`/api/productos?cliente_id=${clienteId}`)
      .then(r => r.json())
      .then(data => setProductos(data.filter(p => !['saldado','decomisado','refinanciado'].includes(p.estado))))
  }, [clienteId])

  if (!clienteId) return (
    <div className="text-center text-gray-400 py-8">
      <p className="text-3xl mb-2">🌿</p>
      <p className="text-sm">Selecciona un cliente para ver su estado de cuenta</p>
    </div>
  )

  const totalActual = productos.reduce((s,p) => s + parseFloat(p.capital_pendiente||0), 0)
  const totalConNuevo = totalActual + (montoNuevo||0)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-700">Estado de cuenta — {cliente?.nombre}</h3>
        <p className="text-xs text-gray-400 mt-0.5">Deuda total activa del cliente</p>
      </div>

      {productos.length === 0
        ? <p className="text-sm text-gray-400 italic">Sin deudas activas actualmente</p>
        : <div className="space-y-2">
            {productos.map(p => (
              <div key={p.id} className="flex justify-between items-center py-2 border-b border-gray-100">
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tipoColor[p.tipo]||''}`}>
                    {tipoLabel[p.tipo]||p.tipo}
                  </span>
                  {p.descripcion_bien && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[160px]">{p.descripcion_bien}</p>}
                </div>
                <span className="font-semibold text-gray-800">{fmt(p.capital_pendiente||0)}</span>
              </div>
            ))}
          </div>
      }

      <div className="border-t-2 pt-3 space-y-1">
        <div className="flex justify-between text-sm text-gray-500">
          <span>Deuda actual</span>
          <span>{fmt(totalActual)}</span>
        </div>
        {montoNuevo > 0 && (
          <div className="flex justify-between text-sm text-green-600">
            <span>+ Este fiado</span>
            <span>{fmt(montoNuevo)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-base text-gray-800 pt-1 border-t">
          <span>Total deuda</span>
          <span className={totalConNuevo > 0 ? 'text-red-600' : 'text-green-600'}>{fmt(totalConNuevo)}</span>
        </div>
      </div>
    </div>
  )
}

const init = {
  cliente_id:'', tipo:'prestamo', monto_capital:'', tasa_interes:'10',
  periodo_tasa:'mensual', frecuencia_cobro:'mensual', num_cuotas:'4',
  fecha_primer_pago:'', con_interes:true, metodo_calculo:'plano',
  cuota_inicial:'0', descripcion_bien:'', valor_comercial_bien:'', notas:''
}

function NuevoPrestamoContenido() {
  const router         = useRouter()
  const searchParams   = useSearchParams()
  const clientePresel  = searchParams.get('cliente') || ''
  const capitalPresel  = searchParams.get('capital') || ''
  const refinanciaId   = searchParams.get('refinancia') || ''

  const [form, setForm] = useState({
    ...init,
    cliente_id:    clientePresel,
    monto_capital: capitalPresel || '',
  })
  const [clientes,   setClientes]   = useState([])
  const [tiposList,  setTiposList]  = useState([])
  const [cuotas,     setCuotas]     = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')

  // comportamiento del tipo seleccionado
  const tipoActual     = tiposList.find(t => t.codigo === form.tipo)
  const comportamiento = tipoActual?.comportamiento ?? 'prestamo_normal'
  const esCuentaAbierta = comportamiento === 'cuenta_abierta'
  const esEmpeno        = comportamiento === 'empeno'

  useEffect(() => {
    fetch('/api/clientes').then(r=>r.json()).then(setClientes)
    fetch('/api/configuracion/tipos').then(r=>r.json()).then(data => {
      const activos = Array.isArray(data) ? data.filter(t => t.activo) : []
      setTiposList(activos)
    })
    // Fecha primer pago = hoy + 1 mes por defecto
    const d = new Date(); d.setMonth(d.getMonth()+1)
    setForm(f => ({...f, fecha_primer_pago: d.toISOString().split('T')[0]}))
  }, [])

  // Ajustar fecha según tipo: cuenta abierta → hoy, préstamo normal → hoy+1 mes
  useEffect(() => {
    if (!tipoActual) return
    const hoy = new Date().toISOString().split('T')[0]
    if (esCuentaAbierta) {
      setForm(f => ({ ...f, fecha_primer_pago: hoy }))
    } else {
      const d = new Date(); d.setMonth(d.getMonth() + 1)
      setForm(f => ({ ...f, fecha_primer_pago: d.toISOString().split('T')[0] }))
    }
  }, [esCuentaAbierta, tipoActual?.codigo])

  // Calcular tabla de amortización en tiempo real (solo para no cuenta_abierta)
  const calcular = useCallback(() => {
    if (esCuentaAbierta) { setCuotas([]); return }
    const P  = parseFloat(form.monto_capital) - parseFloat(form.cuota_inicial||0)
    const n  = parseInt(form.num_cuotas)
    const t  = parseFloat(form.tasa_interes)
    if (!P || P<=0 || !n || !form.fecha_primer_pago) { setCuotas([]); return }
    const fn = form.metodo_calculo === 'frances' ? calcularFrances : calcularInteresPlano
    const result = fn('preview','preview',P,t,form.periodo_tasa,form.frecuencia_cobro,n,form.fecha_primer_pago)
    setCuotas(result)
  }, [form, esCuentaAbierta])

  useEffect(() => { calcular() }, [calcular])

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  const guardar = async e => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/productos',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        ...form,
        monto_capital:        parseFloat(form.monto_capital),
        tasa_interes:         parseFloat(form.tasa_interes),
        num_cuotas:           parseInt(form.num_cuotas),
        cuota_inicial:        parseFloat(form.cuota_inicial||0),
        valor_comercial_bien: parseFloat(form.valor_comercial_bien||0)||null,
        es_refinanciacion_de: refinanciaId || null,
      })
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    router.push('/prestamos')
  }

  const totalPagar  = cuotas.reduce((s,c)=>s+c.monto_cuota,0)
  const totalInteres = cuotas.reduce((s,c)=>s+c.abono_interes,0)

  return (
    <div className="max-w-5xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">
        {refinanciaId ? '🔄 Refinanciación de saldo' : 'Nuevo préstamo / producto'}
      </h2>
      {refinanciaId && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2.5 text-sm text-purple-700">
          Refinanciando saldo pendiente de crédito anterior. El capital ya está pre-llenado — ajusta las condiciones y confirma.
          {' '}<Link href={`/prestamos/${refinanciaId}`} className="underline">Ver crédito original →</Link>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Formulario */}
        <form onSubmit={guardar} className="bg-white rounded-xl border p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Cliente *</label>
              <SelectorCliente clientes={clientes} value={form.cliente_id} onChange={v=>set('cliente_id',v)} />
              {!form.cliente_id && <p className="text-xs text-red-400 mt-1">Requerido</p>}
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Tipo</label>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.tipo} onChange={e=>set('tipo',e.target.value)}>
                {tiposList.length === 0 && <option value="prestamo">Préstamo</option>}
                {tiposList.map(t => (
                  <option key={t.codigo} value={t.codigo}>{t.icono} {t.label}</option>
                ))}
              </select>
            </div>

            {/* Método — solo préstamo normal y empeño */}
            {!esCuentaAbierta && (
              <div>
                <label className="text-xs font-medium text-gray-600">Método</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.metodo_calculo} onChange={e=>set('metodo_calculo',e.target.value)}>
                  <option value="plano">Interés plano</option>
                  <option value="frances">Sistema francés</option>
                </select>
              </div>
            )}

            <div className={esCuentaAbierta ? 'col-span-2' : ''}>
              <label className="text-xs font-medium text-gray-600">
                {esCuentaAbierta ? 'Total adeudado ($) *' : 'Capital *'}
              </label>
              <InputMiles required value={form.monto_capital} onChange={v=>set('monto_capital',v)}
                placeholder="Ej: 500.000" />
            </div>

            {!esCuentaAbierta && (
              <div>
                <label className="text-xs font-medium text-gray-600">Cuota inicial</label>
                <InputMiles value={form.cuota_inicial} onChange={v=>set('cuota_inicial',v)} placeholder="0" />
              </div>
            )}

            {/* Tasa, período — solo no cuenta_abierta */}
            {!esCuentaAbierta && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600">Tasa (%)</label>
                  <input type="number" step="0.01" min="0" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.tasa_interes} onChange={e=>set('tasa_interes',e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Período tasa</label>
                  <div className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 select-none">
                    Mensual
                  </div>
                </div>
              </>
            )}

            {/* Cuotas, frecuencia, fecha — solo no cuenta_abierta */}
            {!esCuentaAbierta && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600">N° cuotas *</label>
                  <input type="number" required min="1" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.num_cuotas} onChange={e=>set('num_cuotas',e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Frecuencia cobro</label>
                  <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.frecuencia_cobro} onChange={e=>set('frecuencia_cobro',e.target.value)}>
                    {['diario','semanal','quincenal','mensual'].map(p=>
                      <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">Fecha primer pago *</label>
                  <input type="date" required className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_primer_pago} onChange={e=>set('fecha_primer_pago',e.target.value)} />
                </div>
              </>
            )}

            {/* Cuenta abierta — descripción + fecha */}
            {esCuentaAbierta && (
              <div className="col-span-2 space-y-3">
                <div className="bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 text-sm text-teal-700">
                  {tipoActual?.icono} <strong>{tipoActual?.label}</strong> — cuenta abierta sin cuotas fijas ni interés.
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Fecha de apertura *</label>
                  <input type="date" max={new Date().toISOString().split('T')[0]}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_primer_pago} onChange={e=>set('fecha_primer_pago',e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Descripción / motivo</label>
                  <textarea rows={3}
                    placeholder="Ej: 10 libras de queso, adelanto de nómina junio..."
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-teal-400"
                    value={form.descripcion_bien} onChange={e=>set('descripcion_bien',e.target.value)} />
                </div>
              </div>
            )}

            {/* Descripción del bien — solo préstamo_normal y empeño (excepto tipos que ya lo piden arriba) */}
            {!esCuentaAbierta && !esEmpeno && (
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600">Descripción del bien <span className="text-gray-400">(opcional)</span></label>
                <input type="text" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.descripcion_bien} onChange={e=>set('descripcion_bien',e.target.value)} />
              </div>
            )}

            {/* Campos de empeño */}
            {esEmpeno && (
              <>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">
                    Descripción del bien <span className="text-gray-400">(marca, modelo, color, serial, estado...)</span>
                  </label>
                  <textarea rows={3}
                    placeholder="Ej: Moto Honda CB 125cc, año 2022, color rojo, placa ABC123..."
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={form.descripcion_bien} onChange={e=>set('descripcion_bien',e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Valor comercial del bien</label>
                  <input type="number" min="0" placeholder="0"
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.valor_comercial_bien} onChange={e=>set('valor_comercial_bien',e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Fecha límite rescate</label>
                  <input type="date"
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_limite_rescate||''} onChange={e=>set('fecha_limite_rescate',e.target.value)} />
                </div>
              </>
            )}
          </div>

          <button type="submit" disabled={loading}
            className="w-full bg-primary-600 text-white rounded-lg py-2.5 font-medium hover:bg-primary-700 disabled:opacity-50">
            {loading ? 'Guardando...' : esCuentaAbierta ? `Registrar ${tipoActual?.label ?? 'cuenta abierta'}` : 'Crear y generar cuotas'}
          </button>
        </form>

        {/* Panel derecho */}
        <div className="bg-white rounded-xl border p-6">
          {esCuentaAbierta
            ? <div className="text-center py-12">
                <p className="text-5xl mb-4">{tipoActual?.icono ?? '📋'}</p>
                <p className="font-semibold text-gray-700 text-lg">{tipoActual?.label ?? 'Cuenta abierta'}</p>
                <p className="text-sm text-gray-400 mt-2">Se registra como cuenta abierta — sin cuotas fijas ni interés.</p>
                {parseFloat(form.monto_capital) > 0 && (
                  <div className="mt-6 bg-teal-50 border border-teal-200 rounded-xl p-4">
                    <p className="text-xs text-teal-500 uppercase font-semibold">Total a devolver</p>
                    <p className="text-3xl font-black text-teal-700 mt-1">{fmt(parseFloat(form.monto_capital))}</p>
                    <p className="text-xs text-teal-400 mt-1">Sin intereses ✓</p>
                  </div>
                )}
              </div>
            : <>
                <h3 className="font-semibold text-gray-700 mb-4">Vista previa tabla de amortización</h3>
                {cuotas.length === 0
                  ? <p className="text-sm text-gray-400">Completa el formulario para ver la proyección</p>
                  : <>
                      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                        <div className="bg-blue-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">Total a pagar</p>
                          <p className="font-bold text-blue-700">{fmt(totalPagar)}</p>
                        </div>
                        <div className="bg-orange-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">Total intereses</p>
                          <p className="font-bold text-orange-600">{fmt(totalInteres)}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">Cuota estándar</p>
                          <p className="font-bold text-green-700">{fmt(cuotas[1]?.monto_cuota||cuotas[0]?.monto_cuota)}</p>
                        </div>
                      </div>
                      <div className="overflow-auto max-h-96">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 text-gray-500 uppercase">
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
                            {cuotas.map(c=>(
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
                    </>
                }
              </>
          }
        </div>
      </div>
    </div>
  )
}

export default function NuevoPrestamo() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Cargando...</div>}>
      <NuevoPrestamoContenido />
    </Suspense>
  )
}
