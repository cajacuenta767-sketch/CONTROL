import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { obtenerClaves } from '../firmas.js';
import {
  listarLicencias, obtenerLicencia, actualizarEtiqueta, cambiarEstado, resetearActivaciones,
  ajustarMaxActivaciones, transferirLicencia, activar, latido,
} from '../servicios/licencias.js';

/* ---------- Rutas públicas: las llaman los productos instalados ---------- */
export const rutasLicenciasPublicas = Router();
rutasLicenciasPublicas.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));

rutasLicenciasPublicas.get('/clave-publica', (req, res) => {
  const { publicaPem, publicaCruda } = obtenerClaves();
  res.json({ algoritmo: 'Ed25519', clave_publica_pem: publicaPem, clave_publica_base64: publicaCruda });
});

const esquemaActivar = z.object({
  clave: z.string().min(10),
  producto: z.string().optional(),
  huella: z.string().min(4).max(200),
  dominio: z.string().max(200).optional(),
  nombre_equipo: z.string().max(120).optional(),
  version: z.string().max(40).optional(),
});

rutasLicenciasPublicas.post('/activar', validar(esquemaActivar), asincrono((req, res) => res.json(activar({ ...req.datos, ip: req.ip }))));
rutasLicenciasPublicas.post(
  '/latido',
  validar(z.object({ clave: z.string().min(10), huella: z.string().min(4), version: z.string().max(40).optional() })),
  asincrono((req, res) => res.json(latido({ ...req.datos, ip: req.ip })))
);

/* ---------- Rutas del panel ---------- */
export const rutasLicencias = Router();
rutasLicencias.use(requerirAuth);

rutasLicencias.get('/', asincrono((req, res) => res.json(listarLicencias(req.usuario, req.query))));
rutasLicencias.get('/:id', asincrono((req, res) => res.json(obtenerLicencia(Number(req.params.id), req.usuario))));
rutasLicencias.patch(
  '/:id/etiqueta',
  validar(z.object({ etiqueta: z.string().max(80).nullable() })),
  asincrono((req, res) => res.json(actualizarEtiqueta(Number(req.params.id), req.datos.etiqueta, req.usuario)))
);

const conMotivo = z.object({ motivo: z.string().min(3).max(300) });
const soloSuper = requerirRol('superadmin');
rutasLicencias.post('/:id/suspender', soloSuper, validar(conMotivo), asincrono((req, res) => res.json(cambiarEstado(Number(req.params.id), 'suspendida', req.datos.motivo, req.usuario))));
rutasLicencias.post('/:id/reanudar', soloSuper, validar(conMotivo), asincrono((req, res) => res.json(cambiarEstado(Number(req.params.id), 'activa', req.datos.motivo, req.usuario))));
rutasLicencias.post('/:id/revocar', soloSuper, validar(conMotivo), asincrono((req, res) => res.json(cambiarEstado(Number(req.params.id), 'revocada', req.datos.motivo, req.usuario))));
rutasLicencias.post('/:id/reset', soloSuper, validar(conMotivo), asincrono((req, res) => res.json(resetearActivaciones(Number(req.params.id), req.datos.motivo, req.usuario))));
rutasLicencias.post(
  '/:id/max-activaciones',
  soloSuper,
  validar(conMotivo.extend({ max: z.number().int().min(1).max(100) })),
  asincrono((req, res) => res.json(ajustarMaxActivaciones(Number(req.params.id), req.datos.max, req.datos.motivo, req.usuario)))
);
rutasLicencias.post(
  '/:id/transferir',
  soloSuper,
  validar(conMotivo.extend({ cliente_id: z.number().int() })),
  asincrono((req, res) => res.json(transferirLicencia(Number(req.params.id), req.datos.cliente_id, req.datos.motivo, req.usuario)))
);
