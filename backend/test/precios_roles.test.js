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

let app, superadmin, admin, vendedor, producto, mensual, vitalicio, cliente, tokens = {};
const CLAVE = 'ClaveSegura2026';
const auth = (rol) => ({ Authorization: `Bearer ${tokens[rol]}` });

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'dueno@test.com', nombre: 'Dueño', clave: CLAVE, rol: 'superadmin' });
  admin = crearUsuario({ email: 'admin@test.com', nombre: 'Admin', clave: CLAVE, rol: 'admin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor', comision_pct: 20 });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  producto = crearProducto({ codigo: 'barber-pro', nombre: 'BARBER-PRO' }, superadmin);
  mensual = crearPlan({ producto_id: producto.id, codigo: 'mensual', nombre: 'Mensual', tipo: 'mensual', precio: 15 }, superadmin);
  vitalicio = crearPlan({ producto_id: producto.id, codigo: 'vitalicio', nombre: 'Vitalicio', tipo: 'vitalicio', precio: 299 }, superadmin);
  cliente = crearCliente({ nombre: 'Barbería Central' }, vendedor);
  for (const [rol, email] of [['superadmin', 'dueno@test.com'], ['admin', 'admin@test.com'], ['vendedor', 'vende@test.com']]) {
    const r = await request(app).post('/api/v1/auth/login').send({ email, clave: CLAVE });
    tokens[rol] = r.body.token;
  }
  // Una venta pagada del vendedor para que existan comisiones.
  const v = crearVenta({ cliente_id: cliente.id, plan_id: vitalicio.id }, vendedor);
  confirmarPago(registrarPago(v.id, { monto: 299, metodo: 'efectivo' }, vendedor).pagos[0].id, superadmin);
});
after(() => reiniciarDb());

test('el precio de una venta sale siempre del catálogo, aunque el cliente envíe otro', async () => {
  const r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: cliente.id, plan_id: mensual.id, precio: 1, total: 1, precio_unitario: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.total, 15);
});

test('el dueño cambia precios en lote; la lista cambia para todos y las ventas hechas conservan el suyo', async () => {
  let r = await request(app).post('/api/v1/planes/precios').set(auth('superadmin')).send({ cambios: [{ plan_id: mensual.id, precio: 19 }, { plan_id: vitalicio.id, precio: 299 }], motivo: 'Subida por inflación' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total, 1, 'solo el que cambió');
  r = await request(app).get('/api/v1/productos').set(auth('vendedor'));
  const pl = r.body[0].planes.find((p) => p.id === mensual.id);
  assert.equal(pl.precio, 19);
  assert.equal(pl.precio_anterior, 15);
  assert.ok(pl.precio_desde);
  const venta = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: cliente.id, plan_id: mensual.id });
  assert.equal(venta.body.total, 19);
  const anterior = obtenerDb().prepare("SELECT total FROM ventas WHERE plan_id = ? ORDER BY id LIMIT 1").get(mensual.id);
  assert.equal(anterior.total, 15, 'la venta anterior no cambia');
  r = await request(app).get('/api/v1/planes/historial-precios').set(auth('superadmin'));
  assert.equal(r.body[0].precio_nuevo, 19);
  assert.equal(r.body[0].usuario_nombre, 'Dueño');
  assert.equal(r.body[0].motivo, 'Subida por inflación');
});

test('ajuste porcentual y niveles sugeridos', async () => {
  let r = await request(app).post('/api/v1/planes/precios/porcentaje').set(auth('superadmin')).send({ porcentaje: 10, tipos: ['vitalicio'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.aplicados[0].nuevo, 329);
  r = await request(app).get('/api/v1/productos/niveles-precio').set(auth('vendedor'));
  assert.equal(r.body.length, 4);
  assert.equal(r.body[0].mensual, 7);
});

test('admin y vendedor no pueden tocar precios ni la demo deja de ser gratis', async () => {
  for (const rol of ['admin', 'vendedor']) {
    const r = await request(app).post('/api/v1/planes/precios').set(auth(rol)).send({ cambios: [{ plan_id: mensual.id, precio: 1 }] });
    assert.equal(r.status, 403, rol);
  }
  const demo = crearPlan({ producto_id: producto.id, codigo: 'demo', nombre: 'Demo', tipo: 'demo', precio: 0, duracion_dias: 7 }, superadmin);
  const r = await request(app).post('/api/v1/planes/precios').set(auth('superadmin')).send({ cambios: [{ plan_id: demo.id, precio: 5 }] });
  assert.equal(r.status, 422);
});

test('tope de descuento por rol: vendedor 10 %, admin 15 %, dueño sin tope', async () => {
  guardarAjuste('tope_descuento_pct', '10'); guardarAjuste('tope_descuento_admin_pct', '15');
  let r = await request(app).post('/api/v1/ventas').set(auth('vendedor')).send({ cliente_id: cliente.id, plan_id: mensual.id, descuento_pct: 12 });
  assert.equal(r.status, 422); assert.equal(r.body.tope, 10);
  r = await request(app).post('/api/v1/ventas').set(auth('admin')).send({ cliente_id: cliente.id, plan_id: mensual.id, descuento_pct: 12 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await request(app).post('/api/v1/ventas').set(auth('admin')).send({ cliente_id: cliente.id, plan_id: mensual.id, descuento_pct: 20 });
  assert.equal(r.status, 422);
  r = await request(app).post('/api/v1/ventas').set(auth('superadmin')).send({ cliente_id: cliente.id, plan_id: mensual.id, descuento_pct: 50 });
  assert.equal(r.status, 201);
});

test('lo del dueño no lo ven admin ni vendedor: comisiones de otros, equipo con dinero, auditoría, correos', async () => {
  // Comisiones: el admin solo ve las suyas (ninguna), el dueño ve las del vendedor.
  let r = await request(app).get('/api/v1/comisiones').set(auth('admin'));
  assert.equal(r.status, 200); assert.equal(r.body.length, 0);
  r = await request(app).get('/api/v1/comisiones').set(auth('vendedor'));
  assert.ok(r.body.length >= 1 && r.body.every((c) => c.vendedor_id === vendedor.id));
  r = await request(app).get('/api/v1/comisiones').set(auth('superadmin'));
  assert.ok(r.body.length >= 1);
  // Equipo: el admin ve nombres y roles pero no comisiones ni ventas.
  r = await request(app).get('/api/v1/usuarios').set(auth('admin'));
  assert.equal(r.status, 200);
  assert.ok(r.body.length >= 3);
  assert.equal(r.body[0].comision_pct, undefined);
  assert.equal(r.body[0].comision_pendiente, undefined);
  r = await request(app).get('/api/v1/usuarios').set(auth('superadmin'));
  assert.ok(r.body.some((u) => u.comision_pendiente > 0));
  // Panel: el admin no recibe el bloque de equipo ni la bolsa de comisiones.
  r = await request(app).get('/api/v1/reportes/resumen').set(auth('admin'));
  assert.equal(r.body.equipo, undefined);
  assert.equal(r.body.comisiones.pendiente, 0);
  r = await request(app).get('/api/v1/reportes/resumen').set(auth('superadmin'));
  assert.ok(Array.isArray(r.body.equipo));
  assert.ok(r.body.comisiones.pendiente > 0);
  r = await request(app).get('/api/v1/reportes/series').set(auth('admin'));
  assert.equal(r.body.por_vendedor.length, 0);
  // Auditoría y correos: solo el dueño.
  for (const ruta of ['/api/v1/auditoria', '/api/v1/correos']) {
    assert.equal((await request(app).get(ruta).set(auth('admin'))).status, 403, ruta);
    assert.equal((await request(app).get(ruta).set(auth('superadmin'))).status, 200, ruta);
  }
});
