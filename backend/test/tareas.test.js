// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, guardarAjuste, ahoraSql } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto, crearPlan } from '../src/servicios/catalogo.js';
import { crearCliente } from '../src/servicios/clientes.js';
import { crearVenta, registrarPago, confirmarPago } from '../src/servicios/ventas.js';
import { ejecutarTareas, avisosVencimiento, renovacionesAutomaticas, recordatorioCaja, crearRespaldo, listarRespaldos, DIR_RESPALDOS } from '../src/servicios/tareas.js';

let app, superadmin, vendedor, cliente, plan, licencia;
const CLAVE = 'ClaveSegura2026';

before(() => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'super@test.com', nombre: 'Super', clave: CLAVE, rol: 'superadmin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  const producto = crearProducto({ codigo: 'gym-pro', nombre: 'GYM-PRO' }, superadmin);
  plan = crearPlan({ producto_id: producto.id, codigo: 'mensual', nombre: 'Mensual', tipo: 'mensual', precio: 50 }, superadmin);
  cliente = crearCliente({ nombre: 'Gym Norte', email: 'gym@norte.test', telefono: '+51 999' }, vendedor);
  const venta = crearVenta({ cliente_id: cliente.id, plan_id: plan.id }, vendedor);
  const pago = registrarPago(venta.id, { monto: 50, metodo: 'efectivo' }, vendedor);
  const pagada = confirmarPago(pago.pagos[0].id, superadmin);
  licencia = pagada.licencias[0];
  guardarAjuste('url_publica', 'https://control.test');
});
after(() => { reiniciarDb(); if (existsSync(DIR_RESPALDOS)) rmSync(DIR_RESPALDOS, { recursive: true, force: true }); });

test('aviso de vencimiento a 7 días: correo al cliente y al vendedor, una sola vez', async () => {
  obtenerDb().prepare('UPDATE licencias SET vence_en = ? WHERE id = ?').run(ahoraSql(7), licencia.id);
  let r = await avisosVencimiento();
  assert.equal(r.avisos_vencimiento, 1);
  const correos = obtenerDb().prepare('SELECT para, asunto FROM correos ORDER BY id').all();
  assert.ok(correos.some((c) => c.para === 'gym@norte.test' && /vence en 7/.test(c.asunto)));
  assert.ok(correos.some((c) => c.para === 'vende@test.com' && /Renovación próxima/.test(c.asunto)));
  r = await avisosVencimiento();
  assert.equal(r.avisos_vencimiento, 0, 'no repite el aviso');
});

test('renovación automática: crea la venta de renovación con enlace de pago y avisa al cliente', async () => {
  guardarAjuste('renovacion_automatica_dias', '7');
  let r = await renovacionesAutomaticas();
  assert.equal(r.renovaciones, 1);
  const venta = obtenerDb().prepare('SELECT * FROM ventas WHERE renueva_licencia_id = ? ORDER BY id DESC').get(licencia.id);
  assert.ok(venta);
  assert.equal(venta.estado, 'pendiente');
  assert.equal(venta.es_renovacion, 1);
  const enlace = obtenerDb().prepare('SELECT * FROM enlaces_pago WHERE venta_id = ?').get(venta.id);
  assert.equal(enlace.proveedor, 'demo');
  const correo = obtenerDb().prepare("SELECT * FROM correos WHERE asunto LIKE 'Renueva tu licencia%'").get();
  assert.ok(correo && correo.html.includes(enlace.url));
  r = await renovacionesAutomaticas();
  assert.equal(r.renovaciones, 0, 'no duplica mientras haya una renovación pendiente');
  // Al pagar la renovación por el enlace demo, la licencia se extiende.
  const pago = await request(app).post(`/api/v1/publico/enlaces/${enlace.id}/demo/confirmar`);
  assert.equal(pago.status, 200);
  const lic = obtenerDb().prepare('SELECT * FROM licencias WHERE id = ?').get(licencia.id);
  assert.ok(lic.vence_en > ahoraSql(30), 'vence al menos 30 días después de hoy');
  assert.equal(lic.estado, 'activa');
});

test('recordatorio de caja: solo a quien cobró hoy sin cerrar', async () => {
  const r = await recordatorioCaja({ forzar: true });
  assert.equal(r.recordatorios_caja, 1);
  const c = obtenerDb().prepare("SELECT * FROM correos WHERE asunto LIKE 'Recuerda cerrar%'").get();
  assert.equal(c.para, 'vende@test.com');
  const r2 = await recordatorioCaja({ forzar: true });
  assert.equal(r2.recordatorios_caja, 0);
});

test('respaldo: crea el archivo, lo lista y respeta el máximo a conservar', () => {
  guardarAjuste('respaldos_conservar', '2');
  crearRespaldo(); crearRespaldo(); const ultimo = crearRespaldo();
  assert.ok(ultimo.bytes > 0);
  const lista = listarRespaldos();
  assert.equal(lista.length, 2);
  assert.equal(lista[0].nombre, ultimo.nombre);
});

test('la orquestación completa corre sin errores y expone su estado al superadmin', async () => {
  const r = await ejecutarTareas();
  assert.deepEqual(r.errores, []);
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE });
  const est = await request(app).get('/api/v1/sistema/tareas').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(est.status, 200);
  assert.ok(est.body.ultima_ejecucion);
  const resp = await request(app).post('/api/v1/sistema/respaldos').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(resp.status, 201);
  const descarga = await request(app).get(`/api/v1/sistema/respaldos/${resp.body.nombre}`).set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(descarga.status, 200);
  const vendedorLogin = await request(app).post('/api/v1/auth/login').send({ email: 'vende@test.com', clave: CLAVE });
  const prohibido = await request(app).get('/api/v1/sistema/tareas').set('Authorization', `Bearer ${vendedorLogin.body.token}`);
  assert.equal(prohibido.status, 403);
});
