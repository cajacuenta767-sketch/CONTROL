import { obtenerDb, hoySql, ahoraSql } from '../db.js';
import { esGestor } from '../middleware/auth.js';
import { actualizarEstadosPorFecha } from './licencias.js';

const redondear = (n) => Math.round(n * 100) / 100;

/** Resumen del panel. Los gestores ven la agencia entera; el vendedor, solo lo suyo. */
export function resumen(usuario) {
  actualizarEstadosPorFecha();
  const db = obtenerDb();
  const hoy = hoySql();
  const mes = hoy.slice(0, 7);
  const propio = !esGestor(usuario);
  const fv = propio ? 'AND v.vendedor_id = ?' : '';
  const fl = propio ? 'AND l.vendedor_id = ?' : '';
  const fc = propio ? 'AND co.vendedor_id = ?' : '';
  const p = propio ? [usuario.id] : [];

  const ventasHoy = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM ventas v WHERE date(v.creado_en) = ? AND v.estado != 'anulada' ${fv}`).get(hoy, ...p);
  const ventasMes = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM ventas v WHERE strftime('%Y-%m', v.creado_en) = ? AND v.estado != 'anulada' ${fv}`).get(mes, ...p);
  const cobradoHoy = db.prepare(`SELECT COALESCE(SUM(pg.monto),0) AS total FROM pagos pg JOIN ventas v ON v.id = pg.venta_id WHERE pg.estado = 'confirmado' AND date(pg.confirmado_en) = ? ${fv}`).get(hoy, ...p).total;
  const cobradoMes = db.prepare(`SELECT COALESCE(SUM(pg.monto),0) AS total FROM pagos pg JOIN ventas v ON v.id = pg.venta_id WHERE pg.estado = 'confirmado' AND strftime('%Y-%m', pg.confirmado_en) = ? ${fv}`).get(mes, ...p).total;
  const comisiones = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN co.estado = 'devengada' THEN co.monto END),0) AS pendiente,
      COALESCE(SUM(CASE WHEN co.estado = 'liquidada' THEN co.monto END),0) AS liquidada,
      COALESCE(SUM(CASE WHEN co.estado != 'revertida' AND strftime('%Y-%m', co.creado_en) = ? THEN co.monto END),0) AS mes
     FROM comisiones co WHERE 1=1 ${fc}`).get(mes, ...p);

  const licenciasPorEstado = Object.fromEntries(
    db.prepare(`SELECT l.estado, COUNT(*) AS n FROM licencias l WHERE 1=1 ${fl} GROUP BY l.estado`).all(...p).map((f) => [f.estado, f.n])
  );
  const licenciasPorProducto = db
    .prepare(`SELECT pr.nombre, pr.codigo, COUNT(*) AS total, SUM(CASE WHEN l.estado IN ('activa','mora') THEN 1 ELSE 0 END) AS activas
      FROM licencias l JOIN productos pr ON pr.id = l.producto_id WHERE 1=1 ${fl} GROUP BY pr.id ORDER BY total DESC`)
    .all(...p);
  const vencenPronto = db
    .prepare(`SELECT l.id, l.clave, l.etiqueta, l.vence_en, l.estado, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, pr.nombre AS producto_nombre, pl.tipo AS plan_tipo
      FROM licencias l JOIN clientes c ON c.id = l.cliente_id JOIN productos pr ON pr.id = l.producto_id JOIN planes pl ON pl.id = l.plan_id
      WHERE l.estado IN ('activa','mora') AND l.vence_en IS NOT NULL AND l.vence_en <= ? ${fl} ORDER BY l.vence_en LIMIT 30`)
    .all(ahoraSql(30), ...p);
  const pagosPendientes = db
    .prepare(`SELECT pg.id, pg.monto, pg.metodo, pg.creado_en, v.numero AS venta_numero, v.id AS venta_id, c.nombre AS cliente_nombre, u.nombre AS registrado_por_nombre
      FROM pagos pg JOIN ventas v ON v.id = pg.venta_id JOIN clientes c ON c.id = v.cliente_id JOIN usuarios u ON u.id = pg.registrado_por
      WHERE pg.estado = 'pendiente' ${fv} ORDER BY pg.id DESC LIMIT 30`)
    .all(...p);
  const ultimasVentas = db
    .prepare(`SELECT v.id, v.numero, v.total, v.estado, v.creado_en, c.nombre AS cliente_nombre, pr.nombre AS producto_nombre, pl.tipo AS plan_tipo, u.nombre AS vendedor_nombre
      FROM ventas v JOIN clientes c ON c.id = v.cliente_id JOIN productos pr ON pr.id = v.producto_id JOIN planes pl ON pl.id = v.plan_id JOIN usuarios u ON u.id = v.vendedor_id
      WHERE 1=1 ${fv} ORDER BY v.id DESC LIMIT 10`)
    .all(...p);

  const salida = {
    hoy, mes,
    ventas: { hoy: ventasHoy, mes: ventasMes },
    cobrado: { hoy: redondear(cobradoHoy), mes: redondear(cobradoMes) },
    comisiones: { pendiente: redondear(comisiones.pendiente), liquidada: redondear(comisiones.liquidada), mes: redondear(comisiones.mes) },
    licencias: { por_estado: licenciasPorEstado, por_producto: licenciasPorProducto, vencen_pronto: vencenPronto },
    pagos_pendientes: pagosPendientes,
    ultimas_ventas: ultimasVentas,
    caja_hoy: db.prepare('SELECT estado FROM cierres_caja WHERE vendedor_id = ? AND fecha = ?').get(usuario.id, hoy)?.estado ?? null,
  };

  if (!propio) {
    salida.equipo = db
      .prepare(`SELECT u.id, u.nombre, u.rol, u.tope_emisiones_dia,
          (SELECT COUNT(*) FROM ventas v WHERE v.vendedor_id = u.id AND strftime('%Y-%m', v.creado_en) = ? AND v.estado != 'anulada') AS ventas_mes,
          (SELECT COALESCE(SUM(v.total),0) FROM ventas v WHERE v.vendedor_id = u.id AND strftime('%Y-%m', v.creado_en) = ? AND v.estado = 'pagada') AS vendido_mes,
          (SELECT COALESCE(SUM(co.monto),0) FROM comisiones co WHERE co.vendedor_id = u.id AND co.estado = 'devengada') AS comision_pendiente,
          (SELECT COUNT(*) FROM licencias l WHERE l.emitida_por = u.id AND date(l.creado_en) = ?) AS emitidas_hoy,
          (SELECT COUNT(*) FROM licencias l JOIN planes pl ON pl.id = l.plan_id WHERE l.emitida_por = u.id AND pl.tipo = 'demo' AND l.creado_en >= datetime('now','-7 days')) AS demos_semana
        FROM usuarios u WHERE u.activo = 1 ORDER BY vendido_mes DESC`)
      .all(mes, mes, hoy);
    salida.alertas = {
      activaciones_rechazadas_24h: db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'activacion.rechazada' AND creado_en >= datetime('now','-1 day')").get().n,
      cierres_por_aprobar: db.prepare("SELECT COUNT(*) AS n FROM cierres_caja WHERE estado = 'cerrado'").get().n,
      pagos_por_confirmar: pagosPendientes.length,
      sin_cierre_hoy: db
        .prepare(`SELECT u.nombre FROM usuarios u WHERE u.activo = 1 AND u.rol = 'vendedor'
          AND EXISTS (SELECT 1 FROM pagos p WHERE p.registrado_por = u.id AND date(p.creado_en) = ? AND p.estado != 'rechazado')
          AND NOT EXISTS (SELECT 1 FROM cierres_caja c WHERE c.vendedor_id = u.id AND c.fecha = ?)`)
        .all(hoy, hoy).map((f) => f.nombre),
      sobre_tope: salida.equipo.filter((u) => u.rol !== 'superadmin' && u.emitidas_hoy > u.tope_emisiones_dia).map((u) => u.nombre),
      instalaciones_sin_latido_7d: db
        .prepare("SELECT COUNT(*) AS n FROM activaciones a JOIN licencias l ON l.id = a.licencia_id WHERE a.activa = 1 AND l.estado IN ('activa','mora') AND a.ultimo_latido < datetime('now','-7 days')")
        .get().n,
    };
    salida.ventas_por_dia = db
      .prepare(`SELECT date(pg.confirmado_en) AS dia, COALESCE(SUM(pg.monto),0) AS total FROM pagos pg
        WHERE pg.estado = 'confirmado' AND pg.confirmado_en >= datetime('now','-30 days') GROUP BY dia ORDER BY dia`)
      .all();
  }
  return salida;
}
