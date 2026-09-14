import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obtenerDb, ajuste, ahoraSql } from '../db.js';
import { dirDatos } from '../config.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { auditar } from './auditoria.js';
import { firmarToken } from '../firmas.js';

export const DIR_VERSIONES = resolve(dirDatos(), 'versiones');
const urlPublica = () => ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '');

/** Compara versiones "1.2.3" numéricamente. */
export function compararVersiones(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0), pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

export function listarVersiones(productoId) {
  return obtenerDb().prepare('SELECT v.*, u.nombre AS creado_por_nombre FROM versiones_producto v LEFT JOIN usuarios u ON u.id = v.creado_por WHERE v.producto_id = ? ORDER BY v.id DESC').all(productoId);
}

/**
 * Publica una versión: con archivo subido (instalador o paquete) o con URL externa
 * (GitHub Releases, Drive…). Calcula el SHA-256 del archivo y, si se pide, la marca como
 * versión actual del producto (lo que dispara el aviso de desactualización).
 */
export function publicarVersion(productoId, { version, notas, archivo, url_externa, marcar_actual = true }, actor) {
  const db = obtenerDb();
  const p = db.prepare('SELECT * FROM productos WHERE id = ?').get(productoId);
  if (!p) throw noEncontrado('Producto no encontrado');
  if (!/^\d+(\.\d+){0,3}([-+][\w.]+)?$/.test(String(version))) throw new ErrorHttp(422, 'Versión inválida (usa 1.2.3)');
  if (!archivo && !url_externa) throw new ErrorHttp(422, 'Adjunta un archivo o indica la URL de descarga');
  if (db.prepare('SELECT 1 FROM versiones_producto WHERE producto_id = ? AND version = ?').get(productoId, version)) throw new ErrorHttp(409, 'Esa versión ya está publicada');
  let sha256 = null, tamano = null;
  if (archivo) {
    const ruta = resolve(DIR_VERSIONES, archivo);
    if (!ruta.startsWith(DIR_VERSIONES) || !existsSync(ruta)) throw new ErrorHttp(422, 'Archivo no encontrado');
    sha256 = createHash('sha256').update(readFileSync(ruta)).digest('hex');
    tamano = statSync(ruta).size;
  }
  const r = db.prepare('INSERT INTO versiones_producto (producto_id, version, notas, archivo, tamano, sha256, url_externa, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(productoId, version, notas ?? null, archivo ?? null, tamano, sha256, url_externa ?? null, actor.id);
  if (marcar_actual) db.prepare('UPDATE productos SET version_actual = ? WHERE id = ?').run(version, productoId);
  auditar({ usuarioId: actor.id, accion: 'version.publicar', entidad: 'producto', entidadId: productoId, detalle: { version, sha256, url_externa, marcar_actual } });
  return db.prepare('SELECT * FROM versiones_producto WHERE id = ?').get(Number(r.lastInsertRowid));
}

export function despublicarVersion(id, actor) {
  const db = obtenerDb();
  const v = db.prepare('SELECT * FROM versiones_producto WHERE id = ?').get(id);
  if (!v) throw noEncontrado('Versión no encontrada');
  db.prepare('UPDATE versiones_producto SET publicada = 0 WHERE id = ?').run(id);
  const p = db.prepare('SELECT version_actual FROM productos WHERE id = ?').get(v.producto_id);
  if (p.version_actual === v.version) {
    const anterior = db.prepare('SELECT version FROM versiones_producto WHERE producto_id = ? AND publicada = 1 ORDER BY id DESC LIMIT 1').get(v.producto_id);
    db.prepare('UPDATE productos SET version_actual = ? WHERE id = ?').run(anterior?.version ?? null, v.producto_id);
  }
  if (v.archivo) { try { unlinkSync(resolve(DIR_VERSIONES, v.archivo)); } catch { /* ya no está */ } }
  auditar({ usuarioId: actor.id, accion: 'version.despublicar', entidad: 'producto', entidadId: v.producto_id, detalle: { version: v.version } });
  return { ok: true };
}

/**
 * Consulta del producto: ¿hay versión nueva para mí? Solo responde a licencias vigentes
 * (clave + huella activada). Devuelve un token firmado con versión, URL y SHA-256 para que
 * el producto verifique la descarga con la clave pública.
 */
export function buscarActualizacion({ clave, huella, producto, version }) {
  const db = obtenerDb();
  const l = db.prepare(`SELECT l.id, l.estado, pr.id AS producto_id, pr.codigo, pr.version_actual FROM licencias l JOIN productos pr ON pr.id = l.producto_id
    WHERE l.clave = ? AND (SELECT COUNT(*) FROM activaciones a WHERE a.licencia_id = l.id AND a.huella = ? AND a.activa = 1) > 0`).get(String(clave || '').trim().toUpperCase(), huella);
  if (!l) throw new ErrorHttp(403, 'Licencia o equipo no reconocidos', { ok: false, codigo: 'no_activada' });
  if (producto && l.codigo !== producto) throw new ErrorHttp(403, 'La licencia es de otro producto', { ok: false, codigo: 'producto_incorrecto' });
  if (['revocada', 'suspendida', 'vencida'].includes(l.estado)) throw new ErrorHttp(403, 'Licencia sin soporte vigente', { ok: false, codigo: l.estado });
  const ultima = db.prepare('SELECT * FROM versiones_producto WHERE producto_id = ? AND publicada = 1 ORDER BY id DESC LIMIT 1').get(l.producto_id);
  if (!ultima) return { ok: true, actualizar: false, version_actual: l.version_actual };
  if (version && compararVersiones(ultima.version, version) <= 0) return { ok: true, actualizar: false, version_actual: ultima.version };
  const url = ultima.url_externa || `${urlPublica()}/api/v1/licencias/actualizacion/${ultima.id}/descargar?clave=${encodeURIComponent(clave)}&huella=${encodeURIComponent(huella)}`;
  const expira = new Date(Date.now() + 24 * 3600000).toISOString();
  const firma = firmarToken({ tipo: 'actualizacion', producto: l.codigo, version: ultima.version, sha256: ultima.sha256, url, emitido_en: ahoraSql(), expira_en: expira });
  return { ok: true, actualizar: true, version: ultima.version, notas: ultima.notas, url, sha256: ultima.sha256, tamano: ultima.tamano, firma, expira_en: expira };
}

/** Ruta del archivo a servir, validando licencia y huella. */
export function archivoDescarga(id, { clave, huella }) {
  const db = obtenerDb();
  const v = db.prepare('SELECT v.*, pr.codigo FROM versiones_producto v JOIN productos pr ON pr.id = v.producto_id WHERE v.id = ? AND v.publicada = 1').get(id);
  if (!v || !v.archivo) throw noEncontrado('Versión no disponible');
  buscarActualizacion({ clave, huella, producto: v.codigo }); // lanza si la licencia no es válida
  const ruta = resolve(DIR_VERSIONES, v.archivo);
  if (!existsSync(ruta)) throw noEncontrado('Archivo no encontrado');
  db.prepare("INSERT INTO auditoria (accion, entidad, entidad_id, detalle) VALUES ('version.descarga', 'producto', ?, ?)").run(v.producto_id, JSON.stringify({ version: v.version, clave }));
  return { ruta, nombre: `${v.codigo}-${v.version}${v.archivo.slice(v.archivo.lastIndexOf('.'))}` };
}

export function asegurarDirVersiones() { mkdirSync(DIR_VERSIONES, { recursive: true }); return DIR_VERSIONES; }
