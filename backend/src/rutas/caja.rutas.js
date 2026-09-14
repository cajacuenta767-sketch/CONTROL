import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol, esGestor } from '../middleware/auth.js';
import { asincrono, prohibido } from '../middleware/errores.js';
import {
  resumenDia, cerrarCaja, listarCierres, obtenerCierre, revisarCierre,
  listarComisiones, crearLiquidacion, listarLiquidaciones, obtenerLiquidacion, pagarLiquidacion,
} from '../servicios/caja.js';
import { cierreCajaPdf, reciboLiquidacion } from '../servicios/documentos.js';

const pdf = (res, nombre, buffer) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${nombre}"`); res.send(buffer); };

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD');

export const rutasCaja = Router();
rutasCaja.use(requerirAuth);

// Vista previa del día (propia, o de otro vendedor si eres gestor).
rutasCaja.get('/dia', asincrono((req, res) => {
  const vendedorId = req.query.vendedor_id ? Number(req.query.vendedor_id) : req.usuario.id;
  if (vendedorId !== req.usuario.id && !esGestor(req.usuario)) throw prohibido();
  res.json(resumenDia(vendedorId, req.query.fecha || undefined));
}));
rutasCaja.post('/cerrar', validar(z.object({ fecha: fecha.optional(), observacion: z.string().max(500).optional() })), asincrono((req, res) => res.status(201).json(cerrarCaja(req.usuario, req.datos))));
rutasCaja.get('/', asincrono((req, res) => res.json(listarCierres(req.usuario, req.query))));
rutasCaja.get('/:id', asincrono((req, res) => res.json(obtenerCierre(Number(req.params.id), req.usuario))));
rutasCaja.get('/:id/cierre.pdf', asincrono(async (req, res) => { obtenerCierre(Number(req.params.id), req.usuario); pdf(res, `cierre-caja-${req.params.id}.pdf`, await cierreCajaPdf(Number(req.params.id))); }));
rutasCaja.post(
  '/:id/revisar',
  requerirRol('superadmin'),
  validar(z.object({ estado: z.enum(['aprobado', 'observado']), observacion: z.string().max(500).optional() })),
  asincrono((req, res) => res.json(revisarCierre(Number(req.params.id), req.datos, req.usuario)))
);

export const rutasComisiones = Router();
rutasComisiones.use(requerirAuth);
rutasComisiones.get('/', asincrono((req, res) => res.json(listarComisiones(req.usuario, req.query))));

export const rutasLiquidaciones = Router();
rutasLiquidaciones.use(requerirAuth);
rutasLiquidaciones.get('/', asincrono((req, res) => res.json(listarLiquidaciones(req.usuario, req.query))));
rutasLiquidaciones.get('/:id', asincrono((req, res) => res.json(obtenerLiquidacion(Number(req.params.id), req.usuario))));
rutasLiquidaciones.get('/:id/recibo.pdf', asincrono(async (req, res) => { obtenerLiquidacion(Number(req.params.id), req.usuario); pdf(res, `liquidacion-${req.params.id}.pdf`, await reciboLiquidacion(Number(req.params.id))); }));
rutasLiquidaciones.post(
  '/',
  requerirRol('superadmin'),
  validar(z.object({ vendedor_id: z.number().int(), desde: fecha, hasta: fecha })),
  asincrono((req, res) => res.status(201).json(crearLiquidacion(req.datos, req.usuario)))
);
rutasLiquidaciones.post('/:id/pagar', requerirRol('superadmin'), asincrono((req, res) => res.json(pagarLiquidacion(Number(req.params.id), req.usuario))));
