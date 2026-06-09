import { Pool } from 'pg'

// ──────────────────────────────────────────────────────────
// Si PROXY_URL está definido, las queries van por HTTP proxy
// (para entornos cloud como Vercel que no alcanzan la BD directo).
// Si no, conexión directa vía pg Pool (desarrollo local / LAN).
// ──────────────────────────────────────────────────────────

const PROXY_URL     = process.env.PROXY_URL     // ej: https://pg-proxy.onrender.com
const PROXY_API_KEY = process.env.PROXY_API_KEY // ej: dusakawi-proxy-2024-clave-secreta

// Pool directo (solo se usa cuando NO hay PROXY_URL)
const pool = !PROXY_URL ? new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      false,
  max: 10,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000,
}) : null

export async function query(text, params) {
  // ── Modo proxy HTTP ──
  if (PROXY_URL) {
    const res = await fetch(`${PROXY_URL}/query`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    PROXY_API_KEY || '',
      },
      body: JSON.stringify({ sql: text, params: params || [] }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Proxy error ${res.status}: ${err}`)
    }
    const data = await res.json()
    // El proxy devuelve { rows, rowCount } igual que pg
    return data
  }

  // ── Modo directo pg Pool ──
  const client = await pool.connect()
  try {
    const res = await client.query(text, params)
    return res
  } finally {
    client.release()
  }
}

export default pool
