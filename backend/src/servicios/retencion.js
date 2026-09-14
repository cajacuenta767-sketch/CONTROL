import { obtenerDb, ajuste, ahoraSql } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { veTodo } from '../middleware/auth.js';
import { auditar } from './auditoria.js';
import { crearVenta, obtenerVenta } from './ventas.js';
import { crearEnlace, proveedoresDisponibles } from './pagos_en_linea.js';
import { enviarWhatsapp } from './mensajeria.js';

const urlPublica = () => ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '');
const rellenar = (texto, vars) => String(texto || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

/* ---------- Semáforo de salud ---------- */

/**
 * Puntaje de salud por cliente (0-100) a partir de señales que ya existen: mora o suspensión,
 * vencimiento cercano sin renovación, instalaciones sin latido, versión atrasada, tickets
 * abiertos, cuotas vencidas y encuestas bajas. Verde ≥ 70, ámbar 40-69, rojo < 40.
 */
export function saludClientes(usuario, { solo_riesgo = false } = {}) {
  const db = obtenerDb();
  const propio = !veTodo(usuario);
  const filas = db.prepare(`SELECT c.id, c.nombre, c.empresa, c.telefono, c.vendedor_id, u.nombre AS vendedor_nombre,
      (SELECT COUNT(*) FROM licencias l WHERE l.cliente_id = c.id AND l.estado IN ('activa','mora','suspendida','vencida')) AS licencias,
      (SELECT COUNT(*) FROM licencias l WHERE l.cliente_id = c.id AND l.estado = 'mora') AS en_mora,
      (SELECT COUNT(*) FROM licencias l WHERE l.cliente_id = c.id AND l.estado = 'suspendida') AS suspendidas,
      (SELECT COUNT(*) FROM licencias l WHERE l.cliente_id = c.id AND l.estado = 'vencida') AS vencidas,
      (SELECT COUNT(*) FROM licencias l WHERE l.cliente_id = c.id AND l.estado IN ('activa','mora') AND l.vence_en IS NOT NULL AND l.vence_en <= datetime('now', '+15 days')
         AND NOT EXISTS (SELECT 1 FROM ventas v WHERE v.renueva_licencia_id = l.id AND v.estado = 'pendiente')) AS vencen_pronto,
      (SELECT COUNT(*) FROM activaciones a JOIN licencias l ON l.id = a.licencia_id WHERE l.cliente_id = c.id AND a.activa = 1 AND l.estado IN ('activa','mora') AND a.ultimo_latido < datetime('now', '-14 days')) AS sin_latido,
      (SELECT COUNT(*) FROM activaciones a JOIN licencias l ON l.id = a.licencia_id JOIN productos p ON p.id = l.producto_id WHERE l.cliente_id = c.id AND a.activa = 1 AND p.version_actual IS NOT NULL AND a.version IS NOT NULL AND a.version != p.version_actual) AS desactualizadas,
      (SELECT COUNT(*) FROM tickets t WHERE t.cliente_id = c.id AND t.estado = 'abierto') AS tickets_abiertos,
      (SELECT COUNT(*) FROM cuotas cu JOIN ventas v ON v.id = cu.venta_id WHERE v.cliente_id = c.id AND cu.estado = 'vencida') AS cuotas_vencidas,
      (SELECT AVG(e.puntaje) FROM encuestas e WHERE e.cliente_id = c.id AND e.creado_en >= datetime('now', '-90 days')) AS encuesta,
      (SELECT MAX(a.ultimo_latido) FROM activaciones a JOIN licencias l ON l.id = a.licencia_id WHERE l.cliente_id = c.id AND a.activa = 1) AS ultimo_latido
    FROM clientes c LEFT JOIN usuarios u ON u.id = c.vendedor_id ${propio ? 'WHERE c.vendedor_id = ?' : ''} ORDER BY c.nombre`).all(...(propio ? [usuario.id] : []));
  const salida = filas.map((c) => {
    let puntaje = 100;
    const factores = [];
    if (c.licencias === 0) return { ...c, puntaje: null, semaforo: 'sin_licencias', factores: ['Sin licencias vigentes'] };
    if (c.suspendidas) { puntaje -= 40; factores.push(`${c.suspendidas} licencia(s) suspendida(s)`); }
    if (c.en_mora) { puntaje -= 25; factores.push(`${c.en_mora} en mora`); }
    if (c.vencidas) { puntaje -= 15; factores.push(`${c.vencidas} vencida(s)`); }
    if (c.cuotas_vencidas) { puntaje -= 30; factores.push(`${c.cuotas_vencidas} cuota(s) vencida(s)`); }
    if (c.vencen_pronto) { puntaje -= 20; factores.push(`${c.vencen_pronto} vence(n) en 15 días sin renovación en curso`); }
    if (c.sin_latido) { puntaje -= 20; factores.push(`${c.sin_latido} instalación(es) sin señal en 14 días`); }
    if (c.desactualizadas) { puntaje -= 5; factores.push(`${c.desactualizadas} desactualizada(s)`); }
    if (c.tickets_abiertos) { puntaje -= Math.min(20, 10 * c.tickets_abiertos); factores.push(`${c.tickets_abiertos} ticket(s) sin responder`); }
    if (c.encuesta !== null && c.encuesta <= 2.5) { puntaje -= 25; factores.push(`Encuesta reciente: ${Number(c.encuesta).toFixed(1)} de 5`); }
    puntaje = Math.max(0, puntaje);
    const semaforo = puntaje >= 70 ? 'verde' : puntaje >= 40 ? 'ambar' : 'rojo';
    return { ...c, puntaje, semaforo, factores: factores.length ? factores : ['Todo en orden'] };
  });
  const lista = solo_riesgo ? salida.filter((c) => c.semaforo === 'rojo' || c.semaforo === 'ambar') : salida;
  return lista.sort((a, b) => (a.puntaje ?? 101) - (b.puntaje ?? 101));
}

export function resumenSalud(usuario) {
  const todos = saludClientes(usuario);
  const conteo = { verde: 0, ambar: 0, rojo: 0, sin_licencias: 0 };
  for (const c of todos) conteo[c.semaforo] = (conteo[c.semaforo] || 0) + 1;
  return { conteo, en_riesgo: todos.filter((c) => c.semaforo === 'rojo' || c.semaforo === 'ambar').slice(0, 8) };
}

export function saludCliente(clienteId, usuario) {
  const c = saludClientes(usuario).find((x) => x.id === clienteId);
  if (!c) throw noEncontrado('Cliente no encontrado');
  return c;
}

/* ---------- Encuesta de una pregunta ---------- */

/** Qué encuestas le corresponde responder al cliente: ticket cerrado o renovación pagada en los últimos 30 días sin encuesta. */
export function encuestasPendientes(clienteId) {
  const db = obtenerDb();
  const tickets = db.prepare(`SELECT t.id, t.asunto FROM tickets t WHERE t.cliente_id = ? AND t.estado = 'cerrado' AND t.actualizado_en >= datetime('now', '-30 days')
    AND NOT EXISTS (SELECT 1 FROM encuestas e WHERE e.ticket_id = t.id) ORDER BY t.id DESC LIMIT 3`).all(clienteId);
  const ventas = db.prepare(`SELECT v.id, v.numero, pr.nombre AS producto FROM ventas v JOIN productos pr ON pr.id = v.producto_id WHERE v.cliente_id = ? AND v.estado = 'pagada' AND v.pagada_en >= datetime('now', '-30 days')
    AND NOT EXISTS (SELECT 1 FROM encuestas e WHERE e.venta_id = v.id) ORDER BY v.id DESC LIMIT 3`).all(clienteId);
  return [
    ...tickets.map((t) => ({ motivo: 'ticket', ticket_id: t.id, pregunta: `¿Qué tal resolvimos "${t.asunto}"?` })),
    ...ventas.map((v) => ({ motivo: v.numero ? 'compra' : 'compra', venta_id: v.id, pregunta: `¿Cómo va ${v.producto} hasta ahora?` })),
  ];
}

export function registrarEncuesta(cliente, { motivo, puntaje, comentario, ticket_id, venta_id }) {
  const db = obtenerDb();
  if (ticket_id && !db.prepare('SELECT 1 FROM tickets WHERE id = ? AND cliente_id = ?').get(ticket_id, cliente.id)) throw noEncontrado('Ticket no encontrado');
  if (venta_id && !db.prepare('SELECT 1 FROM ventas WHERE id = ? AND cliente_id = ?').get(venta_id, cliente.id)) throw noEncontrado('Venta no encontrada');
  if ((ticket_id && db.prepare('SELECT 1 FROM encuestas WHERE ticket_id = ?').get(ticket_id)) || (venta_id && db.prepare('SELECT 1 FROM encuestas WHERE venta_id = ?').get(venta_id))) throw new ErrorHttp(409, 'Ya respondiste esta encuesta');
  const productoId = venta_id ? db.prepare('SELECT producto_id FROM ventas WHERE id = ?').get(venta_id)?.producto_id
    : ticket_id ? db.prepare('SELECT l.producto_id FROM tickets t JOIN licencias l ON l.id = t.licencia_id WHERE t.id = ?').get(ticket_id)?.producto_id ?? null : null;
  const r = db.prepare('INSERT INTO encuestas (cliente_id, ticket_id, venta_id, producto_id, motivo, puntaje, comentario) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(cliente.id, ticket_id ?? null, venta_id ?? null, productoId ?? null, motivo, puntaje, comentario ?? null);
  auditar({ accion: 'encuesta.responder', entidad: 'cliente', entidadId: cliente.id, detalle: { motivo, puntaje, ticket_id, venta_id } });
  return { id: Number(r.lastInsertRowid), puntaje };
}

/** Promedio por producto y últimos comentarios, para Reportes. */
export function reporteEncuestas(usuario) {
  const db = obtenerDb();
  const propio = !veTodo(usuario);
  const filtro = propio ? 'AND c.vendedor_id = ?' : '';
  const p = propio ? [usuario.id] : [];
  const porProducto = db.prepare(`SELECT COALESCE(pr.nombre, 'General') AS producto, COUNT(*) AS respuestas, ROUND(AVG(e.puntaje), 2) AS promedio,
      SUM(CASE WHEN e.puntaje <= 2 THEN 1 ELSE 0 END) AS bajas
    FROM encuestas e JOIN clientes c ON c.id = e.cliente_id LEFT JOIN productos pr ON pr.id = e.producto_id WHERE 1=1 ${filtro} GROUP BY pr.id ORDER BY promedio`).all(...p);
  const ultimas = db.prepare(`SELECT e.*, c.nombre AS cliente_nombre, pr.nombre AS producto FROM encuestas e JOIN clientes c ON c.id = e.cliente_id LEFT JOIN productos pr ON pr.id = e.producto_id WHERE 1=1 ${filtro} ORDER BY e.id DESC LIMIT 30`).all(...p);
  const total = db.prepare(`SELECT COUNT(*) AS n, ROUND(AVG(e.puntaje), 2) AS promedio FROM encuestas e JOIN clientes c ON c.id = e.cliente_id WHERE 1=1 ${filtro}`).get(...p);
  return { total, por_producto: porProducto, ultimas };
}

/* ---------- Campañas de renovación ---------- */

/** Licencias mensuales o anuales que vencen en los próximos N días, con su estado de renovación. */
export function campanaRenovaciones(usuario, { dias = 30 } = {}) {
  const db = obtenerDb();
  const propio = !veTodo(usuario);
  return db.prepare(`SELECT l.id, l.clave, l.etiqueta, l.estado, l.vence_en, l.cliente_id, c.nombre AS cliente_nombre, c.telefono, c.email, c.moneda,
      pr.nombre AS producto_nombre, pl.nombre AS plan_nombre, pl.tipo AS plan_tipo, pl.precio, u.nombre AS vendedor_nombre,
      (SELECT v.id FROM ventas v WHERE v.renueva_licencia_id = l.id AND v.estado = 'pendiente' ORDER BY v.id DESC LIMIT 1) AS venta_renovacion_id,
      (SELECT e.url FROM enlaces_pago e JOIN ventas v ON v.id = e.venta_id WHERE v.renueva_licencia_id = l.id AND v.estado = 'pendiente' AND e.estado = 'pendiente' ORDER BY e.id DESC LIMIT 1) AS enlace_pago,
      (SELECT MAX(m.creado_en) FROM mensajes m WHERE m.referencia = 'renovacion:' || l.id) AS ultimo_mensaje
    FROM licencias l JOIN clientes c ON c.id = l.cliente_id JOIN productos pr ON pr.id = l.producto_id JOIN planes pl ON pl.id = l.plan_id LEFT JOIN usuarios u ON u.id = l.vendedor_id
    WHERE l.estado IN ('activa','mora','vencida','suspendida') AND pl.tipo IN ('mensual','anual') AND l.vence_en IS NOT NULL AND l.vence_en <= datetime('now', ?)
      ${propio ? 'AND l.vendedor_id = ?' : ''} ORDER BY l.vence_en`).all(`+${dias} days`, ...(propio ? [usuario.id] : []));
}

/**
 * Para cada licencia: crea (o reutiliza) la venta de renovación, genera el enlace de pago si
 * hay pasarela y arma el mensaje de WhatsApp. Con `enviar` = true lo manda por la API.
 */
export async function generarRenovaciones({ licencia_ids, proveedor, enviar = false }, actor) {
  const db = obtenerDb();
  const pasarelas = proveedoresDisponibles();
  const prov = proveedor && pasarelas[proveedor] ? proveedor : pasarelas.culqi ? 'culqi' : pasarelas.stripe ? 'stripe' : pasarelas.paypal ? 'paypal' : pasarelas.demo ? 'demo' : null;
  const plantillaWa = ajuste('plantilla_wa_renovacion', '');
  const agencia = ajuste('nombre_agencia', 'CONTROL');
  const resultados = [];
  for (const licId of licencia_ids) {
    const l = db.prepare('SELECT l.*, c.nombre AS cliente_nombre, c.telefono, pr.nombre AS producto_nombre, pl.tipo AS plan_tipo FROM licencias l JOIN clientes c ON c.id = l.cliente_id JOIN productos pr ON pr.id = l.producto_id JOIN planes pl ON pl.id = l.plan_id WHERE l.id = ?').get(licId);
    if (!l) { resultados.push({ licencia_id: licId, error: 'No encontrada' }); continue; }
    if (!veTodo(actor) && l.vendedor_id !== actor.id) { resultados.push({ licencia_id: licId, error: 'De otro vendedor' }); continue; }
    if (!['mensual', 'anual'].includes(l.plan_tipo) || l.estado === 'revocada') { resultados.push({ licencia_id: licId, error: 'No renovable' }); continue; }
    try {
      let ventaId = db.prepare("SELECT id FROM ventas WHERE renueva_licencia_id = ? AND estado = 'pendiente' ORDER BY id DESC").get(l.id)?.id;
      if (!ventaId) ventaId = crearVenta({ cliente_id: l.cliente_id, plan_id: l.plan_id, renueva_licencia_id: l.id, vendedor_id: l.vendedor_id ?? actor.id, notas: 'Campaña de renovación' }, actor, { origen: 'campaña' }).id;
      let enlace = db.prepare("SELECT url FROM enlaces_pago WHERE venta_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1").get(ventaId)?.url ?? null;
      if (!enlace && prov) enlace = (await crearEnlace(ventaId, prov, actor)).url;
      const venta = obtenerVenta(ventaId);
      const mensaje = rellenar(plantillaWa, { cliente: l.cliente_nombre, producto: l.producto_nombre, vence: String(l.vence_en).slice(0, 10), agencia, enlace: enlace ? `Renueva aquí: ${enlace}` : `Renueva desde tu portal: ${urlPublica()}/portal` });
      let envio = null;
      if (enviar && l.telefono) envio = (await enviarWhatsapp({ para: l.telefono, texto: mensaje, plantilla: ajuste('whatsapp_plantilla_vencimiento', '') || null, variables: [l.cliente_nombre, l.producto_nombre, String(l.vence_en).slice(0, 10)], referencia: `renovacion:${l.id}` })).estado;
      resultados.push({ licencia_id: l.id, cliente: l.cliente_nombre, telefono: l.telefono, venta_id: ventaId, numero: venta.numero, total: venta.total, moneda: venta.moneda, enlace, mensaje, envio });
    } catch (e) {
      resultados.push({ licencia_id: licId, cliente: l.cliente_nombre, error: e.message });
    }
  }
  auditar({ usuarioId: actor.id, accion: 'renovaciones.campana', detalle: { licencias: licencia_ids.length, enviadas: resultados.filter((r) => r.envio === 'enviado').length, proveedor: prov } });
  return { proveedor: prov, resultados };
}
