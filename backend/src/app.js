import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import { manejarErrores } from './middleware/errores.js';
import { middlewareContexto } from './contexto.js';
import { rutasAuth } from './rutas/auth.rutas.js';
import { rutasUsuarios } from './rutas/usuarios.rutas.js';
import { rutasProductos, rutasPlanes } from './rutas/catalogo.rutas.js';
import { rutasClientes } from './rutas/clientes.rutas.js';
import { rutasVentas, rutasPagos } from './rutas/ventas.rutas.js';
import { rutasLicencias, rutasLicenciasPublicas } from './rutas/licencias.rutas.js';
import { rutasCaja, rutasComisiones, rutasLiquidaciones } from './rutas/caja.rutas.js';
import { rutasReportes, rutasAuditoria, rutasAjustes, rutasCorreos, rutasErrores, rutasSistema, rutasRenovaciones } from './rutas/sistema.rutas.js';
import { rutasPublico, rutasWebhooks } from './rutas/publico.rutas.js';
import { rutasPortal, rutasTickets } from './rutas/portal.rutas.js';
import { rutasProspectos } from './rutas/prospectos.rutas.js';

/** La app se exporta sin escuchar para poder probarla con supertest. */
export function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://checkout.culqi.com'], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:', 'https://*.culqi.com'],
        connectSrc: ["'self'", 'https://*.culqi.com'], frameSrc: ['https://checkout.culqi.com', 'https://*.culqi.com'], fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: config.origenesPermitidos }));
  app.use('/api/v1/webhooks', rutasWebhooks); // cuerpo crudo: va antes del parser JSON
  app.use(express.json({ limit: '1mb' }));
  app.use(middlewareContexto);
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/v1/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

  app.use('/api/v1/auth', rutasAuth);
  app.use('/api/v1/usuarios', rutasUsuarios);
  app.use('/api/v1/productos', rutasProductos);
  app.use('/api/v1/planes', rutasPlanes);
  app.use('/api/v1/clientes', rutasClientes);
  app.use('/api/v1/ventas', rutasVentas);
  app.use('/api/v1/pagos', rutasPagos);
  app.use('/api/v1/licencias', rutasLicenciasPublicas); // /activar, /latido, /clave-publica
  app.use('/api/v1/licencias', rutasLicencias);
  app.use('/api/v1/caja', rutasCaja);
  app.use('/api/v1/comisiones', rutasComisiones);
  app.use('/api/v1/liquidaciones', rutasLiquidaciones);
  app.use('/api/v1/reportes', rutasReportes);
  app.use('/api/v1/renovaciones', rutasRenovaciones);
  app.use('/api/v1/auditoria', rutasAuditoria);
  app.use('/api/v1/ajustes', rutasAjustes);
  app.use('/api/v1/publico', rutasPublico);
  app.use('/api/v1/correos', rutasCorreos);
  app.use('/api/v1/errores', rutasErrores);
  app.use('/api/v1/sistema', rutasSistema);
  app.use('/api/v1/portal', rutasPortal);
  app.use('/api/v1/tickets', rutasTickets);
  app.use('/api/v1/prospectos', rutasProspectos);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // En producción sirve el panel compilado (frontend/dist) desde el mismo proceso.
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  app.use(manejarErrores);
  return app;
}
