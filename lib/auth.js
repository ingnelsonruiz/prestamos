import { SignJWT } from 'jose/jwt/sign'
import { jwtVerify } from 'jose/jwt/verify'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'inversiones-tata-linan-secret-2026')
const COOKIE  = 'itl_session'

export async function crearToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('8h')
    .sign(SECRET)
}

export async function verificarToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload
  } catch {
    return null
  }
}

export { COOKIE }
