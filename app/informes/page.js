'use client'
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'

const fmt  = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v||0)
const fmtN = v => new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(v||0)

export default function InformesPage() {
  const hoy   = new Date().toISOString().split('T')[0]
  const enero = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]

  const [desde, setDesde]   = useState(enero)
  const [hasta, setHasta]   = useState(hoy)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  const consultar = async () => {
    setLoading(true); setError('')
    const res = await fetch(`/api/informes?desde=${desde}&hasta=${hasta}&tipo=intereses`)
    const json = await res.json()
    setLoading(false)
    if (json.error) { setError(json.error); return }
    setData(json)
  }

  useEffect(() => { consultar() }, [])

  const exportarExcel = () => {
    if (!data) return

    const wb = XLSX.utils.book_new()

    // Hoja 1: Resumen ejecutivo
    const resumenData = [
      ['INFORME DE INTERESES COBRADOS — INVERSIONES TATA LIÑAN'],
      [`Período: ${desde} al ${hasta}`],
      [''],
      ['RESUMEN EJECUTIVO'],
      ['Indicador', 'Valor'],
      ['Total recaudado', parseFloat(data.totales.total_recaudado||0)],
      ['Intereses cobrados', parseFloat(data.totales.total_intereses||0)],
      ['Capital recuperado', parseFloat(data.totales.total_capital||0)],
      ['Número de pagos', parseInt(data.totales.num_pagos||0)],
      ['Clientes únicos', parseInt(data.totales.num_clientes||0)],
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(resumenData)
    ws1['!cols'] = [{wch:30},{wch:20}]
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen')

    // Hoja 2: Por mes
    const mesData = [
      ['Mes', 'Pagos', 'Clientes', 'Total recaudado', 'Intereses', 'Capital'],
      ...data.resumen_mensual.map(r => [
        new Date(r.mes).toLocaleDateString('es-CO',{year:'numeric',month:'long'}),
        parseInt(r.num_pagos),
        parseInt(r.num_clientes),
        parseFloat(r.total_recaudado||0),
        parseFloat(r.intereses_estimados||0),
        parseFloat(r.capital_recuperado||0),
      ])
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(mesData)
    ws2['!cols'] = [{wch:20},{wch:8},{wch:10},{wch:18},{wch:16},{wch:16}]
    XLSX.utils.book_append_sheet(wb, ws2, 'Por mes')

    // Hoja 3: Detalle completo
    const detalleData = [
      ['Fecha','Recibo','Cliente','Documento','Tipo','Descripción bien','Cuota #',
       'Total pago','Interés cobrado','Capital cobrado','Método','Registró','Notas'],
      ...data.detalle.map(d => [
        new Date(d.fecha).toLocaleDateString('es-CO'),
        d.numero_recibo,
        d.cliente,
        d.documento,
        d.tipo_producto,
        d.descripcion_bien || '',
        d.numero_cuota === 1 && d.tipo_producto === 'fiado' ? 'Cuenta' : d.numero_cuota,
        parseFloat(d.total_pago||0),
        parseFloat(d.interes_cobrado||0),
        parseFloat(d.capital_cobrado||0),
        d.metodo_pago,
        d.registrado_por || 'Sistema',
        d.notas || '',
      ])
    ]
    const ws3 = XLSX.utils.aoa_to_sheet(detalleData)
    ws3['!cols'] = [{wch:12},{wch:14},{wch:25},{wch:12},{wch:10},{wch:20},{wch:7},
                   {wch:14},{wch:14},{wch:14},{wch:12},{wch:15},{wch:20}]
    XLSX.utils.book_append_sheet(wb, ws3, 'Detalle pagos')

    XLSX.writeFile(wb, `Informe_Intereses_${desde}_${hasta}.xlsx`)
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800">📊 Informes</h2>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border p-5 flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-xs font-medium text-gray-600">Desde</label>
          <input type="date" className="mt-1 border rounded-lg px-3 py-2 text-sm block"
            value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Hasta</label>
          <input type="date" className="mt-1 border rounded-lg px-3 py-2 text-sm block"
            value={hasta} max={hoy} onChange={e => setHasta(e.target.value)} />
        </div>
        <button onClick={consultar} disabled={loading}
          className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {loading ? 'Consultando...' : '🔍 Consultar'}
        </button>
        {/* Accesos rápidos */}
        <div className="flex gap-2 flex-wrap">
          {[
            ['Este mes',  new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split('T')[0], hoy],
            ['Este año',  enero, hoy],
            ['Mes anterior', new Date(new Date().getFullYear(),new Date().getMonth()-1,1).toISOString().split('T')[0],
              new Date(new Date().getFullYear(),new Date().getMonth(),0).toISOString().split('T')[0]],
          ].map(([label, d, h]) => (
            <button key={label} onClick={() => { setDesde(d); setHasta(h); }}
              className="text-xs border rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50">
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">{error}</div>}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label:'Total recaudado',   val: fmt(data.totales.total_recaudado),   color:'blue',   icon:'💵' },
              { label:'Intereses cobrados',val: fmt(data.totales.total_intereses),   color:'green',  icon:'📈' },
              { label:'Capital recuperado',val: fmt(data.totales.total_capital),     color:'gray',   icon:'🏦' },
              { label:'Número de pagos',   val: fmtN(data.totales.num_pagos),        color:'yellow', icon:'🧾' },
              { label:'Clientes únicos',   val: fmtN(data.totales.num_clientes),     color:'purple', icon:'👥' },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border p-4">
                <p className="text-xl">{k.icon}</p>
                <p className="text-xs text-gray-500 mt-1">{k.label}</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{k.val}</p>
              </div>
            ))}
          </div>

          {/* Resumen mensual */}
          {data.resumen_mensual.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-4 border-b flex justify-between items-center">
                <h3 className="font-semibold text-gray-700">📅 Resumen por mes</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                    <tr>
                      <th className="text-left px-4 py-3">Mes</th>
                      <th className="text-right px-4 py-3">Pagos</th>
                      <th className="text-right px-4 py-3">Clientes</th>
                      <th className="text-right px-4 py-3">Total recaudado</th>
                      <th className="text-right px-4 py-3">Intereses</th>
                      <th className="text-right px-4 py-3">Capital</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.resumen_mensual.map((r,i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium capitalize">
                          {new Date(r.mes).toLocaleDateString('es-CO',{year:'numeric',month:'long'})}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{r.num_pagos}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{r.num_clientes}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmt(r.total_recaudado)}</td>
                        <td className="px-4 py-2.5 text-right text-green-600 font-semibold">{fmt(r.intereses_estimados)}</td>
                        <td className="px-4 py-2.5 text-right text-blue-600">{fmt(r.capital_recuperado)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 font-bold">
                    <tr>
                      <td className="px-4 py-3">TOTAL</td>
                      <td className="px-4 py-3 text-right">{data.totales.num_pagos}</td>
                      <td className="px-4 py-3 text-right">—</td>
                      <td className="px-4 py-3 text-right">{fmt(data.totales.total_recaudado)}</td>
                      <td className="px-4 py-3 text-right text-green-700">{fmt(data.totales.total_intereses)}</td>
                      <td className="px-4 py-3 text-right text-blue-700">{fmt(data.totales.total_capital)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Detalle */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b flex justify-between items-center">
              <h3 className="font-semibold text-gray-700">
                🧾 Detalle de pagos ({data.detalle.length})
              </h3>
              <button onClick={exportarExcel}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">
                📥 Exportar Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">Fecha pago</th>
                    <th className="text-left px-4 py-3">Recibo</th>
                    <th className="text-left px-4 py-3">Cliente</th>
                    <th className="text-left px-4 py-3">Tipo</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-right px-4 py-3">Interés</th>
                    <th className="text-right px-4 py-3">Capital</th>
                    <th className="text-left px-4 py-3">Método</th>
                    <th className="text-left px-4 py-3">Registró</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.detalle.map((d,i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                        {new Date(d.fecha).toLocaleDateString('es-CO')}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{d.numero_recibo}</td>
                      <td className="px-4 py-2.5 font-medium">{d.cliente}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                          {d.tipo_producto}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{fmt(d.total_pago)}</td>
                      <td className="px-4 py-2.5 text-right text-green-600 font-semibold">{fmt(d.interes_cobrado)}</td>
                      <td className="px-4 py-2.5 text-right text-blue-600">{fmt(d.capital_cobrado)}</td>
                      <td className="px-4 py-2.5 text-xs capitalize text-gray-500">{d.metodo_pago}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">👤 {d.registrado_por||'Sistema'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.detalle.length === 0 && (
                <p className="text-center text-gray-400 py-10 text-sm">Sin pagos en el período seleccionado</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
