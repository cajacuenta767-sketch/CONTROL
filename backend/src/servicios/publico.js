import { obtenerDb, ajuste } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { auditar } from './auditoria.js';
import { crearVenta, obtenerVenta } from './ventas.js';
import { crearEnlace, proveedoresDisponibles } from './pagos_en_linea.js';

/** Catálogo público: productos activos con sus planes vendibles (sin demo). */
export function catalogoPublico() {
  const db = obtenerDb();
  const productos = db.prepare('SELECT id, codigo, nombre, descripcion, version_actual FROM productos WHERE activo = 1 ORDER BY nombre').all();
  const planes = db.prepare("SELECT id, producto_id, codigo, nombre, tipo, precio, duracion_dias, max_activaciones FROM planes WHERE activo = 1 AND tipo IN ('mensual','anual','vitalicio') ORDER BY precio").all();
  return {
    agencia: ajuste('nombre_agencia', 'CONTROL'), moneda_base: ajuste('moneda_base', 'USD'),
    tipos_cambio: JSON.parse(ajuste('tipos_cambio', '{}') || '{}'), pasarelas: proveedoresDisponibles(),
    productos: productos.map((p) => ({ ...p, planes: planes.filter((pl) => pl.producto_id === p.id) })),
  };
}

/** Datos públicos de un vendedor por su código de referido (para la página de compra). */
export function vendedorPorCodigo(codigo) {
  if (!codigo) return null;
  const u = obtenerDb().prepare("SELECT id, nombre, marca_nombre, rol FROM usuarios WHERE codigo_ref = ? AND activo = 1").get(String(codigo).toUpperCase().trim());
  return u ? { id: u.id, nombre: u.nombre, marca: u.marca_nombre } : null;
}

/**
 * Pedido externo (desde la web de compra o desde DevMarket con API key).
 * Crea o reutiliza el cliente por correo, registra la venta atribuida al vendedor del
 * código y, si se pide, devuelve un enlace de pago.
 */
export async function crearPedido(datos, { origen, ip }) {
  const db = obtenerDb();
  const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1').get(datos.plan_id);
  if (!plan || plan.tipo === 'demo') throw noEncontrado('Plan no disponible');

  const vendedor = vendedorPorCodigo(datos.ref);
  const casa = db.prepare("SELECT id FROM usuarios WHERE rol = 'superadmin' AND activo = 1 ORDER BY id LIMIT 1").get();
  const vendedorId = vendedor?.id ?? casa?.id;
  if (!vendedorId) throw new ErrorHttp(500, 'No hay superadmin para asignar la venta');
  const actor = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(vendedorId);
  actor.rol = actor.rol === 'superadmin' ? 'superadmin' : actor.rol; // se usan sus topes/permisos

  const email = String(datos.cliente.email || '').toLowerCase().trim();
  let cliente = email ? db.prepare('SELECT * FROM clientes WHERE lower(email) = ?').get(email) : null;
  if (!cliente) {
    const r = db.prepare('INSERT INTO clientes (nombre, empresa, email, telefono, pais, moneda, vendedor_id, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(datos.cliente.nombre, datos.cliente.empresa ?? null, email || null, datos.cliente.telefono ?? null, datos.cliente.pais ?? null, (datos.moneda || ajuste('moneda_base', 'USD')).toUpperCase(), vendedorId, origen);
    cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(r.lastInsertRowid));
    auditar({ accion: 'cliente.crear_publico', entidad: 'cliente', entidadId: cliente.id, detalle: { origen, ref: datos.ref }, ip });
  }

  // El pedido lo "registra" el superadmin de la casa (sin topes) pero la comisión va al vendedor del código.
  const superadmin = db.prepare("SELECT * FROM usuarios WHERE rol = 'superadmin' AND activo = 1 ORDER BY id LIMIT 1").get();
  const venta = crearVenta(
    { cliente_id: cliente.id, plan_id: plan.id, cantidad: datos.cantidad ?? 1, etiquetas: datos.etiquetas, vendedor_id: vendedorId, moneda: datos.moneda, notas: datos.notas },
    superadmin, { origen: `${origen}${datos.ref ? ` · ref ${datos.ref}` : ''}` }
  );
  let enlace = null;
  if (datos.pasarela) enlace = await crearEnlace(venta.id, datos.pasarela, superadmin);
  return { venta: { id: venta.id, numero: venta.numero, total: venta.total, moneda: venta.moneda, estado: venta.estado }, cliente_id: cliente.id, enlace_pago: enlace ? { id: enlace.id, url: enlace.url, proveedor: enlace.proveedor } : null };
}

export function estadoPedidoPublico(numero, email) {
  const v = obtenerDb().prepare('SELECT v.id, c.email FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE v.numero = ?').get(numero);
  if (!v || String(v.email || '').toLowerCase() !== String(email || '').toLowerCase()) throw noEncontrado('Pedido no encontrado');
  const venta = obtenerVenta(v.id);
  return {
    numero: venta.numero, estado: venta.estado, total: venta.total, moneda: venta.moneda, pagado: venta.pagado, producto: venta.producto_nombre, plan: venta.plan_nombre,
    licencias: venta.estado === 'pagada' ? venta.licencias.map((l) => ({ clave: l.clave, etiqueta: l.etiqueta, estado: l.estado })) : [],
    enlace_pago: venta.enlaces_pago.find((e) => e.estado === 'pendiente')?.url ?? null,
  };
}
