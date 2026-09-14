import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { listarProductos, obtenerProducto, crearProducto, actualizarProducto, crearPlan, actualizarPlan } from '../servicios/catalogo.js';

export const rutasProductos = Router();
rutasProductos.use(requerirAuth);

rutasProductos.get('/', asincrono((req, res) => res.json(listarProductos({ incluirInactivos: req.query.todos === '1' }))));
rutasProductos.get('/:id', asincrono((req, res) => res.json(obtenerProducto(Number(req.params.id)))));
rutasProductos.post(
  '/',
  requerirRol('superadmin'),
  validar(z.object({ codigo: z.string().regex(/^[a-z0-9-]+$/, 'solo minúsculas, números y guiones'), nombre: z.string().min(2), descripcion: z.string().optional() })),
  asincrono((req, res) => res.status(201).json(crearProducto(req.datos, req.usuario)))
);
rutasProductos.patch(
  '/:id',
  requerirRol('superadmin'),
  validar(z.object({ nombre: z.string().min(2).optional(), descripcion: z.string().nullable().optional(), activo: z.boolean().optional() })),
  asincrono((req, res) => res.json(actualizarProducto(Number(req.params.id), req.datos, req.usuario)))
);

export const rutasPlanes = Router();
rutasPlanes.use(requerirAuth, requerirRol('superadmin'));

const esquemaPlan = z.object({
  producto_id: z.number().int(),
  codigo: z.string().regex(/^[a-z0-9-]+$/),
  nombre: z.string().min(2),
  tipo: z.enum(['mensual', 'anual', 'vitalicio', 'sucursal_extra', 'mantenimiento', 'demo']),
  precio: z.number().min(0),
  duracion_dias: z.number().int().positive().nullable().optional(),
  max_activaciones: z.number().int().min(1).optional(),
  comision_pct: z.number().min(0).max(100).nullable().optional(),
});

rutasPlanes.post('/', validar(esquemaPlan), asincrono((req, res) => res.status(201).json(crearPlan(req.datos, req.usuario))));
rutasPlanes.patch(
  '/:id',
  validar(esquemaPlan.partial().omit({ producto_id: true, codigo: true, tipo: true }).extend({ activo: z.boolean().optional() })),
  asincrono((req, res) => res.json(actualizarPlan(Number(req.params.id), req.datos, req.usuario)))
);
