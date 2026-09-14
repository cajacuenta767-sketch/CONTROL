import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono, ErrorHttp } from '../middleware/errores.js';
import { crearVenta, listarVentas, obtenerVenta, registrarPago, confirmarPago, rechazarPago, anularVenta, adjuntarComprobante, obtenerPago } from '../servicios/ventas.js';
import { crearEnlace, proveedoresDisponibles } from '../servicios/pagos_en_linea.js';
import { alertarDuenoSinEsperar } from '../servicios/mensajeria.js';
import { reciboVenta, reciboPago } from '../servicios/documentos.js';

export const DIR_COMPROBANTES = resolve(dirname(fileURLToPath(import.meta.url)), '../../datos/comprobantes');

const subir = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { mkdirSync(DIR_COMPROBANTES, { recursive: true }); cb(null, DIR_COMPROBANTES); },
    filename: (req, file, cb) => cb(null, `pago-${req.params.id}-${Date.now()}${extname(file.originalname || '').toLowerCase().slice(0, 6) || '.bin'}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
    cb(ok ? null : new ErrorHttp(422, 'Solo se aceptan imágenes JPG, PNG, WebP o PDF'), ok);
  },
});

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
  cuotas: z.number().int().min(1).max(12).optional(),
});

const esquemaPago = z.object({
  monto: z.number().positive(),
  metodo: z.enum(['efectivo', 'transferencia', 'yape', 'plin', 'tarjeta', 'paypal', 'stripe', 'otro']),
  referencia: z.string().max(120).optional(),
  comprobante: z.string().max(500).optional(),
});

const pdf = (res, nombre, buffer) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${nombre}"`); res.send(buffer); };

rutasVentas.get('/', asincrono((req, res) => res.json(listarVentas(req.usuario, req.query))));
rutasVentas.get('/pasarelas', (req, res) => res.json(proveedoresDisponibles()));
rutasVentas.get('/:id', asincrono((req, res) => res.json(obtenerVenta(Number(req.params.id), req.usuario))));
rutasVentas.get('/:id/recibo.pdf', asincrono(async (req, res) => { obtenerVenta(Number(req.params.id), req.usuario); pdf(res, `recibo-venta-${req.params.id}.pdf`, await reciboVenta(Number(req.params.id))); }));
rutasVentas.post('/', validar(esquemaVenta), asincrono((req, res) => res.status(201).json(crearVenta(req.datos, req.usuario))));
rutasVentas.post('/:id/pagos', validar(esquemaPago), asincrono((req, res) => {
  const v = registrarPago(Number(req.params.id), req.datos, req.usuario);
  if (req.usuario.rol !== 'superadmin') alertarDuenoSinEsperar('pago_por_confirmar', `${req.usuario.nombre} registró ${req.datos.monto} ${v.moneda} (${req.datos.metodo}) de ${v.cliente_nombre} · venta ${v.numero}`, { referencia: `${v.id}:${v.pagos.length}`, url: `/ventas/${v.id}` });
  res.status(201).json(v);
}));
rutasVentas.post('/:id/enlace-pago', validar(z.object({ proveedor: z.enum(['demo', 'stripe', 'paypal', 'culqi']) })),
  asincrono(async (req, res) => res.status(201).json(await crearEnlace(Number(req.params.id), req.datos.proveedor, req.usuario))));
rutasVentas.post(
  '/:id/anular',
  requerirRol('superadmin'),
  validar(z.object({ motivo: z.string().min(3) })),
  asincrono((req, res) => res.json(anularVenta(Number(req.params.id), req.datos.motivo, req.usuario)))
);

export const rutasPagos = Router();
rutasPagos.use(requerirAuth);
rutasPagos.post('/:id/confirmar', requerirRol('superadmin', 'admin'), asincrono((req, res) => res.json(confirmarPago(Number(req.params.id), req.usuario))));
rutasPagos.post(
  '/:id/rechazar',
  requerirRol('superadmin', 'admin'),
  validar(z.object({ motivo: z.string().min(3) })),
  asincrono((req, res) => res.json(rechazarPago(Number(req.params.id), req.datos.motivo, req.usuario)))
);
rutasPagos.get('/:id/recibo.pdf', asincrono(async (req, res) => { obtenerPago(Number(req.params.id), req.usuario); pdf(res, `recibo-pago-${req.params.id}.pdf`, await reciboPago(Number(req.params.id))); }));
rutasPagos.post('/:id/comprobante', (req, res, next) => subir.single('archivo')(req, res, (e) => next(e instanceof ErrorHttp ? e : e ? new ErrorHttp(422, e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 5 MB' : e.message) : undefined)),
  asincrono((req, res) => {
    if (!req.file) throw new ErrorHttp(422, 'Adjunta un archivo en el campo "archivo"');
    res.json(adjuntarComprobante(Number(req.params.id), req.file.filename, req.usuario));
  }));
rutasPagos.get('/:id/comprobante', asincrono((req, res) => {
  const pago = obtenerPago(Number(req.params.id), req.usuario);
  if (!pago.comprobante_archivo) throw new ErrorHttp(404, 'Este pago no tiene comprobante adjunto');
  const ruta = resolve(DIR_COMPROBANTES, pago.comprobante_archivo);
  if (!ruta.startsWith(DIR_COMPROBANTES) || !existsSync(ruta)) throw new ErrorHttp(404, 'Archivo no encontrado');
  res.sendFile(ruta);
}));
