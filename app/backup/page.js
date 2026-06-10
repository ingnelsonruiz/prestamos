'use client'
import { useState, useEffect, useRef } from 'react'

const fmt = n => Number(n).toLocaleString('es-CO')
const fmtFecha = iso => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) +
    ' ' + d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
}

export default function BackupPage() {
  const [historial,     setHistorial]     = useState([])
  const [cargando,      setCargando]      = useState(false)
  const [restaurando,   setRestaurando]   = useState(false)
  const [confirmacion,  setConfirmacion]  = useState('')
  const [archivoInfo,   setArchivoInfo]   = useState(null)   // { data, nombre, fecha, conteos }
  const [error,         setError]         = useState('')
  const [exito,         setExito]         = useState('')
  const fileRef = useRef()

  // ── Recrear estructura ────────────────────────────────────────────────────
  const [recreando,           setRecreando]           = useState(false)
  const [confirmEstructura,   setConfirmEstructura]   = useState('')
  const [resultadoEstructura, setResultadoEstructura] = useState(null) // null | { ok, exitosos, errores, resultados }

  const cargarHistorial = () =>
    fetch('/api/backup/historial').then(r => r.json()).then(d => Array.isArray(d) ? setHistorial(d) : null)

  useEffect(() => { cargarHistorial() }, [])

  // ── Exportar ──────────────────────────────────────────────────────────────
  const exportar = async () => {
    setCargando(true); setError(''); setExito('')
    try {
      const res = await fetch('/api/backup')
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const fecha = new Date().toISOString().slice(0, 10)
      a.href     = url
      a.download = `backup-itl-${fecha}.json`
      a.click()
      URL.revokeObjectURL(url)
      setExito('✅ Backup descargado exitosamente.')
      cargarHistorial()
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  // ── Leer archivo de restauración ─────────────────────────────────────────
  const leerArchivo = (e) => {
    setError(''); setExito(''); setArchivoInfo(null); setConfirmacion('')
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.json')) { setError('Solo se aceptan archivos .json'); return }

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.version || !data.tablas)
          throw new Error('El archivo no es un backup válido del sistema.')
        setArchivoInfo({
          data,
          nombre:  file.name,
          fecha:   data.fecha,
          generado_por: data.generado_por,
          conteos: data.conteos,
        })
      } catch (err) {
        setError(err.message)
      }
    }
    reader.readAsText(file)
  }

  // ── Restaurar ─────────────────────────────────────────────────────────────
  const restaurar = async () => {
    if (confirmacion !== 'RESTAURAR') { setError('Escribe RESTAURAR para confirmar.'); return }
    setRestaurando(true); setError(''); setExito('')
    try {
      const res = await fetch('/api/backup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(archivoInfo.data),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setExito('✅ ' + data.mensaje)
      setArchivoInfo(null)
      setConfirmacion('')
      if (fileRef.current) fileRef.current.value = ''
      cargarHistorial()
    } catch (e) {
      setError(e.message)
    } finally {
      setRestaurando(false)
    }
  }

  const cancelarRestaura = () => {
    setArchivoInfo(null); setConfirmacion(''); setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Recrear estructura BD ─────────────────────────────────────────────────
  const recrearEstructura = async () => {
    if (confirmEstructura !== 'RECREAR') { setError('Escribe RECREAR para confirmar.'); return }
    setRecreando(true); setError(''); setExito(''); setResultadoEstructura(null)
    try {
      const res  = await fetch('/api/backup/estructura', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResultadoEstructura(data)
      setConfirmEstructura('')
      if (data.ok) setExito(`✅ Estructura recreada: ${data.exitosos} sentencias ejecutadas sin errores.`)
      else          setError(`⚠️ Completado con ${data.errores} error(es). Revisa el detalle abajo.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setRecreando(false)
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">🛡️ Copia de Seguridad</h2>
          <p className="text-sm text-gray-500 mt-0.5">Exporta o restaura todos los datos del sistema</p>
        </div>
        {historial.length > 0 && historial[0].tipo === 'exportacion' && (
          <div className="text-xs text-gray-400 text-right">
            <p>Último backup</p>
            <p className="font-medium text-gray-600">{fmtFecha(historial[0]?.fecha)}</p>
          </div>
        )}
      </div>

      {/* ── Alertas globales ─────────────────────────────────────────────── */}
      {error  && <div className="bg-red-50 border border-red-300 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
      {exito  && <div className="bg-green-50 border border-green-300 text-green-700 text-sm rounded-lg px-4 py-3">{exito}</div>}

      {/* ── Exportar ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800 mb-1">📥 Exportar copia de seguridad</h3>
            <p className="text-sm text-gray-500 mb-3">
              Descarga un archivo <code className="bg-gray-100 px-1 rounded text-xs">.json</code> con todos los datos del sistema:
              clientes, préstamos, cuotas, pagos, movimientos de caja, historial y usuarios.
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              {['Clientes','Préstamos','Cuotas','Pagos','Caja','Historial','Usuarios','Config'].map(t => (
                <span key={t} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          </div>
          <button onClick={exportar} disabled={cargando}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold px-5 py-3 rounded-lg transition-colors whitespace-nowrap">
            {cargando ? '⏳ Generando...' : '⬇️ Descargar backup'}
          </button>
        </div>
      </div>

      {/* ── Historial ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">📋 Historial de copias</h3>
        {historial.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Sin copias de seguridad registradas aún.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b">
                  <th className="text-left pb-2 pr-4">Fecha</th>
                  <th className="text-left pb-2 pr-4">Tipo</th>
                  <th className="text-left pb-2 pr-4">Usuario</th>
                  <th className="text-right pb-2 pr-4">Clientes</th>
                  <th className="text-right pb-2 pr-4">Préstamos</th>
                  <th className="text-right pb-2 pr-4">Pagos</th>
                  <th className="text-right pb-2">Tamaño</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {historial.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">{fmtFecha(b.fecha)}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        b.tipo === 'exportacion'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {b.tipo === 'exportacion' ? '📥 Exportación' : '🔄 Restauración'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600">{b.usuario_nombre || '—'}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-700">{fmt(b.num_clientes)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-700">{fmt(b.num_productos)}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-700">{fmt(b.num_pagos)}</td>
                    <td className="py-2.5 text-right text-gray-500">
                      {b.tamanio_kb > 0 ? `${b.tamanio_kb} KB` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Restaurar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">🔄 Restaurar desde archivo</h3>
        <p className="text-sm text-red-600 mb-4">
          ⚠️ <strong>Atención:</strong> Restaurar un backup <strong>reemplaza todos los datos actuales</strong> con los del archivo seleccionado. Esta acción no se puede deshacer.
        </p>

        {!archivoInfo ? (
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-lg p-8 cursor-pointer transition-colors text-center">
            <span className="text-3xl mb-2">📂</span>
            <span className="text-sm font-medium text-gray-700">Seleccionar archivo de backup</span>
            <span className="text-xs text-gray-400 mt-1">Solo archivos .json generados por este sistema</span>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={leerArchivo} />
          </label>
        ) : (
          <div className="space-y-4">
            {/* Resumen del archivo */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800 mb-3">📄 Archivo cargado: {archivoInfo.nombre}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                {[
                  { label: 'Clientes',  val: archivoInfo.conteos?.clientes  },
                  { label: 'Préstamos', val: archivoInfo.conteos?.productos  },
                  { label: 'Cuotas',    val: archivoInfo.conteos?.cuotas     },
                  { label: 'Pagos',     val: archivoInfo.conteos?.pagos      },
                ].map(({ label, val }) => (
                  <div key={label} className="bg-white rounded-lg border border-amber-200 p-2">
                    <p className="text-lg font-bold text-amber-700">{fmt(val || 0)}</p>
                    <p className="text-xs text-gray-500">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-700 mt-3">
                Backup del <strong>{archivoInfo.fecha?.slice(0,10)}</strong> — generado por <strong>{archivoInfo.generado_por}</strong>
              </p>
            </div>

            {/* Confirmación */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Escribe <span className="font-bold text-red-600">RESTAURAR</span> para confirmar:
              </label>
              <input type="text" placeholder="RESTAURAR"
                value={confirmacion}
                onChange={e => setConfirmacion(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none" />
            </div>

            <div className="flex gap-3">
              <button onClick={restaurar}
                disabled={restaurando || confirmacion !== 'RESTAURAR'}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors">
                {restaurando ? '⏳ Restaurando...' : '🔄 Restaurar ahora'}
              </button>
              <button onClick={cancelarRestaura}
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Recrear estructura ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">🏗️ Recrear estructura de base de datos</h3>
        <p className="text-sm text-orange-700 mb-4">
          ⚠️ Usa esto <strong>solo si la base de datos colapsó o perdió sus tablas</strong>.
          Esta operación crea todas las tablas, índices y datos iniciales desde cero.
          Los datos existentes <strong>no se borran</strong> — usa <code className="bg-gray-100 px-1 rounded text-xs">IF NOT EXISTS</code> en todo.
        </p>

        {/* Qué se crea */}
        <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {[
            '🏛️ Esquema administrativo',
            '👥 cred_clientes',
            '💰 cred_productos',
            '📅 cred_cuotas',
            '💳 cred_pagos',
            '🏦 cred_movimientos_caja',
            '⚙️ cred_configuracion',
            '👤 cred_usuarios',
            '📋 cred_auditoria',
            '📊 cred_historial_recalculos',
            '🏷️ cred_tipos_prestamo',
            '🛡️ cred_backups',
            '⚡ 20+ índices de rendimiento',
            '🔑 Usuario admin inicial',
            '🗝️ Configuración inicial',
          ].map(item => (
            <span key={item} className="bg-orange-50 border border-orange-200 text-orange-700 px-2 py-1 rounded text-xs">
              {item}
            </span>
          ))}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Escribe <span className="font-bold text-orange-600">RECREAR</span> para confirmar:
          </label>
          <input type="text" placeholder="RECREAR"
            value={confirmEstructura}
            onChange={e => setConfirmEstructura(e.target.value)}
            className="w-full max-w-xs border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none" />
        </div>

        <button onClick={recrearEstructura}
          disabled={recreando || confirmEstructura !== 'RECREAR'}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors">
          {recreando ? '⏳ Recreando estructura...' : '🏗️ Recrear estructura'}
        </button>

        {/* Resultado detallado */}
        {resultadoEstructura && (
          <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
            <div className={`px-4 py-2 text-sm font-semibold ${resultadoEstructura.ok ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
              {resultadoEstructura.ok
                ? `✅ ${resultadoEstructura.exitosos} de ${resultadoEstructura.total} sentencias ejecutadas correctamente`
                : `⚠️ ${resultadoEstructura.exitosos} OK · ${resultadoEstructura.errores} con error`}
            </div>
            <div className="max-h-64 overflow-y-auto p-3 bg-gray-50 space-y-1">
              {resultadoEstructura.resultados.map((r, i) => (
                <div key={i} className={`flex items-start gap-2 text-xs font-mono ${r.ok ? 'text-gray-600' : 'text-red-600'}`}>
                  <span className="shrink-0">{r.ok ? '✓' : '✗'}</span>
                  <span className="break-all">{r.sql}{r.nota ? ` — ${r.nota}` : ''}{r.error ? ` — ${r.error}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
