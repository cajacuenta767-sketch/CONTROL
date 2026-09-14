import PDFDocument from 'pdfkit';
import { obtenerDb, ajuste } from '../db.js';
import { noEncontrado } from '../middleware/errores.js';
import { obtenerVenta } from './ventas.js';
import { obtenerCierre, obtenerLiquidacion } from './caja.js';

const ETIQUETA = {
  mensual: 'Mensual', anual: 'Anual', vitalicio: 'Vitalicio', sucursal_extra: 'Sucursal extra', mantenimiento: 'Mantenimiento', demo: 'Demo',
  efectivo: 'Efectivo', transferencia: 'Transferencia', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', paypal: 'PayPal', stripe: 'Stripe', otro: 'Otro',
  pendiente: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada', confirmado: 'Confirmado', rechazado: 'Rechazado',
};
const dinero = (n, moneda = 'USD') => `${Number(n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`;
const fecha = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');

/** Crea el documento y devuelve una promesa con el Buffer. */
function generar(construir) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Producer: 'CONTROL' } });
    const trozos = [];
    doc.on('data', (c) => trozos.push(c));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);
    try { construir(doc); doc.end(); } catch (e) { reject(e); }
  });
}

function encabezado(doc, titulo, subtitulo) {
  const agencia = ajuste('nombre_agencia', 'CONTROL');
  const direccion = ajuste('direccion_agencia', '');
  doc.rect(0, 0, doc.page.width, 90).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(agencia, 48, 30);
  if (direccion) doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1').text(direccion, 48, 56);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text(titulo, 48, 30, { align: 'right' });
  if (subtitulo) doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1').text(subtitulo, 48, 50, { align: 'right' });
  doc.fillColor('#1f2937').moveDown();
  doc.y = 116;
}

function pie(doc, texto) {
  doc.fontSize(8).fillColor('#6b7280').text(texto, 48, doc.page.height - 60, { align: 'center', width: doc.page.width - 96 });
}

function tabla(doc, columnas, filas, { anchos }) {
  const x0 = 48;
  let y = doc.y + 6;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#6b7280');
  let x = x0;
  columnas.forEach((c, i) => { doc.text(c.titulo, x, y, { width: anchos[i], align: c.alinear || 'left' }); x += anchos[i]; });
  y += 16;
  doc.moveTo(x0, y).lineTo(x0 + anchos.reduce((a, b) => a + b, 0), y).strokeColor('#e5e7eb').stroke();
  doc.font('Helvetica').fontSize(9.5).fillColor('#1f2937');
  for (const f of filas) {
    if (y > doc.page.height - 100) { doc.addPage(); y = 60; }
    y += 6; x = x0;
    let alto = 12;
    columnas.forEach((c, i) => {
      const texto = String(c.celda(f) ?? '');
      const h = doc.heightOfString(texto, { width: anchos[i] });
      alto = Math.max(alto, h);
      doc.text(texto, x, y, { width: anchos[i], align: c.alinear || 'left' });
      x += anchos[i];
    });
    y += alto + 4;
    doc.moveTo(x0, y).lineTo(x0 + anchos.reduce((a, b) => a + b, 0), y).strokeColor('#f3f4f6').stroke();
  }
  doc.y = y + 8;
}

function parClaveValor(doc, pares) {
  doc.fontSize(10);
  for (const [k, v] of pares) {
    doc.font('Helvetica').fillColor('#6b7280').text(`${k}: `, { continued: true }).font('Helvetica-Bold').fillColor('#1f2937').text(String(v ?? '—'));
  }
  doc.moveDown(0.5);
}

export function reciboVenta(ventaId) {
  const v = obtenerVenta(ventaId);
  const marca = v.marca_nombre || ajuste('nombre_agencia', 'CONTROL');
  return generar((doc) => {
    encabezado(doc, `Recibo de venta ${v.numero}`, `Emitido ${fecha(v.creado_en)} · Estado: ${ETIQUETA[v.estado] || v.estado}`);
    doc.font('Helvetica-Bold').fontSize(12).text('Cliente');
    parClaveValor(doc, [['Nombre', v.cliente_nombre], ['Empresa', v.cliente_empresa || '—'], ['Contacto', [v.cliente_telefono, v.cliente_email].filter(Boolean).join(' · ') || '—'], ['Atendido por', `${v.vendedor_nombre}${v.marca_nombre ? ` (${marca})` : ''}`]]);
    doc.font('Helvetica-Bold').fontSize(12).text('Detalle');
    tabla(doc, [
      { titulo: 'Producto', celda: (f) => f.producto },
      { titulo: 'Plan', celda: (f) => f.plan },
      { titulo: 'Cant.', celda: (f) => f.cantidad, alinear: 'right' },
      { titulo: 'Precio', celda: (f) => dinero(f.precio, v.moneda), alinear: 'right' },
      { titulo: 'Desc.', celda: (f) => `${f.descuento}%`, alinear: 'right' },
      { titulo: 'Total', celda: (f) => dinero(f.total, v.moneda), alinear: 'right' },
    ], [{ producto: v.producto_nombre, plan: ETIQUETA[v.plan_tipo] || v.plan_nombre, cantidad: v.cantidad, precio: v.precio_unitario, descuento: v.descuento_pct, total: v.total }], { anchos: [170, 90, 45, 80, 45, 90] });
    doc.font('Helvetica-Bold').fontSize(11).text(`Total: ${dinero(v.total, v.moneda)}`, { align: 'right' });
    if (v.moneda !== v.moneda_base) doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`Equivale a ${dinero(v.total_base, v.moneda_base)} (T.C. ${v.tipo_cambio})`, { align: 'right' }).fillColor('#1f2937');
    doc.font('Helvetica').fontSize(10).text(`Pagado: ${dinero(v.pagado, v.moneda)} · Saldo: ${dinero(v.saldo, v.moneda)}`, { align: 'right' });
    doc.moveDown();
    if (v.pagos.length) {
      doc.font('Helvetica-Bold').fontSize(12).text('Cobros');
      tabla(doc, [
        { titulo: 'Fecha', celda: (p) => fecha(p.confirmado_en || p.creado_en) },
        { titulo: 'Método', celda: (p) => ETIQUETA[p.metodo] || p.metodo },
        { titulo: 'Referencia', celda: (p) => p.referencia || '—' },
        { titulo: 'Estado', celda: (p) => ETIQUETA[p.estado] || p.estado },
        { titulo: 'Monto', celda: (p) => dinero(p.monto, v.moneda), alinear: 'right' },
      ], v.pagos, { anchos: [110, 90, 150, 80, 90] });
    }
    const licencias = v.es_renovacion && v.licencia_renovada ? [v.licencia_renovada] : v.licencias;
    if (licencias.length) {
      doc.font('Helvetica-Bold').fontSize(12).text('Licencias');
      tabla(doc, [
        { titulo: 'Clave', celda: (l) => l.clave },
        { titulo: 'Etiqueta', celda: (l) => l.etiqueta || '—' },
        { titulo: 'Estado', celda: (l) => l.estado },
        { titulo: 'Vence', celda: (l) => (l.vence_en ? fecha(l.vence_en).slice(0, 10) : l.estado === 'activa' ? 'Nunca' : '—') },
      ], licencias, { anchos: [190, 140, 90, 100] });
    }
    pie(doc, `${marca} · Documento generado por CONTROL. Conserva este recibo como comprobante de tu compra.`);
  });
}

export function reciboPago(pagoId) {
  const p = obtenerDb().prepare('SELECT * FROM pagos WHERE id = ?').get(pagoId);
  if (!p) throw noEncontrado('Pago no encontrado');
  const v = obtenerVenta(p.venta_id);
  return generar((doc) => {
    encabezado(doc, `Recibo de pago #${p.id}`, `Venta ${v.numero} · ${fecha(p.confirmado_en || p.creado_en)}`);
    doc.font('Helvetica-Bold').fontSize(12).text('Recibimos de');
    parClaveValor(doc, [['Cliente', v.cliente_nombre], ['Empresa', v.cliente_empresa || '—'], ['Concepto', `${v.producto_nombre} · ${ETIQUETA[v.plan_tipo] || v.plan_nombre} (${v.numero})`]]);
    doc.font('Helvetica-Bold').fontSize(12).text('Pago');
    parClaveValor(doc, [['Monto', dinero(p.monto, v.moneda)], ['Método', ETIQUETA[p.metodo] || p.metodo], ['Referencia', p.referencia || '—'], ['Estado', ETIQUETA[p.estado] || p.estado], ['Saldo restante de la venta', dinero(v.saldo, v.moneda)]]);
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(22).text(dinero(p.monto, v.moneda), { align: 'right' });
    pie(doc, `${v.marca_nombre || ajuste('nombre_agencia', 'CONTROL')} · Recibo generado por CONTROL.`);
  });
}

export function reciboLiquidacion(id) {
  const l = obtenerLiquidacion(id);
  return generar((doc) => {
    encabezado(doc, `Liquidación de comisiones #${l.id}`, `${l.vendedor_nombre} · ${l.desde} a ${l.hasta} · ${l.estado === 'pagada' ? `Pagada ${fecha(l.pagada_en)}` : 'Pendiente de pago'}`);
    tabla(doc, [
      { titulo: 'Fecha', celda: (c) => fecha(c.creado_en).slice(0, 10) },
      { titulo: 'Venta', celda: (c) => `${c.venta_numero} · ${c.cliente_nombre}` },
      { titulo: 'Base', celda: (c) => dinero(c.base, ajuste('moneda_base', 'USD')), alinear: 'right' },
      { titulo: '%', celda: (c) => `${c.pct}%`, alinear: 'right' },
      { titulo: 'Comisión', celda: (c) => dinero(c.monto, ajuste('moneda_base', 'USD')), alinear: 'right' },
    ], l.comisiones, { anchos: [70, 210, 90, 50, 100] });
    doc.font('Helvetica-Bold').fontSize(14).text(`Total a pagar: ${dinero(l.total, ajuste('moneda_base', 'USD'))}`, { align: 'right' });
    doc.moveDown(3);
    doc.font('Helvetica').fontSize(10).text('______________________________            ______________________________');
    doc.text('Recibí conforme (vendedor)                                   Entregó (agencia)');
    pie(doc, `${ajuste('nombre_agencia', 'CONTROL')} · Liquidación generada por CONTROL.`);
  });
}

export function cierreCajaPdf(id) {
  const c = obtenerCierre(id);
  const base = ajuste('moneda_base', 'USD');
  return generar((doc) => {
    encabezado(doc, `Cierre de caja · ${c.fecha}`, `${c.vendedor_nombre} · ${c.estado}${c.aprobado_por_nombre ? ` por ${c.aprobado_por_nombre}` : ''}`);
    parClaveValor(doc, [['Cobros', c.cantidad_pagos], ['Total cobrado (equivalente)', dinero(c.total_base, base)], ['A entregar en mano', dinero(c.a_entregar, base)], ['Comisión del día', dinero(c.comision_dia, base)], ['Observación', c.observacion || '—']]);
    const filas = [];
    for (const [moneda, metodos] of Object.entries(c.por_moneda || {})) for (const [metodo, monto] of Object.entries(metodos)) filas.push({ moneda, metodo, monto });
    if (!filas.length) for (const [metodo, monto] of Object.entries(c.por_metodo || {})) filas.push({ moneda: base, metodo, monto });
    doc.font('Helvetica-Bold').fontSize(12).text('Por método y moneda');
    tabla(doc, [
      { titulo: 'Moneda', celda: (f) => f.moneda },
      { titulo: 'Método', celda: (f) => ETIQUETA[f.metodo] || f.metodo },
      { titulo: 'Monto', celda: (f) => dinero(f.monto, f.moneda), alinear: 'right' },
    ], filas, { anchos: [100, 200, 150] });
    doc.moveDown(3);
    doc.font('Helvetica').fontSize(10).text('______________________________            ______________________________');
    doc.text('Vendedor                                                                    Aprobó');
    pie(doc, `${ajuste('nombre_agencia', 'CONTROL')} · Cierre generado por CONTROL.`);
  });
}
