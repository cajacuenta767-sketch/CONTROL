import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { obtenerDb, ahoraSql } from '../db.js';
import { ErrorHttp } from '../middleware/errores.js';

/* ---------- Política de contraseñas ---------- */

const COMUNES = new Set([
  '1234567890', 'password12', 'contraseña', 'qwertyuiop', 'password123', 'admin12345', '12345678910', 'iloveyou12',
  'abcdefghij', '0987654321', '1q2w3e4r5t', 'administrador', 'control2026', 'clave12345', 'password1234', '123456789a',
  'bienvenido', 'bienvenido1', 'peru123456', 'colombia123', 'bolivia123', 'mexico1234', 'agencia123', 'vendedor123',
]);

/** Lanza 422 si la contraseña no cumple la política. */
export function validarClave(clave, { email = '', nombre = '' } = {}) {
  const c = String(clave || '');
  if (c.length < 10) throw new ErrorHttp(422, 'La contraseña debe tener al menos 10 caracteres');
  if (!/[a-zA-Z]/.test(c) || !/[0-9]/.test(c)) throw new ErrorHttp(422, 'La contraseña debe combinar letras y números');
  const plana = c.toLowerCase();
  if (COMUNES.has(plana) || /^(.)\1+$/.test(plana) || /^(0123456789|1234567890|abcdefghij)/.test(plana)) {
    throw new ErrorHttp(422, 'Esa contraseña es demasiado común');
  }
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && plana.includes(local)) throw new ErrorHttp(422, 'La contraseña no puede contener tu correo');
  if (nombre && nombre.length >= 4 && plana.includes(nombre.toLowerCase().split(' ')[0])) throw new ErrorHttp(422, 'La contraseña no puede contener tu nombre');
}

/* ---------- Tokens opacos (sesiones, recuperación) ---------- */

export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');
export const tokenAleatorio = (bytes = 32) => randomBytes(bytes).toString('base64url');

const DIAS_SESION = 30;

/** Crea una sesión de renovación y devuelve el token en claro (va en cookie httpOnly). */
export function crearSesion(usuarioId, { ip, agente } = {}) {
  const token = tokenAleatorio();
  obtenerDb()
    .prepare('INSERT INTO sesiones (usuario_id, hash_token, ip, agente, expira_en) VALUES (?, ?, ?, ?, ?)')
    .run(usuarioId, hashToken(token), ip ?? null, (agente || '').slice(0, 200), ahoraSql(DIAS_SESION));
  return token;
}

/** Valida un token de renovación; devuelve la sesión o null. Rota el token. */
export function renovarSesion(token, { ip } = {}) {
  const db = obtenerDb();
  const s = db.prepare('SELECT * FROM sesiones WHERE hash_token = ? AND revocada = 0 AND expira_en > ?').get(hashToken(token), ahoraSql());
  if (!s) return null;
  const nuevo = tokenAleatorio();
  db.prepare('UPDATE sesiones SET hash_token = ?, ultimo_uso = ?, ip = COALESCE(?, ip), expira_en = ? WHERE id = ?')
    .run(hashToken(nuevo), ahoraSql(), ip ?? null, ahoraSql(DIAS_SESION), s.id);
  return { ...s, token: nuevo };
}

export function revocarSesion(token) {
  obtenerDb().prepare('UPDATE sesiones SET revocada = 1 WHERE hash_token = ?').run(hashToken(token));
}

export function revocarSesionesUsuario(usuarioId, exceptoId = null) {
  obtenerDb().prepare('UPDATE sesiones SET revocada = 1 WHERE usuario_id = ? AND (? IS NULL OR id != ?)').run(usuarioId, exceptoId, exceptoId);
}

export function listarSesiones(usuarioId) {
  return obtenerDb()
    .prepare('SELECT id, ip, agente, creado_en, ultimo_uso, expira_en FROM sesiones WHERE usuario_id = ? AND revocada = 0 AND expira_en > ? ORDER BY ultimo_uso DESC')
    .all(usuarioId, ahoraSql());
}

export function revocarSesionPorId(usuarioId, id) {
  obtenerDb().prepare('UPDATE sesiones SET revocada = 1 WHERE id = ? AND usuario_id = ?').run(id, usuarioId);
}

/* ---------- Bloqueo por intentos ---------- */

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

export function registrarIntentoFallido(usuarioId) {
  const db = obtenerDb();
  const u = db.prepare('SELECT intentos_fallidos FROM usuarios WHERE id = ?').get(usuarioId);
  const intentos = (u?.intentos_fallidos ?? 0) + 1;
  const bloqueo = intentos >= MAX_INTENTOS ? new Date(Date.now() + MINUTOS_BLOQUEO * 60000).toISOString().slice(0, 19).replace('T', ' ') : null;
  db.prepare('UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = COALESCE(?, bloqueado_hasta) WHERE id = ?').run(bloqueo ? 0 : intentos, bloqueo, usuarioId);
  return { intentos, bloqueado: Boolean(bloqueo), minutos: MINUTOS_BLOQUEO, restantes: Math.max(0, MAX_INTENTOS - intentos) };
}

export function limpiarIntentos(usuarioId) {
  obtenerDb().prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = ? WHERE id = ?').run(ahoraSql(), usuarioId);
}

/* ---------- TOTP (RFC 6238) sin dependencias ---------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Codificar(buf) {
  let bits = 0, valor = 0, salida = '';
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { salida += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += B32[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decodificar(s) {
  let bits = 0, valor = 0;
  const bytes = [];
  for (const c of String(s).toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export function generarSecretoTotp() {
  return base32Codificar(randomBytes(20));
}

export function codigoTotp(secreto, paso = Math.floor(Date.now() / 30000)) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', base32Decodificar(secreto)).update(contador).digest();
  const desplazamiento = h[h.length - 1] & 0xf;
  const codigo = ((h[desplazamiento] & 0x7f) << 24) | (h[desplazamiento + 1] << 16) | (h[desplazamiento + 2] << 8) | h[desplazamiento + 3];
  return String(codigo % 1000000).padStart(6, '0');
}

/** Acepta el código del paso actual y ±1 (90 s de tolerancia). */
export function verificarTotp(secreto, codigo) {
  const c = String(codigo || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const paso = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) {
    const esperado = codigoTotp(secreto, paso + d);
    if (esperado.length === c.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(c))) return true;
  }
  return false;
}

export function urlOtpauth(email, secreto, emisor = 'CONTROL') {
  return `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(email)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
}

/* ---------- Recuperación de contraseña ---------- */

export function crearTokenRecuperacion(usuarioId) {
  const db = obtenerDb();
  db.prepare('UPDATE tokens_recuperacion SET usado_en = ? WHERE usuario_id = ? AND usado_en IS NULL').run(ahoraSql(), usuarioId);
  const token = tokenAleatorio(24);
  db.prepare('INSERT INTO tokens_recuperacion (usuario_id, hash_token, expira_en) VALUES (?, ?, ?)')
    .run(usuarioId, hashToken(token), new Date(Date.now() + 60 * 60000).toISOString().slice(0, 19).replace('T', ' '));
  return token;
}

/** Devuelve el usuario del token si sigue vigente, sin consumirlo. */
export function leerTokenRecuperacion(token) {
  const t = obtenerDb().prepare('SELECT * FROM tokens_recuperacion WHERE hash_token = ? AND usado_en IS NULL AND expira_en > ?').get(hashToken(token), ahoraSql());
  return t ? t.usuario_id : null;
}

export function consumirTokenRecuperacion(token) {
  const db = obtenerDb();
  const t = db.prepare('SELECT * FROM tokens_recuperacion WHERE hash_token = ? AND usado_en IS NULL AND expira_en > ?').get(hashToken(token), ahoraSql());
  if (!t) return null;
  db.prepare('UPDATE tokens_recuperacion SET usado_en = ? WHERE id = ?').run(ahoraSql(), t.id);
  return t.usuario_id;
}
