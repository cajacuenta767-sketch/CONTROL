import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { obtenerDb, hoyLocal, modZona, ajuste, ahoraSql } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { firmarSesion, firmarTemporal2fa, leerTemporal2fa, cargarUsuario } from '../middleware/auth.js';
import { auditar } from './auditoria.js';
import {
  validarClave, crearSesion, renovarSesion, revocarSesion, revocarSesionesUsuario, registrarIntentoFallido, limpiarIntentos,
  generarSecretoTotp, verificarTotp, urlOtpauth, crearTokenRecuperacion, consumirTokenRecuperacion, leerTokenRecuperacion,
} from './seguridad.js';
import { enviarCorreo, plantilla } from './correo.js';

const COLUMNAS = 'id, email, nombre, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, telefono, activo, creado_en, debe_cambiar_clave, totp_activo, codigo_ref, cupo_licencias, descuento_mayorista_pct, marca_nombre, ultimo_acceso, bloqueado_hasta';

function publico(u) {
  const { hash_clave, totp_secreto, intentos_fallidos, ...resto } = u;
  return resto;
}

/**
 * Paso 1 del login. Devuelve `{ token, renovacion, usuario }` o, si el usuario tiene
 * 2FA, `{ requiere_2fa: true, token_temporal }`.
 */
export function login({ email, clave }, { ip, agente } = {}) {
  const db = obtenerDb();
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  if (u?.bloqueado_hasta && u.bloqueado_hasta > ahoraSql()) {
    const min = Math.ceil((Date.parse(u.bloqueado_hasta.replace(' ', 'T') + 'Z') - Date.now()) / 60000);
    throw new ErrorHttp(423, `Cuenta bloqueada por intentos fallidos. Intenta en ${min} minuto(s).`, { codigo: 'bloqueada' });
  }
  if (!u || !bcrypt.compareSync(clave, u.hash_clave)) {
    if (u) {
      const r = registrarIntentoFallido(u.id);
      auditar({ usuarioId: u.id, accion: r.bloqueado ? 'login.bloqueo' : 'login.fallido', ip, detalle: { intentos: r.intentos } });
      if (r.bloqueado) throw new ErrorHttp(423, `Demasiados intentos. Cuenta bloqueada ${r.minutos} minutos.`, { codigo: 'bloqueada' });
      throw new ErrorHttp(401, `Correo o contraseña incorrectos. Te quedan ${r.restantes} intento(s).`);
    }
    throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
  }
  if (!u.activo) throw new ErrorHttp(403, 'Usuario desactivado');
  if (u.totp_activo) {
    auditar({ usuarioId: u.id, accion: 'login.2fa_pendiente', ip });
    return { requiere_2fa: true, token_temporal: firmarTemporal2fa(u) };
  }
  return completarLogin(u, { ip, agente });
}

/** Paso 2 del login con 2FA. */
export function verificar2fa({ token_temporal, codigo }, { ip, agente } = {}) {
  const p = leerTemporal2fa(token_temporal);
  if (!p) throw new ErrorHttp(401, 'El tiempo para ingresar el código venció. Vuelve a iniciar sesión.');
  const u = obtenerDb().prepare('SELECT * FROM usuarios WHERE id = ?').get(p.id);
  if (!u || !u.totp_activo) throw new ErrorHttp(401, 'Sesión inválida');
  if (!verificarTotp(u.totp_secreto, codigo)) {
    const r = registrarIntentoFallido(u.id);
    auditar({ usuarioId: u.id, accion: '2fa.fallido', ip });
    if (r.bloqueado) throw new ErrorHttp(423, `Demasiados intentos. Cuenta bloqueada ${r.minutos} minutos.`, { codigo: 'bloqueada' });
    throw new ErrorHttp(401, 'Código incorrecto');
  }
  return completarLogin(u, { ip, agente });
}

function completarLogin(u, { ip, agente }) {
  limpiarIntentos(u.id);
  auditar({ usuarioId: u.id, accion: 'login', ip });
  const renovacion = crearSesion(u.id, { ip, agente });
  return { token: firmarSesion(u), renovacion, usuario: publico(u) };
}

/** Renueva el token de acceso con la cookie de renovación (rota la cookie). */
export function renovar(tokenRenovacion, { ip } = {}) {
  const s = tokenRenovacion ? renovarSesion(tokenRenovacion, { ip }) : null;
  if (!s) throw new ErrorHttp(401, 'Sesión vencida. Vuelve a iniciar sesión.', { codigo: 'renovacion_invalida' });
  const u = cargarUsuario(s.usuario_id);
  if (!u || !u.activo) throw new ErrorHttp(401, 'Usuario inactivo');
  return { token: firmarSesion(u), renovacion: s.token, usuario: u };
}

export function salir(tokenRenovacion, usuarioId) {
  if (tokenRenovacion) revocarSesion(tokenRenovacion);
  if (usuarioId) auditar({ usuarioId, accion: 'logout' });
}

/* ---------- Recuperación de contraseña ---------- */

export async function solicitarRecuperacion(email, ip) {
  const u = obtenerDb().prepare('SELECT id, email, nombre, activo FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  // Respuesta idéntica exista o no el correo, para no revelar cuentas.
  if (!u || !u.activo) return;
  const token = crearTokenRecuperacion(u.id);
  const url = `${ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '')}/restablecer/${token}`;
  auditar({ usuarioId: u.id, accion: 'clave.recuperacion_solicitada', ip });
  await enviarCorreo({
    para: u.email, asunto: 'Restablecer tu contraseña de CONTROL',
    html: plantilla('Restablecer contraseña', `<p>Hola ${u.nombre}. Recibimos una solicitud para cambiar tu contraseña. El enlace vale por 1 hora.</p><p>Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>`, { boton: 'Elegir nueva contraseña', url }),
  });
}

export function restablecerClave({ token, clave }, ip) {
  const usuarioId = leerTokenRecuperacion(token);
  if (!usuarioId) throw new ErrorHttp(422, 'El enlace no es válido o ya venció. Solicita uno nuevo.');
  const u = obtenerUsuario(usuarioId);
  validarClave(clave, u);
  consumirTokenRecuperacion(token);
  obtenerDb().prepare('UPDATE usuarios SET hash_clave = ?, debe_cambiar_clave = 0, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?').run(bcrypt.hashSync(clave, 10), usuarioId);
  revocarSesionesUsuario(usuarioId);
  auditar({ usuarioId, accion: 'clave.restablecida', ip });
}

/* ---------- 2FA ---------- */

export function configurar2fa(usuario) {
  const secreto = generarSecretoTotp();
  obtenerDb().prepare('UPDATE usuarios SET totp_secreto = ?, totp_activo = 0 WHERE id = ?').run(secreto, usuario.id);
  return { secreto, url: urlOtpauth(usuario.email, secreto, ajuste('nombre_agencia', 'CONTROL')) };
}

export function activar2fa(usuario, codigo) {
  const db = obtenerDb();
  const u = db.prepare('SELECT totp_secreto FROM usuarios WHERE id = ?').get(usuario.id);
  if (!u?.totp_secreto) throw new ErrorHttp(422, 'Primero genera el código QR');
  if (!verificarTotp(u.totp_secreto, codigo)) throw new ErrorHttp(422, 'Código incorrecto. Revisa la hora del teléfono e inténtalo de nuevo.');
  db.prepare('UPDATE usuarios SET totp_activo = 1 WHERE id = ?').run(usuario.id);
  auditar({ usuarioId: usuario.id, accion: '2fa.activado', entidad: 'usuario', entidadId: usuario.id });
}

export function desactivar2fa(usuario, { codigo, clave }) {
  const db = obtenerDb();
  const u = db.prepare('SELECT totp_secreto, hash_clave FROM usuarios WHERE id = ?').get(usuario.id);
  if (!bcrypt.compareSync(clave || '', u.hash_clave)) throw new ErrorHttp(422, 'Contraseña incorrecta');
  if (!verificarTotp(u.totp_secreto, codigo)) throw new ErrorHttp(422, 'Código incorrecto');
  db.prepare('UPDATE usuarios SET totp_activo = 0, totp_secreto = NULL WHERE id = ?').run(usuario.id);
  auditar({ usuarioId: usuario.id, accion: '2fa.desactivado', entidad: 'usuario', entidadId: usuario.id });
}

/** El superadmin quita el 2FA a un usuario que perdió el teléfono. */
export function quitar2faAdmin(id, actor) {
  obtenerDb().prepare('UPDATE usuarios SET totp_activo = 0, totp_secreto = NULL WHERE id = ?').run(id);
  auditar({ usuarioId: actor.id, accion: '2fa.quitado_por_admin', entidad: 'usuario', entidadId: id });
  return obtenerUsuario(id);
}

/* ---------- CRUD ---------- */

function generarCodigoRef(db, nombre) {
  const base = String(nombre || 'v').normalize('NFD').replace(/[^a-zA-Z]/g, '').slice(0, 5).toUpperCase() || 'VEND';
  let codigo;
  do codigo = `${base}${randomBytes(2).toString('hex').toUpperCase().slice(0, 3)}`;
  while (db.prepare('SELECT 1 FROM usuarios WHERE codigo_ref = ?').get(codigo));
  return codigo;
}

export function crearUsuario(datos, actor) {
  const db = obtenerDb();
  const email = datos.email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) throw new ErrorHttp(409, 'Ese correo ya existe');
  validarClave(datos.clave, { email, nombre: datos.nombre });
  const r = db
    .prepare(
      `INSERT INTO usuarios (email, nombre, hash_clave, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, telefono, debe_cambiar_clave, codigo_ref, cupo_licencias, descuento_mayorista_pct, marca_nombre)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      email, datos.nombre, bcrypt.hashSync(datos.clave, 10), datos.rol,
      datos.comision_pct ?? 20, datos.tope_emisiones_dia ?? 20, datos.tope_demos_semana ?? 10, datos.telefono ?? null,
      actor ? 1 : 0, generarCodigoRef(db, datos.nombre),
      datos.rol === 'revendedor' ? datos.cupo_licencias ?? 0 : null,
      datos.rol === 'revendedor' ? datos.descuento_mayorista_pct ?? 30 : null,
      datos.marca_nombre ?? null
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
  for (const k of ['nombre', 'rol', 'comision_pct', 'tope_emisiones_dia', 'tope_demos_semana', 'telefono', 'activo', 'cupo_licencias', 'descuento_mayorista_pct', 'marca_nombre']) {
    if (datos[k] !== undefined) { campos.push(`${k} = ?`); valores.push(typeof datos[k] === 'boolean' ? Number(datos[k]) : datos[k]); }
  }
  if (datos.clave) {
    validarClave(datos.clave, { email: actual.email, nombre: actual.nombre });
    campos.push('hash_clave = ?', 'debe_cambiar_clave = 1', 'intentos_fallidos = 0', 'bloqueado_hasta = NULL');
    valores.push(bcrypt.hashSync(datos.clave, 10));
    revocarSesionesUsuario(id);
  }
  if (datos.desbloquear) { campos.push('intentos_fallidos = 0', 'bloqueado_hasta = NULL'); }
  if (datos.activo === false) revocarSesionesUsuario(id);
  if (!campos.length) return actual;
  db.prepare(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id);
  auditar({ usuarioId: actor.id, accion: 'usuario.actualizar', entidad: 'usuario', entidadId: id, detalle: { ...datos, clave: datos.clave ? '***' : undefined } });
  return obtenerUsuario(id);
}

export function cambiarMiClave(usuario, { clave_actual, clave_nueva }) {
  const db = obtenerDb();
  const u = db.prepare('SELECT hash_clave, email, nombre FROM usuarios WHERE id = ?').get(usuario.id);
  if (!bcrypt.compareSync(clave_actual, u.hash_clave)) throw new ErrorHttp(422, 'La contraseña actual no coincide');
  if (clave_actual === clave_nueva) throw new ErrorHttp(422, 'La nueva contraseña debe ser distinta');
  validarClave(clave_nueva, u);
  db.prepare('UPDATE usuarios SET hash_clave = ?, debe_cambiar_clave = 0 WHERE id = ?').run(bcrypt.hashSync(clave_nueva, 10), usuario.id);
  auditar({ usuarioId: usuario.id, accion: 'usuario.cambiar_clave', entidad: 'usuario', entidadId: usuario.id });
}

export function obtenerUsuario(id) {
  const u = obtenerDb().prepare(`SELECT ${COLUMNAS} FROM usuarios WHERE id = ?`).get(id);
  if (!u) throw noEncontrado('Usuario no encontrado');
  return u;
}

/** Lista con métricas: licencias emitidas, ventas y comisiones por usuario. */
const CAMPOS_DINERO = ['comision_pct', 'total_vendido', 'vendido_mes', 'comision_pendiente', 'comision_liquidada', 'meta_mes', 'meta_bono_pct', 'cupo_licencias', 'descuento_mayorista_pct'];

/** Lista del equipo. `conDinero` (solo el dueño) incluye comisiones, ventas y metas. */
export function listarUsuarios({ conDinero = true } = {}) {
  const filas = listarUsuariosCompleto();
  if (conDinero) return filas;
  return filas.map((u) => Object.fromEntries(Object.entries(u).filter(([k]) => !CAMPOS_DINERO.includes(k))));
}

function listarUsuariosCompleto() {
  const db = obtenerDb();
  const hoy = hoyLocal();
  const mes = hoy.slice(0, 7);
  return db
    .prepare(
      `SELECT u.${COLUMNAS.split(', ').join(', u.')},
        (SELECT COUNT(*) FROM licencias l WHERE l.emitida_por = u.id) AS licencias_emitidas,
        (SELECT COUNT(*) FROM licencias l WHERE l.emitida_por = u.id AND date(l.creado_en, ?) = ?) AS licencias_hoy,
        (SELECT COUNT(*) FROM ventas v WHERE v.vendedor_id = u.id AND v.estado != 'anulada') AS ventas,
        (SELECT COALESCE(SUM(v.total_base),0) FROM ventas v WHERE v.vendedor_id = u.id AND v.estado = 'pagada') AS total_vendido,
        (SELECT COALESCE(SUM(v.total_base),0) FROM ventas v WHERE v.vendedor_id = u.id AND v.estado = 'pagada' AND strftime('%Y-%m', v.pagada_en, ?) = ?) AS vendido_mes,
        (SELECT COALESCE(SUM(c.monto),0) FROM comisiones c WHERE c.vendedor_id = u.id AND c.estado = 'devengada') AS comision_pendiente,
        (SELECT COALESCE(SUM(c.monto),0) FROM comisiones c WHERE c.vendedor_id = u.id AND c.estado = 'liquidada') AS comision_liquidada,
        (SELECT m.objetivo_monto FROM metas m WHERE m.usuario_id = u.id AND m.mes = ?) AS meta_mes,
        (SELECT m.bono_pct FROM metas m WHERE m.usuario_id = u.id AND m.mes = ?) AS meta_bono_pct
       FROM usuarios u ORDER BY u.rol, u.nombre`
    )
    .all(modZona(), hoy, modZona(), mes, mes, mes);
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

/* ---------- Metas ---------- */

export function guardarMeta({ usuario_id, mes, objetivo_monto, bono_pct }, actor) {
  obtenerUsuario(usuario_id);
  obtenerDb()
    .prepare('INSERT INTO metas (usuario_id, mes, objetivo_monto, bono_pct, creado_por) VALUES (?, ?, ?, ?, ?) ON CONFLICT(usuario_id, mes) DO UPDATE SET objetivo_monto = excluded.objetivo_monto, bono_pct = excluded.bono_pct')
    .run(usuario_id, mes, objetivo_monto, bono_pct ?? 5, actor.id);
  auditar({ usuarioId: actor.id, accion: 'meta.guardar', entidad: 'usuario', entidadId: usuario_id, detalle: { mes, objetivo_monto, bono_pct } });
  return listarMetas({ mes });
}

export function listarMetas({ mes, usuario_id } = {}) {
  const condiciones = [];
  const params = [];
  if (mes) { condiciones.push('m.mes = ?'); params.push(mes); }
  if (usuario_id) { condiciones.push('m.usuario_id = ?'); params.push(usuario_id); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return obtenerDb()
    .prepare(`SELECT m.*, u.nombre AS usuario_nombre,
      (SELECT COALESCE(SUM(v.total_base),0) FROM ventas v WHERE v.vendedor_id = m.usuario_id AND v.estado = 'pagada' AND strftime('%Y-%m', v.pagada_en, ?) = m.mes) AS vendido
      FROM metas m JOIN usuarios u ON u.id = m.usuario_id ${where} ORDER BY m.mes DESC, vendido DESC`)
    .all(modZona(), ...params);
}
