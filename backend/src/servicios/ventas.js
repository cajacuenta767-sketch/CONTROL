import { randomBytes } from 'node:crypto';
import { obtenerDb, transaccion, ajusteNumero, ahoraSql } from '../db.js';
import { ErrorHttp, noEncontrado, prohibido } from '../middleware/errores.js';
import { esGestor, esSuperadmin } from '../middleware/auth.js';
import { auditar } from './auditoria.js';
import { obtenerPlan } from './catalogo.js';
import { obtenerCliente } from './clientes.js';
import { emisionesHoy, demosSemana } from './usuarios.js';

const redondear = (n) => Math.round(n * 100) / 100;

/** Clave de licencia legible: CTL-XXXX-XXXX-XXXX-XXXX. */
export function generarClave(db) {
  const bloque = () => randomBytes(2).toString('hex').toUpperCase();
  let clave;
  do clave = `CTL-${bloque()}-${bloque()}-${bloque()}-${bloque()}`;
  while (db.prepare('SELECT 1 FROM licencias WHERE clave = ?').get(clave));
  return clave;
}

const VENTA_BASE = `SELECT v.*, c.nombre AS cliente_nombre, c.empresa AS cliente_empresa,
  u.nombre AS vendedor_nombre, pr.nombre AS producto_nombre, pr.codigo AS producto_codigo,
  pl.nombre AS plan_nombre, pl.tipo AS plan_tipo,
  (SELECT COALESCE(SUM(p.monto),0) FROM pagos p WHERE p.venta_id = v.id AND p.estado = 'confirmado') AS pagado,
  (SELECT COALESCE(SUM(p.monto),0) FROM pagos p WHERE p.venta_id = v.id AND p.estado = 'pendiente') AS por_confirmar
  FROM ventas v
  JOIN clientes c ON c.id = v.cliente_id
  JOIN usuarios u ON u.id = v.vendedor_id
  JOIN productos pr ON pr.id = v.producto_id
  JOIN planes pl ON pl.id = v.plan_id`;

/**
 * Registra una venta. Crea una licencia por cada unidad (sucursal) en
 * `pendiente_pago`. Las demos se activan al instante con total 0.
 * Una renovación (renueva_licencia_id) no crea licencias: extiende la existente al pagarse.
 */
export function crearVenta(datos, actor) {
  const plan = obtenerPlan(datos.plan_id);
  if (!plan.activo) throw new ErrorHttp(422, 'El plan no está activo');
  const cliente = obtenerCliente(datos.cliente_id, actor);

  const vendedorId = esGestor(actor) && datos.vendedor_id ? datos.vendedor_id : cliente.vendedor_id || actor.id;
  const esDemo = plan.tipo === 'demo';
  const esRenovacion = Boolean(datos.renueva_licencia_id);
  const cantidad = esRenovacion ? 1 : datos.cantidad ?? 1;

  const topeDescuento = ajusteNumero('tope_descuento_pct', 10);
  const descuento = datos.descuento_pct ?? 0;
  if (descuento > topeDescuento && !esSuperadmin(actor)) {
    throw new ErrorHttp(422, `El descuento máximo permitido es ${topeDescuento}%`);
  }

  if (!esSuperadmin(actor) && !esRenovacion) {
    if (esDemo) {
      if (demosSemana(actor.id) + cantidad > actor.tope_demos_semana) {
        throw new ErrorHttp(422, `Superaste tu tope de ${actor.tope_demos_semana} demos por semana`);
      }
    } else if (emisionesHoy(actor.id) + cantidad > actor.tope_emisiones_dia) {
      throw new ErrorHttp(422, `Superaste tu tope de ${actor.tope_emisiones_dia} licencias por día`);
    }
  }

  let licenciaARenovar = null;
  if (esRenovacion) {
    licenciaARenovar = obtenerDb().prepare('SELECT * FROM licencias WHERE id = ?').get(datos.renueva_licencia_id);
    if (!licenciaARenovar) throw noEncontrado('La licencia a renovar no existe');
    if (licenciaARenovar.cliente_id !== cliente.id) throw new ErrorHttp(422, 'La licencia pertenece a otro cliente');
    if (licenciaARenovar.producto_id !== plan.producto_id) throw new ErrorHttp(422, 'El plan es de otro producto');
    if (licenciaARenovar.estado === 'revocada') throw new ErrorHttp(422, 'Una licencia revocada no se puede renovar');
  }

  const precioUnitario = esDemo ? 0 : plan.precio;
  const total = redondear(precioUnitario * cantidad * (1 - descuento / 100));

  return transaccion((db) => {
    const anio = new Date().getUTCFullYear();
    const seq = db.prepare("SELECT COUNT(*) AS c FROM ventas WHERE strftime('%Y', creado_en) = ?").get(String(anio)).c + 1;
    const numero = `V-${anio}-${String(seq).padStart(5, '0')}`;
    const r = db
      .prepare(
        `INSERT INTO ventas (numero, cliente_id, vendedor_id, creado_por, producto_id, plan_id, renueva_licencia_id, cantidad,
          precio_unitario, descuento_pct, total, moneda, tipo_cambio, estado, es_renovacion, notas, pagada_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        numero, cliente.id, vendedorId, actor.id, plan.producto_id, plan.id, datos.renueva_licencia_id ?? null, cantidad,
        precioUnitario, descuento, total, datos.moneda ?? cliente.moneda ?? 'USD', datos.tipo_cambio ?? 1,
        esDemo ? 'pagada' : 'pendiente', esRenovacion ? 1 : 0, datos.notas ?? null, esDemo ? ahoraSql() : null
      );
    const ventaId = Number(r.lastInsertRowid);

    if (!esRenovacion) {
      const insertar = db.prepare(
        `INSERT INTO licencias (clave, venta_id, cliente_id, producto_id, plan_id, vendedor_id, emitida_por, etiqueta, estado,
          max_activaciones, activa_desde, vence_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const etiquetas = datos.etiquetas ?? [];
      const demoDias = plan.duracion_dias ?? ajusteNumero('demo_dias', 7);
      for (let i = 0; i < cantidad; i++) {
        const etiqueta = etiquetas[i] ?? (cantidad > 1 ? `Sucursal ${i + 1}` : null);
        insertar.run(
          generarClave(db), ventaId, cliente.id, plan.producto_id, plan.id, vendedorId, actor.id, etiqueta,
          esDemo ? 'activa' : 'pendiente_pago', plan.max_activaciones,
          esDemo ? ahoraSql() : null, esDemo ? ahoraSql(demoDias) : null
        );
      }
    }

    auditar({
      usuarioId: actor.id, accion: esDemo ? 'venta.demo' : esRenovacion ? 'venta.renovacion' : 'venta.crear',
      entidad: 'venta', entidadId: ventaId,
      detalle: { numero, cliente: cliente.nombre, plan: plan.nombre, cantidad, total, descuento_pct: descuento },
    });
    return obtenerVenta(ventaId);
  });
}

export function listarVentas(usuario, { estado, vendedor_id, cliente_id, desde, hasta, q } = {}) {
  const condiciones = [];
  const params = [];
  if (!esGestor(usuario)) { condiciones.push('v.vendedor_id = ?'); params.push(usuario.id); }
  else if (vendedor_id) { condiciones.push('v.vendedor_id = ?'); params.push(vendedor_id); }
  if (estado) { condiciones.push('v.estado = ?'); params.push(estado); }
  if (cliente_id) { condiciones.push('v.cliente_id = ?'); params.push(cliente_id); }
  if (desde) { condiciones.push('date(v.creado_en) >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('date(v.creado_en) <= ?'); params.push(hasta); }
  if (q) { condiciones.push('(v.numero LIKE ? OR c.nombre LIKE ? OR c.empresa LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return obtenerDb().prepare(`${VENTA_BASE} ${where} ORDER BY v.id DESC LIMIT 500`).all(...params);
}

export function obtenerVenta(id, usuario) {
  const db = obtenerDb();
  const v = db.prepare(`${VENTA_BASE} WHERE v.id = ?`).get(id);
  if (!v) throw noEncontrado('Venta no encontrada');
  if (usuario && !esGestor(usuario) && v.vendedor_id !== usuario.id) throw prohibido('Esta venta es de otro vendedor');
  v.pagos = db
    .prepare(
      `SELECT p.*, r.nombre AS registrado_por_nombre, c.nombre AS confirmado_por_nombre
       FROM pagos p JOIN usuarios r ON r.id = p.registrado_por LEFT JOIN usuarios c ON c.id = p.confirmado_por
       WHERE p.venta_id = ? ORDER BY p.id`
    )
    .all(id);
  v.licencias = db.prepare('SELECT * FROM licencias WHERE venta_id = ? ORDER BY id').all(id);
  if (v.renueva_licencia_id) v.licencia_renovada = db.prepare('SELECT * FROM licencias WHERE id = ?').get(v.renueva_licencia_id);
  v.comisiones = db.prepare('SELECT * FROM comisiones WHERE venta_id = ? ORDER BY id').all(id);
  v.saldo = redondear(v.total - v.pagado);
  return v;
}

/** El vendedor registra un cobro. Queda pendiente hasta que un gestor lo confirma. */
export function registrarPago(ventaId, datos, actor) {
  const v = obtenerVenta(ventaId, actor);
  if (v.estado === 'anulada') throw new ErrorHttp(422, 'La venta está anulada');
  if (v.total === 0) throw new ErrorHttp(422, 'Esta venta no requiere cobro');
  const comprometido = redondear(v.pagado + v.por_confirmar);
  if (redondear(comprometido + datos.monto) > v.total + 0.005) {
    throw new ErrorHttp(422, `El monto supera el saldo pendiente (${redondear(v.total - comprometido)})`);
  }
  const r = obtenerDb()
    .prepare('INSERT INTO pagos (venta_id, monto, metodo, referencia, comprobante, registrado_por) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ventaId, redondear(datos.monto), datos.metodo, datos.referencia ?? null, datos.comprobante ?? null, actor.id);
  const pagoId = Number(r.lastInsertRowid);
  auditar({ usuarioId: actor.id, accion: 'pago.registrar', entidad: 'pago', entidadId: pagoId, detalle: { venta: v.numero, monto: datos.monto, metodo: datos.metodo } });
  return obtenerVenta(ventaId);
}

/** Porcentaje de comisión aplicable a un pago de esta venta. */
function porcentajeComision(db, venta, plan) {
  if (plan.comision_pct !== null && plan.comision_pct !== undefined) return plan.comision_pct;
  const vendedor = db.prepare('SELECT comision_pct FROM usuarios WHERE id = ?').get(venta.vendedor_id);
  if (venta.es_renovacion && venta.renueva_licencia_id) {
    const lic = db.prepare('SELECT activa_desde FROM licencias WHERE id = ?').get(venta.renueva_licencia_id);
    // Renovación después del primer año: porcentaje reducido.
    if (lic?.activa_desde && Date.now() - Date.parse(lic.activa_desde.replace(' ', 'T') + 'Z') > 365 * 86400000) {
      return ajusteNumero('comision_renovacion_pct', 10);
    }
  }
  return vendedor?.comision_pct ?? 20;
}

/** Un gestor confirma el pago: devenga comisión y, si cubre el total, activa las licencias. */
export function confirmarPago(pagoId, actor) {
  return transaccion((db) => {
    const pago = db.prepare('SELECT * FROM pagos WHERE id = ?').get(pagoId);
    if (!pago) throw noEncontrado('Pago no encontrado');
    if (pago.estado !== 'pendiente') throw new ErrorHttp(422, 'El pago ya fue procesado');
    const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(pago.venta_id);
    if (venta.estado === 'anulada') throw new ErrorHttp(422, 'La venta está anulada');
    const plan = obtenerPlan(venta.plan_id);
    const ahora = ahoraSql();

    db.prepare("UPDATE pagos SET estado = 'confirmado', confirmado_por = ?, confirmado_en = ? WHERE id = ?").run(actor.id, ahora, pagoId);

    const pct = porcentajeComision(db, venta, plan);
    const monto = redondear((pago.monto * pct) / 100);
    if (monto > 0) {
      db.prepare('INSERT INTO comisiones (venta_id, pago_id, vendedor_id, base, pct, monto) VALUES (?, ?, ?, ?, ?, ?)')
        .run(venta.id, pagoId, venta.vendedor_id, pago.monto, pct, monto);
    }

    const pagado = db.prepare("SELECT COALESCE(SUM(monto),0) AS s FROM pagos WHERE venta_id = ? AND estado = 'confirmado'").get(venta.id).s;
    let activadas = 0;
    if (pagado + 0.005 >= venta.total && venta.estado !== 'pagada') {
      db.prepare("UPDATE ventas SET estado = 'pagada', pagada_en = ? WHERE id = ?").run(ahora, venta.id);
      activadas = activarLicenciasDeVenta(db, venta, plan, ahora);
    }

    auditar({ usuarioId: actor.id, accion: 'pago.confirmar', entidad: 'pago', entidadId: pagoId,
      detalle: { venta: venta.numero, monto: pago.monto, comision: monto, pct, licencias_activadas: activadas } });
    return obtenerVenta(venta.id);
  });
}

function activarLicenciasDeVenta(db, venta, plan, ahora) {
  const soporteVitalicio = ajusteNumero('soporte_vitalicio_dias', 365);
  if (venta.renueva_licencia_id) {
    const lic = db.prepare('SELECT * FROM licencias WHERE id = ?').get(venta.renueva_licencia_id);
    const base = lic.vence_en && lic.vence_en > ahora ? lic.vence_en : ahora;
    const sumar = (fecha, dias) => new Date(Date.parse(fecha.replace(' ', 'T') + 'Z') + dias * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    if (plan.tipo === 'mantenimiento') {
      const baseSoporte = lic.soporte_hasta && lic.soporte_hasta > ahora ? lic.soporte_hasta : ahora;
      db.prepare("UPDATE licencias SET soporte_hasta = ?, estado = CASE WHEN estado IN ('mora','suspendida','vencida') THEN 'activa' ELSE estado END, motivo_estado = NULL WHERE id = ?")
        .run(sumar(baseSoporte, plan.duracion_dias ?? 365), lic.id);
    } else {
      const nuevoVence = plan.duracion_dias ? sumar(base, plan.duracion_dias) : null;
      db.prepare("UPDATE licencias SET vence_en = ?, estado = 'activa', motivo_estado = NULL, activa_desde = COALESCE(activa_desde, ?), plan_id = ? WHERE id = ?")
        .run(nuevoVence, ahora, plan.id, lic.id);
    }
    return 1;
  }
  const venceEn = plan.duracion_dias ? ahoraSql(plan.duracion_dias) : null;
  const soporteHasta = plan.tipo === 'vitalicio' ? ahoraSql(soporteVitalicio) : venceEn;
  const r = db
    .prepare("UPDATE licencias SET estado = 'activa', activa_desde = ?, vence_en = ?, soporte_hasta = ?, motivo_estado = NULL WHERE venta_id = ? AND estado = 'pendiente_pago'")
    .run(ahora, venceEn, soporteHasta, venta.id);
  return Number(r.changes);
}

export function rechazarPago(pagoId, motivo, actor) {
  const db = obtenerDb();
  const pago = db.prepare('SELECT * FROM pagos WHERE id = ?').get(pagoId);
  if (!pago) throw noEncontrado('Pago no encontrado');
  if (pago.estado !== 'pendiente') throw new ErrorHttp(422, 'El pago ya fue procesado');
  db.prepare("UPDATE pagos SET estado = 'rechazado', motivo_rechazo = ?, confirmado_por = ?, confirmado_en = ? WHERE id = ?").run(motivo, actor.id, ahoraSql(), pagoId);
  auditar({ usuarioId: actor.id, accion: 'pago.rechazar', entidad: 'pago', entidadId: pagoId, detalle: { motivo } });
  return obtenerVenta(pago.venta_id);
}

/** Anula la venta: revoca sus licencias y revierte comisiones. Solo superadmin. */
export function anularVenta(ventaId, motivo, actor) {
  return transaccion((db) => {
    const v = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId);
    if (!v) throw noEncontrado('Venta no encontrada');
    if (v.estado === 'anulada') throw new ErrorHttp(422, 'La venta ya está anulada');
    const ahora = ahoraSql();
    db.prepare("UPDATE ventas SET estado = 'anulada', motivo_anulacion = ? WHERE id = ?").run(motivo, ventaId);
    db.prepare("UPDATE licencias SET estado = 'revocada', motivo_estado = ? WHERE venta_id = ? AND estado != 'revocada'").run(`Venta anulada: ${motivo}`, ventaId);
    db.prepare("UPDATE pagos SET estado = 'rechazado', motivo_rechazo = ? WHERE venta_id = ? AND estado = 'pendiente'").run('Venta anulada', ventaId);
    // Comisiones devengadas se revierten; las ya liquidadas generan un cargo negativo.
    db.prepare("UPDATE comisiones SET estado = 'revertida' WHERE venta_id = ? AND estado = 'devengada'").run(ventaId);
    const liquidadas = db.prepare("SELECT * FROM comisiones WHERE venta_id = ? AND estado = 'liquidada'").all(ventaId);
    for (const c of liquidadas) {
      db.prepare('INSERT INTO comisiones (venta_id, pago_id, vendedor_id, base, pct, monto, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(c.venta_id, c.pago_id, c.vendedor_id, -c.base, c.pct, -c.monto, 'devengada', ahora);
    }
    auditar({ usuarioId: actor.id, accion: 'venta.anular', entidad: 'venta', entidadId: ventaId, detalle: { numero: v.numero, motivo } });
    return obtenerVenta(ventaId);
  });
}
