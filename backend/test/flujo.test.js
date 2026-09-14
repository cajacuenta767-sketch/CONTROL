// Se ejecuta con BASE_DATOS=:memory: (ver package.json).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, hoyLocal } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { verificarToken } from '../src/firmas.js';

let app;
const sesion = {};
const auth = (rol) => ({ Authorization: `Bearer ${sesion[rol]}` });

async function login(email) {
  const r = await request(app).post('/api/v1/auth/login').send({ email, clave: 'Clave12345' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

before(async () => {
  reiniciarDb();
  obtenerDb();
  app = crearApp();
  const superadmin = crearUsuario({ email: 'super@test.com', nombre: 'Super', clave: 'Clave12345', rol: 'superadmin' });
  crearUsuario({ email: 'admin@test.com', nombre: 'Admin', clave: 'Clave12345', rol: 'admin', tope_emisiones_dia: 3 }, superadmin);
  crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: 'Clave12345', rol: 'vendedor', comision_pct: 20, tope_emisiones_dia: 5, tope_demos_semana: 1 }, superadmin);
  crearUsuario({ email: 'otro@test.com', nombre: 'Otro vendedor', clave: 'Clave12345', rol: 'vendedor' }, superadmin);
  sesion.superadmin = await login('super@test.com');
  sesion.admin = await login('admin@test.com');
  sesion.vendedor = await login('vende@test.com');
  sesion.otro = await login('otro@test.com');
});

after(() => reiniciarDb());

const ctx = {};

test('login rechaza contraseña incorrecta', async () => {
  const r = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: 'mala' });
  assert.equal(r.status, 401);
});

test('solo el superadmin crea productos y planes', async () => {
  let r = await request(app).post('/api/v1/productos').set(auth('admin')).send({ codigo: 'dental-pro', nombre: 'Dental' });
  assert.equal(r.status, 403);
  r = await request(app).post('/api/v1/productos').set(auth('superadmin')).send({ codigo: 'dental-pro', nombre: 'DENTAL-PRO' });
  assert.equal(r.status, 201);
  ctx.producto = r.body;
  const planes = [
    { codigo: 'vitalicio', nombre: 'Vitalicio', tipo: 'vitalicio', precio: 1000 },
    { codigo: 'mensual', nombre: 'Mensual', tipo: 'mensual', precio: 50 },
    { codigo: 'demo', nombre: 'Demo', tipo: 'demo', precio: 0, duracion_dias: 7 },
    { codigo: 'sucursal', nombre: 'Sucursal extra', tipo: 'sucursal_extra', precio: 300 },
  ];
  for (const p of planes) {
    r = await request(app).post('/api/v1/planes').set(auth('superadmin')).send({ producto_id: ctx.producto.id, ...p });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ctx[`plan_${p.codigo}`] = r.body;
  }
});

test('el vendedor crea su cliente y otro vendedor no lo ve', async () => {
  let r = await request(app).post('/api/v1/clientes').set(auth('vendedor')).send({ nombre: 'Clínica Sonrisa', empresa: 'Sonrisa SAC', pais: 'PE' });
  assert.equal(r.status, 201);
  ctx.cliente = r.body;
  r = await request(app).get(`/api/v1/clientes/${ctx.cliente.id}`).set(auth('otro'));
  assert.equal(r.status, 403);
  r = await request(app).get('/api/v1/clientes').set(auth('otro'));
  assert.equal(r.body.length, 0);
  r = await request(app).get('/api/v1/clientes').set(auth('admin'));
  assert.equal(r.body.length, 1);
});

test('una venta de 2 sucursales crea 2 licencias pendientes de pago', async () => {
  const r = await request(app).post('/api/v1/ventas').set(auth('vendedor'))
    .send({ cliente_id: ctx.cliente.id, plan_id: ctx.plan_vitalicio.id, cantidad: 2, etiquetas: ['Sede Centro', 'Sede Norte'], descuento_pct: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  ctx.venta = r.body;
  assert.equal(r.body.total, 1800); // 1000 × 2 × 0.9
  assert.equal(r.body.estado, 'pendiente');
  assert.equal(r.body.licencias.length, 2);
  assert.ok(r.body.licencias.every((l) => l.estado === 'pendiente_pago'));
  assert.equal(r.body.licencias[0].etiqueta, 'Sede Centro');
  assert.match(r.body.licencias[0].clave, /^CTL-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test('el descuento por encima del tope se rechaza para vendedores', async () => {
  const r = await request(app).post('/api/v1/ventas').set(auth('vendedor'))
    .send({ cliente_id: ctx.cliente.id, plan_id: ctx.plan_mensual.id, descuento_pct: 25 });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /descuento máximo/);
});

test('una licencia pendiente de pago no se puede activar', async () => {
  const r = await request(app).post('/api/v1/licencias/activar')
    .send({ clave: ctx.venta.licencias[0].clave, producto: 'dental-pro', huella: 'equipo-A' });
  assert.equal(r.status, 403);
  assert.equal(r.body.codigo, 'pendiente_pago');
});

test('el vendedor registra un pago; solo un gestor lo confirma', async () => {
  let r = await request(app).post(`/api/v1/ventas/${ctx.venta.id}/pagos`).set(auth('vendedor'))
    .send({ monto: 800, metodo: 'efectivo' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  ctx.pago1 = r.body.pagos[0];
  assert.equal(ctx.pago1.estado, 'pendiente');

  r = await request(app).post(`/api/v1/pagos/${ctx.pago1.id}/confirmar`).set(auth('vendedor'));
  assert.equal(r.status, 403);

  r = await request(app).post(`/api/v1/pagos/${ctx.pago1.id}/confirmar`).set(auth('admin'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.estado, 'pendiente', 'pago parcial: la venta sigue pendiente');
  assert.equal(r.body.comisiones.length, 1);
  assert.equal(r.body.comisiones[0].monto, 160); // 20 % de 800
  assert.ok(r.body.licencias.every((l) => l.estado === 'pendiente_pago'));
});

test('no se puede registrar más de lo que falta', async () => {
  const r = await request(app).post(`/api/v1/ventas/${ctx.venta.id}/pagos`).set(auth('vendedor'))
    .send({ monto: 1500, metodo: 'transferencia' });
  assert.equal(r.status, 422);
});

test('al completar el pago la venta queda pagada, las licencias activas y la comisión total es 20 %', async () => {
  let r = await request(app).post(`/api/v1/ventas/${ctx.venta.id}/pagos`).set(auth('vendedor'))
    .send({ monto: 1000, metodo: 'transferencia', referencia: 'OP-1' });
  assert.equal(r.status, 201);
  const pago2 = r.body.pagos.find((p) => p.estado === 'pendiente');
  r = await request(app).post(`/api/v1/pagos/${pago2.id}/confirmar`).set(auth('superadmin'));
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'pagada');
  assert.equal(r.body.saldo, 0);
  assert.ok(r.body.licencias.every((l) => l.estado === 'activa' && l.vence_en === null && l.soporte_hasta));
  const comision = r.body.comisiones.reduce((s, c) => s + c.monto, 0);
  assert.equal(comision, 360); // 20 % de 1800
  ctx.venta = r.body;
});

test('activación: primera huella entra, la segunda se rechaza, la misma huella repite', async () => {
  const clave = ctx.venta.licencias[0].clave;
  let r = await request(app).post('/api/v1/licencias/activar').send({ clave, producto: 'dental-pro', huella: 'equipo-A', nombre_equipo: 'PC Recepción', version: '1.2.0' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.licencia.estado, 'activa');
  ctx.token = r.body.token;

  r = await request(app).post('/api/v1/licencias/activar').send({ clave, producto: 'dental-pro', huella: 'equipo-B' });
  assert.equal(r.status, 403);
  assert.equal(r.body.codigo, 'max_activaciones');

  r = await request(app).post('/api/v1/licencias/activar').send({ clave, producto: 'dental-pro', huella: 'equipo-A' });
  assert.equal(r.status, 200);

  r = await request(app).post('/api/v1/licencias/activar').send({ clave, producto: 'otro-producto', huella: 'equipo-A' });
  assert.equal(r.status, 403);
  assert.equal(r.body.codigo, 'producto_incorrecto');
});

test('el token está firmado con Ed25519 y se verifica con la clave pública publicada', async () => {
  const r = await request(app).get('/api/v1/licencias/clave-publica');
  assert.equal(r.status, 200);
  assert.equal(r.body.algoritmo, 'Ed25519');
  const publica = createPublicKey(r.body.clave_publica_pem);
  const payload = verificarToken(ctx.token, publica);
  assert.ok(payload, 'token válido');
  assert.equal(payload.clave, ctx.venta.licencias[0].clave);
  assert.equal(payload.huella, 'equipo-A');
  assert.equal(payload.producto, 'dental-pro');
  // Un token manipulado no verifica.
  const [cuerpo, firma] = ctx.token.split('.');
  const alterado = Buffer.from(JSON.stringify({ ...payload, estado: 'activa', vence_en: '2099-01-01' })).toString('base64url');
  assert.equal(verificarToken(`${alterado}.${firma}`, publica), null);
  assert.equal(verificarToken(`${cuerpo}.${firma}x`, publica), null);
});

test('el latido renueva el token y falla para equipos no activados', async () => {
  const clave = ctx.venta.licencias[0].clave;
  let r = await request(app).post('/api/v1/licencias/latido').send({ clave, huella: 'equipo-A', version: '1.3.0' });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  r = await request(app).post('/api/v1/licencias/latido').send({ clave, huella: 'equipo-Z' });
  assert.equal(r.status, 403);
  assert.equal(r.body.codigo, 'no_activada');
});

test('solo el superadmin resetea activaciones; después el equipo B puede activar', async () => {
  const lic = ctx.venta.licencias[0];
  let r = await request(app).post(`/api/v1/licencias/${lic.id}/reset`).set(auth('admin')).send({ motivo: 'Cambio de PC' });
  assert.equal(r.status, 403);
  r = await request(app).post(`/api/v1/licencias/${lic.id}/reset`).set(auth('superadmin')).send({ motivo: 'Cambio de PC' });
  assert.equal(r.status, 200);
  assert.equal(r.body.activaciones_usadas, 0);
  assert.ok(r.body.historial.some((h) => h.accion === 'licencia.reset' && h.detalle.motivo === 'Cambio de PC'));
  r = await request(app).post('/api/v1/licencias/activar').send({ clave: lic.clave, producto: 'dental-pro', huella: 'equipo-B' });
  assert.equal(r.status, 200);
});

test('suspender bloquea la activación y el latido informa el estado', async () => {
  const lic = ctx.venta.licencias[1];
  let r = await request(app).post('/api/v1/licencias/activar').send({ clave: lic.clave, huella: 'sede-norte' });
  assert.equal(r.status, 200);
  r = await request(app).post(`/api/v1/licencias/${lic.id}/suspender`).set(auth('superadmin')).send({ motivo: 'Cliente moroso' });
  assert.equal(r.status, 200);
  r = await request(app).post('/api/v1/licencias/latido').send({ clave: lic.clave, huella: 'sede-norte' });
  assert.equal(r.status, 403);
  assert.equal(r.body.codigo, 'suspendida');
  r = await request(app).post(`/api/v1/licencias/${lic.id}/reanudar`).set(auth('superadmin')).send({ motivo: 'Pagó' });
  assert.equal(r.body.estado, 'activa');
});

test('demo: se activa al instante, vence a los 7 días y respeta el tope semanal', async () => {
  let r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: ctx.cliente.id, plan_id: ctx.plan_demo.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.total, 0);
  assert.equal(r.body.estado, 'pagada');
  assert.equal(r.body.licencias[0].estado, 'activa');
  assert.ok(r.body.licencias[0].vence_en);
  r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: ctx.cliente.id, plan_id: ctx.plan_demo.id });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /demos por semana/);
});

test('el tope diario de emisiones frena al admin pero no al superadmin', async () => {
  let r = await request(app).post('/api/v1/ventas').set(auth('admin')).send({ cliente_id: ctx.cliente.id, plan_id: ctx.plan_sucursal.id, cantidad: 4 });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /tope/);
  r = await request(app).post('/api/v1/ventas').set(auth('superadmin')).send({ cliente_id: ctx.cliente.id, plan_id: ctx.plan_sucursal.id, cantidad: 4 });
  assert.equal(r.status, 201);
  ctx.ventaSucursales = r.body;
});

test('cierre de caja del vendedor y aprobación del superadmin', async () => {
  let r = await request(app).get('/api/v1/caja/dia').set(auth('vendedor'));
  assert.equal(r.status, 200);
  assert.equal(r.body.total_cobrado, 1800);
  assert.equal(r.body.por_metodo.efectivo, 800);
  assert.equal(r.body.por_metodo.transferencia, 1000);
  assert.equal(r.body.a_entregar, 800, 'solo el efectivo se entrega en mano');
  assert.equal(r.body.comision_dia, 360);

  r = await request(app).post('/api/v1/caja/cerrar').set(auth('vendedor')).send({});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.estado, 'cerrado');
  ctx.cierre = r.body;
  r = await request(app).post('/api/v1/caja/cerrar').set(auth('vendedor')).send({});
  assert.equal(r.status, 409);

  r = await request(app).post(`/api/v1/caja/${ctx.cierre.id}/revisar`).set(auth('admin')).send({ estado: 'aprobado' });
  assert.equal(r.status, 403);
  r = await request(app).post(`/api/v1/caja/${ctx.cierre.id}/revisar`).set(auth('superadmin')).send({ estado: 'aprobado' });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'aprobado');
  r = await request(app).post(`/api/v1/caja/${ctx.cierre.id}/revisar`).set(auth('superadmin')).send({ estado: 'observado', observacion: 'x' });
  assert.equal(r.status, 422, 'un cierre aprobado es inmutable');
});

test('liquidación de comisiones: se crea, se paga y las comisiones quedan liquidadas', async () => {
  const hoy = hoyLocal();
  const vendedorId = ctx.venta.vendedor_id;
  let r = await request(app).post('/api/v1/liquidaciones').set(auth('superadmin')).send({ vendedor_id: vendedorId, desde: hoy, hasta: hoy });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.total, 360);
  assert.equal(r.body.comisiones.length, 2);
  r = await request(app).post(`/api/v1/liquidaciones/${r.body.id}/pagar`).set(auth('superadmin'));
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'pagada');
  r = await request(app).get('/api/v1/comisiones').set(auth('vendedor'));
  assert.ok(r.body.every((c) => c.estado === 'liquidada'));
});

test('anular una venta revoca licencias y genera cargo negativo si la comisión ya se liquidó', async () => {
  let r = await request(app).post(`/api/v1/ventas/${ctx.venta.id}/anular`).set(auth('admin')).send({ motivo: 'Devolución' });
  assert.equal(r.status, 403);
  r = await request(app).post(`/api/v1/ventas/${ctx.venta.id}/anular`).set(auth('superadmin')).send({ motivo: 'Devolución' });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'anulada');
  assert.ok(r.body.licencias.every((l) => l.estado === 'revocada'));
  const negativas = r.body.comisiones.filter((c) => c.monto < 0 && c.estado === 'devengada');
  assert.equal(negativas.reduce((s, c) => s + c.monto, 0), -360);
  r = await request(app).post('/api/v1/licencias/activar').send({ clave: ctx.venta.licencias[0].clave, huella: 'equipo-B' });
  assert.equal(r.status, 403);
  assert.equal(r.body.codigo, 'revocada');
});

test('el resumen del panel muestra alertas al superadmin y solo lo propio al vendedor', async () => {
  let r = await request(app).get('/api/v1/reportes/resumen').set(auth('superadmin'));
  assert.equal(r.status, 200);
  assert.ok(r.body.alertas);
  assert.ok(r.body.alertas.activaciones_rechazadas_24h >= 3);
  assert.ok(r.body.equipo.length >= 3);
  r = await request(app).get('/api/v1/reportes/resumen').set(auth('vendedor'));
  assert.equal(r.status, 200);
  assert.equal(r.body.alertas, undefined);
  assert.equal(r.body.caja_hoy, 'aprobado');
});

test('la auditoría registra todo y solo la ven los gestores', async () => {
  let r = await request(app).get('/api/v1/auditoria').set(auth('vendedor'));
  assert.equal(r.status, 403);
  r = await request(app).get('/api/v1/auditoria?accion=licencia.reset').set(auth('superadmin'));
  assert.equal(r.status, 200);
  assert.equal(r.body.filas.length, 1);
  assert.equal(r.body.filas[0].usuario_nombre, 'Super');
});
