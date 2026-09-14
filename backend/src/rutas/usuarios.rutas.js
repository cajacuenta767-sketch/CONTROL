import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol, ROLES } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { listarUsuarios, crearUsuario, actualizarUsuario, obtenerUsuario } from '../servicios/usuarios.js';

export const rutasUsuarios = Router();
rutasUsuarios.use(requerirAuth);

const esquemaCrear = z.object({
  email: z.string().email(),
  nombre: z.string().min(2),
  clave: z.string().min(8),
  rol: z.enum(ROLES),
  comision_pct: z.number().min(0).max(100).optional(),
  tope_emisiones_dia: z.number().int().min(0).optional(),
  tope_demos_semana: z.number().int().min(0).optional(),
  telefono: z.string().optional(),
});

rutasUsuarios.get('/', requerirRol('superadmin', 'admin'), asincrono((req, res) => res.json(listarUsuarios())));
rutasUsuarios.get('/:id', requerirRol('superadmin', 'admin'), asincrono((req, res) => res.json(obtenerUsuario(Number(req.params.id)))));
rutasUsuarios.post('/', requerirRol('superadmin'), validar(esquemaCrear), asincrono((req, res) => res.status(201).json(crearUsuario(req.datos, req.usuario))));
rutasUsuarios.patch(
  '/:id',
  requerirRol('superadmin'),
  validar(esquemaCrear.partial().omit({ email: true })),
  asincrono((req, res) => res.json(actualizarUsuario(Number(req.params.id), req.datos, req.usuario)))
);
