import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { obtenerDb } from '../db.js';
import { ErrorHttp } from './errores.js';

export const ROLES = ['superadmin', 'admin', 'vendedor'];

export function firmarSesion(usuario) {
  return jwt.sign({ id: usuario.id, rol: usuario.rol, nombre: usuario.nombre }, config.jwtSecreto, {
    expiresIn: config.jwtDuracion,
  });
}

/** Exige un JWT válido y carga el usuario fresco desde la base (por si fue desactivado). */
export function requerirAuth(req, res, next) {
  const cabecera = req.get('authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return next(new ErrorHttp(401, 'Sesión requerida'));
  try {
    const payload = jwt.verify(token, config.jwtSecreto);
    const usuario = obtenerDb()
      .prepare('SELECT id, email, nombre, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, activo FROM usuarios WHERE id = ?')
      .get(payload.id);
    if (!usuario || !usuario.activo) return next(new ErrorHttp(401, 'Sesión inválida'));
    req.usuario = usuario;
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
