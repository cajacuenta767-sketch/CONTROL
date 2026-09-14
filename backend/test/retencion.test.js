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
import { saludClientes, encuestasPendientes, registrarEncuesta } from '../src/servicios/retencion.js';

let app, superadmin, vendedor, sano, riesgo, mensual, tokenS, tokenV;
const CLAVE = 'ClaveSegura2026';

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'dueno@test.com', nombre: 'Dueño', clave: CLAVE, rol: 'superadmin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  const p = crearProducto({ codigo: 'gym-pro', nombre: 'GYM-PRO' }, superadmin);
  mensual = crearPlan({ producto_id: p.id, codigo: 'mensual', nombre: 'Mensual', tipo: 'mensual', precio: 25 }, superadmin);
  sano = crearCliente({ nombre: 'Gym Sano', email: 's@test.com', telefono: '+51 900 000 001' }, vendedor);
  riesgo = crearCliente({ nombre: 'Gym Riesgo', email: 'r@test.com', telefono: '+51 900 000 002' }, vendedor);
  for (const c of [sano, riesgo]) {
    const v = crearVenta({ cliente_id: c.id, plan_id: mensual.id }, vendedor);
    confirmarPago(registrarPago(v.id, { monto: 25, metodo: 'efectivo' }, vendedor).pagos[0].id, superadmin);
  }
  // el cliente en riesgo: vence en 5 días, sin latido reciente y con un ticket abierto
  obtenerDb().prepare("UPDATE licencias SET vence_en = datetime('now', '+5 days') WHERE cliente_id = ?").run(riesgo.id);
  const lic = obtenerDb().prepare('SELECT id FROM licencias WHERE cliente_id = ?').get(riesgo.id);
  obtenerDb().prepare("INSERT INTO activaciones (licencia_id, huella, ultimo_latido) VALUES (?, 'pc-1', datetime('now', '-20 days'))").run(lic.id);
  obtenerDb().prepare("INSERT INTO tickets (cliente_id, licencia_id, asunto, estado) VALUES (?, ?, 'No abre', 'abierto')").run(riesgo.id, lic.id);
  tokenS = (await request(app).post('/api/v1/auth/login').send({ email: 'dueno@test.com', clave: CLAVE })).body.token;
  tokenV = (await request(app).post('/api/v1/auth/login').send({ email: 'vende@test.com', clave: CLAVE })).body.token;
  guardarAjuste('url_publica', 'https://control.test');
});
after(() => reiniciarDb());

test('semáforo de salud: verde para el cliente sano, rojo para el que acumula señales', () => {
  const lista = saludClientes(superadmin);
  const s = lista.find((c) => c.id === sano.id), r = lista.find((c) => c.id === riesgo.id);
  assert.equal(s.semaforo, 'verde'); assert.equal(s.puntaje, 100);
  assert.equal(r.semaforo, 'ambar', JSON.stringify(r));
  assert.ok(r.factores.some((f) => /vence/.test(f)) && r.factores.some((f) => /sin señal/.test(f)) && r.factores.some((f) => /ticket/.test(f)));
  assert.equal(lista[0].id, riesgo.id, 'los de peor salud primero');
  obtenerDb().prepare("UPDATE licencias SET estado = 'mora' WHERE cliente_id = ?").run(riesgo.id);
  assert.equal(saludClientes(superadmin).find((c) => c.id === riesgo.id).semaforo, 'rojo', 'en mora pasa a rojo');
  obtenerDb().prepare("UPDATE licencias SET estado = 'activa' WHERE cliente_id = ?").run(riesgo.id);
});

test('el panel y la lista exponen la salud; el vendedor solo ve sus clientes', async () => {
  let r = await request(app).get('/api/v1/reportes/resumen').set('Authorization', `Bearer ${tokenS}`);
  assert.equal(r.body.salud.conteo.ambar, 1); assert.equal(r.body.salud.conteo.verde, 1);
  assert.equal(r.body.salud.en_riesgo[0].nombre, 'Gym Riesgo');
  r = await request(app).get('/api/v1/clientes/salud?riesgo=1').set('Authorization', `Bearer ${tokenV}`);
  assert.equal(r.body.length, 1);
  const otro = crearUsuario({ email: 'otro@test.com', nombre: 'Otro', clave: CLAVE, rol: 'vendedor' });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  const t = (await request(app).post('/api/v1/auth/login').send({ email: 'otro@test.com', clave: CLAVE })).body.token;
  r = await request(app).get('/api/v1/clientes/salud').set('Authorization', `Bearer ${t}`);
  assert.equal(r.body.length, 0);
  void otro;
});

test('encuesta de una pregunta: pendiente tras compra o ticket cerrado, se responde una vez y baja la salud si es mala', async () => {
  const pend = encuestasPendientes(riesgo.id);
  assert.ok(pend.some((e) => e.motivo === 'compra'));
  obtenerDb().prepare("UPDATE tickets SET estado = 'cerrado' WHERE cliente_id = ?").run(riesgo.id);
  const conTicket = encuestasPendientes(riesgo.id);
  const ticket = conTicket.find((e) => e.motivo === 'ticket');
  assert.ok(ticket);
  // vía portal
  const lic = obtenerDb().prepare('SELECT clave FROM licencias WHERE cliente_id = ?').get(riesgo.id);
  const acceso = await request(app).post('/api/v1/portal/acceso').send({ clave: lic.clave, contacto: 'r@test.com' });
  const tc = acceso.body.token;
  let r = await request(app).get('/api/v1/portal/encuestas/pendientes').set('Authorization', `Bearer ${tc}`);
  assert.equal(r.body.length, 2);
  r = await request(app).post('/api/v1/portal/encuestas').set('Authorization', `Bearer ${tc}`).send({ motivo: 'ticket', puntaje: 1, comentario: 'Tardaron mucho', ticket_id: ticket.ticket_id });
  assert.equal(r.status, 201);
  r = await request(app).post('/api/v1/portal/encuestas').set('Authorization', `Bearer ${tc}`).send({ motivo: 'ticket', puntaje: 5, ticket_id: ticket.ticket_id });
  assert.equal(r.status, 409, 'no se responde dos veces');
  r = await request(app).get('/api/v1/reportes/encuestas').set('Authorization', `Bearer ${tokenS}`);
  assert.equal(r.body.total.n, 1); assert.equal(r.body.ultimas[0].comentario, 'Tardaron mucho');
  const salud = saludClientes(superadmin).find((c) => c.id === riesgo.id);
  assert.ok(salud.factores.some((f) => /Encuesta/.test(f)));
  void registrarEncuesta;
});

test('campaña de renovaciones: lista las que vencen, genera venta + enlace + mensaje y registra el WhatsApp', async () => {
  let r = await request(app).get('/api/v1/renovaciones?dias=30').set('Authorization', `Bearer ${tokenS}`);
  assert.equal(r.status, 200);
  const fila = r.body.find((x) => x.cliente_nombre === 'Gym Riesgo');
  assert.ok(fila); assert.equal(fila.venta_renovacion_id, null);
  r = await request(app).post('/api/v1/renovaciones/generar').set('Authorization', `Bearer ${tokenS}`).send({ licencia_ids: [fila.id], proveedor: 'demo', enviar: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const res = r.body.resultados[0];
  assert.ok(res.venta_id); assert.match(res.enlace, /pagar\/demo/); assert.match(res.mensaje, /Gym Riesgo/); assert.equal(res.envio, 'sin_configurar');
  r = await request(app).get('/api/v1/renovaciones?dias=30').set('Authorization', `Bearer ${tokenS}`);
  const de = r.body.find((x) => x.id === fila.id);
  assert.equal(de.venta_renovacion_id, res.venta_id); assert.ok(de.enlace_pago); assert.ok(de.ultimo_mensaje);
  // generar de nuevo reutiliza la misma venta
  r = await request(app).post('/api/v1/renovaciones/generar').set('Authorization', `Bearer ${tokenS}`).send({ licencia_ids: [fila.id] });
  assert.equal(r.body.resultados[0].venta_id, res.venta_id);
  const salud = saludClientes(superadmin).find((c) => c.id === riesgo.id);
  assert.ok(!salud.factores.some((f) => /sin renovación en curso/.test(f)), 'con renovación en curso ya no penaliza el vencimiento');
});
