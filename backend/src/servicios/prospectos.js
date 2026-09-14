import { obtenerDb, ahoraSql, hoyLocal, modZona } from '../db.js';
import { ErrorHttp, noEncontrado, prohibido } from '../middleware/errores.js';
import { veTodo, puedeVender } from '../middleware/auth.js';
import { auditar } from './auditoria.js';
import { crearCliente } from './clientes.js';

export const ETAPAS = ['nuevo', 'contactado', 'demo', 'propuesta', 'ganado', 'perdido'];
const BASE = `SELECT p.*, u.nombre AS vendedor_nombre, pr.nombre AS producto_nombre, c.nombre AS cliente_nombre
  FROM prospectos p JOIN usuarios u ON u.id = p.vendedor_id LEFT JOIN productos pr ON pr.id = p.producto_id LEFT JOIN clientes c ON c.id = p.cliente_id`;

export function listarProspectos(usuario, { etapa, q, vendedor_id } = {}) {
  const cond = [], params = [];
  if (!veTodo(usuario)) { cond.push('p.vendedor_id = ?'); params.push(usuario.id); }
  else if (vendedor_id) { cond.push('p.vendedor_id = ?'); params.push(Number(vendedor_id)); }
  if (etapa) { cond.push('p.etapa = ?'); params.push(etapa); }
  if (q) { cond.push('(p.nombre LIKE ? OR p.negocio LIKE ? OR p.telefono LIKE ? OR p.rubro LIKE ?)'); params.push(...Array(4).fill(`%${q}%`)); }
  return obtenerDb().prepare(`${BASE} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY CASE p.etapa WHEN 'ganado' THEN 1 WHEN 'perdido' THEN 2 ELSE 0 END, COALESCE(p.proximo_paso_en, '9999') , p.actualizado_en DESC LIMIT 1000`).all(...params);
}

export function obtenerProspecto(id, usuario) {
  const p = obtenerDb().prepare(`${BASE} WHERE p.id = ?`).get(id);
  if (!p) throw noEncontrado('Prospecto no encontrado');
  if (usuario && !veTodo(usuario) && p.vendedor_id !== usuario.id) throw prohibido('Este prospecto es de otro vendedor');
  return p;
}

export function crearProspecto(datos, actor) {
  if (!puedeVender(actor) && !veTodo(actor)) throw prohibido();
  const vendedorId = veTodo(actor) && datos.vendedor_id ? datos.vendedor_id : actor.id;
  if (datos.etapa === 'perdido' && !datos.motivo_perdida) throw new ErrorHttp(422, 'Indica el motivo de la pérdida');
  const r = obtenerDb().prepare(`INSERT INTO prospectos (nombre, negocio, telefono, email, rubro, producto_id, etapa, motivo_perdida, notas, vendedor_id, origen, proximo_paso, proximo_paso_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(datos.nombre, datos.negocio ?? null, datos.telefono ?? null, datos.email ?? null, datos.rubro ?? null, datos.producto_id ?? null,
    datos.etapa ?? 'nuevo', datos.motivo_perdida ?? null, datos.notas ?? null, vendedorId, datos.origen ?? 'manual', datos.proximo_paso ?? null, datos.proximo_paso_en ?? null);
  const id = Number(r.lastInsertRowid);
  auditar({ usuarioId: actor.id, accion: 'prospecto.crear', entidad: 'prospecto', entidadId: id, detalle: { nombre: datos.nombre, etapa: datos.etapa ?? 'nuevo' } });
  return obtenerProspecto(id);
}

export function actualizarProspecto(id, datos, actor) {
  const antes = obtenerProspecto(id, actor);
  const campos = [], valores = [];
  const permitidos = ['nombre', 'negocio', 'telefono', 'email', 'rubro', 'producto_id', 'etapa', 'motivo_perdida', 'notas', 'proximo_paso', 'proximo_paso_en'];
  if (veTodo(actor)) permitidos.push('vendedor_id');
  for (const k of permitidos) if (datos[k] !== undefined) { campos.push(`${k} = ?`); valores.push(datos[k]); }
  if (datos.etapa && !ETAPAS.includes(datos.etapa)) throw new ErrorHttp(422, 'Etapa inválida');
  if (datos.etapa === 'perdido' && !(datos.motivo_perdida ?? antes.motivo_perdida)) throw new ErrorHttp(422, 'Indica el motivo de la pérdida');
  if (campos.length) { campos.push('actualizado_en = ?'); valores.push(ahoraSql()); obtenerDb().prepare(`UPDATE prospectos SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id); }
  if (datos.etapa && datos.etapa !== antes.etapa) auditar({ usuarioId: actor.id, accion: 'prospecto.etapa', entidad: 'prospecto', entidadId: id, detalle: { de: antes.etapa, a: datos.etapa, motivo: datos.motivo_perdida } });
  return obtenerProspecto(id);
}

/** Convierte el prospecto en cliente (o lo enlaza a uno existente) y lo marca ganado. */
export function convertirProspecto(id, { cliente_id } = {}, actor) {
  const p = obtenerProspecto(id, actor);
  if (p.cliente_id) return { prospecto: p, cliente_id: p.cliente_id, ya_convertido: true };
  let clienteId = cliente_id;
  if (!clienteId) {
    const c = crearCliente({ nombre: p.nombre, empresa: p.negocio, telefono: p.telefono, email: p.email || null, notas: [p.rubro ? `Rubro: ${p.rubro}` : null, p.notas].filter(Boolean).join(' · ') || null, vendedor_id: p.vendedor_id }, { ...actor, id: veTodo(actor) ? actor.id : actor.id });
    clienteId = c.id;
    if (veTodo(actor) && c.vendedor_id !== p.vendedor_id) obtenerDb().prepare('UPDATE clientes SET vendedor_id = ? WHERE id = ?').run(p.vendedor_id, c.id);
  }
  obtenerDb().prepare("UPDATE prospectos SET cliente_id = ?, etapa = 'ganado', actualizado_en = ? WHERE id = ?").run(clienteId, ahoraSql(), id);
  auditar({ usuarioId: actor.id, accion: 'prospecto.convertir', entidad: 'prospecto', entidadId: id, detalle: { cliente_id: clienteId } });
  return { prospecto: obtenerProspecto(id), cliente_id: clienteId };
}

/** Embudo: cuántos hay en cada etapa, tasa de conversión y cuántos pasos vencen hoy. */
export function embudo(usuario) {
  const db = obtenerDb();
  const propio = !veTodo(usuario);
  const where = propio ? 'WHERE p.vendedor_id = ?' : '';
  const params = propio ? [usuario.id] : [];
  const porEtapa = Object.fromEntries(ETAPAS.map((e) => [e, 0]));
  for (const f of db.prepare(`SELECT etapa, COUNT(*) AS n FROM prospectos p ${where} GROUP BY etapa`).all(...params)) porEtapa[f.etapa] = f.n;
  const total = Object.values(porEtapa).reduce((a, b) => a + b, 0);
  const cerrados = porEtapa.ganado + porEtapa.perdido;
  const hoy = hoyLocal();
  const pendientesHoy = db.prepare(`SELECT COUNT(*) AS n FROM prospectos p ${where ? `${where} AND` : 'WHERE'} p.etapa NOT IN ('ganado','perdido') AND p.proximo_paso_en IS NOT NULL AND date(p.proximo_paso_en, ?) <= ?`).get(...params, modZona(), hoy).n;
  const motivos = db.prepare(`SELECT motivo_perdida AS motivo, COUNT(*) AS n FROM prospectos p ${where ? `${where} AND` : 'WHERE'} p.etapa = 'perdido' AND motivo_perdida IS NOT NULL GROUP BY motivo_perdida ORDER BY n DESC LIMIT 6`).all(...params);
  const porVendedor = propio ? [] : db.prepare(`SELECT u.nombre, COUNT(*) AS total, SUM(CASE WHEN p.etapa = 'ganado' THEN 1 ELSE 0 END) AS ganados, SUM(CASE WHEN p.etapa = 'demo' THEN 1 ELSE 0 END) AS demos FROM prospectos p JOIN usuarios u ON u.id = p.vendedor_id GROUP BY u.id ORDER BY ganados DESC`).all();
  return { por_etapa: porEtapa, total, tasa_conversion: cerrados ? Math.round((porEtapa.ganado / cerrados) * 100) : null, demos_a_venta: porEtapa.demo + porEtapa.propuesta + porEtapa.ganado ? Math.round((porEtapa.ganado / (porEtapa.demo + porEtapa.propuesta + porEtapa.ganado)) * 100) : null, pendientes_hoy: pendientesHoy, motivos_perdida: motivos, por_vendedor: porVendedor };
}
