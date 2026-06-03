'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

const fmt = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v)

const estadoColor = {
  pendiente: 'bg-gray-100 text-gray-600',
  parcial:   'bg-yellow-100 text-yellow-700',
  pagada:    'bg-green-100 text-green-700',
  mora:      'bg-red-100 text-red-700',
}

export default function DetallePrestamo() {
  const { id } = useParams()
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [pagos, setPagos]     = useState([])
  const [editModal, setEditModal] = useState(false)
  const [form, setForm]       = useState({})
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState('')

  const cargar = () => {
    fetch(`/api/productos/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setData(d)
        // Cargar historial de pagos
        fetch(`/api/pagos?producto_id=${id}`)
          .then(r => r.json())
          .then(setPagos)
        setForm({
          monto_capital:        d.monto_capital,
          tasa_interes:         d.tasa_interes,
          periodo_tasa:         d.periodo_tasa,
          frecuencia_cobro:     d.frecuencia_cobro,
          num_cuotas:           d.num_cuotas,
          fecha_primer_pago:    d.fecha_primer_pago?.split('T')[0],
          metodo_calculo:       d.metodo_calculo,
          cuota_inicial:        d.cuota_inicial || 0,
          descripcion_bien:     d.descripcion_bien || '',
          valor_comercial_bien: d.valor_comercial_bien || '',
          fecha_limite_rescate: d.fecha_limite_rescate?.split('T')[0] || '',
          notas:                d.notas || '',
        })
      })
  }

  useEffect(() => { cargar() }, [id])

  const guardarEdicion = async () => {
    setSaving(true); setSaveError('')
    const res = await fetch(`/api/productos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, _recalcular: true,
        monto_capital: parseFloat(form.monto_capital),
        tasa_interes:  parseFloat(form.tasa_interes),
        num_cuotas:    parseInt(form.num_cuotas),
        cuota_inicial: parseFloat(form.cuota_inicial||0),
      })
    })
    const result = await res.json()
    setSaving(false)
    if (!res.ok) { setSaveError(result.error); return }
    setEditModal(false)
    cargar()
  }

  const eliminar = async () => {
    if (!confirm('¿Eliminar este préstamo? Esta acción no se puede deshacer.')) return
    const res = await fetch(`/api/productos/${id}`, { method: 'DELETE' })
    const result = await res.json()
    if (!res.ok) { alert(result.error); return }
    window.location.href = '/prestamos'
  }

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  if (error) return <div className="text-red-600 p-4 bg-red-50 rounded-lg">❌ {error}</div>
  if (!data)  return <div className="text-gray-400 p-4">Cargando...</div>

  const totalPagado    = data.cuotas?.reduce((s,c) => s + parseFloat(c.monto_pagado||0), 0) || 0
  const totalPendiente = data.cuotas?.reduce((s,c) => s + (parseFloat(c.monto_cuota) - parseFloat(c.monto_pagado||0)), 0) || 0
  const cuotasPagadas  = data.cuotas?.filter(c => c.estado === 'pagada').length || 0
  const puedeEditar    = !data.tiene_pagos

  // Refinanciación: hay saldo pendiente y el préstamo no está saldado
  const saldoPendiente = Math.round(totalPendiente)
  const puedeRefinanciar = saldoPendiente > 0 && !['saldado','refinanciado'].includes(data.estado)

  const urlRefinanciar = `/prestamos/nuevo?cliente=${data.cliente_id}&capital=${saldoPendiente}&refinancia=${id}`

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/prestamos" className="hover:text-gray-700">← Préstamos</Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">{data.nombre_cliente}</span>
        </div>
        <div className="flex gap-2">
          {puedeEditar && (
            <>
              <button onClick={() => setEditModal(true)}
                className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-yellow-600">
                ✏️ Editar
              </button>
              <button onClick={eliminar}
                className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600">
                🗑 Eliminar
              </button>
            </>
          )}
          {puedeRefinanciar && (
            <Link href={urlRefinanciar}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700">
              🔄 Refinanciar saldo ({fmt(saldoPendiente)})
            </Link>
          )}
        </div>
      </div>

      {!puedeEditar && data.estado !== 'refinanciado' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700">
          ⚠️ Este préstamo ya tiene pagos registrados — no puede editarse.
        </div>
      )}

      {/* Aviso: este crédito fue refinanciado */}
      {data.estado === 'refinanciado' && data.refinanciado_por && (
        <div className="bg-purple-50 border border-purple-300 rounded-lg px-4 py-3 text-sm text-purple-800 flex justify-between items-center">
          <span>🔄 Este crédito fue <strong>refinanciado</strong>. El saldo pendiente pasó a un nuevo crédito.</span>
          <Link href={`/prestamos/${data.refinanciado_por}`}
            className="ml-4 bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-purple-700 whitespace-nowrap">
            Ver nuevo crédito →
          </Link>
        </div>
      )}

      {/* Aviso: este crédito es una refinanciación */}
      {data.es_refinanciacion_de && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 flex justify-between items-center">
          <span>🔗 Este crédito es una <strong>refinanciación</strong> de un crédito anterior.</span>
          <Link href={`/prestamos/${data.es_refinanciacion_de}`}
            className="ml-4 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 whitespace-nowrap">
            Ver crédito original →
          </Link>
        </div>
      )}

      {/* Encabezado */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex justify-between items-start">
          <div>
            <span className="text-xs uppercase font-bold text-primary-600 bg-primary-50 px-2 py-1 rounded">
              {data.tipo}
            </span>
            <h2 className="text-xl font-bold mt-2">{data.nombre_cliente}</h2>
            <p className="text-gray-500 text-sm">{data.documento}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium
            ${data.estado==='saldado'      ? 'bg-green-100 text-green-700' :
              data.estado==='en_mora'      ? 'bg-red-100 text-red-700' :
              data.estado==='refinanciado' ? 'bg-purple-100 text-purple-700' :
              'bg-blue-100 text-blue-700'}`}>
            {data.estado}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">Capital</p>
            <p className="font-bold text-gray-800">{fmt(data.monto_capital)}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">Pagado</p>
            <p className="font-bold text-green-700">{fmt(totalPagado)}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">Pendiente</p>
            <p className="font-bold text-blue-700">{fmt(totalPendiente)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">Avance</p>
            <p className="font-bold text-gray-800">{cuotasPagadas}/{data.num_cuotas} cuotas</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${(cuotasPagadas / (data.num_cuotas||1)) * 100}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1 text-right">
            {Math.round((cuotasPagadas / (data.num_cuotas||1)) * 100)}% completado
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4 text-sm text-gray-600">
          {data.tipo === 'fiado'
            ? <div><span className="font-medium">Fecha fiado:</span> {data.fecha_primer_pago ? new Date(data.fecha_primer_pago).toLocaleDateString('es-CO') : '—'}</div>
            : <>
                <div><span className="font-medium">Tasa:</span> {data.tasa_interes}% {data.periodo_tasa}</div>
                <div><span className="font-medium">Método:</span> {data.metodo_calculo}</div>
                <div><span className="font-medium">Frecuencia:</span> {data.frecuencia_cobro}</div>
              </>
          }
        </div>
        {data.descripcion_bien && (
          <p className="mt-3 text-sm text-gray-600">
            <span className="font-medium">Bien:</span> {data.descripcion_bien}
          </p>
        )}
      </div>

      {/* Tabla cuotas */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h3 className="font-semibold text-gray-700">Tabla de cuotas</h3>
          <Link href="/cobros" className="text-sm bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700">
            Registrar cobro
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">#</th>
              {data.tipo !== 'fiado' && <th className="text-left px-4 py-3">Vencimiento</th>}
              <th className="text-right px-4 py-3">Cuota</th>
              <th className="text-right px-4 py-3">Capital</th>
              <th className="text-right px-4 py-3">Interés</th>
              <th className="text-right px-4 py-3">Pagado</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-left px-4 py-3">Mora</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(data.cuotas||[]).map(c => (
              <tr key={c.id} className={`hover:bg-gray-50 ${c.estado==='mora'?'bg-red-50':c.estado==='pagada'?'bg-green-50/30':''}`}>
                <td className="px-4 py-2.5 font-medium">{c.numero_cuota}</td>
                {data.tipo !== 'fiado' && (
                  <td className="px-4 py-2.5 text-gray-500">{new Date(c.fecha_vencimiento).toLocaleDateString('es-CO')}</td>
                )}
                <td className="px-4 py-2.5 text-right font-semibold">{fmt(c.monto_cuota)}</td>
                <td className="px-4 py-2.5 text-right text-blue-600">{fmt(c.abono_capital)}</td>
                <td className="px-4 py-2.5 text-right text-orange-500">{fmt(c.abono_interes)}</td>
                <td className="px-4 py-2.5 text-right text-green-600">{fmt(c.monto_pagado)}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${estadoColor[c.estado]||estadoColor.pendiente}`}>
                    {c.estado}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {c.dias_mora > 0
                    ? <span className="text-red-600 font-semibold">{c.dias_mora}d</span>
                    : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Historial de pagos */}
      {pagos.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold text-gray-700">💳 Historial de pagos ({pagos.length})</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Recibo</th>
                <th className="text-left px-4 py-3">Fecha pago</th>
                {data.tipo !== 'fiado' && <th className="text-left px-4 py-3">Cuota</th>}
                <th className="text-right px-4 py-3">Monto</th>
                <th className="text-left px-4 py-3">Método</th>
                <th className="text-left px-4 py-3">Registró</th>
                <th className="text-left px-4 py-3">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagos.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.numero_recibo}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-700">
                    {new Date(p.fecha_pago).toLocaleDateString('es-CO')}
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(p.fecha_pago).toLocaleTimeString('es-CO', {hour:'2-digit',minute:'2-digit'})}
                    </span>
                  </td>
                  {data.tipo !== 'fiado' && (
                    <td className="px-4 py-2.5 text-gray-500">#{p.numero_cuota}</td>
                  )}
                  <td className="px-4 py-2.5 text-right font-semibold text-green-600">
                    {fmt(p.monto)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full capitalize">
                      {p.metodo_pago}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-medium text-gray-700">👤 {p.usuario_nombre || 'Sistema'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{p.notas || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t">
              <tr>
                <td colSpan={data.tipo === 'fiado' ? 2 : 3} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">
                  Total cobrado
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-green-700">
                  {fmt(pagos.reduce((s,p) => s + parseFloat(p.monto), 0))}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modal edición */}
      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-1">Editar préstamo</h3>
            <p className="text-xs text-amber-600 bg-amber-50 rounded p-2 mb-4">
              ⚠️ Las cuotas se regenerarán completamente con los nuevos valores.
            </p>
            {saveError && <p className="text-red-500 text-sm mb-3">{saveError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Capital</label>
                <input type="number" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.monto_capital} onChange={e=>set('monto_capital',e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Cuota inicial</label>
                <input type="number" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.cuota_inicial} onChange={e=>set('cuota_inicial',e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Tasa (%)</label>
                <input type="number" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.tasa_interes} onChange={e=>set('tasa_interes',e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Período tasa</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.periodo_tasa} onChange={e=>set('periodo_tasa',e.target.value)}>
                  {['diario','semanal','quincenal','mensual','anual'].map(p=>
                    <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">N° cuotas</label>
                <input type="number" min="1" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
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
              <div>
                <label className="text-xs font-medium text-gray-600">Método</label>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.metodo_calculo} onChange={e=>set('metodo_calculo',e.target.value)}>
                  <option value="plano">Interés plano</option>
                  <option value="frances">Sistema francés</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Fecha primer pago</label>
                <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.fecha_primer_pago} onChange={e=>set('fecha_primer_pago',e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600">Descripción del bien</label>
                <input type="text" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.descripcion_bien} onChange={e=>set('descripcion_bien',e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600">Notas</label>
                <textarea rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.notas} onChange={e=>set('notas',e.target.value)} />
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={() => { setEditModal(false); setSaveError('') }}
                className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={guardarEdicion} disabled={saving}
                className="flex-1 bg-yellow-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-yellow-600 disabled:opacity-50">
                {saving ? 'Guardando...' : '✏️ Guardar y recalcular cuotas'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
