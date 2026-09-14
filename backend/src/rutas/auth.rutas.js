import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { login, cambiarMiClave } from '../servicios/usuarios.js';

export const rutasAuth = Router();

rutasAuth.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }),
  validar(z.object({ email: z.string().email(), clave: z.string().min(1) })),
  asincrono((req, res) => res.json(login(req.datos, req.ip)))
);

rutasAuth.get('/yo', requerirAuth, (req, res) => res.json({ usuario: req.usuario }));

rutasAuth.post(
  '/cambiar-clave',
  requerirAuth,
  validar(z.object({ clave_actual: z.string().min(1), clave_nueva: z.string().min(8) })),
  asincrono((req, res) => { cambiarMiClave(req.usuario, req.datos); res.json({ ok: true }); })
);
