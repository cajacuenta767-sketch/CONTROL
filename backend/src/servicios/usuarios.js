import bcrypt from 'bcryptjs';
import { obtenerDb, hoyLocal, modZona } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { firmarSesion } from '../middleware/auth.js';
import { auditar } from './auditoria.js';

const COLUMNAS = 'id, email, nombre, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, telefono, activo, creado_en';

export function login({ email, clave }, ip) {
  const u = obtenerDb().prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  if (!u || !bcrypt.compareSync(clave, u.hash_clave)) throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
  if (!u.activo) throw new ErrorHttp(403, 'Usuario desactivado');
  auditar({ usuarioId: u.id, accion: 'login', ip });
  const { hash_clave, ...publico } = u;
  return { token: firmarSesion(u), usuario: publico };
}

export function crearUsuario(datos, actor) {
  const db = obtenerDb();
  const email = datos.email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) throw new ErrorHttp(409, 'Ese correo ya existe');
  const r = db
    .prepare(
      `INSERT INTO usuarios (email, nombre, hash_clave, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, telefono)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      email,
      datos.nombre,
      bcrypt.hashSync(datos.clave, 10),
      datos.rol,
      datos.comision_pct ?? 20,
      datos.tope_emisiones_dia ?? 20,
      datos.tope_demos_semana ?? 10,
      datos.telefono ?? null
    );
  const id = Number(r.lastInsertRowid);
  if (actor) auditar({ usuarioId: actor.id, accion: 'usuario.crear', entidad: 'usuario', entidadId: id, detalle: { email, rol: datos.rol } });
  return obtenerUsuario(id);
}

export function actualizarUsuario(id, datos, actor) {
  const db = obtenerDb();
  const actual = obtenerUsuario(id);
  if (id === actor.id && datos.activo === false) throw new ErrorHttp(422, 'No puedes desactivar tu propio usuario');
  if (id === actor.id && datos.rol && datos.rol !== actual.rol) throw new ErrorHttp(422, 'No puedes cambiar tu propio rol');
  if (actual.rol === 'superadmin' && datos.rol && datos.rol !== 'superadmin') {
    const otros = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'superadmin' AND id != ? AND activo = 1").get(id).c;
    if (!otros) throw new ErrorHttp(422, 'Debe quedar al menos un superadmin');
  }
  const campos = [];
  const valores = [];
  for (const k of ['nombre', 'rol', 'comision_pct', 'tope_emisiones_dia', 'tope_demos_semana', 'telefono', 'activo']) {
    if (datos[k] !== undefined) { campos.push(`${k} = ?`); valores.push(typeof datos[k] === 'boolean' ? Number(datos[k]) : datos[k]); }
  }
  if (datos.clave) { campos.push('hash_clave = ?'); valores.push(bcrypt.hashSync(datos.clave, 10)); }
  if (!campos.length) return actual;
  db.prepare(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id);
  auditar({ usuarioId: actor.id, accion: 'usuario.actualizar', entidad: 'usuario', entidadId: id, detalle: { ...datos, clave: datos.clave ? '***' : undefined } });
  return obtenerUsuario(id);
}

export function cambiarMiClave(usuario, { clave_actual, clave_nueva }) {
  const db = obtenerDb();
  const u = db.prepare('SELECT hash_clave FROM usuarios WHERE id = ?').get(usuario.id);
  if (!bcrypt.compareSync(clave_actual, u.hash_clave)) throw new ErrorHttp(422, 'La contraseña actual no coincide');
  db.prepare('UPDATE usuarios SET hash_clave = ? WHERE id = ?').run(bcrypt.hashSync(clave_nueva, 10), usuario.id);
  auditar({ usuarioId: usuario.id, accion: 'usuario.cambiar_clave', entidad: 'usuario', entidadId: usuario.id });
}

export function obtenerUsuario(id) {
  const u = obtenerDb().prepare(`SELECT ${COLUMNAS} FROM usuarios WHERE id = ?`).get(id);
  if (!u) throw noEncontrado('Usuario no encontrado');
  return u;
}

/** Lista con métricas: licencias emitidas, ventas y comisiones por usuario. */
export function listarUsuarios() {
  const db = obtenerDb();
  const hoy = hoyLocal();
  return db
    .prepare(
      `SELECT u.${COLUMNAS.split(', ').join(', u.')},
        (SELECT COUNT(*) FROM licencias l WHERE l.emitida_por = u.id) AS licencias_emitidas,
        (SELECT COUNT(*) FROM licencias l WHERE l.emitida_por = u.id AND date(l.creado_en, ?) = ?) AS licencias_hoy,
        (SELECT COUNT(*) FROM ventas v WHERE v.vendedor_id = u.id AND v.estado != 'anulada') AS ventas,
        (SELECT COALESCE(SUM(v.total),0) FROM ventas v WHERE v.vendedor_id = u.id AND v.estado = 'pagada') AS total_vendido,
        (SELECT COALESCE(SUM(c.monto),0) FROM comisiones c WHERE c.vendedor_id = u.id AND c.estado = 'devengada') AS comision_pendiente,
        (SELECT COALESCE(SUM(c.monto),0) FROM comisiones c WHERE c.vendedor_id = u.id AND c.estado = 'liquidada') AS comision_liquidada
       FROM usuarios u ORDER BY u.rol, u.nombre`
    )
    .all(modZona(), hoy);
}

/** Cuántas licencias emitió hoy (para el tope diario). */
export function emisionesHoy(usuarioId) {
  return obtenerDb()
    .prepare('SELECT COUNT(*) AS c FROM licencias WHERE emitida_por = ? AND date(creado_en, ?) = ?')
    .get(usuarioId, modZona(), hoyLocal()).c;
}

/** Cuántas demos emitió en los últimos 7 días. */
export function demosSemana(usuarioId) {
  return obtenerDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM licencias l JOIN planes p ON p.id = l.plan_id
       WHERE l.emitida_por = ? AND p.tipo = 'demo' AND l.creado_en >= datetime('now', '-7 days')`
    )
    .get(usuarioId).c;
}
