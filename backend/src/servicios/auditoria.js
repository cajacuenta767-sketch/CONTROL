import { obtenerDb } from '../db.js';

/** Registra una acción. Tabla de solo inserción: nunca se edita ni se borra. */
export function auditar({ usuarioId = null, accion, entidad = null, entidadId = null, detalle = null, ip = null }) {
  obtenerDb()
    .prepare('INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(usuarioId, accion, entidad, entidadId, detalle == null ? null : JSON.stringify(detalle), ip);
}

export function listarAuditoria({ pagina = 1, porPagina = 50, accion, usuarioId, entidad } = {}) {
  const db = obtenerDb();
  const condiciones = [];
  const params = [];
  if (accion) { condiciones.push('a.accion LIKE ?'); params.push(`%${accion}%`); }
  if (usuarioId) { condiciones.push('a.usuario_id = ?'); params.push(usuarioId); }
  if (entidad) { condiciones.push('a.entidad = ?'); params.push(entidad); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM auditoria a ${where}`).get(...params).c;
  const filas = db
    .prepare(
      `SELECT a.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, porPagina, (pagina - 1) * porPagina)
    .map((f) => ({ ...f, detalle: f.detalle ? JSON.parse(f.detalle) : null }));
  return { filas, total, pagina, porPagina };
}
