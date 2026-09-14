import { obtenerDb, transaccion, ajuste, ahoraSql, hoyLocal, modZona } from '../db.js';
import { ErrorHttp, noEncontrado, prohibido } from '../middleware/errores.js';
import { esGestor, esSuperadmin } from '../middleware/auth.js';
import { auditar } from './auditoria.js';
import { alertarDuenoSinEsperar } from './mensajeria.js';

const redondear = (n) => Math.round(n * 100) / 100;

/**
 * Resumen de lo cobrado por un vendedor en una fecha (sin guardar).
 * Los totales se expresan en la moneda base; `por_moneda` desglosa cada moneda real.
 */
export function resumenDia(vendedorId, fecha = hoyLocal()) {
  const db = obtenerDb();
  const z = modZona();
  const base = ajuste('moneda_base', 'USD');
  const pagos = db
    .prepare(
      `SELECT p.id, p.monto, COALESCE(p.monto_base, p.monto) AS monto_base, p.metodo, p.estado, p.referencia, p.creado_en, v.numero AS venta_numero, v.moneda, c.nombre AS cliente_nombre
       FROM pagos p JOIN ventas v ON v.id = p.venta_id JOIN clientes c ON c.id = v.cliente_id
       WHERE p.registrado_por = ? AND date(p.creado_en, ?) = ? AND p.estado != 'rechazado' ORDER BY p.id`
    )
    .all(vendedorId, z, fecha);
  const porMetodo = {};
  const porMoneda = {};
  let totalBase = 0;
  for (const p of pagos) {
    porMetodo[p.metodo] = redondear((porMetodo[p.metodo] || 0) + p.monto_base);
    porMoneda[p.moneda] = porMoneda[p.moneda] || {};
    porMoneda[p.moneda][p.metodo] = redondear((porMoneda[p.moneda][p.metodo] || 0) + p.monto);
    totalBase += p.monto_base;
  }
  const enMano = ajuste('metodos_en_mano', 'efectivo').split(',').map((s) => s.trim());
  const aEntregar = enMano.reduce((s, m) => s + (porMetodo[m] || 0), 0);
  const aEntregarPorMoneda = Object.fromEntries(Object.entries(porMoneda).map(([mon, metodos]) => [mon, redondear(enMano.reduce((s, m) => s + (metodos[m] || 0), 0))]).filter(([, v]) => v > 0));
  const comision = db
    .prepare("SELECT COALESCE(SUM(monto),0) AS s FROM comisiones WHERE vendedor_id = ? AND date(creado_en, ?) = ? AND estado != 'revertida'")
    .get(vendedorId, z, fecha).s;
  const cierre = db.prepare('SELECT * FROM cierres_caja WHERE vendedor_id = ? AND fecha = ?').get(vendedorId, fecha);
  return {
    fecha, vendedor_id: vendedorId, pagos, moneda_base: base, por_metodo: porMetodo, por_moneda: porMoneda,
    total_cobrado: redondear(totalBase), a_entregar: redondear(aEntregar), a_entregar_por_moneda: aEntregarPorMoneda, comision_dia: redondear(comision),
    cantidad_pagos: pagos.length, cierre: cierre ? parsearCierre(cierre) : null,
  };
}

const parsearCierre = (c) => ({ ...c, por_metodo: JSON.parse(c.por_metodo || '{}'), por_moneda: JSON.parse(c.por_moneda || '{}') });

export function cerrarCaja(actor, { fecha = hoyLocal(), observacion } = {}) {
  if (fecha > hoyLocal()) throw new ErrorHttp(422, 'No se puede cerrar una fecha futura');
  const r = resumenDia(actor.id, fecha);
  if (r.cierre) throw new ErrorHttp(409, 'La caja de ese día ya está cerrada');
  const res = obtenerDb()
    .prepare(
      `INSERT INTO cierres_caja (vendedor_id, fecha, total_cobrado, total_base, por_metodo, por_moneda, comision_dia, a_entregar, cantidad_pagos, observacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(actor.id, fecha, r.total_cobrado, r.total_cobrado, JSON.stringify(r.por_metodo), JSON.stringify(r.por_moneda), r.comision_dia, r.a_entregar, r.cantidad_pagos, observacion ?? null);
  const id = Number(res.lastInsertRowid);
  auditar({ usuarioId: actor.id, accion: 'caja.cerrar', entidad: 'cierre_caja', entidadId: id, detalle: { fecha, total: r.total_cobrado, a_entregar: r.a_entregar } });
  if (actor.rol !== 'superadmin') alertarDuenoSinEsperar('cierre_caja', `${actor.nombre} cerró su caja del ${fecha}: cobrado ${r.total_cobrado}, a entregar ${r.a_entregar}`, { referencia: id, url: '/caja' });
  return obtenerCierre(id);
}

export function obtenerCierre(id, usuario) {
  const c = obtenerDb()
    .prepare('SELECT c.*, u.nombre AS vendedor_nombre, a.nombre AS aprobado_por_nombre FROM cierres_caja c JOIN usuarios u ON u.id = c.vendedor_id LEFT JOIN usuarios a ON a.id = c.aprobado_por WHERE c.id = ?')
    .get(id);
  if (!c) throw noEncontrado('Cierre no encontrado');
  if (usuario && !esGestor(usuario) && c.vendedor_id !== usuario.id) throw prohibido();
  return parsearCierre(c);
}

export function listarCierres(usuario, { estado, vendedor_id, desde, hasta } = {}) {
  const condiciones = [];
  const params = [];
  if (!esGestor(usuario)) { condiciones.push('c.vendedor_id = ?'); params.push(usuario.id); }
  else if (vendedor_id) { condiciones.push('c.vendedor_id = ?'); params.push(vendedor_id); }
  if (estado) { condiciones.push('c.estado = ?'); params.push(estado); }
  if (desde) { condiciones.push('c.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('c.fecha <= ?'); params.push(hasta); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return obtenerDb()
    .prepare(`SELECT c.*, u.nombre AS vendedor_nombre FROM cierres_caja c JOIN usuarios u ON u.id = c.vendedor_id ${where} ORDER BY c.fecha DESC, c.id DESC LIMIT 500`)
    .all(...params)
    .map(parsearCierre);
}

export function revisarCierre(id, { estado, observacion }, actor) {
  const c = obtenerCierre(id);
  if (c.estado === 'aprobado') throw new ErrorHttp(422, 'Un cierre aprobado es inmutable');
  obtenerDb()
    .prepare('UPDATE cierres_caja SET estado = ?, observacion = COALESCE(?, observacion), aprobado_por = ?, aprobado_en = ? WHERE id = ?')
    .run(estado, observacion ?? null, actor.id, ahoraSql(), id);
  auditar({ usuarioId: actor.id, accion: `caja.${estado}`, entidad: 'cierre_caja', entidadId: id, detalle: { observacion } });
  return obtenerCierre(id);
}

/* ---------- Liquidaciones de comisiones ---------- */

export function listarComisiones(usuario, { vendedor_id, estado, desde, hasta } = {}) {
  const condiciones = [];
  const params = [];
  if (!esSuperadmin(usuario)) { condiciones.push('co.vendedor_id = ?'); params.push(usuario.id); }
  else if (vendedor_id) { condiciones.push('co.vendedor_id = ?'); params.push(vendedor_id); }
  if (estado) { condiciones.push('co.estado = ?'); params.push(estado); }
  if (desde) { condiciones.push('date(co.creado_en, ?) >= ?'); params.push(modZona(), desde); }
  if (hasta) { condiciones.push('date(co.creado_en, ?) <= ?'); params.push(modZona(), hasta); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return obtenerDb()
    .prepare(
      `SELECT co.*, u.nombre AS vendedor_nombre, v.numero AS venta_numero, c.nombre AS cliente_nombre, pr.nombre AS producto_nombre
       FROM comisiones co JOIN usuarios u ON u.id = co.vendedor_id JOIN ventas v ON v.id = co.venta_id
       JOIN clientes c ON c.id = v.cliente_id JOIN productos pr ON pr.id = v.producto_id
       ${where} ORDER BY co.id DESC LIMIT 1000`
    )
    .all(...params);
}

export function crearLiquidacion({ vendedor_id, desde, hasta }, actor) {
  return transaccion((db) => {
    const pendientes = db
      .prepare("SELECT id, monto FROM comisiones WHERE vendedor_id = ? AND estado = 'devengada' AND liquidacion_id IS NULL AND date(creado_en, ?) BETWEEN ? AND ?")
      .all(vendedor_id, modZona(), desde, hasta);
    if (!pendientes.length) throw new ErrorHttp(422, 'No hay comisiones pendientes en ese rango');
    const total = redondear(pendientes.reduce((s, c) => s + c.monto, 0));
    const r = db.prepare('INSERT INTO liquidaciones (vendedor_id, desde, hasta, total, creado_por) VALUES (?, ?, ?, ?, ?)').run(vendedor_id, desde, hasta, total, actor.id);
    const id = Number(r.lastInsertRowid);
    const marcar = db.prepare('UPDATE comisiones SET liquidacion_id = ? WHERE id = ?');
    for (const c of pendientes) marcar.run(id, c.id);
    auditar({ usuarioId: actor.id, accion: 'liquidacion.crear', entidad: 'liquidacion', entidadId: id, detalle: { vendedor_id, desde, hasta, total, comisiones: pendientes.length } });
    return obtenerLiquidacion(id);
  });
}

export function obtenerLiquidacion(id, usuario) {
  const db = obtenerDb();
  const l = db.prepare('SELECT l.*, u.nombre AS vendedor_nombre FROM liquidaciones l JOIN usuarios u ON u.id = l.vendedor_id WHERE l.id = ?').get(id);
  if (!l) throw noEncontrado('Liquidación no encontrada');
  if (usuario && !esSuperadmin(usuario) && l.vendedor_id !== usuario.id) throw prohibido();
  l.comisiones = db
    .prepare('SELECT co.*, v.numero AS venta_numero, c.nombre AS cliente_nombre FROM comisiones co JOIN ventas v ON v.id = co.venta_id JOIN clientes c ON c.id = v.cliente_id WHERE co.liquidacion_id = ? ORDER BY co.id')
    .all(id);
  return l;
}

export function listarLiquidaciones(usuario, { vendedor_id } = {}) {
  const condiciones = [];
  const params = [];
  if (!esSuperadmin(usuario)) { condiciones.push('l.vendedor_id = ?'); params.push(usuario.id); }
  else if (vendedor_id) { condiciones.push('l.vendedor_id = ?'); params.push(vendedor_id); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return obtenerDb()
    .prepare(`SELECT l.*, u.nombre AS vendedor_nombre FROM liquidaciones l JOIN usuarios u ON u.id = l.vendedor_id ${where} ORDER BY l.id DESC`)
    .all(...params);
}

export function pagarLiquidacion(id, actor) {
  return transaccion((db) => {
    const l = obtenerLiquidacion(id);
    if (l.estado === 'pagada') throw new ErrorHttp(422, 'Ya está pagada');
    db.prepare("UPDATE liquidaciones SET estado = 'pagada', pagada_en = ? WHERE id = ?").run(ahoraSql(), id);
    db.prepare("UPDATE comisiones SET estado = 'liquidada' WHERE liquidacion_id = ? AND estado = 'devengada'").run(id);
    auditar({ usuarioId: actor.id, accion: 'liquidacion.pagar', entidad: 'liquidacion', entidadId: id, detalle: { total: l.total } });
    return obtenerLiquidacion(id);
  });
}
