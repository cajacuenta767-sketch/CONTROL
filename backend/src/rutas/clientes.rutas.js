import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { listarClientes, obtenerCliente, crearCliente, actualizarCliente, historialCliente } from '../servicios/clientes.js';
import { listarLicencias } from '../servicios/licencias.js';
import { listarVentas } from '../servicios/ventas.js';

export const rutasClientes = Router();
rutasClientes.use(requerirAuth);

const esquema = z.object({
  nombre: z.string().min(2),
  empresa: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  telefono: z.string().nullable().optional(),
  pais: z.string().nullable().optional(),
  moneda: z.string().length(3).optional(),
  notas: z.string().nullable().optional(),
  vendedor_id: z.number().int().optional(),
});

rutasClientes.get('/', asincrono((req, res) => res.json(listarClientes(req.usuario, { q: req.query.q }))));
rutasClientes.get('/:id', asincrono((req, res) => {
  const id = Number(req.params.id);
  const cliente = obtenerCliente(id, req.usuario);
  res.json({ ...cliente, licencias: listarLicencias(req.usuario, { cliente_id: id }), ventas: listarVentas(req.usuario, { cliente_id: id }) });
}));
rutasClientes.get('/:id/historial', asincrono((req, res) => res.json(historialCliente(Number(req.params.id), req.usuario))));
rutasClientes.post('/', validar(esquema), asincrono((req, res) => res.status(201).json(crearCliente(req.datos, req.usuario))));
rutasClientes.patch('/:id', validar(esquema.partial()), asincrono((req, res) => res.json(actualizarCliente(Number(req.params.id), req.datos, req.usuario))));
