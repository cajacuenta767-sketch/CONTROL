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


/** Línea de tiempo del cliente: ventas, pagos, activaciones, tickets y cambios de licencia. */
export function historialCliente(id, usuario) {
  obtenerCliente(id, usuario);
  const db = obtenerDb();
  const eventos = [
    ...db.prepare("SELECT v.creado_en AS fecha, 'venta' AS tipo, v.numero AS titulo, pr.nombre || ' · ' || pl.nombre || ' · ' || v.total || ' ' || v.moneda AS detalle, v.id AS ref_id FROM ventas v JOIN productos pr ON pr.id = v.producto_id JOIN planes pl ON pl.id = v.plan_id WHERE v.cliente_id = ?").all(id),
    ...db.prepare("SELECT COALESCE(p.confirmado_en, p.creado_en) AS fecha, 'pago' AS tipo, p.estado || ' · ' || p.monto || ' ' || v.moneda AS titulo, p.metodo || COALESCE(' · ' || p.referencia, '') AS detalle, v.id AS ref_id FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE v.cliente_id = ?").all(id),
    ...db.prepare("SELECT a.activada_en AS fecha, 'activacion' AS tipo, l.clave AS titulo, COALESCE(a.nombre_equipo, a.dominio, a.huella) || COALESCE(' · v' || a.version, '') AS detalle, l.id AS ref_id FROM activaciones a JOIN licencias l ON l.id = a.licencia_id WHERE l.cliente_id = ?").all(id),
    ...db.prepare("SELECT t.creado_en AS fecha, 'ticket' AS tipo, t.asunto AS titulo, t.estado AS detalle, t.id AS ref_id FROM tickets t WHERE t.cliente_id = ?").all(id),
    ...db.prepare("SELECT au.creado_en AS fecha, 'licencia' AS tipo, au.accion AS titulo, COALESCE(json_extract(au.detalle, '$.motivo'), '') AS detalle, au.entidad_id AS ref_id FROM auditoria au WHERE au.entidad = 'licencia' AND au.entidad_id IN (SELECT id FROM licencias WHERE cliente_id = ?) AND au.accion IN ('licencia.suspendida','licencia.activa','licencia.revocada','licencia.reset','licencia.transferir','renovacion.automatica')").all(id),
  ];
  return eventos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 300);
}
