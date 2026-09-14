import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, leerCookies, ponerCookieRenovacion, borrarCookieRenovacion, NOMBRE_COOKIE } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import {
  login, verificar2fa, renovar, salir, cambiarMiClave, solicitarRecuperacion, restablecerClave,
  configurar2fa, activar2fa, desactivar2fa, obtenerUsuario,
} from '../servicios/usuarios.js';
import { listarSesiones, revocarSesionPorId, revocarSesionesUsuario } from '../servicios/seguridad.js';

export const rutasAuth = Router();
const limite = (limit) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false });
const contexto = (req) => ({ ip: req.ip, agente: req.get('user-agent') });

function responderSesion(res, r, status = 200) {
  if (r.renovacion) ponerCookieRenovacion(res, r.renovacion);
  const { renovacion, ...cuerpo } = r;
  res.status(status).json(cuerpo);
}

rutasAuth.post('/login', limite(30), validar(z.object({ email: z.string().email(), clave: z.string().min(1) })),
  asincrono((req, res) => responderSesion(res, login(req.datos, contexto(req)))));

rutasAuth.post('/2fa/verificar', limite(30), validar(z.object({ token_temporal: z.string(), codigo: z.string().min(6).max(7) })),
  asincrono((req, res) => responderSesion(res, verificar2fa(req.datos, contexto(req)))));

rutasAuth.post('/renovar', limite(120), asincrono((req, res) => {
  const r = renovar(leerCookies(req)[NOMBRE_COOKIE], contexto(req));
  responderSesion(res, r);
}));

rutasAuth.post('/salir', asincrono((req, res) => {
  const cabecera = req.get('authorization') || '';
  let usuarioId = null;
  try { usuarioId = cabecera.startsWith('Bearer ') ? JSON.parse(Buffer.from(cabecera.slice(7).split('.')[1], 'base64url').toString()).id : null; } catch { /* sin sesión */ }
  salir(leerCookies(req)[NOMBRE_COOKIE], usuarioId);
  borrarCookieRenovacion(res);
  res.json({ ok: true });
}));

rutasAuth.get('/yo', requerirAuth, (req, res) => res.json({ usuario: obtenerUsuario(req.usuario.id) }));

rutasAuth.post('/cambiar-clave', requerirAuth, validar(z.object({ clave_actual: z.string().min(1), clave_nueva: z.string().min(1) })),
  asincrono((req, res) => { cambiarMiClave(req.usuario, req.datos); res.json({ ok: true }); }));

rutasAuth.post('/recuperar', limite(10), validar(z.object({ email: z.string().email() })),
  asincrono(async (req, res) => { await solicitarRecuperacion(req.datos.email, req.ip); res.json({ ok: true, mensaje: 'Si el correo existe, recibirás un enlace en unos minutos.' }); }));

rutasAuth.post('/restablecer', limite(10), validar(z.object({ token: z.string().min(10), clave: z.string().min(1) })),
  asincrono((req, res) => { restablecerClave(req.datos, req.ip); res.json({ ok: true }); }));

rutasAuth.post('/2fa/configurar', requerirAuth, asincrono((req, res) => res.json(configurar2fa(req.usuario))));
rutasAuth.post('/2fa/activar', requerirAuth, validar(z.object({ codigo: z.string().min(6).max(7) })),
  asincrono((req, res) => { activar2fa(req.usuario, req.datos.codigo); res.json({ ok: true }); }));
rutasAuth.post('/2fa/desactivar', requerirAuth, validar(z.object({ codigo: z.string().min(6).max(7), clave: z.string().min(1) })),
  asincrono((req, res) => { desactivar2fa(req.usuario, req.datos); res.json({ ok: true }); }));

rutasAuth.get('/sesiones', requerirAuth, asincrono((req, res) => res.json(listarSesiones(req.usuario.id))));
rutasAuth.post('/sesiones/:id/revocar', requerirAuth, asincrono((req, res) => { revocarSesionPorId(req.usuario.id, Number(req.params.id)); res.json({ ok: true }); }));
rutasAuth.post('/sesiones/cerrar-todas', requerirAuth, asincrono((req, res) => { revocarSesionesUsuario(req.usuario.id); borrarCookieRenovacion(res); res.json({ ok: true }); }));
