// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, guardarAjuste, hoyLocal } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';

let app;
const CLAVE = 'ClaveSegura2026';
const sesion = {};
const auth = (rol) => ({ Authorization: `Bearer ${sesion[rol]}` });
const ctx = {};

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  crearUsuario({ email: 'super@test.com', nombre: 'Super', clave: CLAVE, rol: 'superadmin' });
  crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor', comision_pct: 20 });
  crearUsuario({ email: 'reven@test.com', nombre: 'Revendedor', clave: CLAVE, rol: 'revendedor', cupo_licencias: 2, descuento_mayorista_pct: 40, marca_nombre: 'TecnoSur' });
  for (const [k, e] of [['super', 'super@test.com'], ['vendedor', 'vende@test.com'], ['reven', 'reven@test.com']]) {
    const r = await request(app).post('/api/v1/auth/login').send({ email: e, clave: CLAVE });
    sesion[k] = r.body.token;
  }
  let r = await request(app).post('/api/v1/productos').set(auth('super')).send({ codigo: 'gym-pro', nombre: 'GYM-PRO' });
  ctx.producto = r.body;
  r = await request(app).post('/api/v1/planes').set(auth('super')).send({ producto_id: ctx.producto.id, codigo: 'anual', nombre: 'Anual', tipo: 'anual', precio: 100 });
  ctx.plan = r.body;
  guardarAjuste('tipos_cambio', JSON.stringify({ USD: 1, PEN: 3.75 }));
  guardarAjuste('url_publica', 'https://control.test');
});
after(() => reiniciarDb());

test('multimoneda: venta en soles con precio de lista en dólares; comisión sobre la base', async () => {
  let r = await request(app).post('/api/v1/clientes').set(auth('vendedor')).send({ nombre: 'Gym Lima', moneda: 'PEN', telefono: '+51 900 000 000', email: 'gym@lima.test' });
  ctx.clientePen = r.body;
  r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: ctx.clientePen.id, plan_id: ctx.plan.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.moneda, 'PEN');
  assert.equal(r.body.tipo_cambio, 3.75);
  assert.equal(r.body.total, 375);
  assert.equal(r.body.total_base, 100);
  ctx.ventaPen = r.body;
  r = await request(app).post(`/api/v1/ventas/${ctx.ventaPen.id}/pagos`).set(auth('vendedor')).send({ monto: 375, metodo: 'yape', referencia: 'Y-1' });
  assert.equal(r.status, 201);
  const pago = r.body.pagos[0];
  assert.equal(pago.monto_base, 100);
  r = await request(app).post(`/api/v1/pagos/${pago.id}/confirmar`).set(auth('super'));
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'pagada');
  assert.equal(r.body.comisiones[0].base, 100);
  assert.equal(r.body.comisiones[0].monto, 20, '20 % de 100 USD, no de 375 PEN');
  ctx.ventaPen = r.body;
});

test('la caja desglosa por moneda y totaliza en moneda base', async () => {
  const r = await request(app).get('/api/v1/caja/dia').set(auth('vendedor'));
  assert.equal(r.status, 200);
  assert.equal(r.body.moneda_base, 'USD');
  assert.equal(r.body.total_cobrado, 100);
  assert.equal(r.body.por_moneda.PEN.yape, 375);
});

test('sin tipo de cambio configurado la venta se rechaza con mensaje claro', async () => {
  const c = await request(app).post('/api/v1/clientes').set(auth('vendedor')).send({ nombre: 'Cliente BOB', moneda: 'BOB' });
  const r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: c.body.id, plan_id: ctx.plan.id });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /tipo de cambio/);
});

test('revendedor con cupo: precio mayorista, confirmación automática, sin comisión y descuenta cupo', async () => {
  let r = await request(app).post('/api/v1/clientes').set(auth('reven')).send({ nombre: 'Gym de mi cliente', moneda: 'USD' });
  const cliente = r.body;
  r = await request(app).post('/api/v1/ventas').set(auth('reven')).send({ cliente_id: cliente.id, plan_id: ctx.plan.id, cantidad: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.descuento_pct, 40);
  assert.equal(r.body.total, 120, '2 × 100 × 0.6');
  assert.equal(r.body.estado, 'pagada', 'cupo prepagado: se confirma sola');
  assert.ok(r.body.licencias.every((l) => l.estado === 'activa'));
  assert.equal(r.body.comisiones.length, 0, 'el revendedor no cobra comisión');
  assert.equal(r.body.marca_nombre, 'TecnoSur');
  const yo = await request(app).get('/api/v1/auth/yo').set(auth('reven'));
  assert.equal(yo.body.usuario.cupo_licencias, 0);
  // Sin cupo, la siguiente venta queda pendiente de pago a precio mayorista.
  r = await request(app).post('/api/v1/ventas').set(auth('reven')).send({ cliente_id: cliente.id, plan_id: ctx.plan.id });
  assert.equal(r.body.estado, 'pendiente');
  assert.equal(r.body.total, 60);
});

test('pasarela demo: enlace de pago público que confirma la venta y activa licencias', async () => {
  let r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: ctx.clientePen.id, plan_id: ctx.plan.id });
  const venta = r.body;
  r = await request(app).post(`/api/v1/ventas/${venta.id}/enlace-pago`).set(auth('vendedor')).send({ proveedor: 'demo' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.url, /^https:\/\/control\.test\/pagar\/demo\/\d+$/);
  const enlace = r.body;
  const info = await request(app).get(`/api/v1/publico/enlaces/${enlace.id}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.monto, 375);
  assert.equal(info.body.estado, 'pendiente');
  r = await request(app).post(`/api/v1/publico/enlaces/${enlace.id}/demo/confirmar`);
  assert.equal(r.status, 200);
  assert.equal(r.body.activadas, 1);
  r = await request(app).post(`/api/v1/publico/enlaces/${enlace.id}/demo/confirmar`);
  assert.equal(r.body.ya_pagado, true, 'idempotente');
  const v = await request(app).get(`/api/v1/ventas/${venta.id}`).set(auth('vendedor'));
  assert.equal(v.body.estado, 'pagada');
  assert.equal(v.body.pagos[0].estado, 'confirmado');
  assert.equal(v.body.pagos[0].confirmado_por, null, 'confirmación automática');
  assert.equal(v.body.comisiones[0].monto, 20);
  r = await request(app).post(`/api/v1/ventas/${venta.id}/enlace-pago`).set(auth('vendedor')).send({ proveedor: 'stripe' });
  assert.equal(r.status, 422, 'stripe no configurado');
});

test('webhook de Stripe: rechaza firma inválida y acepta la correcta', async () => {
  guardarAjuste('stripe_webhook_secreto', 'whsec_prueba');
  const evento = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', metadata: { enlace_id: '999999' } } } });
  let r = await request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1,v1=mala').send(evento);
  assert.equal(r.status, 400);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', 'whsec_prueba').update(`${t}.${evento}`).digest('hex');
  r = await request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${t},v1=${v1}`).send(evento);
  assert.equal(r.status, 404, 'firma válida; el enlace 999999 no existe');
  guardarAjuste('stripe_webhook_secreto', '');
});

test('pedido público desde la web con código de vendedor y enlace de pago', async () => {
  const yo = await request(app).get('/api/v1/auth/yo').set(auth('vendedor'));
  const ref = yo.body.usuario.codigo_ref;
  let r = await request(app).get(`/api/v1/publico/vendedor/${ref}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.nombre, 'Vendedor');
  r = await request(app).get('/api/v1/publico/catalogo');
  assert.equal(r.status, 200);
  assert.equal(r.body.productos[0].planes.length, 1);
  r = await request(app).post('/api/v1/publico/pedidos').send({ plan_id: ctx.plan.id, ref, moneda: 'PEN', pasarela: 'demo', cliente: { nombre: 'Compradora Web', email: 'web@cliente.test', telefono: '+51 911 111 111' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.venta.total, 375);
  assert.ok(r.body.enlace_pago.url);
  const venta = await request(app).get(`/api/v1/ventas/${r.body.venta.id}`).set(auth('super'));
  assert.equal(venta.body.vendedor_nombre, 'Vendedor', 'atribuida al vendedor del código');
  assert.match(venta.body.notas, /web/);
  const estado = await request(app).get(`/api/v1/publico/pedidos/${r.body.venta.numero}?email=web@cliente.test`);
  assert.equal(estado.status, 200);
  assert.equal(estado.body.estado, 'pendiente');
  const ajeno = await request(app).get(`/api/v1/publico/pedidos/${r.body.venta.numero}?email=otro@x.test`);
  assert.equal(ajeno.status, 404);
  // Con API key (DevMarket)
  guardarAjuste('api_key_pedidos', 'clave-devmarket');
  const malo = await request(app).post('/api/v1/publico/pedidos').set('X-Api-Key', 'incorrecta').send({ plan_id: ctx.plan.id, cliente: { nombre: 'X', email: 'x@x.test' } });
  assert.equal(malo.status, 401);
  const bueno = await request(app).post('/api/v1/publico/pedidos').set('X-Api-Key', 'clave-devmarket').send({ plan_id: ctx.plan.id, cliente: { nombre: 'Cliente DevMarket', email: 'dm@x.test' } });
  assert.equal(bueno.status, 201);
});

test('recibos en PDF de venta, pago, liquidación y cierre', async () => {
  let r = await request(app).get(`/api/v1/ventas/${ctx.ventaPen.id}/recibo.pdf`).set(auth('vendedor'));
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/pdf');
  assert.ok(Buffer.from(r.body).subarray(0, 4).toString() === '%PDF');
  r = await request(app).get(`/api/v1/pagos/${ctx.ventaPen.pagos[0].id}/recibo.pdf`).set(auth('vendedor'));
  assert.equal(r.status, 200);
  const hoy = hoyLocal();
  const liq = await request(app).post('/api/v1/liquidaciones').set(auth('super')).send({ vendedor_id: ctx.ventaPen.vendedor_id, desde: hoy, hasta: hoy });
  assert.equal(liq.status, 201);
  r = await request(app).get(`/api/v1/liquidaciones/${liq.body.id}/recibo.pdf`).set(auth('super'));
  assert.equal(r.status, 200);
  const cierre = await request(app).post('/api/v1/caja/cerrar').set(auth('vendedor')).send({});
  assert.equal(cierre.status, 201);
  assert.equal(cierre.body.por_moneda.PEN.yape, 375);
  assert.equal(cierre.body.por_moneda.PEN.otro, 375, 'el cobro por enlace demo entra como "otro"');
  r = await request(app).get(`/api/v1/caja/${cierre.body.id}/cierre.pdf`).set(auth('vendedor'));
  assert.equal(r.status, 200);
});

test('comprobante como archivo: se sube, se descarga y se valida el tipo', async () => {
  const pagoId = ctx.ventaPen.pagos[0].id;
  let r = await request(app).post(`/api/v1/pagos/${pagoId}/comprobante`).set(auth('vendedor')).attach('archivo', Buffer.from('hola'), { filename: 'nota.txt', contentType: 'text/plain' });
  assert.equal(r.status, 422);
  r = await request(app).post(`/api/v1/pagos/${pagoId}/comprobante`).set(auth('vendedor')).attach('archivo', Buffer.from('%PDF-1.4 comprobante'), { filename: 'yape.pdf', contentType: 'application/pdf' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.pagos[0].comprobante_archivo);
  r = await request(app).get(`/api/v1/pagos/${pagoId}/comprobante`).set(auth('vendedor'));
  assert.equal(r.status, 200);
  assert.match(String(r.headers['content-type']), /pdf/);
});

test('meta mensual: cumplida la meta, los cobros siguientes llevan el bono', async () => {
  const mes = hoyLocal().slice(0, 7);
  let r = await request(app).post('/api/v1/usuarios/metas').set(auth('super')).send({ usuario_id: ctx.ventaPen.vendedor_id, mes, objetivo_monto: 150, bono_pct: 5 });
  assert.equal(r.status, 201);
  const resumen = await request(app).get('/api/v1/reportes/resumen').set(auth('vendedor'));
  assert.ok(resumen.body.meta);
  assert.equal(resumen.body.meta.cumplida, true, 'ya vendió 200 USD pagados este mes');
  assert.match(resumen.body.enlace_venta, /\/comprar\?ref=/);
  r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: ctx.clientePen.id, plan_id: ctx.plan.id });
  const venta = r.body;
  r = await request(app).post(`/api/v1/ventas/${venta.id}/pagos`).set(auth('vendedor')).send({ monto: 375, metodo: 'efectivo' });
  r = await request(app).post(`/api/v1/pagos/${r.body.pagos[0].id}/confirmar`).set(auth('super'));
  assert.equal(r.body.comisiones[0].pct, 25, '20 % + 5 % de bono');
  assert.equal(r.body.comisiones[0].monto, 25);
});
