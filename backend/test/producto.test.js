// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, guardarAjuste } from '../src/db.js';
import { verificarToken } from '../src/firmas.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto, crearPlan } from '../src/servicios/catalogo.js';
import { crearCliente } from '../src/servicios/clientes.js';
import { crearVenta, registrarPago, confirmarPago } from '../src/servicios/ventas.js';
import { DIR_VERSIONES, compararVersiones } from '../src/servicios/versiones.js';

let app, superadmin, vendedor, producto, licencia, tokenS;
const CLAVE = 'ClaveSegura2026';

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'dueno@test.com', nombre: 'Dueño', clave: CLAVE, rol: 'superadmin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  producto = crearProducto({ codigo: 'supero-pos', nombre: 'Supero POS' }, superadmin);
  const plan = crearPlan({ producto_id: producto.id, codigo: 'vitalicio', nombre: 'Vitalicio', tipo: 'vitalicio', precio: 299 }, superadmin);
  crearPlan({ producto_id: producto.id, codigo: 'demo', nombre: 'Demo', tipo: 'demo', precio: 0, duracion_dias: 7 }, superadmin);
  const cliente = crearCliente({ nombre: 'Minimarket', email: 'm@test.com' }, vendedor);
  const venta = crearVenta({ cliente_id: cliente.id, plan_id: plan.id }, vendedor);
  licencia = confirmarPago(registrarPago(venta.id, { monto: 299, metodo: 'efectivo' }, vendedor).pagos[0].id, superadmin).licencias[0];
  await request(app).post('/api/v1/licencias/activar').send({ clave: licencia.clave, producto: 'supero-pos', huella: 'caja-1', version: '1.0.0' });
  tokenS = (await request(app).post('/api/v1/auth/login').send({ email: 'dueno@test.com', clave: CLAVE })).body.token;
  guardarAjuste('url_publica', 'https://control.test');
});
after(() => { reiniciarDb(); if (existsSync(DIR_VERSIONES)) rmSync(DIR_VERSIONES, { recursive: true, force: true }); });

test('comparación de versiones', () => {
  assert.ok(compararVersiones('1.10.0', '1.9.9') > 0); assert.ok(compararVersiones('2.0', '2.0.0') === 0); assert.ok(compararVersiones('1.2', '1.2.1') < 0);
});

test('publicar versión con archivo: sha256, versión actual y actualización firmada solo para licencias activadas', async () => {
  mkdirSync(DIR_VERSIONES, { recursive: true });
  const r1 = await request(app).post(`/api/v1/productos/${producto.id}/versiones`).set('Authorization', `Bearer ${tokenS}`).field('version', '1.1.0').field('notas', 'Arregla la impresión').attach('archivo', Buffer.from('instalador de prueba'), 'supero-pos-1.1.0.zip');
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.sha256.length, 64); assert.equal(r1.body.tamano, 20);
  assert.equal(obtenerDb().prepare('SELECT version_actual FROM productos WHERE id = ?').get(producto.id).version_actual, '1.1.0');
  // el producto pregunta con su versión vieja
  let r = await request(app).post('/api/v1/licencias/actualizacion').send({ clave: licencia.clave, huella: 'caja-1', producto: 'supero-pos', version: '1.0.0' });
  assert.equal(r.status, 200); assert.equal(r.body.actualizar, true); assert.equal(r.body.version, '1.1.0'); assert.equal(r.body.sha256, r1.body.sha256);
  const firma = verificarToken(r.body.firma);
  assert.equal(firma.tipo, 'actualizacion'); assert.equal(firma.sha256, r1.body.sha256); assert.equal(firma.url, r.body.url);
  // descarga con la licencia
  const d = await request(app).get(`/api/v1/licencias/actualizacion/${r1.body.id}/descargar?clave=${licencia.clave}&huella=caja-1`);
  assert.equal(d.status, 200); assert.match(d.headers['content-disposition'], /supero-pos-1\.1\.0\.zip/);
  // ya actualizado: nada que hacer
  r = await request(app).post('/api/v1/licencias/actualizacion').send({ clave: licencia.clave, huella: 'caja-1', version: '1.1.0' });
  assert.equal(r.body.actualizar, false);
  // equipo no activado o licencia ajena: rechazado
  r = await request(app).post('/api/v1/licencias/actualizacion').send({ clave: licencia.clave, huella: 'otra-pc', version: '1.0.0' });
  assert.equal(r.status, 403);
  r = await request(app).get(`/api/v1/licencias/actualizacion/${r1.body.id}/descargar?clave=CTL-0000-0000-0000-0000&huella=caja-1`);
  assert.equal(r.status, 403);
  // el vendedor no publica versiones
  r = await request(app).post(`/api/v1/productos/${producto.id}/versiones`).set('Authorization', `Bearer ${(await request(app).post('/api/v1/auth/login').send({ email: 'vende@test.com', clave: CLAVE })).body.token}`).field('version', '9.9.9').field('url_externa', 'https://x');
  assert.equal(r.status, 403);
  // versión con URL externa (GitHub Releases) sin archivo
  r = await request(app).post(`/api/v1/productos/${producto.id}/versiones`).set('Authorization', `Bearer ${tokenS}`).send({ version: '1.2.0', url_externa: 'https://github.com/x/y/releases/1.2.0.zip', marcar_actual: false });
  assert.equal(r.status, 201); assert.equal(obtenerDb().prepare('SELECT version_actual FROM productos WHERE id = ?').get(producto.id).version_actual, '1.1.0', 'sin marcar actual no cambia');
  r = await request(app).get(`/api/v1/productos/${producto.id}/versiones`).set('Authorization', `Bearer ${tokenS}`);
  assert.equal(r.body.length, 2);
  r = await request(app).delete(`/api/v1/productos/${producto.id}/versiones/${r.body[0].id}`).set('Authorization', `Bearer ${tokenS}`);
  assert.equal(r.body.ok, true);
});

test('demo autoservicio desde la web: emite la clave al instante, avisa por correo y no se repite', async () => {
  const cat = await request(app).get('/api/v1/publico/catalogo');
  const p = cat.body.productos.find((x) => x.codigo === 'supero-pos');
  const demo = p.planes.find((pl) => pl.tipo === 'demo');
  assert.ok(demo, 'el catálogo público incluye la demo'); assert.equal(cat.body.demo_autoservicio, true);
  let r = await request(app).post('/api/v1/publico/pedidos').send({ plan_id: demo.id, cliente: { nombre: 'Rosa Bodega', email: 'rosa@test.com', telefono: '+51 900 5' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.demo.clave, /^CTL-/); assert.ok(r.body.demo.vence_en); assert.equal(r.body.venta.estado, 'pagada');
  const correo = obtenerDb().prepare("SELECT * FROM correos WHERE para = 'rosa@test.com'").get();
  assert.ok(correo && correo.html.includes(r.body.demo.clave));
  r = await request(app).post('/api/v1/publico/pedidos').send({ plan_id: demo.id, cliente: { nombre: 'Rosa Bodega', email: 'rosa@test.com' } });
  assert.equal(r.status, 409, 'una demo por correo y producto');
  guardarAjuste('demo_autoservicio', '0');
  r = await request(app).post('/api/v1/publico/pedidos').send({ plan_id: demo.id, cliente: { nombre: 'Otro', email: 'otro2@test.com' } });
  assert.equal(r.status, 403);
  guardarAjuste('demo_autoservicio', '1');
});

test('el chequeo de salud informa base de datos y planificador', async () => {
  const r = await request(app).get('/api/v1/salud');
  assert.equal(r.status, 200); assert.equal(r.body.base_datos, 'ok'); assert.equal(r.body.planificador, 'arrancando');
});
