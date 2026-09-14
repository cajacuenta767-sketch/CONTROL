// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto } from '../src/servicios/catalogo.js';

let app, tokens = {};
const CLAVE = 'ClaveSegura2026';
const auth = (r) => ({ Authorization: `Bearer ${tokens[r]}` });

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  const s = crearUsuario({ email: 'dueno@test.com', nombre: 'Dueño', clave: CLAVE, rol: 'superadmin' });
  crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  crearUsuario({ email: 'otro@test.com', nombre: 'Otro', clave: CLAVE, rol: 'vendedor' });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  crearProducto({ codigo: 'barber-pro', nombre: 'BARBER-PRO', material: JSON.stringify({ ficha: 'Gestión de barberías', beneficios: ['Citas', 'Caja'] }) }, s);
  obtenerDb().prepare("UPDATE productos SET material = ? WHERE codigo = 'barber-pro'").run(JSON.stringify({ ficha: 'Gestión de barberías', beneficios: ['Citas', 'Caja'], objeciones: [{ p: 'Es caro', r: 'Cuesta menos que una cita al mes' }] }));
  for (const [r, e] of [['superadmin', 'dueno@test.com'], ['vendedor', 'vende@test.com'], ['otro', 'otro@test.com']]) tokens[r] = (await request(app).post('/api/v1/auth/login').send({ email: e, clave: CLAVE })).body.token;
});
after(() => reiniciarDb());

test('prospecto: crear, avanzar etapa, perder con motivo y convertir en cliente', async () => {
  let r = await request(app).post('/api/v1/prospectos').set(auth('vendedor')).send({ nombre: 'Luis Barbero', negocio: 'Barbería Luis', telefono: '+51 900 1', rubro: 'barbería', proximo_paso: 'Llamar', proximo_paso_en: '2026-01-01' });
  assert.equal(r.status, 201); const id = r.body.id; assert.equal(r.body.etapa, 'nuevo');
  r = await request(app).patch(`/api/v1/prospectos/${id}`).set(auth('vendedor')).send({ etapa: 'demo' });
  assert.equal(r.body.etapa, 'demo');
  r = await request(app).patch(`/api/v1/prospectos/${id}`).set(auth('vendedor')).send({ etapa: 'perdido' });
  assert.equal(r.status, 422, 'perder exige motivo');
  r = await request(app).get(`/api/v1/prospectos/${id}`).set(auth('otro'));
  assert.equal(r.status, 403, 'otro vendedor no lo ve');
  r = await request(app).post(`/api/v1/prospectos/${id}/convertir`).set(auth('vendedor')).send({});
  assert.equal(r.status, 200); assert.ok(r.body.cliente_id); assert.equal(r.body.prospecto.etapa, 'ganado');
  const c = obtenerDb().prepare('SELECT * FROM clientes WHERE id = ?').get(r.body.cliente_id);
  assert.equal(c.empresa, 'Barbería Luis'); assert.equal(c.vendedor_id, 2);
  r = await request(app).post(`/api/v1/prospectos/${id}/convertir`).set(auth('vendedor')).send({});
  assert.equal(r.body.ya_convertido, true);
});

test('embudo y tablero', async () => {
  await request(app).post('/api/v1/prospectos').set(auth('vendedor')).send({ nombre: 'P2', etapa: 'contactado' });
  await request(app).post('/api/v1/prospectos').set(auth('vendedor')).send({ nombre: 'P3', etapa: 'perdido', motivo_perdida: 'Precio' });
  let r = await request(app).get('/api/v1/prospectos/embudo').set(auth('vendedor'));
  assert.equal(r.body.por_etapa.ganado, 1); assert.equal(r.body.por_etapa.perdido, 1); assert.equal(r.body.tasa_conversion, 50);
  assert.equal(r.body.motivos_perdida[0].motivo, 'Precio'); assert.equal(r.body.pendientes_hoy, 0);
  r = await request(app).get('/api/v1/prospectos/embudo').set(auth('superadmin'));
  assert.equal(r.body.por_vendedor[0].nombre, 'Vendedor');
  r = await request(app).get('/api/v1/reportes/tablero').set(auth('otro'));
  assert.equal(r.status, 200); assert.ok(Array.isArray(r.body.equipo)); assert.equal(r.body.equipo[0].puesto, 1);
  assert.equal(r.body.equipo.find((u) => u.nombre === 'Vendedor').prospectos_abiertos, 1);
  assert.equal(r.body.equipo[0].comision_pendiente, undefined, 'el tablero no muestra comisiones');
});

test('el material de venta viaja al catálogo público sin las objeciones internas', async () => {
  const r = await request(app).get('/api/v1/publico/catalogo');
  const p = r.body.productos.find((x) => x.codigo === 'barber-pro');
  assert.equal(p.material.ficha, 'Gestión de barberías'); assert.deepEqual(p.material.beneficios, ['Citas', 'Caja']); assert.equal(p.material.objeciones, undefined);
});
