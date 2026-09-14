import { obtenerDb } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { auditar } from './auditoria.js';

export function listarProductos({ incluirInactivos = false } = {}) {
  const db = obtenerDb();
  const productos = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM licencias l WHERE l.producto_id = p.id AND l.estado IN ('activa','mora')) AS licencias_activas,
        (SELECT COUNT(*) FROM licencias l WHERE l.producto_id = p.id) AS licencias_total
       FROM productos p ${incluirInactivos ? '' : 'WHERE p.activo = 1'} ORDER BY p.nombre`
    )
    .all();
  const planes = db.prepare('SELECT * FROM planes ORDER BY producto_id, precio').all();
  return productos.map((p) => ({ ...p, planes: planes.filter((pl) => pl.producto_id === p.id) }));
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
    .prepare('INSERT INTO productos (codigo, nombre, descripcion) VALUES (?, ?, ?)')
    .run(datos.codigo, datos.nombre, datos.descripcion ?? null);
  const id = Number(r.lastInsertRowid);
  auditar({ usuarioId: actor.id, accion: 'producto.crear', entidad: 'producto', entidadId: id, detalle: datos });
  return obtenerProducto(id);
}

export function actualizarProducto(id, datos, actor) {
  obtenerProducto(id);
  const campos = [];
  const valores = [];
  for (const k of ['nombre', 'descripcion', 'activo']) {
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
  if (campos.length) obtenerDb().prepare(`UPDATE planes SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id);
  auditar({ usuarioId: actor.id, accion: 'plan.actualizar', entidad: 'plan', entidadId: id, detalle: datos });
  return obtenerPlan(id);
}
