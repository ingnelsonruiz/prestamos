'use client'
import { useState, useRef } from 'react'

const fmt  = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
const fmtFecha = f => f ? new Date(f).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtFechaSolo = f => f ? new Date(f).toLocaleDateString('es-CO') : '—'

const tipoLabel   = { prestamo: 'Préstamo', venta: 'Venta a crédito', empeno: 'Empeño', fiado: 'Fiado', adelanto: 'Adelanto' }
const metodoBadge = { efectivo: 'bg-green-100 text-green-700', transferencia: 'bg-blue-100 text-blue-700', nequi: 'bg-purple-100 text-purple-700', daviplata: 'bg-red-100 text-red-700', otro: 'bg-gray-100 text-gray-600' }

export default function RecibosPage() {
  const [buscar, setBuscar]   = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando]     = useState(false)
  const [buscado, setBuscado]       = useState(false)
  const [error, setError]     = useState('')
  const [imprimiendo, setImprimiendo] = useState(null)
  const debounceRef = useRef(null)

  const buscarRecibo = async (q) => {
    if (!q.trim()) { setResultados([]); setBuscado(false); return }
    setBuscando(true); setError(''); setBuscado(false)
    try {
      const res  = await fetch(`/api/recibos?q=${encodeURIComponent(q.trim())}`)
      const data = await res.json()
      if (data.error) { setError(data.error); setResultados([]) }
      else setResultados(data)
    } catch {
      setError('Error de conexión')
    }
    setBuscando(false)
    setBuscado(true)
  }

  const handleChange = e => {
    const q = e.target.value
    setBuscar(q)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => buscarRecibo(q), 400)
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter') {
      clearTimeout(debounceRef.current)
      buscarRecibo(buscar)
    }
  }

  const imprimir = (recibo) => {
    setImprimiendo(recibo)
    setTimeout(() => window.print(), 200)
  }

  return (
    <>
      {/* Estilos de impresión */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #recibo-imprimible, #recibo-imprimible * { visibility: visible !important; }
          #recibo-imprimible { position: fixed; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">🧾 Consulta de Recibos</h2>
          <p className="text-sm text-gray-500 mt-1">Busca por número de recibo (REC-000001) o solo por el número</p>
        </div>

        {/* Buscador */}
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">🔍</span>
          <input
            type="text"
            placeholder="REC-000001  ó  1  ó  parte del número..."
            className="w-full border-2 rounded-xl pl-12 pr-4 py-3.5 text-base focus:outline-none focus:border-indigo-500 transition-colors uppercase placeholder:normal-case placeholder:text-gray-400"
            value={buscar}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {buscando && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm animate-pulse">Buscando...</span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm">❌ {error}</div>
        )}

        {/* Sin resultados */}
        {buscado && !buscando && resultados.length === 0 && (
          <div className="bg-white rounded-xl border p-12 text-center">
            <p className="text-4xl mb-3">🔎</p>
            <p className="font-semibold text-gray-600">No se encontró ningún recibo</p>
            <p className="text-sm text-gray-400 mt-1">Verifica el número e intenta de nuevo</p>
          </div>
        )}

        {/* Estado inicial */}
        {!buscado && !buscando && (
          <div className="bg-white rounded-xl border p-12 text-center">
            <p className="text-5xl mb-3">🧾</p>
            <p className="font-semibold text-gray-600">Escribe un número de recibo para buscarlo</p>
            <p className="text-sm text-gray-400 mt-1">Ejemplo: <span className="font-mono font-bold text-indigo-600">REC-000001</span> o simplemente <span className="font-mono font-bold text-indigo-600">1</span></p>
          </div>
        )}

        {/* Resultados */}
        {resultados.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{resultados.length} recibo(s) encontrado(s)</p>

            {resultados.map(r => (
              <div key={r.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                {/* Encabezado recibo */}
                <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-white/70 text-xs uppercase tracking-wide">Número de recibo</p>
                    <p className="text-white text-2xl font-bold font-mono">{r.numero_recibo}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/70 text-xs uppercase tracking-wide">Fecha de pago</p>
                    <p className="text-white font-semibold text-sm">{fmtFecha(r.fecha_pago)}</p>
                    <p className="text-white/60 text-xs mt-0.5">Registrado por: {r.usuario_nombre}</p>
                  </div>
                </div>

                {/* Monto destacado */}
                <div className="bg-green-50 border-b px-6 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${metodoBadge[r.metodo_pago] || metodoBadge.otro}`}>
                      💳 {r.metodo_pago}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Valor pagado</p>
                    <p className="text-2xl font-bold text-green-600">{fmt(r.monto)}</p>
                  </div>
                </div>

                {/* Detalles en grid */}
                <div className="px-6 py-4 grid grid-cols-2 gap-x-8 gap-y-3">
                  {/* Cliente */}
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Cliente</p>
                    <p className="font-semibold text-gray-800">{r.nombre_cliente}</p>
                    <p className="text-sm text-gray-500">CC/NIT: {r.documento}</p>
                    {r.telefono && <p className="text-sm text-green-600">📞 {r.telefono}</p>}
                  </div>

                  {/* Producto */}
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Producto</p>
                    <p className="font-semibold text-gray-800">{tipoLabel[r.tipo_producto] || r.tipo_producto}</p>
                    {r.descripcion_bien && <p className="text-sm text-gray-500 italic">{r.descripcion_bien}</p>}
                    <p className="text-sm text-gray-500">Capital: {fmt(r.monto_capital)}</p>
                  </div>

                  {/* Cuota */}
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Cuota</p>
                    {r.tipo_producto === 'fiado'
                      ? <p className="font-semibold text-gray-800">Cuenta abierta</p>
                      : <>
                          <p className="font-semibold text-gray-800">#{r.numero_cuota} de {r.num_cuotas}</p>
                          <p className="text-sm text-gray-500">Vencía: {fmtFechaSolo(r.fecha_vencimiento)}</p>
                        </>
                    }
                  </div>

                  {/* Desglose del pago */}
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Desglose</p>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Abono capital</span>
                        <span className="font-medium">{fmt(r.abono_capital)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Abono interés</span>
                        <span className="font-medium">{fmt(r.abono_interes)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t mt-1 pt-1">
                        <span className="text-gray-500">Total cuota</span>
                        <span className="font-semibold">{fmt(r.monto_cuota)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Total pagado cuota</span>
                        <span className="font-semibold text-green-600">{fmt(r.monto_pagado)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Saldo pendiente */}
                {r.estado_producto !== 'saldado' && parseFloat(r.saldo_pendiente) > 0 ? (
                  <div className="mx-6 mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Saldo pendiente</p>
                      <p className="text-xs text-amber-500 mt-0.5">
                        {r.cuotas_pendientes} cuota{r.cuotas_pendientes !== '1' ? 's' : ''} por cancelar
                      </p>
                    </div>
                    <p className="text-xl font-black text-amber-700">{fmt(r.saldo_pendiente)}</p>
                  </div>
                ) : r.estado_producto === 'saldado' ? (
                  <div className="mx-6 mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-2 text-center">
                    <p className="text-sm font-bold text-green-700">✅ Crédito saldado — sin deuda pendiente</p>
                  </div>
                ) : null}

                {/* Notas */}
                {r.notas && (
                  <div className="px-6 pb-4">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Notas</p>
                    <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{r.notas}</p>
                  </div>
                )}

                {/* Acciones */}
                <div className="px-6 pb-4 flex gap-2">
                  <button
                    onClick={() => imprimir(r)}
                    className="flex items-center gap-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors">
                    🖨️ Imprimir recibo
                  </button>
                  <a href={`/clientes/${r.cliente_id}`}
                    className="flex items-center gap-2 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg font-medium transition-colors">
                    👤 Ver cliente
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recibo imprimible (oculto en pantalla) */}
      {imprimiendo && (
        <div id="recibo-imprimible" className="hidden print:block p-8 max-w-sm mx-auto font-mono text-sm">
          <div className="text-center border-b-2 border-black pb-3 mb-3">
            <p className="text-xl font-bold">💼 INVERSIONES HNOS LIÑÁN</p>
            <p className="text-xs">Recibo de Pago</p>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between"><span>Recibo:</span><span className="font-bold">{imprimiendo.numero_recibo}</span></div>
            <div className="flex justify-between"><span>Fecha:</span><span>{fmtFecha(imprimiendo.fecha_pago)}</span></div>
            <div className="border-t border-dashed my-2" />
            <div className="flex justify-between"><span>Cliente:</span><span>{imprimiendo.nombre_cliente}</span></div>
            <div className="flex justify-between"><span>CC/NIT:</span><span>{imprimiendo.documento}</span></div>
            <div className="border-t border-dashed my-2" />
            <div className="flex justify-between"><span>Producto:</span><span>{tipoLabel[imprimiendo.tipo_producto]}</span></div>
            {imprimiendo.tipo_producto !== 'fiado' && (
              <div className="flex justify-between"><span>Cuota:</span><span>#{imprimiendo.numero_cuota} / {imprimiendo.num_cuotas}</span></div>
            )}
            <div className="flex justify-between"><span>Método:</span><span className="capitalize">{imprimiendo.metodo_pago}</span></div>
            <div className="border-t border-dashed my-2" />
            <div className="flex justify-between text-lg font-bold"><span>VALOR PAGADO:</span><span>{fmt(imprimiendo.monto)}</span></div>
            {imprimiendo.notas && <p className="text-xs mt-2">Nota: {imprimiendo.notas}</p>}
            <div className="border-t border-dashed my-2" />
            <p className="text-center text-xs">Registrado por: {imprimiendo.usuario_nombre}</p>
            <p className="text-center text-xs mt-3">¡Gracias por su pago! 🙏</p>
          </div>
        </div>
      )}
    </>
  )
}
