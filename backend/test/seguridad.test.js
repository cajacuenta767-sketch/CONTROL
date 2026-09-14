// Se ejecuta con BASE_DATOS=:memory: (ver package.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { obtenerDb, reiniciarDb } from '../src/db.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { codigoTotp, validarClave } from '../src/servicios/seguridad.js';

let app;
const CLAVE = 'ClaveSegura2026';
const cookieDe = (r) => (r.headers['set-cookie'] || []).find((c) => c.startsWith('control_renovar=')) || '';

before(() => {
  reiniciarDb(); obtenerDb(); app = crearApp();
  crearUsuario({ email: 'super@test.com', nombre: 'Super', clave: CLAVE, rol: 'superadmin' });
  crearUsuario({ email: 'ana@test.com', nombre: 'Ana', clave: CLAVE, rol: 'vendedor' });
});
after(() => reiniciarDb());

test('política de contraseñas', () => {
  assert.throws(() => validarClave('corta1'), /10 caracteres/);
  assert.throws(() => validarClave('sinnumerosaqui'), /letras y números/);
  assert.throws(() => validarClave('password123'), /común/);
  assert.throws(() => validarClave('ana.perez2026x', { email: 'ana.perez@x.com' }), /correo/);
  assert.doesNotThrow(() => validarClave('MiClaveBuena77'));
});

test('login entrega token corto y cookie de renovación httpOnly', async () => {
  const r = await request(app).post('/api/v1/auth/login').send({ email: 'ana@test.com', clave: CLAVE });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  const cookie = cookieDe(r);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/v1\/auth/);
});

test('renovar rota la cookie y salir la invalida', async () => {
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'ana@test.com', clave: CLAVE });
  const c1 = cookieDe(login).split(';')[0];
  const r1 = await request(app).post('/api/v1/auth/renovar').set('Cookie', c1);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.ok(r1.body.token);
  const c2 = cookieDe(r1).split(';')[0];
  assert.notEqual(c1, c2, 'la cookie rota en cada renovación');
  const viejo = await request(app).post('/api/v1/auth/renovar').set('Cookie', c1);
  assert.equal(viejo.status, 401, 'la cookie anterior ya no sirve');
  const salir = await request(app).post('/api/v1/auth/salir').set('Cookie', c2).set('Authorization', `Bearer ${r1.body.token}`);
  assert.equal(salir.status, 200);
  const despues = await request(app).post('/api/v1/auth/renovar').set('Cookie', c2);
  assert.equal(despues.status, 401);
});

test('cinco intentos fallidos bloquean la cuenta 15 minutos', async () => {
  for (let i = 1; i <= 4; i++) {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'ana@test.com', clave: 'mala-mala-1' });
    assert.equal(r.status, 401);
    assert.match(r.body.error, new RegExp(`quedan ${5 - i} intento`));
  }
  const r5 = await request(app).post('/api/v1/auth/login').send({ email: 'ana@test.com', clave: 'mala-mala-1' });
  assert.equal(r5.status, 423);
  const correcta = await request(app).post('/api/v1/auth/login').send({ email: 'ana@test.com', clave: CLAVE });
  assert.equal(correcta.status, 423, 'incluso con la clave correcta sigue bloqueada');
  obtenerDb().prepare('UPDATE usuarios SET bloqueado_hasta = NULL WHERE email = ?').run('ana@test.com');
});

test('un usuario creado por el superadmin debe cambiar su contraseña antes de usar el panel', async () => {
  const s = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE });
  const auth = { Authorization: `Bearer ${s.body.token}` };
  let r = await request(app).post('/api/v1/usuarios').set(auth).send({ email: 'nuevo@test.com', nombre: 'Nuevo', clave: 'password123', rol: 'vendedor' });
  assert.equal(r.status, 422, 'rechaza contraseña común');
  r = await request(app).post('/api/v1/usuarios').set(auth).send({ email: 'nuevo@test.com', nombre: 'Nuevo', clave: 'Temporal2026xx', rol: 'vendedor' });
  assert.equal(r.status, 201);
  assert.equal(r.body.debe_cambiar_clave, 1);
  assert.ok(r.body.codigo_ref, 'recibe código de referido');
  const l = await request(app).post('/api/v1/auth/login').send({ email: 'nuevo@test.com', clave: 'Temporal2026xx' });
  assert.equal(l.status, 200);
  const authNuevo = { Authorization: `Bearer ${l.body.token}` };
  const bloqueado = await request(app).get('/api/v1/clientes').set(authNuevo);
  assert.equal(bloqueado.status, 403);
  assert.equal(bloqueado.body.codigo, 'cambiar_clave');
  const cambio = await request(app).post('/api/v1/auth/cambiar-clave').set(authNuevo).send({ clave_actual: 'Temporal2026xx', clave_nueva: 'MiNuevaClave2026' });
  assert.equal(cambio.status, 200);
  const ok = await request(app).get('/api/v1/clientes').set(authNuevo);
  assert.equal(ok.status, 200);
});

test('recuperación de contraseña por correo: el enlace restablece y se consume una sola vez', async () => {
  let r = await request(app).post('/api/v1/auth/recuperar').send({ email: 'noexiste@test.com' });
  assert.equal(r.status, 200, 'respuesta idéntica aunque no exista');
  r = await request(app).post('/api/v1/auth/recuperar').send({ email: 'ana@test.com' });
  assert.equal(r.status, 200);
  const correo = obtenerDb().prepare("SELECT * FROM correos WHERE para = 'ana@test.com' ORDER BY id DESC").get();
  assert.ok(correo, 'queda registrado aunque no haya SMTP');
  assert.equal(correo.estado, 'sin_smtp');
  const token = correo.html.match(/\/restablecer\/([A-Za-z0-9_-]+)/)[1];
  r = await request(app).post('/api/v1/auth/restablecer').send({ token, clave: 'corta' });
  assert.equal(r.status, 422);
  r = await request(app).post('/api/v1/auth/restablecer').send({ token, clave: 'OtraClaveNueva99' });
  assert.equal(r.status, 200);
  r = await request(app).post('/api/v1/auth/restablecer').send({ token, clave: 'OtraClaveNueva99' });
  assert.equal(r.status, 422, 'el token no se reutiliza');
  const l = await request(app).post('/api/v1/auth/login').send({ email: 'ana@test.com', clave: 'OtraClaveNueva99' });
  assert.equal(l.status, 200);
});

test('2FA: configurar, activar, exigir código al entrar y desactivar', async () => {
  const s = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE });
  const auth = { Authorization: `Bearer ${s.body.token}` };
  const conf = await request(app).post('/api/v1/auth/2fa/configurar').set(auth);
  assert.equal(conf.status, 200);
  assert.match(conf.body.url, /^otpauth:\/\/totp\//);
  let r = await request(app).post('/api/v1/auth/2fa/activar').set(auth).send({ codigo: '000000' });
  assert.equal(r.status, 422);
  r = await request(app).post('/api/v1/auth/2fa/activar').set(auth).send({ codigo: codigoTotp(conf.body.secreto) });
  assert.equal(r.status, 200);

  const paso1 = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE });
  assert.equal(paso1.status, 200);
  assert.equal(paso1.body.requiere_2fa, true);
  assert.equal(paso1.body.token, undefined, 'sin código no hay token');
  const mal = await request(app).post('/api/v1/auth/2fa/verificar').send({ token_temporal: paso1.body.token_temporal, codigo: '123456' });
  assert.equal(mal.status, 401);
  const bien = await request(app).post('/api/v1/auth/2fa/verificar').send({ token_temporal: paso1.body.token_temporal, codigo: codigoTotp(conf.body.secreto) });
  assert.equal(bien.status, 200);
  assert.ok(bien.body.token);
  assert.ok(cookieDe(bien));

  const off = await request(app).post('/api/v1/auth/2fa/desactivar').set({ Authorization: `Bearer ${bien.body.token}` }).send({ codigo: codigoTotp(conf.body.secreto), clave: CLAVE });
  assert.equal(off.status, 200);
  const sin2fa = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE });
  assert.ok(sin2fa.body.token);
});

test('sesiones activas se listan y se pueden cerrar todas', async () => {
  const l = await request(app).post('/api/v1/auth/login').send({ email: 'super@test.com', clave: CLAVE });
  const auth = { Authorization: `Bearer ${l.body.token}` };
  const lista = await request(app).get('/api/v1/auth/sesiones').set(auth);
  assert.equal(lista.status, 200);
  assert.ok(lista.body.length >= 1);
  const cerrar = await request(app).post('/api/v1/auth/sesiones/cerrar-todas').set(auth);
  assert.equal(cerrar.status, 200);
  const despues = await request(app).get('/api/v1/auth/sesiones').set(auth);
  assert.equal(despues.body.length, 0);
});

test('cabeceras de seguridad: CSP presente', async () => {
  const r = await request(app).get('/api/v1/salud');
  assert.match(r.headers['content-security-policy'] || '', /default-src 'self'/);
});
