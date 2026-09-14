import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { obtenerDb } from '../db.js';
import { ErrorHttp } from './errores.js';

export const ROLES = ['superadmin', 'admin', 'vendedor', 'revendedor', 'soporte', 'contador'];

const COLUMNAS_USUARIO = 'id, email, nombre, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, activo, debe_cambiar_clave, totp_activo, codigo_ref, cupo_licencias, descuento_mayorista_pct, marca_nombre';

/** Token de acceso corto (1 h). La renovación va por cookie httpOnly. */
export function firmarSesion(usuario, extra = {}) {
  return jwt.sign({ id: usuario.id, rol: usuario.rol, nombre: usuario.nombre, tipo: 'acceso', ...extra }, config.jwtSecreto, { expiresIn: config.jwtDuracion });
}

/** Token temporal para el segundo paso del 2FA (5 min). */
export function firmarTemporal2fa(usuario) {
  return jwt.sign({ id: usuario.id, tipo: '2fa' }, config.jwtSecreto, { expiresIn: '5m' });
}

export function leerTemporal2fa(token) {
  try {
    const p = jwt.verify(token, config.jwtSecreto);
    return p.tipo === '2fa' ? p : null;
  } catch { return null; }
}

/** Token del portal del cliente (rol 'cliente', limitado a su cliente_id). */
export function firmarCliente(cliente) {
  return jwt.sign({ cliente_id: cliente.id, nombre: cliente.nombre, tipo: 'cliente' }, config.jwtSecreto, { expiresIn: '12h' });
}

export function cargarUsuario(id) {
  return obtenerDb().prepare(`SELECT ${COLUMNAS_USUARIO} FROM usuarios WHERE id = ?`).get(id);
}

/** Exige un JWT válido y carga el usuario fresco desde la base (por si fue desactivado). */
export function requerirAuth(req, res, next) {
  const cabecera = req.get('authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return next(new ErrorHttp(401, 'Sesión requerida'));
  let payload;
  try { payload = jwt.verify(token, config.jwtSecreto); }
  catch (e) { return next(new ErrorHttp(401, e.name === 'TokenExpiredError' ? 'Sesión vencida' : 'Sesión inválida', { codigo: e.name === 'TokenExpiredError' ? 'vencida' : 'invalida' })); }
  if (payload.tipo !== 'acceso') return next(new ErrorHttp(401, 'Sesión inválida'));
  const usuario = cargarUsuario(payload.id);
  if (!usuario || !usuario.activo) return next(new ErrorHttp(401, 'Sesión inválida'));
  // Con cambio de contraseña obligatorio solo se permiten las rutas de auth.
  if (usuario.debe_cambiar_clave && !req.originalUrl.startsWith('/api/v1/auth/')) {
    return next(new ErrorHttp(403, 'Debes cambiar tu contraseña antes de continuar', { codigo: 'cambiar_clave' }));
  }
  req.usuario = usuario;
  next();
}

/** Exige un token del portal del cliente. */
export function requerirCliente(req, res, next) {
  const cabecera = req.get('authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return next(new ErrorHttp(401, 'Sesión requerida'));
  try {
    const p = jwt.verify(token, config.jwtSecreto);
    if (p.tipo !== 'cliente') throw new Error('tipo');
    const c = obtenerDb().prepare('SELECT id, nombre, empresa, email, telefono, pais, moneda, vendedor_id FROM clientes WHERE id = ?').get(p.cliente_id);
    if (!c) throw new Error('no existe');
    req.cliente = c;
    next();
  } catch {
    next(new ErrorHttp(401, 'Sesión inválida o vencida'));
  }
}

/** Exige uno de los roles indicados. */
export const requerirRol = (...roles) => (req, res, next) => {
  if (!req.usuario) return next(new ErrorHttp(401, 'Sesión requerida'));
  if (!roles.includes(req.usuario.rol)) return next(new ErrorHttp(403, 'Tu rol no permite esta acción'));
  next();
};

export const esSuperadmin = (u) => u?.rol === 'superadmin';
export const esGestor = (u) => u?.rol === 'superadmin' || u?.rol === 'admin';
export const esRevendedor = (u) => u?.rol === 'revendedor';
export const esSoporte = (u) => u?.rol === 'soporte';
export const esContador = (u) => u?.rol === 'contador';
/** Roles que ven toda la cartera (clientes, ventas, licencias, tickets) aunque no la gestionen. */
export const veTodo = (u) => ['superadmin', 'admin', 'soporte', 'contador'].includes(u?.rol);
/** Roles que pueden crear ventas y registrar cobros. */
export const puedeVender = (u) => ['superadmin', 'admin', 'vendedor', 'revendedor'].includes(u?.rol);

/* ---------- Cookies (sin dependencias) ---------- */

export function leerCookies(req) {
  const salida = {};
  for (const par of (req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) salida[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return salida;
}

export const NOMBRE_COOKIE = 'control_renovar';

export function ponerCookieRenovacion(res, token) {
  const partes = [`${NOMBRE_COOKIE}=${encodeURIComponent(token)}`, 'Path=/api/v1/auth', 'HttpOnly', 'SameSite=Strict', `Max-Age=${30 * 86400}`];
  if (config.entorno === 'production') partes.push('Secure');
  res.append('Set-Cookie', partes.join('; '));
}

export function borrarCookieRenovacion(res) {
  res.append('Set-Cookie', `${NOMBRE_COOKIE}=; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=0`);
}
