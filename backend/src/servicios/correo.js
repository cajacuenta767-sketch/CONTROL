import nodemailer from 'nodemailer';
import { obtenerDb, ajuste, ahoraSql } from '../db.js';

let transporte = null;
let configuracionVista = '';

function obtenerTransporte() {
  const host = ajuste('smtp_host', '');
  if (!host) return null;
  const firma = [host, ajuste('smtp_puerto'), ajuste('smtp_usuario'), ajuste('smtp_clave')].join('|');
  if (!transporte || firma !== configuracionVista) {
    const puerto = Number(ajuste('smtp_puerto', '587'));
    transporte = nodemailer.createTransport({
      host, port: puerto, secure: puerto === 465,
      auth: ajuste('smtp_usuario') ? { user: ajuste('smtp_usuario'), pass: ajuste('smtp_clave') } : undefined,
    });
    configuracionVista = firma;
  }
  return transporte;
}

/** Plantilla base de correo con el nombre de la agencia. */
export function plantilla(titulo, cuerpoHtml, { boton, url } = {}) {
  const agencia = ajuste('nombre_agencia', 'CONTROL');
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6f9;font-family:Inter,system-ui,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
    <div style="background:#0f172a;color:#fff;padding:18px 24px;font-weight:700;letter-spacing:.08em">${agencia}</div>
    <div style="padding:24px"><h2 style="margin:0 0 12px;font-size:20px">${titulo}</h2><div style="line-height:1.55;font-size:15px">${cuerpoHtml}</div>
    ${boton && url ? `<p style="margin:22px 0 6px"><a href="${url}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block;font-weight:600">${boton}</a></p><p style="font-size:12px;color:#6b7280">Si el botón no funciona, copia este enlace: ${url}</p>` : ''}
    </div><div style="padding:12px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">Mensaje automático de ${agencia}.</div></div></body></html>`;
}

/**
 * Envía un correo. Siempre deja registro en la tabla `correos`. Sin SMTP configurado,
 * el correo queda con estado `sin_smtp` y visible en el panel (útil en desarrollo).
 */
export async function enviarCorreo({ para, asunto, html }) {
  const db = obtenerDb();
  const id = Number(db.prepare('INSERT INTO correos (para, asunto, html) VALUES (?, ?, ?)').run(para, asunto, html).lastInsertRowid);
  const t = obtenerTransporte();
  if (!t) {
    db.prepare("UPDATE correos SET estado = 'sin_smtp' WHERE id = ?").run(id);
    if (process.env.NODE_ENV !== 'test') console.log(`[correo sin SMTP] para=${para} asunto="${asunto}"`);
    return { id, enviado: false };
  }
  try {
    await t.sendMail({ from: ajuste('smtp_desde') || ajuste('smtp_usuario'), to: para, subject: asunto, html });
    db.prepare("UPDATE correos SET estado = 'enviado', enviado_en = ? WHERE id = ?").run(ahoraSql(), id);
    return { id, enviado: true };
  } catch (e) {
    db.prepare("UPDATE correos SET estado = 'error', error = ? WHERE id = ?").run(String(e.message || e).slice(0, 500), id);
    return { id, enviado: false, error: e.message };
  }
}

export function listarCorreos({ pagina = 1, porPagina = 50 } = {}) {
  const db = obtenerDb();
  const total = db.prepare('SELECT COUNT(*) AS c FROM correos').get().c;
  const filas = db.prepare('SELECT id, para, asunto, estado, error, creado_en, enviado_en FROM correos ORDER BY id DESC LIMIT ? OFFSET ?').all(porPagina, (pagina - 1) * porPagina);
  return { filas, total, pagina, porPagina };
}

export function obtenerCorreo(id) {
  return obtenerDb().prepare('SELECT * FROM correos WHERE id = ?').get(id);
}

/** Prueba la configuración SMTP enviando un correo al destinatario. */
export async function probarSmtp(para) {
  const t = obtenerTransporte();
  if (!t) return { ok: false, error: 'SMTP no configurado' };
  try {
    await t.verify();
    const r = await enviarCorreo({ para, asunto: 'Prueba de correo de CONTROL', html: plantilla('Correo de prueba', 'Si lees esto, el envío de correos está configurado correctamente.') });
    return { ok: r.enviado, error: r.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
