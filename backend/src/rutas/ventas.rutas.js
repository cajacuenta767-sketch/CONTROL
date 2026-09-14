import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { crearVenta, listarVentas, obtenerVenta, registrarPago, confirmarPago, rechazarPago, anularVenta } from '../servicios/ventas.js';

export const rutasVentas = Router();
rutasVentas.use(requerirAuth);

const esquemaVenta = z.object({
  cliente_id: z.number().int(),
  plan_id: z.number().int(),
  cantidad: z.number().int().min(1).max(50).optional(),
  etiquetas: z.array(z.string().max(80)).optional(),
  descuento_pct: z.number().min(0).max(100).optional(),
  vendedor_id: z.number().int().optional(),
  renueva_licencia_id: z.number().int().optional(),
  moneda: z.string().length(3).optional(),
  tipo_cambio: z.number().positive().optional(),
  notas: z.string().max(500).optional(),
});

const esquemaPago = z.object({
  monto: z.number().positive(),
  metodo: z.enum(['efectivo', 'transferencia', 'yape', 'plin', 'tarjeta', 'paypal', 'stripe', 'otro']),
  referencia: z.string().max(120).optional(),
  comprobante: z.string().max(500).optional(),
});

rutasVentas.get('/', asincrono((req, res) => res.json(listarVentas(req.usuario, req.query))));
rutasVentas.get('/:id', asincrono((req, res) => res.json(obtenerVenta(Number(req.params.id), req.usuario))));
rutasVentas.post('/', validar(esquemaVenta), asincrono((req, res) => res.status(201).json(crearVenta(req.datos, req.usuario))));
rutasVentas.post('/:id/pagos', validar(esquemaPago), asincrono((req, res) => res.status(201).json(registrarPago(Number(req.params.id), req.datos, req.usuario))));
rutasVentas.post(
  '/:id/anular',
  requerirRol('superadmin'),
  validar(z.object({ motivo: z.string().min(3) })),
  asincrono((req, res) => res.json(anularVenta(Number(req.params.id), req.datos.motivo, req.usuario)))
);

export const rutasPagos = Router();
rutasPagos.use(requerirAuth, requerirRol('superadmin', 'admin'));
rutasPagos.post('/:id/confirmar', asincrono((req, res) => res.json(confirmarPago(Number(req.params.id), req.usuario))));
rutasPagos.post(
  '/:id/rechazar',
  validar(z.object({ motivo: z.string().min(3) })),
  asincrono((req, res) => res.json(rechazarPago(Number(req.params.id), req.datos.motivo, req.usuario)))
);
