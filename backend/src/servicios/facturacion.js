import { obtenerDb, ajuste, ajusteNumero, ahoraSql, hoyLocal } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { auditar } from './auditoria.js';

/**
 * Facturación electrónica. Proveedores:
 *  - ninguno: desactivada.
 *  - manual:  CONTROL numera y guarda el comprobante; se emite fuera (otro sistema o país sin SUNAT).
 *  - nubefact: Perú (SUNAT) vía la API de Nubefact; también sirve para otros PSE compatibles.
 */
const redondear = (n) => Math.round(n * 100) / 100;
export const proveedorFacturacion = () => ajuste('facturacion_proveedor', 'ninguno');
export const facturacionActiva = () => proveedorFacturacion() !== 'ninguno';

const DOC_SUNAT = { RUC: '6', DNI: '1', CE: '4', NIT: '0', OTRO: '0' };
const MONEDA_NUBEFACT = { PEN: 1, USD: 2 };

function siguienteNumero(db, serie) {
  const ultimo = db.prepare('SELECT MAX(CAST(numero AS INTEGER)) AS n FROM comprobantes_fiscales WHERE serie = ?').get(serie).n || 0;
  return String(ultimo + 1);
}

/** Descompone el total en base imponible e IGV según si los precios ya lo incluyen. */
export function desglosarIgv(total) {
  const pct = ajusteNumero('igv_pct', 18);
  if (pct <= 0) return { base: redondear(total), igv: 0, total: redondear(total), pct };
  if (ajuste('precios_incluyen_igv', '1') === '1') { const base = redondear(total / (1 + pct / 100)); return { base, igv: redondear(total - base), total: redondear(total), pct }; }
  const igv = redondear((total * pct) / 100);
  return { base: redondear(total), igv, total: redondear(total + igv), pct };
}

export function listarComprobantes({ venta_id, mes } = {}) {
  const cond = [], params = [];
  if (venta_id) { cond.push('cf.venta_id = ?'); params.push(venta_id); }
  if (mes) { cond.push("strftime('%Y-%m', cf.creado_en) = ?"); params.push(mes); }
  return obtenerDb().prepare(`SELECT cf.*, v.numero AS venta_numero, u.nombre AS creado_por_nombre FROM comprobantes_fiscales cf JOIN ventas v ON v.id = cf.venta_id LEFT JOIN usuarios u ON u.id = cf.creado_por
    ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY cf.id DESC LIMIT 500`).all(...params);
}

/**
 * Emite boleta o factura por una venta (por el total, o por un pago concreto si se indica).
 * Guarda el resultado y, con Nubefact, envía a SUNAT. Devuelve la fila.
 */
export async function emitirComprobante(ventaId, { tipo = 'boleta', pago_id = null, cliente: datosCliente = {} } = {}, actor) {
  if (!facturacionActiva()) throw new ErrorHttp(422, 'La facturación electrónica no está configurada (Ajustes › Facturación)');
  const db = obtenerDb();
  const v = db.prepare(`SELECT v.*, c.nombre AS cliente_nombre, c.email AS cliente_email, c.documento_tipo, c.documento, c.razon_social, c.direccion, pr.nombre AS producto_nombre, pl.nombre AS plan_nombre
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id JOIN productos pr ON pr.id = v.producto_id JOIN planes pl ON pl.id = v.plan_id WHERE v.id = ?`).get(ventaId);
  if (!v) throw noEncontrado('Venta no encontrada');
  if (v.estado === 'anulada') throw new ErrorHttp(422, 'La venta está anulada');
  if (v.total <= 0) throw new ErrorHttp(422, 'Esta venta no tiene importe');
  const existente = db.prepare("SELECT * FROM comprobantes_fiscales WHERE venta_id = ? AND (pago_id IS ? OR pago_id = ?) AND estado IN ('pendiente','aceptado') AND tipo != 'nota_credito'").get(ventaId, pago_id, pago_id);
  if (existente) return existente;

  // Datos fiscales del cliente: los enviados ahora tienen prioridad y se guardan en la ficha.
  const cli = { documento_tipo: datosCliente.documento_tipo ?? v.documento_tipo, documento: datosCliente.documento ?? v.documento, razon_social: datosCliente.razon_social ?? v.razon_social ?? v.cliente_nombre, direccion: datosCliente.direccion ?? v.direccion };
  if (tipo === 'factura' && (cli.documento_tipo !== 'RUC' || !cli.documento)) throw new ErrorHttp(422, 'Una factura requiere RUC del cliente');
  if (tipo === 'boleta' && !cli.documento) { cli.documento_tipo = cli.documento_tipo || 'OTRO'; cli.documento = '00000000'; }
  if (datosCliente.documento) db.prepare('UPDATE clientes SET documento_tipo = ?, documento = ?, razon_social = COALESCE(?, razon_social), direccion = COALESCE(?, direccion) WHERE id = ?').run(cli.documento_tipo, cli.documento, datosCliente.razon_social ?? null, datosCliente.direccion ?? null, v.cliente_id);

  let importe = v.total;
  if (pago_id) { const p = db.prepare('SELECT monto FROM pagos WHERE id = ? AND venta_id = ?').get(pago_id, ventaId); if (!p) throw noEncontrado('Pago no encontrado'); importe = p.monto; }
  const { base, igv, total } = desglosarIgv(importe);
  const serie = tipo === 'factura' ? ajuste('serie_factura', 'F001') : ajuste('serie_boleta', 'B001');
  const numero = siguienteNumero(db, serie);
  const proveedor = proveedorFacturacion();
  const r = db.prepare(`INSERT INTO comprobantes_fiscales (venta_id, pago_id, proveedor, tipo, serie, numero, cliente_documento_tipo, cliente_documento, cliente_razon_social, cliente_direccion, moneda, total, igv, estado, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`).run(ventaId, pago_id, proveedor, tipo, serie, numero, cli.documento_tipo, cli.documento, cli.razon_social, cli.direccion ?? null, v.moneda, total, igv, actor?.id ?? null);
  const id = Number(r.lastInsertRowid);

  if (proveedor === 'manual') {
    db.prepare("UPDATE comprobantes_fiscales SET estado = 'aceptado' WHERE id = ?").run(id);
  } else if (proveedor === 'nubefact') {
    const cuerpo = {
      operacion: 'generar_comprobante', tipo_de_comprobante: tipo === 'factura' ? 1 : 2, serie, numero: Number(numero), sunat_transaction: 1,
      cliente_tipo_de_documento: DOC_SUNAT[cli.documento_tipo] ?? '0', cliente_numero_de_documento: cli.documento, cliente_denominacion: cli.razon_social, cliente_direccion: cli.direccion || '-', cliente_email: v.cliente_email || '',
      fecha_de_emision: hoyLocal().split('-').reverse().join('-'), moneda: MONEDA_NUBEFACT[v.moneda] ?? 2, porcentaje_de_igv: ajusteNumero('igv_pct', 18),
      total_gravada: base, total_igv: igv, total, enviar_automaticamente_a_la_sunat: true, enviar_automaticamente_al_cliente: Boolean(v.cliente_email), observaciones: `Venta ${v.numero}${pago_id ? ` · pago ${pago_id}` : ''}`,
      items: [{ unidad_de_medida: 'ZZ', codigo: String(v.plan_id), descripcion: `${v.producto_nombre} · ${v.plan_nombre}${v.cantidad > 1 ? ` × ${v.cantidad}` : ''}`, cantidad: 1, valor_unitario: base, precio_unitario: total, subtotal: base, tipo_de_igv: 1, igv, total, anticipo_regularizacion: false }],
    };
    try {
      const resp = await fetch(ajuste('nubefact_url'), { method: 'POST', headers: { Authorization: `Token token="${ajuste('nubefact_token')}"`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok || d.errors) {
        db.prepare("UPDATE comprobantes_fiscales SET estado = 'error', error = ?, respuesta = ? WHERE id = ?").run(String(d.errors || d.error || `HTTP ${resp.status}`), JSON.stringify(d), id);
      } else {
        db.prepare("UPDATE comprobantes_fiscales SET estado = ?, enlace_pdf = ?, enlace_xml = ?, hash = ?, respuesta = ? WHERE id = ?")
          .run(d.aceptada_por_sunat === false ? 'rechazado' : 'aceptado', d.enlace_del_pdf ?? null, d.enlace_del_xml ?? null, d.codigo_hash ?? null, JSON.stringify(d), id);
      }
    } catch (e) {
      db.prepare("UPDATE comprobantes_fiscales SET estado = 'error', error = ? WHERE id = ?").run(e.message, id);
    }
  }
  const fila = db.prepare('SELECT * FROM comprobantes_fiscales WHERE id = ?').get(id);
  auditar({ usuarioId: actor?.id ?? null, accion: 'comprobante.emitir', entidad: 'venta', entidadId: ventaId, detalle: { tipo, serie, numero, total, estado: fila.estado, proveedor } });
  return fila;
}

/** Anulación (comunicación de baja en SUNAT vía Nubefact) o anulación manual. */
export async function anularComprobante(id, motivo, actor) {
  const db = obtenerDb();
  const cf = db.prepare('SELECT * FROM comprobantes_fiscales WHERE id = ?').get(id);
  if (!cf) throw noEncontrado('Comprobante no encontrado');
  if (cf.estado !== 'aceptado') throw new ErrorHttp(422, 'Solo se anulan comprobantes aceptados');
  if (cf.proveedor === 'nubefact') {
    const resp = await fetch(ajuste('nubefact_url'), { method: 'POST', headers: { Authorization: `Token token="${ajuste('nubefact_token')}"`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operacion: 'generar_anulacion', tipo_de_comprobante: cf.tipo === 'factura' ? 1 : 2, serie: cf.serie, numero: Number(cf.numero), motivo }) });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || d.errors) throw new ErrorHttp(502, `Nubefact: ${d.errors || d.error || resp.status}`);
  }
  db.prepare("UPDATE comprobantes_fiscales SET estado = 'anulado', error = ? WHERE id = ?").run(motivo, id);
  auditar({ usuarioId: actor.id, accion: 'comprobante.anular', entidad: 'venta', entidadId: cf.venta_id, detalle: { serie: cf.serie, numero: cf.numero, motivo } });
  return db.prepare('SELECT * FROM comprobantes_fiscales WHERE id = ?').get(id);
}

/** Emisión automática al confirmar un pago, si está activada y el cliente tiene documento. */
export async function facturarAutomatico(ventaId, pagoId) {
  if (!facturacionActiva() || ajuste('facturar_automatico', '0') !== '1') return null;
  const db = obtenerDb();
  const v = db.prepare('SELECT v.total, v.cuotas, c.documento_tipo, c.documento FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?').get(ventaId);
  if (!v || v.total <= 0) return null;
  const tipo = v.documento_tipo === 'RUC' ? 'factura' : 'boleta';
  try { return await emitirComprobante(ventaId, { tipo, pago_id: v.cuotas > 1 ? pagoId : null }, null); }
  catch { return null; }
}
