import XLSX from 'xlsx';
import { obtenerDb, modZona, ajuste } from '../db.js';

/** Exportación contable mensual en Excel: ventas, cobros por método, comisiones, cierres de caja y comprobantes. */
export function exportacionContable(mes) {
  const db = obtenerDb();
  const z = modZona();
  const monedaBase = ajuste('moneda_base', 'USD');
  const ventas = db.prepare(`SELECT v.numero AS "N.º", date(v.creado_en, ?) AS Fecha, c.nombre AS Cliente, c.documento AS Documento, pr.nombre AS Producto, pl.nombre AS Plan, v.cantidad AS Cantidad, v.total AS Total, v.moneda AS Moneda, v.total_base AS "Total base", v.descuento_pct AS "Descuento %", v.estado AS Estado, u.nombre AS Vendedor, v.cuotas AS Cuotas
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id JOIN productos pr ON pr.id = v.producto_id JOIN planes pl ON pl.id = v.plan_id JOIN usuarios u ON u.id = v.vendedor_id WHERE strftime('%Y-%m', v.creado_en, ?) = ? ORDER BY v.id`).all(z, z, mes);
  const cobros = db.prepare(`SELECT p.id AS "Pago", date(p.confirmado_en, ?) AS Fecha, v.numero AS Venta, c.nombre AS Cliente, p.metodo AS Método, p.referencia AS Referencia, p.monto AS Monto, v.moneda AS Moneda, p.monto_base AS "Monto base", u.nombre AS "Registró", uc.nombre AS "Confirmó"
    FROM pagos p JOIN ventas v ON v.id = p.venta_id JOIN clientes c ON c.id = v.cliente_id JOIN usuarios u ON u.id = p.registrado_por LEFT JOIN usuarios uc ON uc.id = p.confirmado_por WHERE p.estado = 'confirmado' AND strftime('%Y-%m', p.confirmado_en, ?) = ? ORDER BY p.confirmado_en`).all(z, z, mes);
  const porMetodo = db.prepare(`SELECT p.metodo AS Método, v.moneda AS Moneda, COUNT(*) AS Cobros, SUM(p.monto) AS Total, SUM(p.monto_base) AS "Total base" FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE p.estado = 'confirmado' AND strftime('%Y-%m', p.confirmado_en, ?) = ? GROUP BY p.metodo, v.moneda ORDER BY Total DESC`).all(z, mes);
  const comisiones = db.prepare(`SELECT date(co.creado_en, ?) AS Fecha, u.nombre AS Vendedor, v.numero AS Venta, co.base AS Base, co.pct AS "%", co.monto AS Comisión, co.estado AS Estado, co.liquidacion_id AS "Liquidación"
    FROM comisiones co JOIN usuarios u ON u.id = co.vendedor_id JOIN ventas v ON v.id = co.venta_id WHERE strftime('%Y-%m', co.creado_en, ?) = ? ORDER BY co.id`).all(z, z, mes);
  const cierres = db.prepare(`SELECT cc.fecha AS Fecha, u.nombre AS Vendedor, cc.total_cobrado AS "Total cobrado", cc.a_entregar AS "A entregar", cc.estado AS Estado, cc.observacion AS "Observación" FROM cierres_caja cc JOIN usuarios u ON u.id = cc.vendedor_id WHERE strftime('%Y-%m', cc.fecha) = ? ORDER BY cc.fecha`).all(mes);
  const comprobantes = db.prepare(`SELECT date(cf.creado_en, ?) AS Fecha, cf.tipo AS Tipo, cf.serie || '-' || cf.numero AS "Serie-número", cf.cliente_razon_social AS Cliente, cf.cliente_documento AS Documento, cf.moneda AS Moneda, ROUND(cf.total - cf.igv, 2) AS Base, cf.igv AS IGV, cf.total AS Total, cf.estado AS Estado, v.numero AS Venta, cf.enlace_pdf AS PDF FROM comprobantes_fiscales cf JOIN ventas v ON v.id = cf.venta_id WHERE strftime('%Y-%m', cf.creado_en, ?) = ? ORDER BY cf.id`).all(z, z, mes);
  const resumen = [
    { Concepto: 'Mes', Valor: mes }, { Concepto: 'Moneda base', Valor: monedaBase },
    { Concepto: 'Ventas registradas', Valor: ventas.length }, { Concepto: 'Total vendido (base, sin anuladas)', Valor: ventas.filter((v) => v.Estado !== 'anulada').reduce((a, v) => a + (v['Total base'] || 0), 0) },
    { Concepto: 'Cobros confirmados', Valor: cobros.length }, { Concepto: 'Total cobrado (base)', Valor: cobros.reduce((a, c) => a + (c['Monto base'] || 0), 0) },
    { Concepto: 'Comisiones devengadas', Valor: comisiones.filter((c) => c.Estado !== 'revertida').reduce((a, c) => a + c['Comisión'], 0) },
    { Concepto: 'Comprobantes emitidos', Valor: comprobantes.filter((c) => c.Estado === 'aceptado').length },
  ];
  const wb = XLSX.utils.book_new();
  const hoja = (nombre, filas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ Aviso: 'Sin registros en el mes' }]), nombre);
  hoja('Resumen', resumen); hoja('Ventas', ventas); hoja('Cobros', cobros); hoja('Cobros por método', porMetodo); hoja('Comisiones', comisiones); hoja('Cierres de caja', cierres); hoja('Comprobantes', comprobantes);
  return { nombre: `contabilidad-${mes}.xlsx`, buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), resumen };
}
