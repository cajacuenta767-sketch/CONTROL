import { createHmac, timingSafeEqual } from 'node:crypto';
import { obtenerDb, transaccion, ajuste, ahoraSql } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { auditar } from './auditoria.js';
import { obtenerVenta, procesarPagoConfirmado } from './ventas.js';

const redondear = (n) => Math.round(n * 100) / 100;
const urlPublica = () => ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '');
const SIN_DECIMALES = new Set(['JPY', 'CLP', 'KRW', 'VND', 'PYG', 'XAF', 'XOF']);

/** Proveedores disponibles según la configuración. */
export function proveedoresDisponibles() {
  return {
    demo: ajuste('pasarela_demo', '1') === '1',
    stripe: Boolean(ajuste('stripe_clave_secreta', '')),
    paypal: Boolean(ajuste('paypal_cliente', '') && ajuste('paypal_secreto', '')),
  };
}

/* ---------- Stripe (API REST directa, sin SDK) ---------- */

async function stripeCrearSesion(enlace, venta) {
  const clave = ajuste('stripe_clave_secreta');
  const menor = SIN_DECIMALES.has(venta.moneda) ? Math.round(enlace.monto) : Math.round(enlace.monto * 100);
  const cuerpo = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': venta.moneda.toLowerCase(),
    'line_items[0][price_data][product_data][name]': `${venta.producto_nombre} · ${venta.plan_nombre} (${venta.numero})`,
    'line_items[0][price_data][unit_amount]': String(menor),
    'line_items[0][quantity]': '1',
    success_url: `${urlPublica()}/pago-exitoso?enlace=${enlace.id}`,
    cancel_url: `${urlPublica()}/pago-cancelado?enlace=${enlace.id}`,
    client_reference_id: String(enlace.id),
    'metadata[enlace_id]': String(enlace.id),
    'metadata[venta]': venta.numero,
  });
  if (venta.cliente_email) cuerpo.set('customer_email', venta.cliente_email);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo,
  });
  const d = await r.json();
  if (!r.ok) throw new ErrorHttp(502, `Stripe: ${d.error?.message || 'error al crear la sesión'}`);
  return { id_externo: d.id, url: d.url };
}

/** Verifica la firma `Stripe-Signature` (t=…,v1=…) sobre el cuerpo crudo. */
export function verificarFirmaStripe(cabecera, cuerpoCrudo, secreto = ajuste('stripe_webhook_secreto', '')) {
  if (!secreto || !cabecera) return false;
  const partes = Object.fromEntries(String(cabecera).split(',').map((p) => p.split('=')));
  const t = partes.t;
  const v1 = partes.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const esperado = createHmac('sha256', secreto).update(`${t}.${cuerpoCrudo}`).digest('hex');
  return esperado.length === v1.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
}

export function webhookStripe(evento) {
  if (evento?.type !== 'checkout.session.completed') return { ignorado: true };
  const sesion = evento.data?.object || {};
  const enlaceId = Number(sesion.metadata?.enlace_id || sesion.client_reference_id);
  if (!enlaceId) return { ignorado: true };
  return confirmarEnlace(enlaceId, { id_externo: sesion.id, detalle: { payment_intent: sesion.payment_intent, email: sesion.customer_details?.email } });
}

/* ---------- PayPal (Orders v2) ---------- */

const paypalBase = () => (ajuste('paypal_sandbox', '1') === '1' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');

async function paypalToken() {
  const cred = Buffer.from(`${ajuste('paypal_cliente')}:${ajuste('paypal_secreto')}`).toString('base64');
  const r = await fetch(`${paypalBase()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const d = await r.json();
  if (!r.ok) throw new ErrorHttp(502, `PayPal: ${d.error_description || 'no se pudo autenticar'}`);
  return d.access_token;
}

async function paypalCrearOrden(enlace, venta) {
  const token = await paypalToken();
  const r = await fetch(`${paypalBase()}/v2/checkout/orders`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: String(enlace.id), description: `${venta.producto_nombre} · ${venta.plan_nombre} (${venta.numero})`.slice(0, 127), amount: { currency_code: venta.moneda, value: enlace.monto.toFixed(2) } }],
      application_context: { brand_name: ajuste('nombre_agencia', 'CONTROL').slice(0, 127), user_action: 'PAY_NOW', return_url: `${urlPublica()}/api/v1/publico/paypal/retorno?enlace=${enlace.id}`, cancel_url: `${urlPublica()}/pago-cancelado?enlace=${enlace.id}` },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new ErrorHttp(502, `PayPal: ${d.message || 'error al crear la orden'}`);
  const aprobar = (d.links || []).find((l) => l.rel === 'approve')?.href;
  if (!aprobar) throw new ErrorHttp(502, 'PayPal no devolvió enlace de aprobación');
  return { id_externo: d.id, url: aprobar };
}

/** Al volver de PayPal se captura la orden; si queda COMPLETED se confirma el pago. */
export async function paypalCapturar(enlaceId, ordenId) {
  const enlace = obtenerDb().prepare('SELECT * FROM enlaces_pago WHERE id = ?').get(enlaceId);
  if (!enlace || enlace.proveedor !== 'paypal' || enlace.id_externo !== ordenId) throw noEncontrado('Enlace de pago no encontrado');
  if (enlace.estado === 'pagado') return { ya_pagado: true };
  const token = await paypalToken();
  const r = await fetch(`${paypalBase()}/v2/checkout/orders/${ordenId}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const d = await r.json();
  if (!r.ok || d.status !== 'COMPLETED') throw new ErrorHttp(502, `PayPal: captura no completada (${d.status || d.message || r.status})`);
  return confirmarEnlace(enlaceId, { id_externo: ordenId, detalle: { captura: d.purchase_units?.[0]?.payments?.captures?.[0]?.id } });
}

/* ---------- Enlaces ---------- */

/** Crea un enlace de pago por el saldo pendiente de la venta. */
export async function crearEnlace(ventaId, proveedor, actor) {
  const venta = obtenerVenta(ventaId, actor);
  if (venta.estado !== 'pendiente') throw new ErrorHttp(422, 'La venta no tiene saldo pendiente');
  const monto = redondear(venta.saldo - venta.por_confirmar);
  if (monto <= 0) throw new ErrorHttp(422, 'No hay saldo pendiente de cobrar (hay cobros esperando confirmación)');
  const disponibles = proveedoresDisponibles();
  if (!disponibles[proveedor]) throw new ErrorHttp(422, `La pasarela ${proveedor} no está configurada en Ajustes`);
  const db = obtenerDb();
  db.prepare("UPDATE enlaces_pago SET estado = 'cancelado' WHERE venta_id = ? AND estado = 'pendiente'").run(ventaId);
  const r = db.prepare('INSERT INTO enlaces_pago (venta_id, proveedor, url, monto, moneda, creado_por) VALUES (?, ?, ?, ?, ?, ?)').run(ventaId, proveedor, '', monto, venta.moneda, actor?.id ?? null);
  const enlace = { id: Number(r.lastInsertRowid), monto };
  let externo;
  try {
    if (proveedor === 'stripe') externo = await stripeCrearSesion(enlace, venta);
    else if (proveedor === 'paypal') externo = await paypalCrearOrden(enlace, venta);
    else externo = { id_externo: `demo-${enlace.id}`, url: `${urlPublica()}/pagar/demo/${enlace.id}` };
  } catch (e) {
    db.prepare("UPDATE enlaces_pago SET estado = 'cancelado', datos = ? WHERE id = ?").run(JSON.stringify({ error: e.message }), enlace.id);
    throw e;
  }
  db.prepare('UPDATE enlaces_pago SET id_externo = ?, url = ? WHERE id = ?').run(externo.id_externo, externo.url, enlace.id);
  auditar({ usuarioId: actor?.id ?? null, accion: 'enlace_pago.crear', entidad: 'venta', entidadId: ventaId, detalle: { proveedor, monto, moneda: venta.moneda } });
  return db.prepare('SELECT id, venta_id, proveedor, url, monto, moneda, estado, creado_en FROM enlaces_pago WHERE id = ?').get(enlace.id);
}

export function obtenerEnlacePublico(id) {
  const e = obtenerDb()
    .prepare(`SELECT e.id, e.proveedor, e.monto, e.moneda, e.estado, e.creado_en, v.numero AS venta_numero, pr.nombre AS producto_nombre, pl.nombre AS plan_nombre, c.nombre AS cliente_nombre
      FROM enlaces_pago e JOIN ventas v ON v.id = e.venta_id JOIN productos pr ON pr.id = v.producto_id JOIN planes pl ON pl.id = v.plan_id JOIN clientes c ON c.id = v.cliente_id WHERE e.id = ?`)
    .get(id);
  if (!e) throw noEncontrado('Enlace de pago no encontrado');
  return { ...e, agencia: ajuste('nombre_agencia', 'CONTROL') };
}

/** Confirma el cobro de un enlace: crea el pago confirmado y activa licencias. Idempotente. */
export function confirmarEnlace(enlaceId, { id_externo, detalle } = {}) {
  return transaccion((db) => {
    const e = db.prepare('SELECT * FROM enlaces_pago WHERE id = ?').get(enlaceId);
    if (!e) throw noEncontrado('Enlace de pago no encontrado');
    if (e.estado === 'pagado') return { ya_pagado: true, venta_id: e.venta_id };
    if (e.estado !== 'pendiente') throw new ErrorHttp(422, 'El enlace ya no está vigente');
    const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(e.venta_id);
    db.prepare("UPDATE enlaces_pago SET estado = 'pagado', pagado_en = ?, id_externo = COALESCE(?, id_externo), datos = ? WHERE id = ?")
      .run(ahoraSql(), id_externo ?? null, detalle ? JSON.stringify(detalle) : null, e.id);
    const metodo = e.proveedor === 'stripe' ? 'stripe' : e.proveedor === 'paypal' ? 'paypal' : 'otro';
    const pago = db
      .prepare('INSERT INTO pagos (venta_id, monto, monto_base, metodo, referencia, registrado_por, enlace_pago_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.venta_id, e.monto, redondear(e.monto / (venta.tipo_cambio || 1)), metodo, id_externo ?? e.id_externo ?? `enlace-${e.id}`, venta.vendedor_id, e.id);
    const { activadas } = procesarPagoConfirmado(db, Number(pago.lastInsertRowid), null);
    return { ok: true, venta_id: e.venta_id, activadas };
  });
}

/** Pasarela de demostración: confirma sin cobrar. Solo si está habilitada. */
export function confirmarDemo(enlaceId) {
  if (ajuste('pasarela_demo', '1') !== '1') throw new ErrorHttp(403, 'La pasarela de demostración está desactivada');
  const e = obtenerDb().prepare('SELECT proveedor FROM enlaces_pago WHERE id = ?').get(enlaceId);
  if (!e || e.proveedor !== 'demo') throw noEncontrado('Enlace de pago no encontrado');
  return confirmarEnlace(enlaceId, { id_externo: `demo-${enlaceId}-${Date.now()}`, detalle: { simulado: true } });
}
