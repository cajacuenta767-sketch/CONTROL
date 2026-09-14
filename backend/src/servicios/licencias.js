import { obtenerDb, transaccion, ajusteNumero, ahoraSql } from '../db.js';
import { ErrorHttp, noEncontrado, prohibido } from '../middleware/errores.js';
import { veTodo } from '../middleware/auth.js';
import { auditar } from './auditoria.js';
import { alertarDuenoSinEsperar } from './mensajeria.js';
import { tokenParaLicencia, firmarToken } from '../firmas.js';

const BASE = `SELECT l.*, c.nombre AS cliente_nombre, c.empresa AS cliente_empresa, c.email AS cliente_email,
  pr.codigo AS producto_codigo, pr.nombre AS producto_nombre, pr.version_actual AS producto_version_actual, pl.nombre AS plan_nombre, pl.tipo AS plan_tipo,
  u.nombre AS vendedor_nombre, e.nombre AS emitida_por_nombre, v.numero AS venta_numero,
  (SELECT COUNT(*) FROM activaciones a WHERE a.licencia_id = l.id AND a.activa = 1) AS activaciones_usadas,
  (SELECT MAX(a.ultimo_latido) FROM activaciones a WHERE a.licencia_id = l.id AND a.activa = 1) AS ultimo_latido
  FROM licencias l
  JOIN clientes c ON c.id = l.cliente_id
  JOIN productos pr ON pr.id = l.producto_id
  JOIN planes pl ON pl.id = l.plan_id
  LEFT JOIN usuarios u ON u.id = l.vendedor_id
  JOIN usuarios e ON e.id = l.emitida_por
  LEFT JOIN ventas v ON v.id = l.venta_id`;

/**
 * Barrido de estados por fecha. Se ejecuta antes de listar, activar o mostrar el panel.
 *  activa y vencida  → demo: vencida · otros: mora (dentro de gracia) o suspendida
 *  mora y gracia agotada → suspendida
 */
export function actualizarEstadosPorFecha() {
  const db = obtenerDb();
  const ahora = ahoraSql();
  const gracia = ajusteNumero('gracia_dias', 7);
  const limiteGracia = ahoraSql(-gracia);
  db.prepare(
    `UPDATE licencias SET estado = 'vencida', motivo_estado = 'Periodo de prueba terminado'
     WHERE estado = 'activa' AND vence_en IS NOT NULL AND vence_en < ?
       AND plan_id IN (SELECT id FROM planes WHERE tipo = 'demo')`
  ).run(ahora);
  db.prepare(
    `UPDATE licencias SET estado = 'mora', motivo_estado = 'Vencida, en periodo de gracia'
     WHERE estado = 'activa' AND vence_en IS NOT NULL AND vence_en < ? AND vence_en >= ?`
  ).run(ahora, limiteGracia);
  db.prepare(
    `UPDATE licencias SET estado = 'suspendida', motivo_estado = 'Vencida sin renovar'
     WHERE estado IN ('activa','mora') AND vence_en IS NOT NULL AND vence_en < ?`
  ).run(limiteGracia);
}

export function listarLicencias(usuario, filtros = {}) {
  actualizarEstadosPorFecha();
  const condiciones = [];
  const params = [];
  if (!veTodo(usuario)) { condiciones.push('l.vendedor_id = ?'); params.push(usuario.id); }
  else if (filtros.vendedor_id) { condiciones.push('l.vendedor_id = ?'); params.push(filtros.vendedor_id); }
  if (filtros.estado) { condiciones.push('l.estado = ?'); params.push(filtros.estado); }
  if (filtros.producto_id) { condiciones.push('l.producto_id = ?'); params.push(filtros.producto_id); }
  if (filtros.cliente_id) { condiciones.push('l.cliente_id = ?'); params.push(filtros.cliente_id); }
  if (filtros.vence_antes) { condiciones.push('l.vence_en IS NOT NULL AND l.vence_en <= ?'); params.push(filtros.vence_antes); }
  if (filtros.q) { condiciones.push('(l.clave LIKE ? OR c.nombre LIKE ? OR c.empresa LIKE ? OR l.etiqueta LIKE ?)'); params.push(...Array(4).fill(`%${filtros.q}%`)); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const db = obtenerDb();
  if (filtros.pagina) {
    const porPagina = Math.min(200, Number(filtros.por_pagina) || 50);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM licencias l JOIN clientes c ON c.id = l.cliente_id ${where}`).get(...params).c;
    const conteo = Object.fromEntries(db.prepare(`SELECT l.estado, COUNT(*) AS n FROM licencias l ${!veTodo(usuario) ? 'WHERE l.vendedor_id = ?' : ''} GROUP BY l.estado`).all(...(!veTodo(usuario) ? [usuario.id] : [])).map((f) => [f.estado, f.n]));
    const filas = db.prepare(`${BASE} ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(...params, porPagina, (Number(filtros.pagina) - 1) * porPagina);
    return { filas, total, pagina: Number(filtros.pagina), por_pagina: porPagina, conteo };
  }
  return db.prepare(`${BASE} ${where} ORDER BY l.id DESC LIMIT 1000`).all(...params);
}

export function obtenerLicencia(id, usuario) {
  const db = obtenerDb();
  const l = db.prepare(`${BASE} WHERE l.id = ?`).get(id);
  if (!l) throw noEncontrado('Licencia no encontrada');
  if (usuario && !veTodo(usuario) && l.vendedor_id !== usuario.id) throw prohibido('Esta licencia es de otro vendedor');
  l.activaciones = db.prepare('SELECT * FROM activaciones WHERE licencia_id = ? ORDER BY id DESC').all(id)
    .map((a) => ({ ...a, desactualizada: Boolean(l.producto_version_actual && a.version && a.version !== l.producto_version_actual) }));
  l.codigos_emergencia = db.prepare('SELECT ce.id, ce.huella, ce.expira_en, ce.motivo, ce.creado_en, u.nombre AS creado_por_nombre FROM codigos_emergencia ce LEFT JOIN usuarios u ON u.id = ce.creado_por WHERE ce.licencia_id = ? ORDER BY ce.id DESC LIMIT 20').all(id);
  l.historial = db
    .prepare(
      `SELECT a.*, u.nombre AS usuario_nombre FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.entidad = 'licencia' AND a.entidad_id = ? ORDER BY a.id DESC LIMIT 50`
    )
    .all(id)
    .map((f) => ({ ...f, detalle: f.detalle ? JSON.parse(f.detalle) : null }));
  return l;
}

function porClave(db, clave) {
  return db.prepare(`${BASE} WHERE l.clave = ?`).get(String(clave || '').trim().toUpperCase());
}

export function actualizarEtiqueta(id, etiqueta, actor) {
  obtenerLicencia(id, actor);
  obtenerDb().prepare('UPDATE licencias SET etiqueta = ? WHERE id = ?').run(etiqueta, id);
  auditar({ usuarioId: actor.id, accion: 'licencia.etiqueta', entidad: 'licencia', entidadId: id, detalle: { etiqueta } });
  return obtenerLicencia(id);
}

/** Cambios de estado manuales: solo superadmin, siempre con motivo. */
export function cambiarEstado(id, nuevoEstado, motivo, actor) {
  const l = obtenerLicencia(id);
  if (l.estado === 'revocada') throw new ErrorHttp(422, 'Una licencia revocada no cambia de estado');
  if (nuevoEstado === 'activa' && l.estado === 'pendiente_pago') throw new ErrorHttp(422, 'Confirma el pago de la venta para activarla');
  obtenerDb().prepare('UPDATE licencias SET estado = ?, motivo_estado = ? WHERE id = ?').run(nuevoEstado, motivo, id);
  auditar({ usuarioId: actor.id, accion: `licencia.${nuevoEstado}`, entidad: 'licencia', entidadId: id, detalle: { de: l.estado, motivo } });
  return obtenerLicencia(id);
}

/** Libera todas las activaciones (cambio de equipo). Solo superadmin. */
export function resetearActivaciones(id, motivo, actor) {
  obtenerLicencia(id);
  const r = obtenerDb().prepare('UPDATE activaciones SET activa = 0 WHERE licencia_id = ? AND activa = 1').run(id);
  auditar({ usuarioId: actor.id, accion: 'licencia.reset', entidad: 'licencia', entidadId: id, detalle: { motivo, liberadas: Number(r.changes) } });
  return obtenerLicencia(id);
}

export function ajustarMaxActivaciones(id, max, motivo, actor) {
  obtenerLicencia(id);
  obtenerDb().prepare('UPDATE licencias SET max_activaciones = ? WHERE id = ?').run(max, id);
  auditar({ usuarioId: actor.id, accion: 'licencia.max_activaciones', entidad: 'licencia', entidadId: id, detalle: { max, motivo } });
  return obtenerLicencia(id);
}

export function transferirLicencia(id, clienteId, motivo, actor) {
  obtenerLicencia(id);
  const db = obtenerDb();
  if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(clienteId)) throw noEncontrado('Cliente destino no existe');
  db.prepare('UPDATE licencias SET cliente_id = ? WHERE id = ?').run(clienteId, id);
  auditar({ usuarioId: actor.id, accion: 'licencia.transferir', entidad: 'licencia', entidadId: id, detalle: { cliente_id: clienteId, motivo } });
  return obtenerLicencia(id);
}

const BLOQUEADAS = { pendiente_pago: 'Pago pendiente de confirmación', suspendida: 'Licencia suspendida', vencida: 'Licencia vencida', revocada: 'Licencia revocada' };

function respuestaLicencia(l, version = null) {
  const actual = l.producto_version_actual || null;
  return {
    estado: l.estado, etiqueta: l.etiqueta, vence_en: l.vence_en, soporte_hasta: l.soporte_hasta, producto: l.producto_codigo, plan: l.plan_tipo, motivo: l.motivo_estado,
    version_actual: actual, desactualizada: Boolean(actual && version && version !== actual),
  };
}

const HORAS_EMERGENCIA = 72;

/**
 * Código de emergencia: token firmado de 72 h para un equipo concreto, que el producto
 * acepta sin conexión (p. ej. CONTROL caído o cliente sin internet en una fecha crítica).
 */
export function crearCodigoEmergencia(id, { huella, motivo }, actor) {
  const l = obtenerLicencia(id, actor);
  if (l.estado === 'revocada') throw new ErrorHttp(422, 'La licencia está revocada');
  const h = String(huella || '').trim();
  if (!h) throw new ErrorHttp(422, 'Indica la huella del equipo');
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + HORAS_EMERGENCIA * 3600000);
  const codigo = firmarToken({
    clave: l.clave, producto: l.producto_codigo, plan: l.plan_tipo, huella: h, estado: 'activa', etiqueta: l.etiqueta,
    vence_en: l.vence_en, soporte_hasta: l.soporte_hasta, emergencia: true, emitido_en: ahora.toISOString(), expira_en: expira.toISOString(),
  });
  obtenerDb().prepare('INSERT INTO codigos_emergencia (licencia_id, huella, expira_en, creado_por, motivo) VALUES (?, ?, ?, ?, ?)').run(l.id, h, expira.toISOString(), actor.id, motivo ?? null);
  auditar({ usuarioId: actor.id, accion: 'licencia.codigo_emergencia', entidad: 'licencia', entidadId: l.id, detalle: { huella: h, motivo, expira_en: expira.toISOString() } });
  return { codigo, expira_en: expira.toISOString(), horas: HORAS_EMERGENCIA, huella: h };
}

/**
 * Activación pública que llama cada producto. Registra la huella y devuelve un token
 * firmado. Rechaza si la licencia no está vigente o se agotaron las activaciones.
 */
export function activar({ clave, producto, huella, dominio, nombre_equipo, version, ip }) {
  actualizarEstadosPorFecha();
  try {
    return activarEnTransaccion({ clave, producto, huella, dominio, nombre_equipo, version, ip });
  } catch (e) {
    // El rechazo se audita fuera de la transacción para que sobreviva al ROLLBACK.
    if (e.auditoria) {
      auditar(e.auditoria);
      const d = e.auditoria.detalle || {};
      const clonada = e.extra?.codigo === 'max_activaciones' || d.motivo?.includes('otro equipo');
      alertarDuenoSinEsperar(clonada ? 'instalacion_clonada' : 'activacion_rechazada', `Clave ${d.clave} · ${d.motivo} · equipo ${d.huella || '?'} · IP ${ip || '?'}`, { referencia: `${d.clave}:${d.huella}:${new Date().toISOString().slice(0, 10)}`, url: e.auditoria.entidadId ? `/licencias/${e.auditoria.entidadId}` : '/auditoria' });
    }
    throw e;
  }
}

function activarEnTransaccion({ clave, producto, huella, dominio, nombre_equipo, version, ip }) {
  return transaccion((db) => {
    const l = porClave(db, clave);
    const rechazo = (status, motivo, extra = {}) => {
      const err = new ErrorHttp(status, motivo, { ok: false, codigo: extra.codigo ?? motivo, ...extra });
      err.auditoria = { accion: 'activacion.rechazada', entidad: 'licencia', entidadId: l?.id ?? null, detalle: { clave, producto, huella, motivo }, ip };
      throw err;
    };
    if (!l) rechazo(404, 'Licencia no encontrada', { codigo: 'no_encontrada' });
    if (producto && l.producto_codigo !== producto) rechazo(403, 'La licencia es de otro producto', { codigo: 'producto_incorrecto', producto: l.producto_codigo });
    if (BLOQUEADAS[l.estado]) rechazo(403, BLOQUEADAS[l.estado], { codigo: l.estado, licencia: respuestaLicencia(l) });

    let act = db.prepare('SELECT * FROM activaciones WHERE licencia_id = ? AND huella = ? AND activa = 1').get(l.id, huella);
    if (act) {
      db.prepare('UPDATE activaciones SET ultimo_latido = ?, version = COALESCE(?, version), ip = COALESCE(?, ip) WHERE id = ?').run(ahoraSql(), version ?? null, ip ?? null, act.id);
    } else {
      const usadas = db.prepare('SELECT COUNT(*) AS c FROM activaciones WHERE licencia_id = ? AND activa = 1').get(l.id).c;
      if (usadas >= l.max_activaciones) {
        rechazo(403, 'Esta licencia ya está activada en otro equipo', { codigo: 'max_activaciones', usadas, max: l.max_activaciones });
      }
      const r = db
        .prepare('INSERT INTO activaciones (licencia_id, huella, dominio, nombre_equipo, version, ip) VALUES (?, ?, ?, ?, ?, ?)')
        .run(l.id, huella, dominio ?? null, nombre_equipo ?? null, version ?? null, ip ?? null);
      act = { id: Number(r.lastInsertRowid), huella };
      auditar({ accion: 'activacion.nueva', entidad: 'licencia', entidadId: l.id, detalle: { huella, dominio, nombre_equipo, version }, ip });
    }
    return { ok: true, token: tokenParaLicencia(l, act), licencia: respuestaLicencia(l, version) };
  });
}

/** Latido periódico: renueva el token y registra que la instalación sigue viva. */
export function latido({ clave, huella, version, ip }) {
  actualizarEstadosPorFecha();
  const db = obtenerDb();
  const l = porClave(db, clave);
  if (!l) throw new ErrorHttp(404, 'Licencia no encontrada', { ok: false, codigo: 'no_encontrada' });
  const act = db.prepare('SELECT * FROM activaciones WHERE licencia_id = ? AND huella = ? AND activa = 1').get(l.id, huella);
  if (!act) throw new ErrorHttp(403, 'Este equipo no está activado', { ok: false, codigo: 'no_activada', licencia: respuestaLicencia(l) });
  db.prepare('UPDATE activaciones SET ultimo_latido = ?, version = COALESCE(?, version), ip = COALESCE(?, ip) WHERE id = ?').run(ahoraSql(), version ?? null, ip ?? null, act.id);
  if (BLOQUEADAS[l.estado]) throw new ErrorHttp(403, BLOQUEADAS[l.estado], { ok: false, codigo: l.estado, licencia: respuestaLicencia(l, version) });
  return { ok: true, token: tokenParaLicencia(l, act), licencia: respuestaLicencia(l, version) };
}
