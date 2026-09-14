import { obtenerDb, hoyLocal, ahoraSql, modZona, ajuste } from '../db.js';
import { esGestor, esSuperadmin } from '../middleware/auth.js';
import { actualizarEstadosPorFecha } from './licencias.js';
import { resumenSalud } from './retencion.js';

const redondear = (n) => Math.round(n * 100) / 100;

/** Resumen del panel. Los gestores ven la agencia entera; el vendedor, solo lo suyo. */
export function resumen(usuario) {
  actualizarEstadosPorFecha();
  const db = obtenerDb();
  const hoy = hoyLocal();
  const mes = hoy.slice(0, 7);
  const z = modZona();
  const propio = !esGestor(usuario);
  const fv = propio ? 'AND v.vendedor_id = ?' : '';
  const fl = propio ? 'AND l.vendedor_id = ?' : '';
  const fc = propio ? 'AND co.vendedor_id = ?' : '';
  const p = propio ? [usuario.id] : [];

  const ventasHoy = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_base),0) AS total FROM ventas v WHERE date(v.creado_en, ?) = ? AND v.estado != 'anulada' ${fv}`).get(z, hoy, ...p);
  const ventasMes = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_base),0) AS total FROM ventas v WHERE strftime('%Y-%m', v.creado_en, ?) = ? AND v.estado != 'anulada' ${fv}`).get(z, mes, ...p);
  const cobradoHoy = db.prepare(`SELECT COALESCE(SUM(COALESCE(pg.monto_base, pg.monto)),0) AS total FROM pagos pg JOIN ventas v ON v.id = pg.venta_id WHERE pg.estado = 'confirmado' AND date(pg.confirmado_en, ?) = ? ${fv}`).get(z, hoy, ...p).total;
  const cobradoMes = db.prepare(`SELECT COALESCE(SUM(COALESCE(pg.monto_base, pg.monto)),0) AS total FROM pagos pg JOIN ventas v ON v.id = pg.venta_id WHERE pg.estado = 'confirmado' AND strftime('%Y-%m', pg.confirmado_en, ?) = ? ${fv}`).get(z, mes, ...p).total;
  const comisiones = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN co.estado = 'devengada' THEN co.monto END),0) AS pendiente,
      COALESCE(SUM(CASE WHEN co.estado = 'liquidada' THEN co.monto END),0) AS liquidada,
      COALESCE(SUM(CASE WHEN co.estado != 'revertida' AND strftime('%Y-%m', co.creado_en, ?) = ? THEN co.monto END),0) AS mes
     FROM comisiones co WHERE 1=1 ${fc}`).get(z, mes, ...p);

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
    .prepare(`SELECT pg.id, pg.monto, v.moneda, pg.metodo, pg.creado_en, v.numero AS venta_numero, v.id AS venta_id, c.nombre AS cliente_nombre, u.nombre AS registrado_por_nombre
      FROM pagos pg JOIN ventas v ON v.id = pg.venta_id JOIN clientes c ON c.id = v.cliente_id JOIN usuarios u ON u.id = pg.registrado_por
      WHERE pg.estado = 'pendiente' ${fv} ORDER BY pg.id DESC LIMIT 30`)
    .all(...p);
  const ultimasVentas = db
    .prepare(`SELECT v.id, v.numero, v.total, v.moneda, v.total_base, v.estado, v.creado_en, c.nombre AS cliente_nombre, pr.nombre AS producto_nombre, pl.tipo AS plan_tipo, u.nombre AS vendedor_nombre
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
    moneda_base: ajuste('moneda_base', 'USD'),
    enlace_venta: usuario.codigo_ref ? `${ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '')}/comprar?ref=${usuario.codigo_ref}` : null,
    meta: (() => {
      const m = db.prepare('SELECT objetivo_monto, bono_pct FROM metas WHERE usuario_id = ? AND mes = ?').get(usuario.id, mes);
      if (!m) return null;
      const vendido = db.prepare("SELECT COALESCE(SUM(total_base),0) AS s FROM ventas WHERE vendedor_id = ? AND estado = 'pagada' AND strftime('%Y-%m', pagada_en, ?) = ?").get(usuario.id, z, mes).s;
      return { objetivo: m.objetivo_monto, bono_pct: m.bono_pct, vendido: redondear(vendido), cumplida: vendido >= m.objetivo_monto };
    })(),
  };

  salida.salud = resumenSalud(usuario);
  if (!esSuperadmin(usuario)) {
    // Admin y vendedor ven solo su propia comisión, nunca la bolsa de comisiones de la agencia.
    const propias = db.prepare(`SELECT COALESCE(SUM(CASE WHEN estado = 'devengada' THEN monto END),0) AS pendiente, COALESCE(SUM(CASE WHEN estado = 'liquidada' THEN monto END),0) AS liquidada,
      COALESCE(SUM(CASE WHEN estado != 'revertida' AND strftime('%Y-%m', creado_en, ?) = ? THEN monto END),0) AS mes FROM comisiones WHERE vendedor_id = ?`).get(z, mes, usuario.id);
    salida.comisiones = { pendiente: redondear(propias.pendiente), liquidada: redondear(propias.liquidada), mes: redondear(propias.mes) };
  }
  if (esSuperadmin(usuario)) {
    salida.equipo = db
      .prepare(`SELECT u.id, u.nombre, u.rol, u.tope_emisiones_dia,
          (SELECT COUNT(*) FROM ventas v WHERE v.vendedor_id = u.id AND strftime('%Y-%m', v.creado_en, ?) = ? AND v.estado != 'anulada') AS ventas_mes,
          (SELECT COALESCE(SUM(v.total_base),0) FROM ventas v WHERE v.vendedor_id = u.id AND strftime('%Y-%m', v.creado_en, ?) = ? AND v.estado = 'pagada') AS vendido_mes,
          (SELECT COALESCE(SUM(co.monto),0) FROM comisiones co WHERE co.vendedor_id = u.id AND co.estado = 'devengada') AS comision_pendiente,
          (SELECT COUNT(*) FROM licencias l WHERE l.emitida_por = u.id AND date(l.creado_en, ?) = ?) AS emitidas_hoy,
          (SELECT COUNT(*) FROM licencias l JOIN planes pl ON pl.id = l.plan_id WHERE l.emitida_por = u.id AND pl.tipo = 'demo' AND l.creado_en >= datetime('now','-7 days')) AS demos_semana
        FROM usuarios u WHERE u.activo = 1 ORDER BY vendido_mes DESC`)
      .all(z, mes, z, mes, z, hoy);
    salida.alertas = {
      activaciones_rechazadas_24h: db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'activacion.rechazada' AND creado_en >= datetime('now','-1 day')").get().n,
      cierres_por_aprobar: db.prepare("SELECT COUNT(*) AS n FROM cierres_caja WHERE estado = 'cerrado'").get().n,
      pagos_por_confirmar: pagosPendientes.length,
      sin_cierre_hoy: db
        .prepare(`SELECT u.nombre FROM usuarios u WHERE u.activo = 1 AND u.rol = 'vendedor'
          AND EXISTS (SELECT 1 FROM pagos p WHERE p.registrado_por = u.id AND date(p.creado_en, ?) = ? AND p.estado != 'rechazado')
          AND NOT EXISTS (SELECT 1 FROM cierres_caja c WHERE c.vendedor_id = u.id AND c.fecha = ?)`)
        .all(z, hoy, hoy).map((f) => f.nombre),
      sobre_tope: salida.equipo.filter((u) => u.rol !== 'superadmin' && u.emitidas_hoy > u.tope_emisiones_dia).map((u) => u.nombre),
      instalaciones_desactualizadas: db
        .prepare("SELECT COUNT(*) AS n FROM activaciones a JOIN licencias l ON l.id = a.licencia_id JOIN productos p ON p.id = l.producto_id WHERE a.activa = 1 AND l.estado IN ('activa','mora') AND p.version_actual IS NOT NULL AND a.version IS NOT NULL AND a.version != p.version_actual")
        .get().n,
      instalaciones_sin_latido_7d: db
        .prepare("SELECT COUNT(*) AS n FROM activaciones a JOIN licencias l ON l.id = a.licencia_id WHERE a.activa = 1 AND l.estado IN ('activa','mora') AND a.ultimo_latido < datetime('now','-7 days')")
        .get().n,
    };
    salida.ventas_por_dia = db
      .prepare(`SELECT date(pg.confirmado_en, ?) AS dia, COALESCE(SUM(COALESCE(pg.monto_base, pg.monto)),0) AS total FROM pagos pg
        WHERE pg.estado = 'confirmado' AND pg.confirmado_en >= datetime('now','-30 days') GROUP BY dia ORDER BY dia`)
      .all(z);
  }
  return salida;
}


/** Búsqueda global: clientes, ventas y licencias (respetando el alcance del rol). */
export function buscar(usuario, q) {
  const db = obtenerDb();
  const like = `%${String(q || '').trim()}%`;
  if (like.length < 4) return { clientes: [], ventas: [], licencias: [] };
  const propio = !esGestor(usuario);
  const clientes = db.prepare(`SELECT id, nombre, empresa, telefono FROM clientes WHERE (nombre LIKE ? OR empresa LIKE ? OR email LIKE ? OR telefono LIKE ?) ${propio ? 'AND vendedor_id = ?' : ''} ORDER BY id DESC LIMIT 6`).all(like, like, like, like, ...(propio ? [usuario.id] : []));
  const ventas = db.prepare(`SELECT v.id, v.numero, v.total, v.moneda, v.estado, c.nombre AS cliente FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE (v.numero LIKE ? OR c.nombre LIKE ?) ${propio ? 'AND v.vendedor_id = ?' : ''} ORDER BY v.id DESC LIMIT 6`).all(like, like, ...(propio ? [usuario.id] : []));
  const licencias = db.prepare(`SELECT l.id, l.clave, l.etiqueta, l.estado, c.nombre AS cliente, pr.nombre AS producto FROM licencias l JOIN clientes c ON c.id = l.cliente_id JOIN productos pr ON pr.id = l.producto_id WHERE (l.clave LIKE ? OR l.etiqueta LIKE ? OR c.nombre LIKE ?) ${propio ? 'AND l.vendedor_id = ?' : ''} ORDER BY l.id DESC LIMIT 6`).all(like, like, like, ...(propio ? [usuario.id] : []));
  return { clientes, ventas, licencias };
}

/** Series mensuales para gráficos: cobros por producto y por vendedor (moneda base). */
export function series(usuario, { meses = 6 } = {}) {
  const db = obtenerDb();
  const z = modZona();
  const n = Math.min(24, Math.max(1, Number(meses) || 6));
  const propio = !esGestor(usuario);
  const filtro = propio ? 'AND v.vendedor_id = ?' : '';
  const p = propio ? [usuario.id] : [];
  const desde = new Date(); desde.setUTCDate(1); desde.setUTCMonth(desde.getUTCMonth() - (n - 1));
  const desdeMes = desde.toISOString().slice(0, 7);
  const meses_lista = []; for (let i = 0; i < n; i++) { const d = new Date(desde); d.setUTCMonth(desde.getUTCMonth() + i); meses_lista.push(d.toISOString().slice(0, 7)); }
  const porProducto = db.prepare(`SELECT strftime('%Y-%m', pg.confirmado_en, ?) AS mes, pr.nombre AS serie, COALESCE(SUM(COALESCE(pg.monto_base, pg.monto)),0) AS total
    FROM pagos pg JOIN ventas v ON v.id = pg.venta_id JOIN productos pr ON pr.id = v.producto_id
    WHERE pg.estado = 'confirmado' AND strftime('%Y-%m', pg.confirmado_en, ?) >= ? ${filtro} GROUP BY mes, pr.id ORDER BY mes`).all(z, z, desdeMes, ...p);
  const porVendedor = !esSuperadmin(usuario) ? [] : db.prepare(`SELECT strftime('%Y-%m', pg.confirmado_en, ?) AS mes, u.nombre AS serie, COALESCE(SUM(COALESCE(pg.monto_base, pg.monto)),0) AS total
    FROM pagos pg JOIN ventas v ON v.id = pg.venta_id JOIN usuarios u ON u.id = v.vendedor_id
    WHERE pg.estado = 'confirmado' AND strftime('%Y-%m', pg.confirmado_en, ?) >= ? GROUP BY mes, u.id ORDER BY mes`).all(z, z, desdeMes);
  const nuevasLicencias = db.prepare(`SELECT strftime('%Y-%m', l.activa_desde, ?) AS mes, COUNT(*) AS total FROM licencias l JOIN ventas v ON v.id = l.venta_id WHERE l.activa_desde IS NOT NULL AND strftime('%Y-%m', l.activa_desde, ?) >= ? ${filtro} GROUP BY mes`).all(z, z, desdeMes, ...p);
  return { meses: meses_lista, moneda_base: ajuste('moneda_base', 'USD'), por_producto: porProducto, por_vendedor: porVendedor, licencias_nuevas: nuevasLicencias };
}
