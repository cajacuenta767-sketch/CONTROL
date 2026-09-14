import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol, ROLES } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { listarUsuarios, crearUsuario, actualizarUsuario, obtenerUsuario, quitar2faAdmin, guardarMeta, listarMetas } from '../servicios/usuarios.js';

export const rutasUsuarios = Router();
rutasUsuarios.use(requerirAuth);

const esquemaCrear = z.object({
  email: z.string().email(),
  nombre: z.string().min(2),
  clave: z.string().min(1),
  rol: z.enum(ROLES),
  comision_pct: z.number().min(0).max(100).optional(),
  tope_emisiones_dia: z.number().int().min(0).optional(),
  tope_demos_semana: z.number().int().min(0).optional(),
  telefono: z.string().optional(),
  cupo_licencias: z.number().int().min(0).nullable().optional(),
  descuento_mayorista_pct: z.number().min(0).max(90).nullable().optional(),
  marca_nombre: z.string().max(80).nullable().optional(),
});

rutasUsuarios.get('/', requerirRol('superadmin', 'admin'), asincrono((req, res) => res.json(listarUsuarios({ conDinero: req.usuario.rol === 'superadmin' }))));
rutasUsuarios.get('/:id', requerirRol('superadmin', 'admin'), asincrono((req, res) => res.json(obtenerUsuario(Number(req.params.id)))));
rutasUsuarios.post('/', requerirRol('superadmin'), validar(esquemaCrear), asincrono((req, res) => res.status(201).json(crearUsuario(req.datos, req.usuario))));
rutasUsuarios.patch(
  '/:id',
  requerirRol('superadmin'),
  validar(esquemaCrear.partial().omit({ email: true }).extend({ activo: z.boolean().optional(), desbloquear: z.boolean().optional() })),
  asincrono((req, res) => res.json(actualizarUsuario(Number(req.params.id), req.datos, req.usuario)))
);
rutasUsuarios.post('/:id/quitar-2fa', requerirRol('superadmin'), asincrono((req, res) => res.json(quitar2faAdmin(Number(req.params.id), req.usuario))));

// Metas mensuales por vendedor
rutasUsuarios.get('/metas/lista', asincrono((req, res) => res.json(listarMetas({ mes: req.query.mes, usuario_id: req.query.usuario_id ? Number(req.query.usuario_id) : undefined }))));
rutasUsuarios.post(
  '/metas',
  requerirRol('superadmin'),
  validar(z.object({ usuario_id: z.number().int(), mes: z.string().regex(/^\d{4}-\d{2}$/), objetivo_monto: z.number().min(0), bono_pct: z.number().min(0).max(100).optional() })),
  asincrono((req, res) => res.status(201).json(guardarMeta(req.datos, req.usuario)))
);
