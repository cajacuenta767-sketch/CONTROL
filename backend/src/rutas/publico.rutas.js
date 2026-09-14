import { Router, raw } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { asincrono, ErrorHttp } from '../middleware/errores.js';
import { ajuste } from '../db.js';
import { catalogoPublico, vendedorPorCodigo, crearPedido, estadoPedidoPublico } from '../servicios/publico.js';
import { obtenerEnlacePublico, confirmarDemo, paypalCapturar, verificarFirmaStripe, webhookStripe, culqiDatosCheckout, culqiCobrarConToken, webhookCulqi } from '../servicios/pagos_en_linea.js';

const urlPublica = () => ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '');

/* ---------- Público (catálogo, pedidos, pagos) ---------- */
export const rutasPublico = Router();
rutasPublico.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));

rutasPublico.get('/catalogo', asincrono((req, res) => res.json(catalogoPublico())));
rutasPublico.get('/vendedor/:codigo', asincrono((req, res) => {
  const v = vendedorPorCodigo(req.params.codigo);
  if (!v) throw new ErrorHttp(404, 'Código de vendedor no válido');
  res.json(v);
}));

const esquemaPedido = z.object({
  plan_id: z.number().int(),
  cantidad: z.number().int().min(1).max(20).optional(),
  etiquetas: z.array(z.string().max(80)).optional(),
  ref: z.string().max(20).optional(),
  moneda: z.string().length(3).optional(),
  pasarela: z.enum(['demo', 'stripe', 'paypal', 'culqi']).optional(),
  notas: z.string().max(300).optional(),
  cliente: z.object({ nombre: z.string().min(2).max(120), empresa: z.string().max(120).optional(), email: z.string().email(), telefono: z.string().max(40).optional(), pais: z.string().max(5).optional() }),
});

/** Pedido desde la web de compra (sin clave) o desde DevMarket/otros (con X-Api-Key). */
const verificarApiKey = (req, res, next) => {
  const clave = req.get('x-api-key');
  const claveConfigurada = ajuste('api_key_pedidos', '');
  req.origenPedido = clave ? (claveConfigurada && clave === claveConfigurada ? 'api' : null) : 'web';
  if (!req.origenPedido) return next(new ErrorHttp(401, 'API key inválida'));
  next();
};
rutasPublico.post('/pedidos', rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }), verificarApiKey, validar(esquemaPedido),
  asincrono(async (req, res) => res.status(201).json(await crearPedido(req.datos, { origen: req.origenPedido, ip: req.ip }))));

rutasPublico.get('/pedidos/:numero', asincrono((req, res) => res.json(estadoPedidoPublico(req.params.numero, req.query.email))));

rutasPublico.get('/enlaces/:id', asincrono((req, res) => res.json(obtenerEnlacePublico(Number(req.params.id)))));
rutasPublico.post('/enlaces/:id/demo/confirmar', asincrono((req, res) => res.json(confirmarDemo(Number(req.params.id)))));
rutasPublico.get('/enlaces/:id/culqi', asincrono((req, res) => res.json(culqiDatosCheckout(Number(req.params.id)))));
rutasPublico.post('/enlaces/:id/culqi/cargo', validar(z.object({ token_id: z.string().min(5).max(80), email: z.string().email().optional() })),
  asincrono(async (req, res) => res.json(await culqiCobrarConToken(Number(req.params.id), req.datos))));

/** Retorno de PayPal: captura y redirige al panel público. */
rutasPublico.get('/paypal/retorno', asincrono(async (req, res) => {
  const enlace = Number(req.query.enlace);
  try {
    await paypalCapturar(enlace, String(req.query.token || ''));
    res.redirect(`${urlPublica()}/pago-exitoso?enlace=${enlace}`);
  } catch (e) {
    res.redirect(`${urlPublica()}/pago-cancelado?enlace=${enlace}&error=${encodeURIComponent(e.message)}`);
  }
}));

/* ---------- Webhooks (cuerpo crudo para verificar firmas) ---------- */
export const rutasWebhooks = Router();
rutasWebhooks.post('/stripe', raw({ type: '*/*', limit: '1mb' }), asincrono((req, res) => {
  const crudo = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  if (!verificarFirmaStripe(req.get('stripe-signature'), crudo)) throw new ErrorHttp(400, 'Firma de Stripe inválida');
  let evento;
  try { evento = JSON.parse(crudo); } catch { throw new ErrorHttp(400, 'JSON inválido'); }
  res.json(webhookStripe(evento));
}));
/** Culqi no firma: el servicio re-consulta el recurso en la API antes de confirmar. */
rutasWebhooks.post('/culqi', raw({ type: '*/*', limit: '1mb' }), asincrono(async (req, res) => {
  const crudo = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  let evento;
  try { evento = JSON.parse(crudo); } catch { throw new ErrorHttp(400, 'JSON inválido'); }
  res.json(await webhookCulqi(evento));
}));
