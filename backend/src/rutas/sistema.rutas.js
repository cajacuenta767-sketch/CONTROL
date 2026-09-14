import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono, ErrorHttp } from '../middleware/errores.js';
import { probarSmtp, listarCorreos, obtenerCorreo } from '../servicios/correo.js';
import { obtenerDb, guardarAjuste } from '../db.js';
import { auditar, listarAuditoria } from '../servicios/auditoria.js';
import { resumen } from '../servicios/reportes.js';

export const rutasReportes = Router();
rutasReportes.use(requerirAuth);
rutasReportes.get('/resumen', asincrono((req, res) => res.json(resumen(req.usuario))));

export const rutasAuditoria = Router();
rutasAuditoria.use(requerirAuth, requerirRol('superadmin', 'admin'));
rutasAuditoria.get('/', asincrono((req, res) => res.json(listarAuditoria({
  pagina: Number(req.query.pagina || 1), porPagina: Math.min(200, Number(req.query.por_pagina || 50)),
  accion: req.query.accion, usuarioId: req.query.usuario_id ? Number(req.query.usuario_id) : undefined, entidad: req.query.entidad,
}))));

const AJUSTES_EDITABLES = [
  'nombre_agencia', 'direccion_agencia', 'logo_url', 'url_publica', 'moneda_base', 'tipos_cambio', 'tope_descuento_pct', 'comision_renovacion_pct',
  'gracia_dias', 'demo_dias', 'soporte_vitalicio_dias', 'metodos_en_mano', 'desfase_horario_horas',
  'smtp_host', 'smtp_puerto', 'smtp_usuario', 'smtp_clave', 'smtp_desde',
  'stripe_clave_secreta', 'stripe_webhook_secreto', 'paypal_cliente', 'paypal_secreto', 'paypal_sandbox', 'pasarela_demo',
  'plantilla_wa_claves', 'plantilla_wa_cobro', 'plantilla_wa_renovacion',
  'hora_recordatorio_caja', 'respaldos_conservar', 'dias_aviso_vencimiento', 'renovacion_automatica_dias', 'api_key_pedidos', 'portal_activo',
];
const SECRETOS = ['smtp_clave', 'stripe_clave_secreta', 'stripe_webhook_secreto', 'paypal_secreto', 'api_key_pedidos'];

export const rutasAjustes = Router();
rutasAjustes.use(requerirAuth);
rutasAjustes.get('/', asincrono((req, res) => {
  const filas = obtenerDb().prepare('SELECT clave, valor FROM ajustes').all().filter((f) => AJUSTES_EDITABLES.includes(f.clave));
  const esSuper = req.usuario.rol === 'superadmin';
  // Los secretos nunca viajan al navegador: solo se indica si están configurados.
  res.json(Object.fromEntries(filas.map((f) => [f.clave, SECRETOS.includes(f.clave) ? (esSuper && f.valor ? '••••••••' : '') : f.valor])));
}));
rutasAjustes.patch(
  '/',
  requerirRol('superadmin'),
  validar(z.record(z.string(), z.union([z.string(), z.number()]))),
  asincrono((req, res) => {
    const cambios = {};
    for (const [k, v] of Object.entries(req.datos)) {
      if (!AJUSTES_EDITABLES.includes(k)) continue;
      if (SECRETOS.includes(k) && String(v) === '••••••••') continue; // sin cambios
      if (k === 'tipos_cambio') { try { JSON.parse(String(v)); } catch { throw new ErrorHttp(422, 'tipos_cambio debe ser JSON, p. ej. {"PEN":3.75}'); } }
      guardarAjuste(k, v); cambios[k] = SECRETOS.includes(k) ? '***' : v;
    }
    auditar({ usuarioId: req.usuario.id, accion: 'ajustes.actualizar', entidad: 'ajustes', detalle: cambios });
    res.json(cambios);
  })
);

rutasAjustes.post('/probar-smtp', requerirRol('superadmin'), validar(z.object({ para: z.string().email() })), asincrono(async (req, res) => res.json(await probarSmtp(req.datos.para))));

export const rutasCorreos = Router();
rutasCorreos.use(requerirAuth, requerirRol('superadmin', 'admin'));
rutasCorreos.get('/', asincrono((req, res) => res.json(listarCorreos({ pagina: Number(req.query.pagina || 1) }))));
rutasCorreos.get('/:id', asincrono((req, res) => { const c = obtenerCorreo(Number(req.params.id)); if (!c) throw new ErrorHttp(404, 'Correo no encontrado'); res.json(c); }));

export const rutasErrores = Router();
rutasErrores.use(requerirAuth, requerirRol('superadmin'));
rutasErrores.get('/', asincrono((req, res) => res.json(obtenerDb().prepare('SELECT * FROM errores ORDER BY id DESC LIMIT 200').all())));
