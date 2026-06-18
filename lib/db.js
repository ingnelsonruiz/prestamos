import { Pool } from 'pg'

// ──────────────────────────────────────────────────────────
// Si PROXY_URL está definido → queries via HTTP proxy (Vercel/cloud).
// Si no → conexión directa pg Pool (desarrollo local).
// ──────────────────────────────────────────────────────────

const PROXY_URL     = process.env.PROXY_URL
const PROXY_API_KEY = process.env.PROXY_API_KEY

// Pool directo — singleton global para sobrevivir hot-reload de Next.js.
// Sin esto, cada HMR crea un nuevo Pool y agota el pool_size de PgBouncer.
function createPool() {
  return new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    max:                     3,     // conservador frente a PgBouncer transaction mode
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
  })
}

if (!PROXY_URL && !globalThis.__pg_pool) {
  globalThis.__pg_pool = createPool()
}

const pool = !PROXY_URL ? globalThis.__pg_pool : null

// ── Lógica de resiliencia para el proxy HTTP ──────────────
const TIMEOUT_MS       = 90_000  // 90s — queries anuales son lentas
const MAX_RETRIES      = 3
const RETRY_DELAY_MS   = 8_000   // 8s entre reintentos
const COLD_START_MS    = 35_000  // Render tarda ~35s en despertar

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function executeQuery(sql, params = []) {
  let lastError

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(`${PROXY_URL}/query`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    PROXY_API_KEY || '',
        },
        body:  JSON.stringify({ sql, params }),
        cache: 'no-store',
        signal: controller.signal,
      })

      const text = await res.text()

      // Cold start: Render devuelve 502/503 con HTML mientras despierta
      if ((res.status === 502 || res.status === 503) && text.trimStart().startsWith('<')) {
        console.warn(`[db] Proxy en cold start (intento ${attempt}/${MAX_RETRIES}). Esperando ${COLD_START_MS/1000}s…`)
        lastError = new Error(`Proxy en cold start — HTTP ${res.status}`)
        if (attempt < MAX_RETRIES) await sleep(COLD_START_MS)
        continue
      }

      // 404 con HTML = servicio eliminado — no reintentar
      if (res.status === 404 && text.trimStart().startsWith('<')) {
        throw new Error('Proxy no encontrado (404). Verifica PROXY_URL.')
      }

      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Respuesta inválida del proxy: ${text.slice(0, 200)}`)
      }

      if (!res.ok) {
        const msg = data.details || data.message || data.error || `HTTP ${res.status}`
        throw new Error(`Proxy error: ${msg}`)
      }

      // Éxito — { rows, rowCount }
      return data

    } catch (err) {
      if (err.name === 'AbortError') {
        lastError = new Error(`Proxy timeout después de ${TIMEOUT_MS/1000}s`)
      } else {
        lastError = err
      }
      if (attempt < MAX_RETRIES) {
        console.warn(`[db] Reintento ${attempt}/${MAX_RETRIES}: ${lastError.message}`)
        await sleep(RETRY_DELAY_MS)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError
}

// ── API pública ───────────────────────────────────────────
export async function query(text, params) {
  if (PROXY_URL) {
    return executeQuery(text, params)
  }

  // Modo directo pg Pool — pool.query gestiona connect/release internamente
  return pool.query(text, params)
}

// ── Transacciones ─────────────────────────────────────────
// Ejecuta `fn(q)` dentro de BEGIN/COMMIT sobre UN MISMO cliente del pool.
// Si algo falla a mitad de camino → ROLLBACK: no quedan estados intermedios
// (cuotas cerradas sin pago, caja sin recibo, consecutivo consumido, etc.).
//
// Uso:
//   const res = await withTransaction(async (q) => {
//     await q('UPDATE ...', [..])
//     await q('INSERT ...', [..])
//     return algo
//   })
//
// NOTA modo proxy (PROXY_URL): el proxy HTTP no mantiene sesión entre
// llamadas, por lo que no puede haber transacción real. En ese modo `fn`
// se ejecuta secuencialmente con la query normal (best effort) y se deja
// advertencia en logs. Para atomicidad real en cloud, el proxy debería
// exponer un endpoint /transaction que reciba el lote completo.
export async function withTransaction(fn) {
  if (PROXY_URL) {
    console.warn('[db] withTransaction: modo proxy sin sesión — ejecución secuencial sin atomicidad')
    return fn(query)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn((text, params) => client.query(text, params))
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* conexión rota: release la descarta */ }
    throw err
  } finally {
    client.release()
  }
}

export default pool
