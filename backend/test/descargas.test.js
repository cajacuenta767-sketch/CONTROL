// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb, guardarAjuste } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { DIR_DESCARGAS } from '../src/servicios/descargas.js';
import { obtenerClaves } from '../src/firmas.js';

let app, tokenS, tokenV;
const CLAVE = 'ClaveSegura2026';
before(async () => {
  reiniciarDb(); obtenerDb(); obtenerClaves(); app = crearApp();
  crearUsuario({ email: 'dueno@test.com', nombre: 'Dueño', clave: CLAVE, rol: 'superadmin' });
  crearUsuario({ email: 'vende@test.com', nombre: 'Vendedor', clave: CLAVE, rol: 'vendedor' });
  obtenerDb().prepare('UPDATE usuarios SET debe_cambiar_clave = 0').run();
  tokenS = (await request(app).post('/api/v1/auth/login').send({ email: 'dueno@test.com', clave: CLAVE })).body.token;
  tokenV = (await request(app).post('/api/v1/auth/login').send({ email: 'vende@test.com', clave: CLAVE })).body.token;
  guardarAjuste('url_publica', 'https://control.test');
});
after(() => { reiniciarDb(); if (existsSync(DIR_DESCARGAS)) rmSync(DIR_DESCARGAS, { recursive: true, force: true }); });

test('landing de descarga: sin archivos no hay nada; con URL externa o archivo subido aparece; el archivo tiene prioridad', async () => {
  let r = await request(app).get('/api/v1/publico/descargas');
  assert.equal(r.status, 200); assert.equal(r.body.plataformas.android.disponible, false); assert.equal(r.body.version, '1.0.0');
  guardarAjuste('descarga_android_url', 'https://github.com/x/y/releases/download/apps-v1.0.0/CONTROL-android.apk');
  r = await request(app).get('/api/v1/publico/descargas');
  assert.equal(r.body.plataformas.android.origen, 'externa'); assert.match(r.body.plataformas.android.url, /github\.com/);
  // el vendedor no puede subir instaladores
  r = await request(app).post('/api/v1/sistema/descargas/windows').set('Authorization', `Bearer ${tokenV}`).attach('archivo', Buffer.from('MZ fake exe'), 'CONTROL-Instalador-1.0.0.exe');
  assert.equal(r.status, 403);
  // el dueño sube el instalador de Windows y el APK
  r = await request(app).post('/api/v1/sistema/descargas/windows').set('Authorization', `Bearer ${tokenS}`).attach('archivo', Buffer.from('MZ fake exe'), 'CONTROL-Instalador-1.0.0.exe');
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.plataformas.windows.origen, 'archivo'); assert.equal(r.body.plataformas.windows.tamano, 11);
  r = await request(app).post('/api/v1/sistema/descargas/android').set('Authorization', `Bearer ${tokenS}`).attach('archivo', Buffer.from('PK fake apk'), 'app.apk');
  assert.equal(r.status, 201); assert.equal(r.body.plataformas.android.origen, 'archivo', 'el archivo subido gana a la URL externa');
  // extensión equivocada rechazada
  r = await request(app).post('/api/v1/sistema/descargas/android').set('Authorization', `Bearer ${tokenS}`).attach('archivo', Buffer.from('x'), 'malo.exe');
  assert.equal(r.status, 422);
  // descarga pública con nombre y tipo correctos
  r = await request(app).get('/api/v1/publico/descargas/windows').buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(r.status, 200); assert.match(r.headers['content-disposition'], /CONTROL-Instalador\.exe/); assert.equal(r.body.toString(), 'MZ fake exe');
  r = await request(app).get('/api/v1/publico/descargas/android');
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /android/);
  r = await request(app).get('/api/v1/publico/descargas/linux');
  assert.equal(r.status, 404);
  // quitar
  r = await request(app).delete('/api/v1/sistema/descargas/android').set('Authorization', `Bearer ${tokenS}`);
  assert.equal(r.body.plataformas.android.origen, 'externa', 'vuelve a la URL externa');
  assert.ok(obtenerDb().prepare("SELECT 1 FROM auditoria WHERE accion = 'descargas.descarga'").get());
});

test('los ajustes de las fases nuevas se leen y se guardan desde el panel (culqi, whatsapp, facturación, descargas)', async () => {
  let r = await request(app).get('/api/v1/ajustes').set('Authorization', `Bearer ${tokenS}`);
  for (const k of ['culqi_clave_publica', 'whatsapp_token', 'telegram_chat_id', 'facturacion_proveedor', 'nubefact_url', 'descarga_windows_url', 'tope_descuento_admin_pct', 'niveles_precio', 'demo_autoservicio']) assert.ok(k in r.body, `falta ${k}`);
  assert.equal('clave_privada_pem' in r.body, false, 'la clave privada nunca sale');
  r = await request(app).patch('/api/v1/ajustes').set('Authorization', `Bearer ${tokenS}`).send({ descarga_android_url: 'https://ejemplo.test/CONTROL.apk', telegram_chat_id: '42', facturacion_proveedor: 'manual', clave_privada_pem: 'hackeada', inventado: 'x' });
  assert.equal(r.status, 200);
  r = await request(app).get('/api/v1/publico/descargas');
  assert.equal(r.body.plataformas.android.url, 'https://ejemplo.test/CONTROL.apk');
  assert.equal(r.body.plataformas.windows.origen, 'archivo', 'el archivo subido antes sigue teniendo prioridad');
  assert.equal(obtenerDb().prepare("SELECT valor FROM ajustes WHERE clave = 'telegram_chat_id'").get().valor, '42');
  assert.equal(obtenerDb().prepare("SELECT valor FROM ajustes WHERE clave = 'clave_privada_pem'").get().valor.startsWith('-----BEGIN'), true, 'la clave privada no se toca');
  assert.equal(obtenerDb().prepare("SELECT 1 FROM ajustes WHERE clave = 'inventado'").get(), undefined, 'no se crean claves nuevas');
  r = await request(app).patch('/api/v1/ajustes').set('Authorization', `Bearer ${tokenS}`).send({ niveles_precio: 'no es json' });
  assert.equal(r.status, 422);
});
