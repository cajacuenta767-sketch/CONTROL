// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, guardarAjuste } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto, crearPlan } from '../src/servicios/catalogo.js';
import { crearCliente } from '../src/servicios/clientes.js';
import { crearVenta, registrarPago, confirmarPago, obtenerVenta } from '../src/servicios/ventas.js';
import { cuotasVencidas, recordatoriosCobro } from '../src/servicios/tareas.js';
import { alertarDueno, enviarWhatsapp } from '../src/servicios/mensajeria.js';

let app, superadmin, vendedor, cliente, vitalicio, mensual, tokenV;
const CLAVE = 'ClaveSegura2026';
const fetchReal = globalThis.fetch;

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'dueno@test.com', nombre: 'Dueño', clave: CLAVE, rol: 'superadmin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor', comision_pct: 20 });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  const p = crearProducto({ codigo: 'dental-pro', nombre: 'DENTAL-PRO' }, superadmin);
  vitalicio = crearPlan({ producto_id: p.id, codigo: 'vitalicio', nombre: 'Vitalicio', tipo: 'vitalicio', precio: 790, cuotas: 3 }, superadmin);
  mensual = crearPlan({ producto_id: p.id, codigo: 'mensual', nombre: 'Mensual', tipo: 'mensual', precio: 39 }, superadmin);
  cliente = crearCliente({ nombre: 'Clínica Sonrisa', email: 'c@test.com', telefono: '+51 999 111 222' }, vendedor);
  tokenV = (await request(app).post('/api/v1/auth/login').send({ email: 'vende@test.com', clave: CLAVE })).body.token;
  guardarAjuste('url_publica', 'https://control.test');
});
after(() => { reiniciarDb(); globalThis.fetch = fetchReal; });

test('cuotas: 790 en 3 cuotas, la licencia se activa con la primera y la venta queda pendiente', () => {
  const v = crearVenta({ cliente_id: cliente.id, plan_id: vitalicio.id, cuotas: 3 }, vendedor);
  assert.equal(v.cuotas, 3);
  assert.equal(v.cuotas_detalle.length, 3);
  assert.equal(v.cuotas_detalle.map((c) => c.monto).reduce((a, b) => a + b, 0), 790);
  const pago = registrarPago(v.id, { monto: v.cuotas_detalle[0].monto, metodo: 'yape' }, vendedor);
  const tras = confirmarPago(pago.pagos[0].id, superadmin);
  assert.equal(tras.estado, 'pendiente', 'sigue pendiente hasta la última cuota');
  assert.equal(tras.licencias[0].estado, 'activa', 'activa con la primera cuota');
  assert.equal(tras.cuotas_detalle[0].estado, 'pagada');
  assert.equal(tras.cuotas_detalle[1].estado, 'pendiente');
  const com = obtenerDb().prepare('SELECT SUM(monto) AS s FROM comisiones WHERE venta_id = ?').get(v.id).s;
  assert.ok(com > 0, 'la comisión se devenga por cada cuota cobrada');
});

test('cuota vencida: pasada la gracia se suspende la licencia y se reactiva al pagar', async () => {
  const v = obtenerDb().prepare("SELECT id FROM ventas WHERE cuotas = 3 ORDER BY id DESC LIMIT 1").get();
  obtenerDb().prepare("UPDATE cuotas SET vence_en = datetime('now', '-10 days') WHERE venta_id = ? AND numero = 2").run(v.id);
  const r = await cuotasVencidas();
  assert.equal(r.cuotas_vencidas, 1);
  let venta = obtenerVenta(v.id);
  assert.equal(venta.licencias[0].estado, 'suspendida');
  assert.match(venta.licencias[0].motivo_estado, /Cuota 2/);
  const wa = obtenerDb().prepare("SELECT * FROM mensajes WHERE canal = 'whatsapp' AND referencia LIKE 'cuota_vencida:%'").get();
  assert.ok(wa, 'se registró el WhatsApp al cliente');
  assert.equal(wa.estado, 'sin_configurar');
  const pago = registrarPago(v.id, { monto: venta.cuotas_detalle[1].monto, metodo: 'yape' }, vendedor);
  venta = confirmarPago(pago.pagos.find((p) => p.estado === 'pendiente').id, superadmin);
  assert.equal(venta.cuotas_detalle[1].estado, 'pagada');
  assert.equal(venta.licencias[0].estado, 'activa', 'se reanuda al pagar la cuota vencida');
});

test('no se pueden pedir más cuotas de las que admite el plan', async () => {
  const r = await request(app).post('/api/v1/ventas').set('Authorization', `Bearer ${tokenV}`).send({ cliente_id: cliente.id, plan_id: mensual.id, cuotas: 3 });
  assert.equal(r.status, 422);
});

test('recordatorio de cobro por WhatsApp a los N días, una sola vez', async () => {
  guardarAjuste('recordatorio_cobro_dias', '3');
  const v = crearVenta({ cliente_id: cliente.id, plan_id: mensual.id }, vendedor);
  obtenerDb().prepare("UPDATE ventas SET creado_en = datetime('now', '-4 days') WHERE id = ?").run(v.id);
  let r = await recordatoriosCobro();
  assert.equal(r.recordatorios_cobro, 1);
  const m = obtenerDb().prepare("SELECT * FROM mensajes WHERE referencia = ?").get(`cobro:${v.id}`);
  assert.ok(m.texto.includes('Clínica Sonrisa'));
  assert.equal(m.para, '51999111222');
  r = await recordatoriosCobro();
  assert.equal(r.recordatorios_cobro, 0, 'no repite');
});

test('alerta al dueño: registrar un pago avisa por Telegram si está configurado (fetch simulado) y no se repite', async () => {
  guardarAjuste('telegram_token', '123:abc'); guardarAjuste('telegram_chat_id', '999');
  const llamadas = [];
  globalThis.fetch = async (url, opts) => { llamadas.push({ url: String(url), body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) }; };
  const r1 = await alertarDueno('pago_por_confirmar', 'Prueba', { referencia: 'x1', url: '/ventas/1' });
  assert.equal(r1.telegram, 'enviado');
  assert.match(llamadas[0].url, /api\.telegram\.org\/bot123:abc\/sendMessage/);
  assert.match(llamadas[0].body.text, /control\.test\/ventas\/1/);
  const r2 = await alertarDueno('pago_por_confirmar', 'Prueba', { referencia: 'x1' });
  assert.equal(r2.repetida, true);
  guardarAjuste('alertas_dueno', 'ticket_nuevo');
  const r3 = await alertarDueno('pago_por_confirmar', 'Prueba', { referencia: 'x2' });
  assert.equal(r3.omitida, true, 'respeta la lista de alertas activas');
  guardarAjuste('telegram_token', ''); guardarAjuste('telegram_chat_id', '');
  globalThis.fetch = fetchReal;
});

test('WhatsApp Cloud API: con token envía plantilla con variables (fetch simulado)', async () => {
  guardarAjuste('whatsapp_token', 'tok'); guardarAjuste('whatsapp_telefono_id', '555');
  let enviado;
  globalThis.fetch = async (url, opts) => { enviado = { url: String(url), body: JSON.parse(opts.body), auth: opts.headers.Authorization }; return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; };
  const r = await enviarWhatsapp({ para: '+51 999 111 222', texto: 'hola', plantilla: 'cobro_pendiente', variables: ['Ana', '39 USD'] });
  assert.equal(r.estado, 'enviado');
  assert.match(enviado.url, /graph\.facebook\.com\/v20\.0\/555\/messages/);
  assert.equal(enviado.auth, 'Bearer tok');
  assert.equal(enviado.body.type, 'template');
  assert.equal(enviado.body.template.components[0].parameters[1].text, '39 USD');
  const fila = obtenerDb().prepare("SELECT * FROM mensajes WHERE id_externo = 'wamid.1'").get();
  assert.equal(fila.estado, 'enviado');
  guardarAjuste('whatsapp_token', ''); guardarAjuste('whatsapp_telefono_id', '');
  globalThis.fetch = fetchReal;
});

test('Culqi: enlace con orden, cargo con token y webhook verificado por re-consulta (fetch simulado)', async () => {
  guardarAjuste('culqi_clave_publica', 'pk_test_x'); guardarAjuste('culqi_clave_secreta', 'sk_test_y');
  const v = crearVenta({ cliente_id: cliente.id, plan_id: mensual.id, moneda: 'USD' }, vendedor);
  const peticiones = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); peticiones.push({ u, m: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.endsWith('/orders') && opts.method === 'POST') return { ok: true, json: async () => ({ id: 'ord_1', state: 'created' }) };
    if (u.includes('/orders/ord_1')) return { ok: true, json: async () => ({ id: 'ord_1', state: 'paid', order_number: 'enlace-' + enlaceId, metadata: { enlace_id: String(enlaceId) } }) };
    if (u.endsWith('/charges') && opts.method === 'POST') return { ok: true, json: async () => ({ id: 'chr_1', outcome: { type: 'venta_exitosa' }, source: { card_number: '411111******1111', iin: { card_brand: 'Visa' } } }) };
    if (u.includes('/charges/chr_falso')) return { ok: false, json: async () => ({}) };
    return { ok: false, json: async () => ({}) };
  };
  const tokenS = (await request(app).post('/api/v1/auth/login').send({ email: 'dueno@test.com', clave: CLAVE })).body.token;
  let r = await request(app).get('/api/v1/ventas/pasarelas').set('Authorization', `Bearer ${tokenS}`);
  assert.equal(r.body.culqi, true);
  r = await request(app).post(`/api/v1/ventas/${v.id}/enlace-pago`).set('Authorization', `Bearer ${tokenS}`).send({ proveedor: 'culqi' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const enlaceId = r.body.id;
  assert.equal(r.body.url, `https://control.test/pagar/culqi/${enlaceId}`);
  assert.equal(peticiones[0].body.amount, 3900);
  assert.equal(peticiones[0].body.order_number, `enlace-${enlaceId}`);
  // datos para el checkout en el navegador (público)
  r = await request(app).get(`/api/v1/publico/enlaces/${enlaceId}/culqi`);
  assert.equal(r.body.clave_publica, 'pk_test_x'); assert.equal(r.body.monto_centimos, 3900); assert.equal(r.body.orden_id, 'ord_1');
  // webhook con id falso no confirma nada
  r = await request(app).post('/api/v1/webhooks/culqi').set('Content-Type', 'application/json').send({ type: 'charge.creation.succeeded', data: { id: 'chr_falso', object: 'charge' } });
  assert.equal(r.body.ignorado, true);
  assert.equal(obtenerVenta(v.id).estado, 'pendiente');
  // webhook de orden pagada (Yape): se re-consulta y se confirma
  r = await request(app).post('/api/v1/webhooks/culqi').set('Content-Type', 'application/json').send({ type: 'order.status.changed', data: JSON.stringify({ id: 'ord_1', object: 'order', state: 'paid' }) });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const venta = obtenerVenta(v.id);
  assert.equal(venta.estado, 'pagada');
  assert.equal(venta.pagos[0].metodo, 'yape');
  // el mismo webhook otra vez es idempotente
  r = await request(app).post('/api/v1/webhooks/culqi').set('Content-Type', 'application/json').send({ type: 'order.status.changed', data: { id: 'ord_1', object: 'order' } });
  assert.equal(r.body.ya_pagado, true);
  // cargo con token de tarjeta en otro enlace
  const v2 = crearVenta({ cliente_id: cliente.id, plan_id: mensual.id, moneda: 'USD' }, vendedor);
  r = await request(app).post(`/api/v1/ventas/${v2.id}/enlace-pago`).set('Authorization', `Bearer ${tokenS}`).send({ proveedor: 'culqi' });
  r = await request(app).post(`/api/v1/publico/enlaces/${r.body.id}/culqi/cargo`).send({ token_id: 'tkn_test_123', email: 'c@test.com' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(obtenerVenta(v2.id).pagos[0].metodo, 'tarjeta');
  guardarAjuste('culqi_clave_publica', ''); guardarAjuste('culqi_clave_secreta', '');
  globalThis.fetch = fetchReal;
});
