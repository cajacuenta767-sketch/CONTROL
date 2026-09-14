import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { listarProspectos, obtenerProspecto, crearProspecto, actualizarProspecto, convertirProspecto, embudo, ETAPAS } from '../servicios/prospectos.js';

export const rutasProspectos = Router();
rutasProspectos.use(requerirAuth);

const esquema = z.object({
  nombre: z.string().min(2).max(120),
  negocio: z.string().max(120).nullable().optional(),
  telefono: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  rubro: z.string().max(60).nullable().optional(),
  producto_id: z.number().int().nullable().optional(),
  etapa: z.enum(ETAPAS).optional(),
  motivo_perdida: z.string().max(200).nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  vendedor_id: z.number().int().optional(),
  origen: z.string().max(40).optional(),
  proximo_paso: z.string().max(200).nullable().optional(),
  proximo_paso_en: z.string().max(25).nullable().optional(),
});

rutasProspectos.get('/', asincrono((req, res) => res.json(listarProspectos(req.usuario, req.query))));
rutasProspectos.get('/embudo', asincrono((req, res) => res.json(embudo(req.usuario))));
rutasProspectos.get('/:id', asincrono((req, res) => res.json(obtenerProspecto(Number(req.params.id), req.usuario))));
rutasProspectos.post('/', validar(esquema), asincrono((req, res) => res.status(201).json(crearProspecto({ ...req.datos, email: req.datos.email || null }, req.usuario))));
rutasProspectos.patch('/:id', validar(esquema.partial()), asincrono((req, res) => res.json(actualizarProspecto(Number(req.params.id), { ...req.datos, email: req.datos.email === '' ? null : req.datos.email }, req.usuario))));
rutasProspectos.post('/:id/convertir', validar(z.object({ cliente_id: z.number().int().optional() })), asincrono((req, res) => res.json(convertirProspecto(Number(req.params.id), req.datos, req.usuario))));
