// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb } from '../src/db.js';
import { verificarToken } from '../src/firmas.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto, crearPlan, actualizarProducto } from '../src/servicios/catalogo.js';
import { crearCliente } from '../src/servicios/clientes.js';
import { crearVenta, registrarPago, confirmarPago } from '../src/servicios/ventas.js';

let app, superadmin, vendedor, otro, producto, licencia, token;
const CLAVE = 'ClaveSegura2026';

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'super@test.com', nombre: 'Super', clave: CLAVE, rol: 'superadmin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  otro = crearUsuario({ email: 'otro@test.com', nombre: 'Otro', clave: CLAVE, rol: 'vendedor' });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  producto = crearProducto({ codigo: 'dental-pro', nombre: 'DENTAL-PRO', version_actual: '2.0.0' }, superadmin);
  const plan = crearPlan({ producto_id: producto.id, codigo: 'anual', nombre: 'Anual', tipo: 'anual', precio: 300 }, superadmin);
  const cliente = crearCliente({ nombre: 'Clínica', email: 'c@test.com' }, vendedor);
  const venta = crearVenta({ cliente_id: cliente.id, plan_id: plan.id }, vendedor);
  const pago = registrarPago(venta.id, { monto: 300, metodo: 'efectivo' }, vendedor);
  licencia = confirmarPago(pago.pagos[0].id, superadmin).licencias[0];
  const r = await request(app).post('/api/v1/auth/login').send({ email: 'vende@test.com', clave: CLAVE });
  token = r.body.token;
});
after(() => reiniciarDb());

test('la activación informa si la instalación está desactualizada', async () => {
  let r = await request(app).post('/api/v1/licencias/activar').send({ clave: licencia.clave, producto: 'dental-pro', huella: 'pc-recepcion', version: '1.9.0' });
  assert.equal(r.status, 200);
  assert.equal(r.body.licencia.version_actual, '2.0.0');
  assert.equal(r.body.licencia.desactualizada, true);
  r = await request(app).post('/api/v1/licencias/latido').send({ clave: licencia.clave, huella: 'pc-recepcion', version: '2.0.0' });
  assert.equal(r.body.licencia.desactualizada, false);
  actualizarProducto(producto.id, { version_actual: '2.1.0' }, superadmin);
  r = await request(app).post('/api/v1/licencias/latido').send({ clave: licencia.clave, huella: 'pc-recepcion' });
  assert.equal(r.body.licencia.desactualizada, false, 'sin versión reportada no se marca');
  r = await request(app).post('/api/v1/licencias/latido').send({ clave: licencia.clave, huella: 'pc-recepcion', version: '2.0.0' });
  assert.equal(r.body.licencia.desactualizada, true);
});

test('el panel cuenta instalaciones desactualizadas en alertas y catálogo', async () => {
  const s = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE });
  let r = await request(app).get('/api/v1/reportes/resumen').set('Authorization', `Bearer ${s.body.token}`);
  assert.equal(r.body.alertas.instalaciones_desactualizadas, 1);
  r = await request(app).get('/api/v1/productos').set('Authorization', `Bearer ${s.body.token}`);
  assert.equal(r.body.find((p) => p.codigo === 'dental-pro').instalaciones_desactualizadas, 1);
  r = await request(app).get(`/api/v1/licencias/${licencia.id}`).set('Authorization', `Bearer ${s.body.token}`);
  assert.equal(r.body.activaciones[0].desactualizada, true);
});

test('código de emergencia: token firmado de 72 h para un equipo, auditado y listado', async () => {
  const r = await request(app).post(`/api/v1/licencias/${licencia.id}/emergencia`).set('Authorization', `Bearer ${token}`).send({ huella: 'pc-recepcion', motivo: 'Cliente sin internet en campaña' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = verificarToken(r.body.codigo);
  assert.ok(p, 'el código verifica con la clave pública');
  assert.equal(p.emergencia, true);
  assert.equal(p.clave, licencia.clave);
  assert.equal(p.huella, 'pc-recepcion');
  assert.equal(p.estado, 'activa');
  const horas = (Date.parse(p.expira_en) - Date.now()) / 3600000;
  assert.ok(horas > 71 && horas <= 72, `expira en ${horas} h`);
  const det = await request(app).get(`/api/v1/licencias/${licencia.id}`).set('Authorization', `Bearer ${token}`);
  assert.equal(det.body.codigos_emergencia.length, 1);
  assert.equal(det.body.codigos_emergencia[0].motivo, 'Cliente sin internet en campaña');
  assert.ok(det.body.historial.some((h) => h.accion === 'licencia.codigo_emergencia'));
});

test('un vendedor no puede emitir códigos de emergencia para licencias ajenas ni para revocadas', async () => {
  const o = await request(app).post('/api/v1/auth/login').send({ email: 'otro@test.com', clave: CLAVE });
  let r = await request(app).post(`/api/v1/licencias/${licencia.id}/emergencia`).set('Authorization', `Bearer ${o.body.token}`).send({ huella: 'pc-recepcion', motivo: 'intento' });
  assert.equal(r.status, 403);
  obtenerDb().prepare("UPDATE licencias SET estado = 'revocada' WHERE id = ?").run(licencia.id);
  r = await request(app).post(`/api/v1/licencias/${licencia.id}/emergencia`).set('Authorization', `Bearer ${token}`).send({ huella: 'pc-recepcion', motivo: 'intento' });
  assert.equal(r.status, 422);
});
