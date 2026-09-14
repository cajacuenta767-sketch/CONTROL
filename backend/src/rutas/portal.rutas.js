import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirCliente } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
import { accesoPortal, resumenPortal, renovarDesdePortal, crearTicket, obtenerTicket, responderTicket, listarTicketsPanel } from '../servicios/portal.js';
import { reciboVenta } from '../servicios/documentos.js';
import { encuestasPendientes, registrarEncuesta } from '../servicios/retencion.js';
import { obtenerDb } from '../db.js';
import { ErrorHttp } from '../middleware/errores.js';

/* ---------- Portal del cliente ---------- */
export const rutasPortal = Router();
rutasPortal.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));

rutasPortal.post('/acceso', validar(z.object({ clave: z.string().min(10), contacto: z.string().min(5) })), asincrono((req, res) => res.json(accesoPortal(req.datos, req.ip))));
rutasPortal.get('/yo', requerirCliente, asincrono((req, res) => res.json(resumenPortal(req.cliente))));
rutasPortal.get('/ventas/:id/recibo.pdf', requerirCliente, asincrono(async (req, res) => {
  const v = obtenerDb().prepare('SELECT cliente_id FROM ventas WHERE id = ?').get(Number(req.params.id));
  if (!v || v.cliente_id !== req.cliente.id) throw new ErrorHttp(404, 'Recibo no encontrado');
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="recibo-${req.params.id}.pdf"`);
  res.send(await reciboVenta(Number(req.params.id)));
}));
rutasPortal.post('/licencias/:id/renovar', requerirCliente, asincrono(async (req, res) => res.json(await renovarDesdePortal(req.cliente, Number(req.params.id)))));
rutasPortal.post('/tickets', requerirCliente, validar(z.object({ asunto: z.string().min(3).max(120), texto: z.string().min(3).max(4000), licencia_id: z.number().int().optional() })),
  asincrono(async (req, res) => res.status(201).json(await crearTicket(req.cliente, req.datos))));
rutasPortal.get('/encuestas/pendientes', requerirCliente, asincrono((req, res) => res.json(encuestasPendientes(req.cliente.id))));
rutasPortal.post('/encuestas', requerirCliente, validar(z.object({ motivo: z.string().max(40), puntaje: z.number().int().min(1).max(5), comentario: z.string().max(500).optional(), ticket_id: z.number().int().optional(), venta_id: z.number().int().optional() })),
  asincrono((req, res) => res.status(201).json(registrarEncuesta(req.cliente, req.datos))));
rutasPortal.get('/tickets/:id', requerirCliente, asincrono((req, res) => res.json(obtenerTicket(Number(req.params.id), { clienteId: req.cliente.id }))));
rutasPortal.post('/tickets/:id/responder', requerirCliente, validar(z.object({ texto: z.string().min(1).max(4000) })),
  asincrono(async (req, res) => res.json(await responderTicket(Number(req.params.id), req.datos, { cliente: req.cliente }))));

/* ---------- Tickets en el panel ---------- */
export const rutasTickets = Router();
rutasTickets.use(requerirAuth);
rutasTickets.get('/', asincrono((req, res) => res.json(listarTicketsPanel(req.usuario, req.query))));
rutasTickets.get('/:id', asincrono((req, res) => res.json(obtenerTicket(Number(req.params.id), { usuario: req.usuario }))));
rutasTickets.post('/:id/responder', validar(z.object({ texto: z.string().min(1).max(4000), cerrar: z.boolean().optional() })),
  asincrono(async (req, res) => res.json(await responderTicket(Number(req.params.id), req.datos, { usuario: req.usuario }))));
