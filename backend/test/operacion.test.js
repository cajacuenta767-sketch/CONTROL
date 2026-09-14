// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import XLSX from 'xlsx';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, guardarAjuste } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto, crearPlan } from '../src/servicios/catalogo.js';
import { crearCliente } from '../src/servicios/clientes.js';
import { crearVenta, registrarPago, confirmarPago } from '../src/servicios/ventas.js';
import { desglosarIgv } from '../src/servicios/facturacion.js';

let app, superadmin, vendedor, cliente, plan, venta, tokens = {};
const CLAVE = 'ClaveSegura2026';
const auth = (r) => ({ Authorization: `Bearer ${tokens[r]}` });
const fetchReal = globalThis.fetch;

before(async () => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  superadmin = crearUsuario({ email: 'dueno@test.com', nombre: 'Dueño', clave: CLAVE, rol: 'superadmin' });
  vendedor = crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  crearUsuario({ email: 'soporte@test.com', nombre: 'Soporte', clave: CLAVE, rol: 'soporte' });
  crearUsuario({ email: 'conta@test.com', nombre: 'Contador', clave: CLAVE, rol: 'contador' });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  const p = crearProducto({ codigo: 'farmasys', nombre: 'FarmaSys' }, superadmin);
  plan = crearPlan({ producto_id: p.id, codigo: 'anual', nombre: 'Anual', tipo: 'anual', precio: 349 }, superadmin);
  cliente = crearCliente({ nombre: 'Farmacia Central', email: 'f@test.com', documento_tipo: 'RUC', documento: '20123456789', razon_social: 'Farmacia Central SAC', direccion: 'Av. Lima 123' }, vendedor);
  venta = crearVenta({ cliente_id: cliente.id, plan_id: plan.id, moneda: 'PEN' }, vendedor);
  confirmarPago(registrarPago(venta.id, { monto: venta.total, metodo: 'yape' }, vendedor).pagos[0].id, superadmin);
  for (const [r, e] of [['superadmin', 'dueno@test.com'], ['vendedor', 'vende@test.com'], ['soporte', 'soporte@test.com'], ['contador', 'conta@test.com']]) tokens[r] = (await request(app).post('/api/v1/auth/login').send({ email: e, clave: CLAVE })).body.token;
});
after(() => { reiniciarDb(); globalThis.fetch = fetchReal; });

test('rol soporte: ve clientes, licencias y tickets de toda la cartera pero no registra ventas ni ve comisiones', async () => {
  let r = await request(app).get('/api/v1/licencias').set(auth('soporte'));
  assert.equal(r.status, 200); assert.equal(r.body.length, 1);
  r = await request(app).get(`/api/v1/licencias/${r.body[0].id}`).set(auth('soporte'));
  assert.equal(r.status, 200);
  r = await request(app).post(`/api/v1/licencias/${r.body.id}/emergencia`).set(auth('soporte')).send({ huella: 'pc-farmacia', motivo: 'sin internet' });
  assert.equal(r.status, 201, 'soporte emite códigos de emergencia');
  r = await request(app).get('/api/v1/tickets').set(auth('soporte'));
  assert.equal(r.status, 200);
  r = await request(app).post('/api/v1/ventas').set(auth('soporte')).send({ cliente_id: cliente.id, plan_id: plan.id });
  assert.equal(r.status, 403);
  r = await request(app).post('/api/v1/clientes').set(auth('soporte')).send({ nombre: 'Nuevo' });
  assert.equal(r.status, 403);
  r = await request(app).get('/api/v1/comisiones').set(auth('soporte'));
  assert.equal(r.body.length, 0);
});

test('rol contador: ve caja y comisiones de todos y exporta el Excel, pero no liquida ni vende', async () => {
  let r = await request(app).get('/api/v1/comisiones').set(auth('contador'));
  assert.equal(r.status, 200); assert.ok(r.body.length >= 1, 've las comisiones de todos');
  r = await request(app).get('/api/v1/caja').set(auth('contador'));
  assert.equal(r.status, 200);
  r = await request(app).post('/api/v1/liquidaciones').set(auth('contador')).send({ vendedor_id: vendedor.id, desde: '2020-01-01', hasta: '2030-01-01' });
  assert.equal(r.status, 403);
  r = await request(app).post('/api/v1/ventas').set(auth('contador')).send({ cliente_id: cliente.id, plan_id: plan.id });
  assert.equal(r.status, 403);
  const mes = new Date().toISOString().slice(0, 7);
  r = await request(app).get(`/api/v1/reportes/contable?mes=${mes}&formato=json`).set(auth('contador'));
  assert.equal(r.status, 200); assert.equal(r.body.resumen.find((x) => x.Concepto === 'Cobros confirmados').Valor, 1);
  r = await request(app).get(`/api/v1/reportes/contable?mes=${mes}`).set(auth('contador')).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /spreadsheetml/);
  const wb = XLSX.read(r.body, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Resumen', 'Ventas', 'Cobros', 'Cobros por método', 'Comisiones', 'Cierres de caja', 'Comprobantes']);
  const cobros = XLSX.utils.sheet_to_json(wb.Sheets.Cobros);
  assert.equal(cobros[0].Cliente, 'Farmacia Central'); assert.equal(cobros[0]['Método'], 'yape');
  r = await request(app).get(`/api/v1/reportes/contable?mes=${mes}`).set(auth('vendedor'));
  assert.equal(r.status, 403);
});

test('facturación: desglose de IGV y emisión con proveedor manual y con Nubefact (fetch simulado)', async () => {
  guardarAjuste('igv_pct', '18'); guardarAjuste('precios_incluyen_igv', '1');
  const d = desglosarIgv(118);
  assert.equal(d.base, 100); assert.equal(d.igv, 18);
  let r = await request(app).post(`/api/v1/ventas/${venta.id}/comprobantes`).set(auth('superadmin')).send({ tipo: 'factura' });
  assert.equal(r.status, 422, 'sin proveedor configurado no emite');
  guardarAjuste('facturacion_proveedor', 'manual');
  r = await request(app).post(`/api/v1/ventas/${venta.id}/comprobantes`).set(auth('contador')).send({ tipo: 'factura' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.serie, 'F001'); assert.equal(r.body.numero, '1'); assert.equal(r.body.estado, 'aceptado'); assert.equal(r.body.cliente_documento, '20123456789');
  assert.equal(r.body.total, venta.total); assert.equal(r.body.igv, Math.round((venta.total - venta.total / 1.18) * 100) / 100);
  r = await request(app).post(`/api/v1/ventas/${venta.id}/comprobantes`).set(auth('superadmin')).send({ tipo: 'factura' });
  assert.equal(r.body.numero, '1', 'no duplica el comprobante de la misma venta');
  // Nubefact
  guardarAjuste('facturacion_proveedor', 'nubefact'); guardarAjuste('nubefact_url', 'https://api.nubefact.com/api/v1/xxx'); guardarAjuste('nubefact_token', 'tok');
  const v2 = crearVenta({ cliente_id: cliente.id, plan_id: plan.id, moneda: 'PEN' }, vendedor);
  let enviado;
  globalThis.fetch = async (url, opts) => { enviado = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization }; return { ok: true, json: async () => ({ aceptada_por_sunat: true, enlace_del_pdf: 'https://nubefact/pdf/1', enlace_del_xml: 'https://nubefact/xml/1', codigo_hash: 'abc' }) }; };
  r = await request(app).post(`/api/v1/ventas/${v2.id}/comprobantes`).set(auth('superadmin')).send({ tipo: 'boleta', cliente: { documento_tipo: 'DNI', documento: '12345678', razon_social: 'Juan Pérez' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.estado, 'aceptado'); assert.equal(r.body.serie, 'B001'); assert.equal(r.body.enlace_pdf, 'https://nubefact/pdf/1');
  assert.equal(enviado.body.operacion, 'generar_comprobante'); assert.equal(enviado.body.tipo_de_comprobante, 2); assert.equal(enviado.body.cliente_tipo_de_documento, '1'); assert.equal(enviado.body.moneda, 1);
  assert.equal(enviado.auth, 'Token token="tok"');
  assert.equal(Math.round((enviado.body.total_gravada + enviado.body.total_igv) * 100) / 100, enviado.body.total);
  // datos fiscales guardados en el cliente
  const c = obtenerDb().prepare('SELECT documento_tipo, documento FROM clientes WHERE id = ?').get(cliente.id);
  assert.equal(c.documento_tipo, 'DNI');
  // anulación
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ sunat_ticket_numero: '1' }) });
  r = await request(app).post(`/api/v1/comprobantes/${r.body.id}/anular`).set(auth('superadmin')).send({ motivo: 'Error en datos' });
  assert.equal(r.status, 200); assert.equal(r.body.estado, 'anulado');
  // el vendedor ve los comprobantes de su venta pero no emite
  r = await request(app).get(`/api/v1/ventas/${venta.id}/comprobantes`).set(auth('vendedor'));
  assert.equal(r.status, 200); assert.equal(r.body.comprobantes.length, 1);
  r = await request(app).post(`/api/v1/ventas/${venta.id}/comprobantes`).set(auth('vendedor')).send({});
  assert.equal(r.status, 403);
  r = await request(app).get(`/api/v1/comprobantes?mes=${new Date().toISOString().slice(0, 7)}`).set(auth('contador'));
  assert.equal(r.body.length, 2);
  guardarAjuste('facturacion_proveedor', 'ninguno'); globalThis.fetch = fetchReal;
});

test('facturación automática al confirmar un pago', async () => {
  guardarAjuste('facturacion_proveedor', 'manual'); guardarAjuste('facturar_automatico', '1');
  const v3 = crearVenta({ cliente_id: cliente.id, plan_id: plan.id, moneda: 'PEN' }, vendedor);
  const pagoId = registrarPago(v3.id, { monto: v3.total, metodo: 'efectivo' }, vendedor).pagos[0].id;
  const r = await request(app).post(`/api/v1/pagos/${pagoId}/confirmar`).set(auth('superadmin'));
  assert.equal(r.status, 200);
  assert.equal(r.body.comprobantes.length, 1); assert.equal(r.body.comprobantes[0].tipo, 'boleta', 'el cliente quedó con DNI, así que boleta');
  guardarAjuste('facturar_automatico', '0'); guardarAjuste('facturacion_proveedor', 'ninguno');
});
