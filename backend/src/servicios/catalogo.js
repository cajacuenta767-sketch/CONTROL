import { obtenerDb, transaccion, ajuste } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { auditar } from './auditoria.js';

export function listarProductos({ incluirInactivos = false } = {}) {
  const db = obtenerDb();
  const productos = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM licencias l WHERE l.producto_id = p.id AND l.estado IN ('activa','mora')) AS licencias_activas,
        (SELECT COUNT(*) FROM licencias l WHERE l.producto_id = p.id) AS licencias_total,
        (SELECT COUNT(*) FROM activaciones a JOIN licencias l ON l.id = a.licencia_id WHERE l.producto_id = p.id AND a.activa = 1 AND p.version_actual IS NOT NULL AND a.version IS NOT NULL AND a.version != p.version_actual) AS instalaciones_desactualizadas
       FROM productos p ${incluirInactivos ? '' : 'WHERE p.activo = 1'} ORDER BY p.nombre`
    )
    .all();
  const planes = db.prepare(`SELECT pl.*,
      (SELECT h.creado_en FROM precios_historial h WHERE h.plan_id = pl.id ORDER BY h.id DESC LIMIT 1) AS precio_desde,
      (SELECT h.precio_anterior FROM precios_historial h WHERE h.plan_id = pl.id ORDER BY h.id DESC LIMIT 1) AS precio_anterior
    FROM planes pl ORDER BY pl.producto_id, pl.precio`).all();
  return productos.map((p) => ({ ...p, planes: planes.filter((pl) => pl.producto_id === p.id) }));
}

/** Niveles de precio sugeridos (Ajustes › niveles_precio) para aplicar de un clic en el editor. */
export function nivelesPrecio() {
  try { const n = JSON.parse(ajuste('niveles_precio', '[]')); return Array.isArray(n) ? n : []; } catch { return []; }
}

const TIPOS_PRECIO = ['mensual', 'anual', 'vitalicio', 'sucursal_extra', 'mantenimiento'];

/**
 * Cambia varios precios de golpe (editor de precios del dueño). `cambios` es una lista de
 * { plan_id, precio }. Solo se registran los que realmente cambian; cada uno queda en
 * precios_historial y en auditoría. Las ventas ya hechas conservan su precio.
 */
export function actualizarPrecios(cambios, motivo, actor) {
  return transaccion((db) => {
    const aplicados = [];
    for (const c of cambios) {
      const pl = db.prepare('SELECT id, precio, tipo, producto_id FROM planes WHERE id = ?').get(c.plan_id);
      if (!pl) throw noEncontrado(`Plan ${c.plan_id} no encontrado`);
      const nuevo = Math.round(Number(c.precio) * 100) / 100;
      if (!Number.isFinite(nuevo) || nuevo < 0) throw new ErrorHttp(422, 'Precio inválido');
      if (pl.tipo === 'demo' && nuevo !== 0) throw new ErrorHttp(422, 'La demo siempre es gratis');
      if (nuevo === pl.precio) continue;
      db.prepare('UPDATE planes SET precio = ? WHERE id = ?').run(nuevo, pl.id);
      db.prepare('INSERT INTO precios_historial (plan_id, precio_anterior, precio_nuevo, usuario_id, motivo) VALUES (?, ?, ?, ?, ?)').run(pl.id, pl.precio, nuevo, actor.id, motivo ?? null);
      aplicados.push({ plan_id: pl.id, producto_id: pl.producto_id, tipo: pl.tipo, anterior: pl.precio, nuevo });
    }
    if (aplicados.length) auditar({ usuarioId: actor.id, accion: 'precios.actualizar', entidad: 'catalogo', entidadId: null, detalle: { motivo, cambios: aplicados } });
    return { aplicados, total: aplicados.length };
  });
}

/** Sube o baja todos los precios (o los de un tipo) un porcentaje. Redondea a entero si el precio es mayor a 20. */
export function ajustarPreciosPorcentaje({ porcentaje, tipos = TIPOS_PRECIO, producto_id = null }, motivo, actor) {
  const db = obtenerDb();
  const filas = db.prepare(`SELECT id, precio FROM planes WHERE tipo IN (${tipos.map(() => '?').join(',')}) ${producto_id ? 'AND producto_id = ?' : ''} AND activo = 1`).all(...tipos, ...(producto_id ? [producto_id] : []));
  const cambios = filas.map((f) => { const n = f.precio * (1 + porcentaje / 100); return { plan_id: f.id, precio: n > 20 ? Math.round(n) : Math.round(n * 100) / 100 }; });
  return actualizarPrecios(cambios, motivo ?? `Ajuste del ${porcentaje}%`, actor);
}

export function historialPrecios({ plan_id, limite = 100 } = {}) {
  return obtenerDb()
    .prepare(`SELECT h.*, u.nombre AS usuario_nombre, pl.nombre AS plan_nombre, pl.tipo AS plan_tipo, pr.nombre AS producto_nombre
      FROM precios_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id JOIN planes pl ON pl.id = h.plan_id JOIN productos pr ON pr.id = pl.producto_id
      ${plan_id ? 'WHERE h.plan_id = ?' : ''} ORDER BY h.id DESC LIMIT ?`)
    .all(...(plan_id ? [plan_id] : []), limite);
}

export function obtenerProducto(id) {
  const p = obtenerDb().prepare('SELECT * FROM productos WHERE id = ?').get(id);
  if (!p) throw noEncontrado('Producto no encontrado');
  p.planes = obtenerDb().prepare('SELECT * FROM planes WHERE producto_id = ? ORDER BY precio').all(id);
  return p;
}

export function crearProducto(datos, actor) {
  const db = obtenerDb();
  if (db.prepare('SELECT 1 FROM productos WHERE codigo = ?').get(datos.codigo)) throw new ErrorHttp(409, 'Ese código ya existe');
  const r = db
    .prepare('INSERT INTO productos (codigo, nombre, descripcion, version_actual) VALUES (?, ?, ?, ?)')
    .run(datos.codigo, datos.nombre, datos.descripcion ?? null, datos.version_actual ?? null);
  const id = Number(r.lastInsertRowid);
  auditar({ usuarioId: actor.id, accion: 'producto.crear', entidad: 'producto', entidadId: id, detalle: datos });
  return obtenerProducto(id);
}

export function actualizarProducto(id, datos, actor) {
  obtenerProducto(id);
  const campos = [];
  const valores = [];
  for (const k of ['nombre', 'descripcion', 'activo', 'version_actual']) {
    if (datos[k] !== undefined) { campos.push(`${k} = ?`); valores.push(typeof datos[k] === 'boolean' ? Number(datos[k]) : datos[k]); }
  }
  if (campos.length) obtenerDb().prepare(`UPDATE productos SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id);
  auditar({ usuarioId: actor.id, accion: 'producto.actualizar', entidad: 'producto', entidadId: id, detalle: datos });
  return obtenerProducto(id);
}

export function obtenerPlan(id) {
  const p = obtenerDb()
    .prepare('SELECT pl.*, pr.codigo AS producto_codigo, pr.nombre AS producto_nombre FROM planes pl JOIN productos pr ON pr.id = pl.producto_id WHERE pl.id = ?')
    .get(id);
  if (!p) throw noEncontrado('Plan no encontrado');
  return p;
}

const DURACION_POR_TIPO = { mensual: 30, anual: 365, vitalicio: null, sucursal_extra: null, mantenimiento: 365, demo: 7 };

export function crearPlan(datos, actor) {
  const db = obtenerDb();
  obtenerProducto(datos.producto_id);
  if (db.prepare('SELECT 1 FROM planes WHERE producto_id = ? AND codigo = ?').get(datos.producto_id, datos.codigo)) {
    throw new ErrorHttp(409, 'Ese código de plan ya existe para el producto');
  }
  const duracion = datos.duracion_dias !== undefined ? datos.duracion_dias : DURACION_POR_TIPO[datos.tipo];
  const r = db
    .prepare(
      `INSERT INTO planes (producto_id, codigo, nombre, tipo, precio, duracion_dias, max_activaciones, comision_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(datos.producto_id, datos.codigo, datos.nombre, datos.tipo, datos.precio, duracion, datos.max_activaciones ?? 1, datos.comision_pct ?? null);
  const id = Number(r.lastInsertRowid);
  auditar({ usuarioId: actor.id, accion: 'plan.crear', entidad: 'plan', entidadId: id, detalle: datos });
  return obtenerPlan(id);
}

export function actualizarPlan(id, datos, actor) {
  obtenerPlan(id);
  const campos = [];
  const valores = [];
  for (const k of ['nombre', 'precio', 'duracion_dias', 'max_activaciones', 'comision_pct', 'activo']) {
    if (datos[k] !== undefined) { campos.push(`${k} = ?`); valores.push(typeof datos[k] === 'boolean' ? Number(datos[k]) : datos[k]); }
  }
  const antes = obtenerPlan(id);
  if (campos.length) obtenerDb().prepare(`UPDATE planes SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id);
  if (datos.precio !== undefined && datos.precio !== antes.precio) {
    obtenerDb().prepare('INSERT INTO precios_historial (plan_id, precio_anterior, precio_nuevo, usuario_id, motivo) VALUES (?, ?, ?, ?, ?)').run(id, antes.precio, datos.precio, actor.id, datos.motivo ?? null);
  }
  auditar({ usuarioId: actor.id, accion: 'plan.actualizar', entidad: 'plan', entidadId: id, detalle: datos });
  return obtenerPlan(id);
}
