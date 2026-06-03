import { query } from './db'
import { cookies } from 'next/headers'
import { verificarToken, COOKIE } from './auth'
import { v4 as uuidv4 } from 'uuid'

// Obtener usuario del token de la request
export async function getUsuarioDesdeRequest(request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE)?.value
    if (!token) return { id: null, nombre: 'Sistema' }
    const payload = await verificarToken(token)
    return { id: payload?.id || null, nombre: payload?.nombre || 'Desconocido' }
  } catch {
    return { id: null, nombre: 'Sistema' }
  }
}

// Registrar evento de auditoría
export async function auditar({ usuario_id, usuario_nombre, accion, modulo, descripcion, detalle = {}, ip = null }) {
  try {
    await query(
      `INSERT INTO administrativo.cred_auditoria
        (id, usuario_id, usuario_nombre, accion, modulo, descripcion, detalle, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuidv4(), usuario_id, usuario_nombre, accion, modulo, descripcion, JSON.stringify(detalle), ip]
    )
  } catch (e) {
    console.error('Error auditoría:', e.message)
  }
}

// Módulos
export const MODULOS = {
  AUTH:      'Autenticación',
  CLIENTES:  'Clientes',
  PRESTAMOS: 'Préstamos',
  COBROS:    'Cobros',
  USUARIOS:  'Usuarios',
}

// Acciones
export const ACCIONES = {
  LOGIN:              'Inicio de sesión',
  LOGOUT:             'Cierre de sesión',
  CREAR_CLIENTE:      'Crear cliente',
  EDITAR_CLIENTE:     'Editar cliente',
  ELIMINAR_CLIENTE:   'Eliminar cliente',
  CREAR_PRESTAMO:     'Crear préstamo',
  EDITAR_PRESTAMO:    'Editar préstamo',
  ELIMINAR_PRESTAMO:  'Eliminar préstamo',
  REFINANCIAR:        'Refinanciar préstamo',
  REGISTRAR_PAGO:     'Registrar pago',
  CREAR_USUARIO:      'Crear usuario',
  CAMBIAR_CLAVE:      'Cambiar contraseña',
  DESACTIVAR_USUARIO: 'Desactivar usuario',
  ACTIVAR_USUARIO:    'Activar usuario',
}
