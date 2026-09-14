import { obtenerDb, ajuste, ahoraSql } from '../db.js';
import { enviarCorreo, plantilla as plantillaCorreo } from './correo.js';

/**
 * Mensajería saliente: WhatsApp (Cloud API de Meta), Telegram (bot) y alertas al dueño.
 * Todo mensaje queda registrado en `mensajes` aunque el canal no esté configurado, para
 * que el panel muestre qué se habría enviado.
 */

const normalizarTel = (t) => String(t || '').replace(/\D/g, '');

export function whatsappConfigurado() {
  return Boolean(ajuste('whatsapp_token', '') && ajuste('whatsapp_telefono_id', ''));
}
export function telegramConfigurado() {
  return Boolean(ajuste('telegram_token', '') && ajuste('telegram_chat_id', ''));
}

function registrar({ canal, para, texto, plantilla = null, referencia = null }) {
  return Number(obtenerDb().prepare('INSERT INTO mensajes (canal, para, texto, plantilla, referencia) VALUES (?, ?, ?, ?, ?)').run(canal, para, texto, plantilla, referencia).lastInsertRowid);
}
function marcar(id, estado, { error = null, idExterno = null } = {}) {
  obtenerDb().prepare("UPDATE mensajes SET estado = ?, error = ?, id_externo = ?, enviado_en = CASE WHEN ? = 'enviado' THEN ? ELSE NULL END WHERE id = ?").run(estado, error, idExterno, estado, ahoraSql(), id);
}

/**
 * Envía un WhatsApp. En modo `plantilla` usa una plantilla aprobada por Meta (obligatorio
 * para mensajes que inicia la empresa); en modo `texto` manda texto libre (solo llega si el
 * cliente escribió en las últimas 24 h). `variables` rellena los {{n}} de la plantilla.
 */
export async function enviarWhatsapp({ para, texto, plantilla = null, variables = [], referencia = null }) {
  const telefono = normalizarTel(para);
  const id = registrar({ canal: 'whatsapp', para: telefono || String(para || ''), texto, plantilla, referencia });
  if (!telefono) { marcar(id, 'error', { error: 'Sin teléfono' }); return { id, estado: 'error' }; }
  if (!whatsappConfigurado()) { marcar(id, 'sin_configurar'); return { id, estado: 'sin_configurar' }; }
  const token = ajuste('whatsapp_token');
  const telId = ajuste('whatsapp_telefono_id');
  const modo = plantilla ? 'plantilla' : ajuste('whatsapp_modo', 'texto');
  const cuerpo = modo === 'plantilla' && plantilla
    ? { messaging_product: 'whatsapp', to: telefono, type: 'template', template: { name: plantilla, language: { code: ajuste('whatsapp_idioma', 'es') }, components: variables.length ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }] : [] } }
    : { messaging_product: 'whatsapp', to: telefono, type: 'text', text: { preview_url: true, body: texto } };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${telId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { marcar(id, 'error', { error: d.error?.message || `HTTP ${r.status}` }); return { id, estado: 'error', error: d.error?.message }; }
    marcar(id, 'enviado', { idExterno: d.messages?.[0]?.id ?? null });
    return { id, estado: 'enviado' };
  } catch (e) {
    marcar(id, 'error', { error: e.message });
    return { id, estado: 'error', error: e.message };
  }
}

/** Mensaje al chat del dueño por Telegram (bot). */
export async function enviarTelegram({ texto, referencia = null, chatId = ajuste('telegram_chat_id', '') }) {
  const id = registrar({ canal: 'telegram', para: chatId || 'sin chat', texto, referencia });
  if (!telegramConfigurado()) { marcar(id, 'sin_configurar'); return { id, estado: 'sin_configurar' }; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${ajuste('telegram_token')}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { marcar(id, 'error', { error: d.description || `HTTP ${r.status}` }); return { id, estado: 'error' }; }
    marcar(id, 'enviado', { idExterno: String(d.result?.message_id ?? '') });
    return { id, estado: 'enviado' };
  } catch (e) {
    marcar(id, 'error', { error: e.message });
    return { id, estado: 'error', error: e.message };
  }
}

export const TIPOS_ALERTA = {
  pago_por_confirmar: 'Pago registrado que espera tu confirmación',
  activacion_rechazada: 'Activación de licencia rechazada',
  instalacion_clonada: 'Intento de usar una licencia en más equipos de los permitidos',
  cuota_vencida: 'Cuota vencida: licencias suspendidas',
  ticket_nuevo: 'Ticket de soporte nuevo',
  cierre_caja: 'Cierre de caja por aprobar',
  planificador_detenido: 'Las tareas programadas no corren',
};

/**
 * Alerta al dueño por los canales configurados (Telegram, WhatsApp al teléfono del dueño y
 * correo del superadmin). `referencia` evita repetir la misma alerta.
 */
export async function alertarDueno(tipo, texto, { referencia = null, url = null } = {}) {
  const activas = ajuste('alertas_dueno', '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!activas.includes(tipo)) return { omitida: true };
  const db = obtenerDb();
  if (referencia) {
    try { db.prepare('INSERT INTO notificaciones (tipo, referencia, canal, detalle) VALUES (?, ?, ?, ?)').run(`alerta_${tipo}`, String(referencia), 'dueno', null); }
    catch { return { repetida: true }; }
  }
  const titulo = TIPOS_ALERTA[tipo] || tipo;
  const enlace = url ? `${ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '')}${url}` : null;
  const cuerpo = `${titulo}\n${texto}${enlace ? `\n${enlace}` : ''}`;
  const resultados = {};
  if (telegramConfigurado()) resultados.telegram = (await enviarTelegram({ texto: `<b>${titulo}</b>\n${texto}${enlace ? `\n${enlace}` : ''}`, referencia: `${tipo}:${referencia ?? ''}` })).estado;
  const tel = ajuste('telefono_dueno', '');
  if (tel && whatsappConfigurado()) resultados.whatsapp = (await enviarWhatsapp({ para: tel, texto: cuerpo, referencia: `${tipo}:${referencia ?? ''}` })).estado;
  if (!resultados.telegram && !resultados.whatsapp) {
    const dueno = db.prepare("SELECT email FROM usuarios WHERE rol = 'superadmin' AND activo = 1 ORDER BY id LIMIT 1").get();
    if (dueno?.email) { await enviarCorreo({ para: dueno.email, asunto: `[Alerta] ${titulo}`, html: plantillaCorreo(titulo, `<p>${texto.replace(/\n/g, '<br>')}</p>`, enlace ? { boton: 'Abrir en el panel', url: enlace } : undefined) }); resultados.correo = 'enviado'; }
  }
  return resultados;
}

/** Nunca rompe el flujo principal: alerta en segundo plano. */
export function alertarDuenoSinEsperar(tipo, texto, opciones) {
  alertarDueno(tipo, texto, opciones).catch(() => null);
}

export function listarMensajes({ canal, limite = 200 } = {}) {
  return obtenerDb().prepare(`SELECT * FROM mensajes ${canal ? 'WHERE canal = ?' : ''} ORDER BY id DESC LIMIT ?`).all(...(canal ? [canal] : []), limite);
}

/** Prueba de canales desde Ajustes. */
export async function probarCanales() {
  const r = {};
  if (telegramConfigurado()) r.telegram = await enviarTelegram({ texto: 'Prueba de CONTROL: alertas por Telegram activas.', referencia: 'prueba' });
  else r.telegram = { estado: 'sin_configurar' };
  const tel = ajuste('telefono_dueno', '');
  if (tel && whatsappConfigurado()) r.whatsapp = await enviarWhatsapp({ para: tel, texto: 'Prueba de CONTROL: WhatsApp configurado.', referencia: 'prueba' });
  else r.whatsapp = { estado: 'sin_configurar' };
  return r;
}
