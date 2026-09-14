import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../middleware/validar.js';
import { requerirAuth, requerirRol } from '../middleware/auth.js';
import { asincrono } from '../middleware/errores.js';
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

const AJUSTES_EDITABLES = ['nombre_agencia', 'moneda_base', 'tope_descuento_pct', 'comision_renovacion_pct', 'gracia_dias', 'demo_dias', 'soporte_vitalicio_dias', 'metodos_en_mano'];

export const rutasAjustes = Router();
rutasAjustes.use(requerirAuth);
rutasAjustes.get('/', asincrono((req, res) => {
  const filas = obtenerDb().prepare('SELECT clave, valor FROM ajustes').all().filter((f) => AJUSTES_EDITABLES.includes(f.clave));
  res.json(Object.fromEntries(filas.map((f) => [f.clave, f.valor])));
}));
rutasAjustes.patch(
  '/',
  requerirRol('superadmin'),
  validar(z.record(z.string(), z.union([z.string(), z.number()]))),
  asincrono((req, res) => {
    const cambios = {};
    for (const [k, v] of Object.entries(req.datos)) {
      if (AJUSTES_EDITABLES.includes(k)) { guardarAjuste(k, v); cambios[k] = v; }
    }
    auditar({ usuarioId: req.usuario.id, accion: 'ajustes.actualizar', entidad: 'ajustes', detalle: cambios });
    res.json(cambios);
  })
);
