import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { buscarActualizacion, archivoDescarga, listarVersiones, publicarVersion, despublicarVersion, asegurarDirVersiones } from '../servicios/versiones.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono, ErrorHttp } from '../middleware/errores.js';
import { obtenerClaves } from '../firmas.js';
import {
  listarLicencias, obtenerLicencia, actualizarEtiqueta, cambiarEstado, resetearActivaciones,
  ajustarMaxActivaciones, transferirLicencia, activar, latido, crearCodigoEmergencia,
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

rutasLicenciasPublicas.post('/actualizacion', validar(z.object({ clave: z.string().min(10), huella: z.string().min(4), producto: z.string().optional(), version: z.string().optional() })),
  asincrono((req, res) => res.json(buscarActualizacion(req.datos))));
rutasLicenciasPublicas.get('/actualizacion/:id/descargar', asincrono((req, res) => {
  const { ruta, nombre } = archivoDescarga(Number(req.params.id), { clave: String(req.query.clave || ''), huella: String(req.query.huella || '') });
  res.download(ruta, nombre);
}));
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
rutasLicencias.post(
  '/:id/emergencia',
  validar(z.object({ huella: z.string().min(4).max(128), motivo: z.string().min(3).max(300) })),
  asincrono((req, res) => res.status(201).json(crearCodigoEmergencia(Number(req.params.id), req.datos, req.usuario)))
);

/* ---------- Versiones publicadas (solo superadmin) ---------- */
const subirVersion = multer({
  storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, asegurarDirVersiones()), filename: (req, file, cb) => cb(null, `p${req.params.id}-${Date.now()}${extname(file.originalname || '').toLowerCase().slice(0, 8) || '.bin'}`) }),
  limits: { fileSize: 500 * 1024 * 1024 },
});
export const rutasVersiones = Router();
const soloDueno = [requerirAuth, requerirRol('superadmin')];
rutasVersiones.get('/:id/versiones', ...soloDueno, asincrono((req, res) => res.json(listarVersiones(Number(req.params.id)))));
rutasVersiones.post('/:id/versiones', ...soloDueno, (req, res, next) => subirVersion.single('archivo')(req, res, (e) => next(e ? new ErrorHttp(422, e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 500 MB' : e.message) : undefined)),
  asincrono((req, res) => res.status(201).json(publicarVersion(Number(req.params.id), { version: req.body.version, notas: req.body.notas, archivo: req.file?.filename, url_externa: req.body.url_externa || undefined, marcar_actual: req.body.marcar_actual !== '0' && req.body.marcar_actual !== false }, req.usuario))));
rutasVersiones.delete('/:id/versiones/:vid', ...soloDueno, asincrono((req, res) => res.json(despublicarVersion(Number(req.params.vid), req.usuario))));
