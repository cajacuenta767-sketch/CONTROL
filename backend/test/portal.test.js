// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, guardarAjuste } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto, crearPlan } from '../src/servicios/catalogo.js';
import { crearCliente } from '../src/servicios/clientes.js';
import { crearVenta, registrarPago, confirmarPago } from '../src/servicios/ventas.js';

let app, superadmin, vendedor, cliente, licencia, tokenCliente, tokenVendedor, tokenSuper;
const CLAVE = 'ClaveSegura2026';

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'super@test.com', nombre: 'Super', clave: CLAVE, rol: 'superadmin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  const producto = crearProducto({ codigo: 'gym-pro', nombre: 'GYM-PRO' }, superadmin);
  const plan = crearPlan({ producto_id: producto.id, codigo: 'mensual', nombre: 'Mensual', tipo: 'mensual', precio: 50 }, superadmin);
  cliente = crearCliente({ nombre: 'Gym Norte', email: 'gym@norte.test', telefono: '+51 999 888 777' }, vendedor);
  const venta = crearVenta({ cliente_id: cliente.id, plan_id: plan.id }, vendedor);
  const pago = registrarPago(venta.id, { monto: 50, metodo: 'efectivo' }, vendedor);
  licencia = confirmarPago(pago.pagos[0].id, superadmin).licencias[0];
  guardarAjuste('url_publica', 'https://control.test');
  tokenVendedor = (await request(app).post('/api/v1/auth/login').send({ email: 'vende@test.com', clave: CLAVE })).body.token;
  tokenSuper = (await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE })).body.token;
});
after(() => reiniciarDb());

test('acceso al portal con clave + teléfono; datos ajenos rechazados', async () => {
  let r = await request(app).post('/api/v1/portal/acceso').send({ clave: licencia.clave, contacto: 'otro@x.test' });
  assert.equal(r.status, 401);
  r = await request(app).post('/api/v1/portal/acceso').send({ clave: licencia.clave, contacto: '999888777' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  tokenCliente = r.body.token;
  const yo = await request(app).get('/api/v1/portal/yo').set('Authorization', `Bearer ${tokenCliente}`);
  assert.equal(yo.status, 200);
  assert.equal(yo.body.licencias.length, 1);
  assert.equal(yo.body.ventas[0].estado, 'pagada');
  const panel = await request(app).get('/api/v1/clientes').set('Authorization', `Bearer ${tokenCliente}`);
  assert.equal(panel.status, 401, 'el token de cliente no sirve para el panel');
});

test('el cliente descarga su recibo y renueva con enlace de pago', async () => {
  const yo = await request(app).get('/api/v1/portal/yo').set('Authorization', `Bearer ${tokenCliente}`);
  const pdf = await request(app).get(`/api/v1/portal/ventas/${yo.body.ventas[0].id}/recibo.pdf`).set('Authorization', `Bearer ${tokenCliente}`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  const r = await request(app).post(`/api/v1/portal/licencias/${licencia.id}/renovar`).set('Authorization', `Bearer ${tokenCliente}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.url, /\/pagar\/demo\//);
  const r2 = await request(app).post(`/api/v1/portal/licencias/${licencia.id}/renovar`).set('Authorization', `Bearer ${tokenCliente}`);
  assert.equal(r2.body.url, r.body.url, 'reutiliza la renovación pendiente');
});

test('tickets: el cliente abre, el vendedor responde por el panel, el cliente lo ve', async () => {
  let r = await request(app).post('/api/v1/portal/tickets').set('Authorization', `Bearer ${tokenCliente}`).send({ asunto: 'No puedo activar', texto: 'Me dice equipo no autorizado', licencia_id: licencia.id });
  assert.equal(r.status, 201);
  const ticket = r.body;
  assert.equal(ticket.estado, 'abierto');
  const aviso = obtenerDb().prepare("SELECT para FROM correos WHERE asunto LIKE 'Nuevo ticket%'").all().map((c) => c.para);
  assert.ok(aviso.includes('vende@test.com'));
  const lista = await request(app).get('/api/v1/tickets').set('Authorization', `Bearer ${tokenVendedor}`);
  assert.equal(lista.body.length, 1);
  r = await request(app).post(`/api/v1/tickets/${ticket.id}/responder`).set('Authorization', `Bearer ${tokenVendedor}`).send({ texto: 'Te reseteamos el equipo, intenta de nuevo' });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'respondido');
  const visto = await request(app).get(`/api/v1/portal/tickets/${ticket.id}`).set('Authorization', `Bearer ${tokenCliente}`);
  assert.equal(visto.body.mensajes.length, 2);
  r = await request(app).post(`/api/v1/tickets/${ticket.id}/responder`).set('Authorization', `Bearer ${tokenSuper}`).send({ texto: 'Resuelto', cerrar: true });
  assert.equal(r.body.estado, 'cerrado');
  const cerrado = await request(app).post(`/api/v1/portal/tickets/${ticket.id}/responder`).set('Authorization', `Bearer ${tokenCliente}`).send({ texto: 'gracias' });
  assert.equal(cerrado.status, 422);
});

test('búsqueda global, series e historial del cliente', async () => {
  let r = await request(app).get('/api/v1/reportes/buscar?q=Norte').set('Authorization', `Bearer ${tokenVendedor}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.clientes.length, 1);
  assert.equal(r.body.licencias.length, 1);
  r = await request(app).get('/api/v1/reportes/series?meses=3').set('Authorization', `Bearer ${tokenSuper}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.meses.length, 3);
  assert.ok(r.body.por_producto.some((f) => f.serie === 'GYM-PRO' && f.total === 50));
  assert.ok(r.body.por_vendedor.some((f) => f.serie === 'Vendedor'));
  r = await request(app).get(`/api/v1/clientes/${cliente.id}/historial`).set('Authorization', `Bearer ${tokenVendedor}`);
  assert.equal(r.status, 200);
  const tipos = new Set(r.body.map((e) => e.tipo));
  assert.ok(tipos.has('venta') && tipos.has('pago') && tipos.has('ticket'));
  r = await request(app).get('/api/v1/licencias?pagina=1&por_pagina=10').set('Authorization', `Bearer ${tokenSuper}`);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.conteo.activa, 1);
});
