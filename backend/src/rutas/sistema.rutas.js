import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono, ErrorHttp } from '../middleware/errores.js';
import { probarSmtp, listarCorreos, obtenerCorreo } from '../servicios/correo.js';
import { obtenerDb, guardarAjuste } from '../db.js';
import { auditar, listarAuditoria } from '../servicios/auditoria.js';
import { resumen, buscar, series, tablero } from '../servicios/reportes.js';
import { reporteEncuestas, campanaRenovaciones, generarRenovaciones } from '../servicios/retencion.js';
import { exportacionContable } from '../servicios/contabilidad.js';
import multer from 'multer';
import { extname } from 'node:path';
import { estadoDescargas, registrarArchivo, quitarArchivo, asegurarDirDescargas, PLATAFORMAS } from '../servicios/descargas.js';

export const rutasReportes = Router();
rutasReportes.use(requerirAuth);
rutasReportes.get('/resumen', asincrono((req, res) => res.json(resumen(req.usuario))));
rutasReportes.get('/series', asincrono((req, res) => res.json(series(req.usuario, { meses: req.query.meses }))));
rutasReportes.get('/buscar', asincrono((req, res) => res.json(buscar(req.usuario, req.query.q))));
rutasReportes.get('/contable', requerirRol('superadmin', 'contador'), asincrono((req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? String(req.query.mes) : new Date().toISOString().slice(0, 7);
  const r = exportacionContable(mes);
  if (req.query.formato === 'json') return res.json({ mes, resumen: r.resumen });
  auditar({ usuarioId: req.usuario.id, accion: 'contabilidad.exportar', detalle: { mes } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${r.nombre}"`);
  res.send(r.buffer);
}));
rutasReportes.get('/tablero', asincrono((req, res) => res.json(tablero())));
rutasReportes.get('/encuestas', asincrono((req, res) => res.json(reporteEncuestas(req.usuario))));

export const rutasRenovaciones = Router();
rutasRenovaciones.use(requerirAuth);
rutasRenovaciones.get('/', asincrono((req, res) => res.json(campanaRenovaciones(req.usuario, { dias: Number(req.query.dias) || 30 }))));
rutasRenovaciones.post('/generar', validar(z.object({ licencia_ids: z.array(z.number().int()).min(1).max(200), proveedor: z.string().optional(), enviar: z.boolean().optional() })),
  asincrono(async (req, res) => res.json(await generarRenovaciones(req.datos, req.usuario))));

export const rutasAuditoria = Router();
rutasAuditoria.use(requerirAuth, requerirRol('superadmin'));
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
const SECRETOS = ['smtp_clave', 'stripe_clave_secreta', 'stripe_webhook_secreto', 'paypal_secreto', 'api_key_pedidos', 'culqi_clave_secreta', 'whatsapp_token', 'telegram_token', 'nubefact_token'];

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
rutasCorreos.use(requerirAuth, requerirRol('superadmin'));
rutasCorreos.get('/', asincrono((req, res) => res.json(listarCorreos({ pagina: Number(req.query.pagina || 1) }))));
rutasCorreos.get('/:id', asincrono((req, res) => { const c = obtenerCorreo(Number(req.params.id)); if (!c) throw new ErrorHttp(404, 'Correo no encontrado'); res.json(c); }));

export const rutasErrores = Router();
rutasErrores.use(requerirAuth, requerirRol('superadmin'));
rutasErrores.get('/', asincrono((req, res) => res.json(obtenerDb().prepare('SELECT * FROM errores ORDER BY id DESC LIMIT 200').all())));

import { ejecutarTareas, estadoTareas, crearRespaldo, listarRespaldos, rutaRespaldo } from '../servicios/tareas.js';
import { listarMensajes, probarCanales } from '../servicios/mensajeria.js';
export const rutasSistema = Router();
rutasSistema.use(requerirAuth, requerirRol('superadmin'));
rutasSistema.get('/tareas', asincrono((req, res) => res.json(estadoTareas())));
rutasSistema.get('/mensajes', asincrono((req, res) => res.json(listarMensajes({ canal: req.query.canal }))));
rutasSistema.post('/mensajes/probar', asincrono(async (req, res) => res.json(await probarCanales())));
rutasSistema.post('/tareas/ejecutar', asincrono(async (req, res) => { const r = await ejecutarTareas({ forzarCaja: req.body?.forzar_caja === true }); auditar({ usuarioId: req.usuario.id, accion: 'tareas.ejecutar', detalle: r }); res.json(r); }));
rutasSistema.get('/respaldos', asincrono((req, res) => res.json(listarRespaldos())));
rutasSistema.post('/respaldos', asincrono((req, res) => { const r = crearRespaldo({ manual: true }); auditar({ usuarioId: req.usuario.id, accion: 'respaldo.crear', detalle: r }); res.status(201).json(r); }));
rutasSistema.get('/respaldos/:nombre', asincrono((req, res) => {
  const ruta = rutaRespaldo(req.params.nombre);
  if (!ruta) throw new ErrorHttp(404, 'Respaldo no encontrado');
  auditar({ usuarioId: req.usuario.id, accion: 'respaldo.descargar', detalle: { nombre: req.params.nombre } });
  res.download(ruta);
}));

/* ---------- Apps: instaladores para la landing /descargar (solo superadmin) ---------- */
const subirApp = multer({
  storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, asegurarDirDescargas()), filename: (req, file, cb) => cb(null, `${req.params.plataforma}-${Date.now()}${extname(file.originalname || '').toLowerCase().slice(0, 6) || '.bin'}`) }),
  limits: { fileSize: 300 * 1024 * 1024 },
});
rutasSistema.get('/descargas', asincrono((req, res) => res.json(estadoDescargas())));
rutasSistema.post('/descargas/:plataforma', (req, res, next) => { if (!PLATAFORMAS[req.params.plataforma]) return next(new ErrorHttp(422, 'Plataforma desconocida')); subirApp.single('archivo')(req, res, (e) => next(e ? new ErrorHttp(422, e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 300 MB' : e.message) : undefined)); },
  asincrono((req, res) => { if (!req.file) throw new ErrorHttp(422, 'Adjunta el archivo en el campo "archivo"'); res.status(201).json(registrarArchivo(req.params.plataforma, req.file.filename, req.usuario)); }));
rutasSistema.delete('/descargas/:plataforma', asincrono((req, res) => res.json(quitarArchivo(req.params.plataforma, req.usuario))));
