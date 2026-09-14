import { obtenerDb, ajuste, ahoraSql } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { firmarCliente, esGestor } from '../middleware/auth.js';
import { auditar } from './auditoria.js';
import { alertarDuenoSinEsperar } from './mensajeria.js';
import { encuestasPendientes } from './retencion.js';
import { obtenerVenta, crearVenta } from './ventas.js';
import { crearEnlace, proveedoresDisponibles } from './pagos_en_linea.js';
import { enviarCorreo, plantilla } from './correo.js';
import { actualizarEstadosPorFecha } from './licencias.js';

const normalizarTel = (t) => String(t || '').replace(/\D/g, '');

/**
 * Acceso al portal: clave de licencia + correo o teléfono registrado del cliente.
 * No hay contraseña: la clave solo la conoce el cliente y el dato de contacto lo verifica.
 */
export function accesoPortal({ clave, contacto }, ip) {
  if (ajuste('portal_activo', '1') !== '1') throw new ErrorHttp(403, 'El portal del cliente está desactivado');
  const db = obtenerDb();
  const l = db.prepare('SELECT l.id, l.cliente_id, c.email, c.telefono, c.nombre FROM licencias l JOIN clientes c ON c.id = l.cliente_id WHERE l.clave = ?').get(String(clave || '').trim().toUpperCase());
  const c = String(contacto || '').trim().toLowerCase();
  const telLic = normalizarTel(l?.telefono), telIn = normalizarTel(c);
  const telCoincide = telLic.length >= 7 && telIn.length >= 7 && (telLic.endsWith(telIn) || telIn.endsWith(telLic));
  const coincide = l && ((l.email && l.email.toLowerCase() === c) || telCoincide);
  if (!coincide) {
    auditar({ accion: 'portal.acceso_rechazado', detalle: { clave }, ip });
    throw new ErrorHttp(401, 'No encontramos una licencia con esos datos');
  }
  auditar({ usuarioId: null, accion: 'portal.acceso', entidad: 'cliente', entidadId: l.cliente_id, ip });
  const cliente = db.prepare('SELECT id, nombre, empresa, email, telefono, moneda FROM clientes WHERE id = ?').get(l.cliente_id);
  return { token: firmarCliente(cliente), cliente };
}

export function resumenPortal(cliente) {
  actualizarEstadosPorFecha();
  const db = obtenerDb();
  const licencias = db
    .prepare(`SELECT l.id, l.clave, l.etiqueta, l.estado, l.vence_en, l.soporte_hasta, l.max_activaciones, pr.nombre AS producto, pl.nombre AS plan, pl.tipo AS plan_tipo,
      (SELECT COUNT(*) FROM activaciones a WHERE a.licencia_id = l.id AND a.activa = 1) AS equipos,
      u.nombre AS vendedor, u.telefono AS vendedor_telefono, u.marca_nombre
      FROM licencias l JOIN productos pr ON pr.id = l.producto_id JOIN planes pl ON pl.id = l.plan_id LEFT JOIN usuarios u ON u.id = l.vendedor_id
      WHERE l.cliente_id = ? ORDER BY l.id DESC`)
    .all(cliente.id);
  const ventas = db
    .prepare(`SELECT v.id, v.numero, v.total, v.moneda, v.estado, v.creado_en, pr.nombre AS producto, pl.nombre AS plan,
      (SELECT COALESCE(SUM(p.monto),0) FROM pagos p WHERE p.venta_id = v.id AND p.estado = 'confirmado') AS pagado,
      (SELECT e.url FROM enlaces_pago e WHERE e.venta_id = v.id AND e.estado = 'pendiente' ORDER BY e.id DESC LIMIT 1) AS enlace_pago
      FROM ventas v JOIN productos pr ON pr.id = v.producto_id JOIN planes pl ON pl.id = v.plan_id WHERE v.cliente_id = ? AND v.estado != 'anulada' ORDER BY v.id DESC`)
    .all(cliente.id);
  const tickets = listarTicketsCliente(cliente.id);
  const marca = licencias.find((l) => l.marca_nombre)?.marca_nombre || ajuste('nombre_agencia', 'CONTROL');
  return { cliente, agencia: marca, licencias, ventas, tickets, pasarelas: proveedoresDisponibles(), encuestas_pendientes: encuestasPendientes(cliente.id) };
}

/** El cliente pide renovar desde el portal: venta de renovación + enlace de pago. */
export async function renovarDesdePortal(cliente, licenciaId) {
  const db = obtenerDb();
  const l = db.prepare('SELECT l.*, pl.tipo AS plan_tipo FROM licencias l JOIN planes pl ON pl.id = l.plan_id WHERE l.id = ? AND l.cliente_id = ?').get(licenciaId, cliente.id);
  if (!l) throw noEncontrado('Licencia no encontrada');
  if (!['mensual', 'anual'].includes(l.plan_tipo)) throw new ErrorHttp(422, 'Este plan no se renueva en línea; contacta a tu asesor');
  if (l.estado === 'revocada') throw new ErrorHttp(422, 'Licencia revocada');
  const pendiente = db.prepare("SELECT v.id FROM ventas v WHERE v.renueva_licencia_id = ? AND v.estado = 'pendiente' ORDER BY v.id DESC").get(l.id);
  const pasarelas = proveedoresDisponibles();
  const proveedor = pasarelas.stripe ? 'stripe' : pasarelas.paypal ? 'paypal' : pasarelas.demo ? 'demo' : null;
  if (!proveedor) throw new ErrorHttp(422, 'No hay pasarela de pago configurada; contacta a tu asesor');
  const superadmin = db.prepare("SELECT * FROM usuarios WHERE rol = 'superadmin' AND activo = 1 ORDER BY id LIMIT 1").get();
  let ventaId = pendiente?.id;
  if (!ventaId) {
    const venta = crearVenta({ cliente_id: cliente.id, plan_id: l.plan_id, renueva_licencia_id: l.id, vendedor_id: l.vendedor_id ?? superadmin.id, notas: 'Renovación desde el portal' }, superadmin, { origen: 'portal' });
    ventaId = venta.id;
  }
  const existente = db.prepare("SELECT * FROM enlaces_pago WHERE venta_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1").get(ventaId);
  const enlace = existente || (await crearEnlace(ventaId, proveedor, superadmin));
  const venta = obtenerVenta(ventaId);
  return { venta: { id: venta.id, numero: venta.numero, total: venta.total, moneda: venta.moneda }, url: enlace.url };
}

/* ---------- Tickets ---------- */

export function listarTicketsCliente(clienteId) {
  const db = obtenerDb();
  return db.prepare('SELECT t.*, l.clave AS licencia_clave, (SELECT COUNT(*) FROM ticket_mensajes m WHERE m.ticket_id = t.id) AS mensajes FROM tickets t LEFT JOIN licencias l ON l.id = t.licencia_id WHERE t.cliente_id = ? ORDER BY t.actualizado_en DESC').all(clienteId);
}

export function obtenerTicket(id, { clienteId = null, usuario = null } = {}) {
  const db = obtenerDb();
  const t = db.prepare('SELECT t.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.vendedor_id, l.clave AS licencia_clave, pr.nombre AS producto FROM tickets t JOIN clientes c ON c.id = t.cliente_id LEFT JOIN licencias l ON l.id = t.licencia_id LEFT JOIN productos pr ON pr.id = l.producto_id WHERE t.id = ?').get(id);
  if (!t) throw noEncontrado('Ticket no encontrado');
  if (clienteId !== null && t.cliente_id !== clienteId) throw noEncontrado('Ticket no encontrado');
  if (usuario && !esGestor(usuario) && t.vendedor_id !== usuario.id) throw new ErrorHttp(403, 'Este ticket es de un cliente de otro vendedor');
  t.mensajes = db.prepare('SELECT m.*, u.nombre AS usuario_nombre FROM ticket_mensajes m LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.ticket_id = ? ORDER BY m.id').all(id);
  return t;
}

export async function crearTicket(cliente, { asunto, texto, licencia_id }) {
  const db = obtenerDb();
  if (licencia_id && !db.prepare('SELECT 1 FROM licencias WHERE id = ? AND cliente_id = ?').get(licencia_id, cliente.id)) throw noEncontrado('Licencia no encontrada');
  const r = db.prepare('INSERT INTO tickets (cliente_id, licencia_id, asunto) VALUES (?, ?, ?)').run(cliente.id, licencia_id ?? null, asunto);
  const id = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO ticket_mensajes (ticket_id, autor_tipo, texto) VALUES (?, 'cliente', ?)").run(id, texto);
  auditar({ accion: 'ticket.crear', entidad: 'ticket', entidadId: id, detalle: { cliente: cliente.nombre, asunto } });
  // Aviso al vendedor del cliente (o a los gestores si no tiene)
  const destinos = db.prepare(`SELECT email FROM usuarios WHERE activo = 1 AND (id = (SELECT vendedor_id FROM clientes WHERE id = ?) OR rol = 'superadmin')`).all(cliente.id).map((u) => u.email);
  for (const para of new Set(destinos)) {
    await enviarCorreo({ para, asunto: `Nuevo ticket de ${cliente.nombre}: ${asunto}`, html: plantilla('Nuevo ticket de soporte', `<p><strong>${cliente.nombre}</strong> escribió:</p><blockquote>${texto.replace(/</g, '&lt;')}</blockquote>`, { boton: 'Responder', url: `${ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '')}/tickets/${id}` }) });
  }
  alertarDuenoSinEsperar('ticket_nuevo', `${cliente.nombre}: ${asunto}`, { referencia: id, url: `/tickets/${id}` });
  return obtenerTicket(id, { clienteId: cliente.id });
}

export async function responderTicket(id, { texto, cerrar = false }, { cliente = null, usuario = null }) {
  const db = obtenerDb();
  const t = obtenerTicket(id, { clienteId: cliente?.id ?? null, usuario });
  if (t.estado === 'cerrado' && cliente) throw new ErrorHttp(422, 'El ticket está cerrado; abre uno nuevo');
  db.prepare('INSERT INTO ticket_mensajes (ticket_id, autor_tipo, usuario_id, texto) VALUES (?, ?, ?, ?)').run(id, cliente ? 'cliente' : 'agencia', usuario?.id ?? null, texto);
  const estado = cerrar ? 'cerrado' : cliente ? 'abierto' : 'respondido';
  db.prepare('UPDATE tickets SET estado = ?, actualizado_en = ? WHERE id = ?').run(estado, ahoraSql(), id);
  auditar({ usuarioId: usuario?.id ?? null, accion: cerrar ? 'ticket.cerrar' : 'ticket.responder', entidad: 'ticket', entidadId: id });
  if (usuario) {
    const c = db.prepare('SELECT nombre, email FROM clientes WHERE id = ?').get(t.cliente_id);
    if (c?.email) await enviarCorreo({ para: c.email, asunto: `Respuesta a tu ticket: ${t.asunto}`, html: plantilla('Respuesta de soporte', `<p>Hola ${c.nombre}.</p><blockquote>${texto.replace(/</g, '&lt;')}</blockquote>${cerrar ? '<p>El ticket quedó cerrado. Si necesitas algo más, abre uno nuevo desde el portal.</p>' : ''}`, { boton: 'Ver en el portal', url: `${ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '')}/portal` }) });
  }
  return obtenerTicket(id, { clienteId: cliente?.id ?? null, usuario });
}

export function listarTicketsPanel(usuario, { estado } = {}) {
  const condiciones = [];
  const params = [];
  if (!esGestor(usuario)) { condiciones.push('c.vendedor_id = ?'); params.push(usuario.id); }
  if (estado) { condiciones.push('t.estado = ?'); params.push(estado); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return obtenerDb()
    .prepare(`SELECT t.*, c.nombre AS cliente_nombre, l.clave AS licencia_clave, pr.nombre AS producto,
      (SELECT COUNT(*) FROM ticket_mensajes m WHERE m.ticket_id = t.id) AS mensajes,
      (SELECT m.texto FROM ticket_mensajes m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS ultimo_mensaje
      FROM tickets t JOIN clientes c ON c.id = t.cliente_id LEFT JOIN licencias l ON l.id = t.licencia_id LEFT JOIN productos pr ON pr.id = l.producto_id
      ${where} ORDER BY CASE t.estado WHEN 'abierto' THEN 0 WHEN 'respondido' THEN 1 ELSE 2 END, t.actualizado_en DESC LIMIT 500`)
    .all(...params);
}
