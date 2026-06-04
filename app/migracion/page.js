'use client'
import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'

function ToggleModoPrueba() {
  const [activo, setActivo]     = useState(false)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    fetch('/api/config/modo-prueba').then(r=>r.json()).then(d => { setActivo(d.activo); setCargando(false) })
  }, [])

  const toggle = async () => {
    const nuevo = !activo
    try {
      const res  = await fetch('/api/config/modo-prueba', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: nuevo })
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setActivo(nuevo)
      } else {
        alert('Error al guardar: ' + (data.error || 'intenta de nuevo'))
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message)
    }
  }

  if (cargando) return null

  return (
    <div className={`rounded-2xl border-2 p-5 flex items-center justify-between gap-4 ${activo ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{activo ? '🧪' : '🔒'}</span>
        <div>
          <p className={`font-bold ${activo ? 'text-amber-700' : 'text-gray-700'}`}>
            Modo prueba — fechas futuras en pagos
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {activo
              ? '⚠️ ACTIVO — puedes registrar pagos con fechas futuras para hacer pruebas'
              : 'Desactivado — solo se permiten pagos con fecha actual o anterior'}
          </p>
        </div>
      </div>
      <button onClick={toggle}
        className={`relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${activo ? 'bg-amber-400' : 'bg-gray-300'}`}>
        <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-7' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

function BotonReset() {
  const [fase, setFase]       = useState(0) // 0=normal, 1=primera confirmación, 2=segunda
  const [texto, setTexto]     = useState('')
  const [ejecutando, setEjecutando] = useState(false)
  const [listo, setListo]     = useState(false)

  const ejecutarReset = async () => {
    setEjecutando(true)
    const res  = await fetch('/api/migracion/reset', { method: 'POST' })
    const data = await res.json()
    setEjecutando(false)
    if (data.ok) { setListo(true); setFase(0) }
    else alert('Error: ' + data.error)
  }

  if (listo) return (
    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex justify-between items-center text-sm">
      <span className="text-green-700 font-semibold">✅ Datos de prueba eliminados. Clientes y usuarios conservados.</span>
      <button onClick={() => setListo(false)} className="text-green-500 hover:text-green-700">✕</button>
    </div>
  )

  return (
    <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-3xl">🗑️</span>
        <div>
          <p className="font-bold text-red-700">Limpiar datos de prueba</p>
          <p className="text-xs text-red-500">Elimina préstamos, cuotas, pagos y movimientos. <strong>Conserva clientes y usuarios.</strong></p>
        </div>
      </div>

      {fase === 0 && (
        <button onClick={() => setFase(1)}
          className="w-full bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 font-bold text-sm">
          🗑️ Limpiar todos los movimientos
        </button>
      )}

      {fase === 1 && (
        <div className="space-y-2">
          <div className="bg-red-100 border border-red-300 rounded-xl p-3 text-sm text-red-700 font-semibold text-center">
            ⚠️ Se borrarán TODOS los préstamos, cuotas, pagos y caja.<br/>Esta acción NO se puede deshacer.
          </div>
          <div className="flex gap-2">
            <button onClick={() => setFase(0)}
              className="flex-1 border rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button onClick={() => setFase(2)}
              className="flex-1 bg-red-600 text-white rounded-xl py-2 text-sm font-bold hover:bg-red-700">
              Sí, continuar →
            </button>
          </div>
        </div>
      )}

      {fase === 2 && (
        <div className="space-y-2">
          <p className="text-sm text-red-700 font-semibold text-center">
            Escribe <span className="font-mono bg-red-200 px-1 rounded">LIMPIAR</span> para confirmar
          </p>
          <input type="text" placeholder="Escribe LIMPIAR"
            className="w-full border-2 border-red-300 rounded-xl px-4 py-2 text-sm text-center font-mono font-bold focus:outline-none focus:border-red-500 uppercase"
            value={texto} onChange={e => setTexto(e.target.value.toUpperCase())} />
          <div className="flex gap-2">
            <button onClick={() => { setFase(0); setTexto('') }}
              className="flex-1 border rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button
              onClick={ejecutarReset}
              disabled={texto !== 'LIMPIAR' || ejecutando}
              className="flex-1 bg-red-700 text-white rounded-xl py-2 text-sm font-bold hover:bg-red-800 disabled:opacity-40">
              {ejecutando ? '⏳ Eliminando...' : '🗑️ CONFIRMAR LIMPIEZA'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const fmt = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0)

// ── Definición de plantillas ──────────────────────────────────────────────────
const PLANTILLAS = [
  {
    id: 'clientes',
    nombre: 'Solo Clientes',
    icono: '👥',
    color: 'blue',
    descripcion: 'Registra clientes sin deuda. Ideal para cargar el directorio.',
    columnas: [
      { key: 'documento',  label: 'DOCUMENTO',  requerido: true,  ejemplo: '1067123456',        ayuda: 'Cédula o NIT' },
      { key: 'nombre',     label: 'NOMBRE',     requerido: true,  ejemplo: 'JUAN PEREZ',         ayuda: 'Nombre completo en mayúsculas' },
      { key: 'telefono',   label: 'TELEFONO',   requerido: false, ejemplo: '3001234567',         ayuda: 'Celular o fijo' },
      { key: 'direccion',  label: 'DIRECCION',  requerido: false, ejemplo: 'Cra 5 #10-20',       ayuda: 'Dirección de residencia' },
      { key: 'email',      label: 'EMAIL',      requerido: false, ejemplo: 'correo@gmail.com',   ayuda: 'Correo electrónico' },
    ],
    ejemplos: [
      { documento:'1067123456', nombre:'JUAN CARLOS PEREZ',   telefono:'3001234567', direccion:'Cra 5 #10-20',    email:'juan@gmail.com' },
      { documento:'1067654321', nombre:'MARIA RODRIGUEZ',      telefono:'3109876543', direccion:'Clle 8 #3-15',    email:'' },
      { documento:'900123456',  nombre:'FERRETERIA EL CLAVO',  telefono:'5742345678', direccion:'Av Principal 12', email:'ferreteria@mail.com' },
    ]
  },
  {
    id: 'prestamos',
    nombre: 'Clientes + Deudas',
    icono: '💰',
    color: 'green',
    descripcion: 'Migra clientes con sus saldos actuales. Cada fila = un saldo pendiente.',
    columnas: [
      { key: 'documento',    label: 'DOCUMENTO',    requerido: true,  ejemplo: '1067123456',     ayuda: 'Cédula del cliente' },
      { key: 'nombre',       label: 'NOMBRE',       requerido: true,  ejemplo: 'JUAN PEREZ',     ayuda: 'Nombre completo' },
      { key: 'telefono',     label: 'TELEFONO',     requerido: false, ejemplo: '3001234567',     ayuda: 'Celular' },
      { key: 'direccion',    label: 'DIRECCION',    requerido: false, ejemplo: 'Cra 5 #10-20',   ayuda: 'Dirección' },
      { key: 'tipo',         label: 'TIPO',         requerido: true,  ejemplo: 'prestamo',       ayuda: 'prestamo / fiado / empeno / adelanto / venta' },
      { key: 'saldo_actual', label: 'SALDO_ACTUAL', requerido: true,  ejemplo: '500000',         ayuda: 'Saldo que debe actualmente (solo números)' },
      { key: 'descripcion',  label: 'DESCRIPCION',  requerido: false, ejemplo: 'Queso 5 libras', ayuda: 'Descripción del bien o motivo' },
      { key: 'notas',        label: 'NOTAS',        requerido: false, ejemplo: 'Desde enero',    ayuda: 'Observaciones adicionales' },
    ],
    ejemplos: [
      { documento:'1067123456', nombre:'JUAN CARLOS PEREZ',  telefono:'3001234567', direccion:'Cra 5 #10-20',  tipo:'prestamo', saldo_actual:500000,  descripcion:'',              notas:'Préstamo de marzo' },
      { documento:'1067123456', nombre:'JUAN CARLOS PEREZ',  telefono:'3001234567', direccion:'Cra 5 #10-20',  tipo:'fiado',    saldo_actual:85000,   descripcion:'Queso 10 lb',   notas:'' },
      { documento:'1067654321', nombre:'MARIA RODRIGUEZ',    telefono:'3109876543', direccion:'Clle 8 #3-15',  tipo:'prestamo', saldo_actual:1200000, descripcion:'',              notas:'Lleva 3 cuotas' },
      { documento:'1067654321', nombre:'MARIA RODRIGUEZ',    telefono:'3109876543', direccion:'Clle 8 #3-15',  tipo:'empeno',   saldo_actual:300000,  descripcion:'Moto Honda 125',notas:'' },
    ]
  },
  {
    id: 'solo_saldos',
    nombre: 'Solo Saldos (clientes ya existentes)',
    icono: '📋',
    color: 'purple',
    descripcion: 'Para clientes que ya están registrados. Solo actualiza sus deudas.',
    columnas: [
      { key: 'documento',    label: 'DOCUMENTO',    requerido: true,  ejemplo: '1067123456',     ayuda: 'Cédula del cliente ya registrado' },
      { key: 'nombre',       label: 'NOMBRE',       requerido: true,  ejemplo: 'JUAN PEREZ',     ayuda: 'Nombre (se actualiza si hay diferencia)' },
      { key: 'tipo',         label: 'TIPO',         requerido: true,  ejemplo: 'prestamo',       ayuda: 'prestamo / fiado / empeno / adelanto / venta' },
      { key: 'saldo_actual', label: 'SALDO_ACTUAL', requerido: true,  ejemplo: '500000',         ayuda: 'Lo que debe ahora' },
      { key: 'descripcion',  label: 'DESCRIPCION',  requerido: false, ejemplo: 'Queso 5 libras', ayuda: 'Descripción del bien o motivo' },
      { key: 'notas',        label: 'NOTAS',        requerido: false, ejemplo: 'Desde enero',    ayuda: 'Observaciones' },
    ],
    ejemplos: [
      { documento:'1067123456', nombre:'JUAN CARLOS PEREZ', tipo:'prestamo', saldo_actual:500000,  descripcion:'',             notas:'' },
      { documento:'1067654321', nombre:'MARIA RODRIGUEZ',   tipo:'fiado',    saldo_actual:120000,  descripcion:'Arroz 5 bultos',notas:'Pendiente de diciembre' },
    ]
  }
]

const colorMap = {
  blue:   { btn: 'bg-blue-600 hover:bg-blue-700',   badge: 'bg-blue-100 text-blue-700',   border: 'border-blue-200', light: 'bg-blue-50' },
  green:  { btn: 'bg-green-600 hover:bg-green-700', badge: 'bg-green-100 text-green-700', border: 'border-green-200',light: 'bg-green-50' },
  purple: { btn: 'bg-purple-600 hover:bg-purple-700',badge:'bg-purple-100 text-purple-700',border:'border-purple-200',light:'bg-purple-50' },
}

export default function MigracionPage() {
  const [paso, setPaso]             = useState(1) // 1=plantillas, 2=subir, 3=preview, 4=resultado
  const [plantillaActiva, setPlantillaActiva] = useState(null)
  const [filas, setFilas]           = useState([])
  const [erroresValidacion, setErroresValidacion] = useState([])
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado]   = useState(null)
  const [archivoNombre, setArchivoNombre] = useState('')
  const inputRef = useRef()

  // ── Descargar plantilla Excel ─────────────────────────────────────────────
  const descargarPlantilla = (plantilla) => {
    const wb = XLSX.utils.book_new()

    // Hoja de datos
    const encabezados = plantilla.columnas.map(c => c.label)
    const ejemploRows = plantilla.ejemplos.map(e => plantilla.columnas.map(c => e[c.key] ?? ''))
    const ws = XLSX.utils.aoa_to_sheet([encabezados, ...ejemploRows])

    // Ancho de columnas
    ws['!cols'] = plantilla.columnas.map(c => ({ wch: Math.max(c.label.length, c.ejemplo.length, 18) }))

    // Estilo encabezado (color azul oscuro)
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = XLSX.utils.encode_cell({ r: 0, c: C })
      if (!ws[cell]) continue
      ws[cell].s = {
        font:    { bold: true, color: { rgb: 'FFFFFF' } },
        fill:    { fgColor: { rgb: '1E3A5F' } },
        alignment: { horizontal: 'center' }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, 'DATOS')

    // Hoja de instrucciones
    const instrucciones = [
      ['INSTRUCCIONES DE LLENADO — ' + plantilla.nombre.toUpperCase()],
      [''],
      ['COLUMNA', 'REQUERIDA', 'DESCRIPCIÓN', 'EJEMPLO'],
      ...plantilla.columnas.map(c => [
        c.label,
        c.requerido ? 'SÍ ✓' : 'No',
        c.ayuda,
        c.ejemplo
      ]),
      [''],
      ['NOTAS IMPORTANTES:'],
      ['• No borrar ni cambiar los encabezados de la fila 1'],
      ['• Los datos inician desde la fila 2'],
      ['• SALDO_ACTUAL: solo números, sin puntos ni comas (ej: 500000)'],
      ['• TIPO válidos: prestamo, fiado, empeno, adelanto, venta'],
      ['• Si el cliente ya existe, se actualiza con los nuevos datos'],
      ['• Los saldos se crean como cuenta abierta (sin plan de cuotas)'],
    ]
    const wsInst = XLSX.utils.aoa_to_sheet(instrucciones)
    wsInst['!cols'] = [{wch:20},{wch:12},{wch:40},{wch:25}]
    XLSX.utils.book_append_sheet(wb, wsInst, 'INSTRUCCIONES')

    XLSX.writeFile(wb, `Plantilla_${plantilla.id}_Inversiones.xlsx`)
  }

  // ── Leer archivo subido ───────────────────────────────────────────────────
  const leerArchivo = (file) => {
    if (!file) return
    setArchivoNombre(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const wb   = XLSX.read(e.target.result, { type: 'array' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

      // Normalizar claves a minúsculas sin espacios
      const normalizadas = rows.map((row, i) => {
        const norm = { _fila: i + 2 }
        Object.keys(row).forEach(k => {
          norm[k.toLowerCase().trim().replace(/\s+/g,'_')] = String(row[k]).trim()
        })
        return norm
      }).filter(r => r.documento || r.nombre) // ignorar filas vacías

      // Validar
      const errores = []
      normalizadas.forEach(r => {
        if (!r.documento) errores.push(`Fila ${r._fila}: falta DOCUMENTO`)
        if (!r.nombre)    errores.push(`Fila ${r._fila}: falta NOMBRE`)
        if (r.saldo_actual && isNaN(parseFloat(r.saldo_actual)))
          errores.push(`Fila ${r._fila}: SALDO_ACTUAL debe ser número`)
        if (r.tipo) {
          const validos = ['prestamo','venta','empeno','fiado','adelanto']
          if (!validos.includes(r.tipo.toLowerCase()))
            errores.push(`Fila ${r._fila}: TIPO inválido "${r.tipo}" — use: prestamo, fiado, empeno, adelanto, venta`)
        }
      })

      setFilas(normalizadas)
      setErroresValidacion(errores)
      setPaso(3)
    }
    reader.readAsArrayBuffer(file)
  }

  // ── Importar ──────────────────────────────────────────────────────────────
  const importar = async () => {
    setImportando(true)
    const res  = await fetch('/api/migracion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registros: filas })
    })
    const data = await res.json()
    setImportando(false)
    setResultado(data)
    setPaso(4)
  }

  const reiniciar = () => {
    setPaso(1); setFilas([]); setErroresValidacion([])
    setResultado(null); setArchivoNombre(''); setPlantillaActiva(null)
  }

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">📦 Migración masiva</h2>
        <p className="text-sm text-gray-500 mt-1">Importa clientes y saldos desde cuadernos o Excel en pocos pasos</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs font-semibold">
        {[
          { n:1, l:'Plantillas' },
          { n:2, l:'Subir archivo' },
          { n:3, l:'Vista previa' },
          { n:4, l:'Resultado' },
        ].map((s, i, arr) => (
          <div key={s.n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm
              ${paso >= s.n ? 'bg-[#1e3a5f] text-white' : 'bg-gray-200 text-gray-400'}`}>
              {paso > s.n ? '✓' : s.n}
            </div>
            <span className={paso >= s.n ? 'text-gray-800' : 'text-gray-400'}>{s.l}</span>
            {i < arr.length - 1 && <div className={`w-8 h-0.5 ${paso > s.n ? 'bg-[#1e3a5f]' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* ── PASO 1: Plantillas ── */}
      {paso === 1 && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
            <strong>¿Cómo funciona?</strong> Descarga la plantilla que necesites → llénala con tus datos del cuaderno → súbela aquí → el sistema crea los clientes y saldos automáticamente.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANTILLAS.map(p => {
              const c = colorMap[p.color]
              return (
                <div key={p.id} className={`bg-white rounded-2xl border-2 ${c.border} p-5 space-y-3`}>
                  <div className="flex items-center gap-2">
                    <span className="text-3xl">{p.icono}</span>
                    <div>
                      <p className="font-bold text-gray-800">{p.nombre}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge}`}>
                        {p.columnas.length} columnas
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">{p.descripcion}</p>

                  {/* Columnas */}
                  <div className="space-y-1">
                    {p.columnas.map(col => (
                      <div key={col.key} className="flex items-center gap-1.5 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${col.requerido ? 'bg-red-400' : 'bg-gray-300'}`} />
                        <span className="font-mono font-semibold text-gray-700">{col.label}</span>
                        {col.requerido && <span className="text-red-400 text-xs">*</span>}
                        <span className="text-gray-400">— {col.ayuda}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => descargarPlantilla(p)}
                      className={`flex-1 text-white text-sm py-2 rounded-xl font-semibold ${c.btn} flex items-center justify-center gap-1.5`}>
                      ⬇️ Descargar plantilla
                    </button>
                  </div>
                  <button
                    onClick={() => { setPlantillaActiva(p); setPaso(2) }}
                    className="w-full border-2 border-gray-200 hover:border-gray-300 text-gray-700 text-sm py-2 rounded-xl font-medium">
                    📤 Ya la tengo llena → Subir
                  </button>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-gray-400 text-center">
            🔴 Campos obligatorios · ⚪ Campos opcionales
          </p>
        </div>
      )}

      {/* ── PASO 2: Subir archivo ── */}
      {paso === 2 && (
        <div className="space-y-4">
          <button onClick={() => setPaso(1)} className="text-sm text-gray-500 hover:text-gray-700">← Volver a plantillas</button>

          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center"
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400','bg-blue-50') }}
            onDragLeave={e => { e.currentTarget.classList.remove('border-blue-400','bg-blue-50') }}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400','bg-blue-50'); leerArchivo(e.dataTransfer.files[0]) }}>
            <p className="text-5xl mb-4">📊</p>
            <p className="font-bold text-gray-700 text-lg">Arrastra tu archivo Excel aquí</p>
            <p className="text-sm text-gray-400 mt-1">o haz clic para seleccionarlo</p>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => leerArchivo(e.target.files[0])} />
            <button onClick={() => inputRef.current.click()}
              className="mt-5 bg-[#1e3a5f] text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-[#16304f]">
              📁 Seleccionar archivo .xlsx
            </button>
            <p className="text-xs text-gray-400 mt-3">Solo archivos .xlsx o .xls</p>
          </div>
        </div>
      )}

      {/* ── PASO 3: Vista previa ── */}
      {paso === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => setPaso(2)} className="text-sm text-gray-500 hover:text-gray-700">← Volver</button>
            <p className="text-sm text-gray-500">📄 {archivoNombre}</p>
          </div>

          {/* Resumen */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
              <p className="text-3xl font-black text-blue-700">{filas.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Registros leídos</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-3xl font-black text-green-700">
                {filas.filter(f => parseFloat(f.saldo_actual) > 0).length}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Con saldo a migrar</p>
            </div>
            <div className={`${erroresValidacion.length ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'} border rounded-xl p-4 text-center`}>
              <p className={`text-3xl font-black ${erroresValidacion.length ? 'text-red-600' : 'text-emerald-600'}`}>
                {erroresValidacion.length}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Errores encontrados</p>
            </div>
          </div>

          {/* Errores */}
          {erroresValidacion.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="font-semibold text-red-700 mb-2">⚠️ Corrige estos errores antes de importar:</p>
              <ul className="space-y-1">
                {erroresValidacion.map((e, i) => (
                  <li key={i} className="text-sm text-red-600">• {e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Tabla preview */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50 flex justify-between items-center">
              <p className="font-semibold text-gray-700 text-sm">Vista previa — primeros 10 registros</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#1e3a5f] text-white">
                  <tr>
                    <th className="px-3 py-2 text-left">Fila</th>
                    <th className="px-3 py-2 text-left">Documento</th>
                    <th className="px-3 py-2 text-left">Nombre</th>
                    <th className="px-3 py-2 text-left">Teléfono</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-right">Saldo actual</th>
                    <th className="px-3 py-2 text-left">Descripción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filas.slice(0, 10).map((f, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{f._fila}</td>
                      <td className="px-3 py-2 font-mono font-semibold">{f.documento}</td>
                      <td className="px-3 py-2 font-medium">{f.nombre}</td>
                      <td className="px-3 py-2 text-gray-500">{f.telefono || '—'}</td>
                      <td className="px-3 py-2">
                        {f.tipo && (
                          <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {f.tipo}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-green-600">
                        {f.saldo_actual ? fmt(parseFloat(f.saldo_actual)) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-500 italic">{f.descripcion || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filas.length > 10 && (
                <p className="text-center text-xs text-gray-400 py-2">
                  ... y {filas.length - 10} registro(s) más
                </p>
              )}
            </div>
          </div>

          {/* Botón importar */}
          <div className="flex gap-3">
            <button onClick={reiniciar}
              className="border rounded-xl px-5 py-3 text-sm text-gray-600 hover:bg-gray-50 font-medium">
              ✕ Cancelar
            </button>
            <button
              onClick={importar}
              disabled={importando || erroresValidacion.length > 0}
              className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#16304f] disabled:opacity-50 flex items-center justify-center gap-2">
              {importando
                ? <><span className="animate-spin">⏳</span> Importando {filas.length} registros...</>
                : <>🚀 Importar {filas.length} registro(s)</>
              }
            </button>
          </div>

          {erroresValidacion.length > 0 && (
            <p className="text-xs text-red-500 text-center">
              Corrige los {erroresValidacion.length} error(es) en el archivo Excel y vuelve a subirlo
            </p>
          )}
        </div>
      )}

      {/* ── ZONA DE PRUEBAS ── */}
      {paso === 1 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">⚙️ Zona de desarrollo</p>
          <ToggleModoPrueba />
          <BotonReset />
        </div>
      )}

      {/* ── PASO 4: Resultado ── */}
      {paso === 4 && resultado && (
        <div className="space-y-4">
          <div className={`rounded-2xl p-6 text-center ${resultado.errores?.length === 0 ? 'bg-green-50 border-2 border-green-200' : 'bg-amber-50 border-2 border-amber-200'}`}>
            <p className="text-5xl mb-3">{resultado.errores?.length === 0 ? '🎉' : '⚠️'}</p>
            <p className="text-xl font-black text-gray-800">
              {resultado.errores?.length === 0 ? '¡Migración completada!' : 'Completado con advertencias'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-3xl font-black text-green-700">{resultado.creados}</p>
              <p className="text-xs text-gray-500 mt-0.5">Clientes nuevos</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
              <p className="text-3xl font-black text-blue-700">{resultado.actualizados}</p>
              <p className="text-xs text-gray-500 mt-0.5">Clientes actualizados</p>
            </div>
            <div className={`${resultado.errores?.length ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'} border rounded-xl p-4 text-center`}>
              <p className={`text-3xl font-black ${resultado.errores?.length ? 'text-red-600' : 'text-emerald-600'}`}>
                {resultado.errores?.length || 0}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Errores</p>
            </div>
          </div>

          {resultado.errores?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="font-semibold text-red-700 mb-2">Registros con error:</p>
              <ul className="space-y-1">
                {resultado.errores.map((e, i) => <li key={i} className="text-sm text-red-600">• {e}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={reiniciar}
              className="flex-1 border-2 rounded-xl py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              📦 Nueva migración
            </button>
            <a href="/clientes"
              className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-3 text-sm font-bold text-center hover:bg-[#16304f]">
              👥 Ver clientes importados
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
