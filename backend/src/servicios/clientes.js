import { obtenerDb } from '../db.js';
import { noEncontrado, prohibido } from '../middleware/errores.js';
import { esGestor } from '../middleware/auth.js';
import { auditar } from './auditoria.js';

const BASE = `SELECT c.*, u.nombre AS vendedor_nombre,
  (SELECT COUNT(*) FROM licencias l WHERE l.cliente_id = c.id) AS licencias,
  (SELECT COUNT(*) FROM licencias l WHERE l.cliente_id = c.id AND l.estado IN ('activa','mora')) AS licencias_activas
  FROM clientes c LEFT JOIN usuarios u ON u.id = c.vendedor_id`;

export function listarClientes(usuario, { q = '' } = {}) {
  const condiciones = [];
  const params = [];
  if (!esGestor(usuario)) { condiciones.push('c.vendedor_id = ?'); params.push(usuario.id); }
  if (q) { condiciones.push('(c.nombre LIKE ? OR c.empresa LIKE ? OR c.email LIKE ? OR c.telefono LIKE ?)'); params.push(...Array(4).fill(`%${q}%`)); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return obtenerDb().prepare(`${BASE} ${where} ORDER BY c.creado_en DESC`).all(...params);
}

export function obtenerCliente(id, usuario) {
  const c = obtenerDb().prepare(`${BASE} WHERE c.id = ?`).get(id);
  if (!c) throw noEncontrado('Cliente no encontrado');
  if (usuario && !esGestor(usuario) && c.vendedor_id !== usuario.id) throw prohibido('Este cliente pertenece a otro vendedor');
  return c;
}

export function crearCliente(datos, actor) {
  const vendedorId = esGestor(actor) && datos.vendedor_id ? datos.vendedor_id : actor.id;
  const r = obtenerDb()
    .prepare('INSERT INTO clientes (nombre, empresa, email, telefono, pais, moneda, notas, vendedor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(datos.nombre, datos.empresa ?? null, datos.email ?? null, datos.telefono ?? null, datos.pais ?? null, datos.moneda ?? 'USD', datos.notas ?? null, vendedorId);
  const id = Number(r.lastInsertRowid);
  auditar({ usuarioId: actor.id, accion: 'cliente.crear', entidad: 'cliente', entidadId: id, detalle: { nombre: datos.nombre } });
  return obtenerCliente(id);
}

export function actualizarCliente(id, datos, actor) {
  obtenerCliente(id, actor);
  const campos = [];
  const valores = [];
  const permitidos = ['nombre', 'empresa', 'email', 'telefono', 'pais', 'moneda', 'notas'];
  if (esGestor(actor)) permitidos.push('vendedor_id');
  for (const k of permitidos) {
    if (datos[k] !== undefined) { campos.push(`${k} = ?`); valores.push(datos[k]); }
  }
  if (campos.length) obtenerDb().prepare(`UPDATE clientes SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id);
  auditar({ usuarioId: actor.id, accion: 'cliente.actualizar', entidad: 'cliente', entidadId: id, detalle: datos });
  return obtenerCliente(id);
}
