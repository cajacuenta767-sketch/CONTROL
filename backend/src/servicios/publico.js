import { obtenerDb, ajuste } from '../db.js';
import { ErrorHttp, noEncontrado } from '../middleware/errores.js';
import { auditar } from './auditoria.js';
import { crearVenta, obtenerVenta } from './ventas.js';
import { crearEnlace, proveedoresDisponibles } from './pagos_en_linea.js';
import { enviarCorreo, plantilla } from './correo.js';
import { alertarDuenoSinEsperar } from './mensajeria.js';

/** Catálogo público: productos activos con sus planes vendibles (sin demo). */
export function catalogoPublico() {
  const db = obtenerDb();
  const productos = db.prepare('SELECT id, codigo, nombre, descripcion, version_actual, material FROM productos WHERE activo = 1 ORDER BY nombre').all()
    .map((p) => { let m = null; try { m = p.material ? JSON.parse(p.material) : null; } catch { m = null; } return { ...p, material: m ? { ficha: m.ficha, video_url: m.video_url, capturas: m.capturas, beneficios: m.beneficios } : null }; });
  const planes = db.prepare("SELECT id, producto_id, codigo, nombre, tipo, precio, duracion_dias, max_activaciones, cuotas FROM planes WHERE activo = 1 AND tipo IN ('mensual','anual','vitalicio','demo') ORDER BY CASE tipo WHEN 'demo' THEN 0 ELSE 1 END, precio").all();
  return {
    agencia: ajuste('nombre_agencia', 'CONTROL'), moneda_base: ajuste('moneda_base', 'USD'),
    tipos_cambio: JSON.parse(ajuste('tipos_cambio', '{}') || '{}'), pasarelas: proveedoresDisponibles(), demo_autoservicio: ajuste('demo_autoservicio', '1') === '1',
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
  if (!plan) throw noEncontrado('Plan no disponible');
  if (plan.tipo === 'demo') {
    if (ajuste('demo_autoservicio', '1') !== '1') throw new ErrorHttp(403, 'La demo se instala con un asesor');
    // Una demo por correo y producto: evita que un mismo negocio encadene demos gratis.
    const previa = db.prepare("SELECT l.id FROM licencias l JOIN clientes c ON c.id = l.cliente_id JOIN planes pl ON pl.id = l.plan_id WHERE lower(c.email) = ? AND pl.tipo = 'demo' AND l.producto_id = ?").get(String(datos.cliente.email || '').toLowerCase(), plan.producto_id);
    if (previa) throw new ErrorHttp(409, 'Ya probaste este sistema. Escríbenos y te ayudamos a activarlo.');
  }

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
  if (datos.pasarela && plan.tipo !== 'demo') enlace = await crearEnlace(venta.id, datos.pasarela, superadmin);
  const salida = { venta: { id: venta.id, numero: venta.numero, total: venta.total, moneda: venta.moneda, estado: venta.estado }, cliente_id: cliente.id, enlace_pago: enlace ? { id: enlace.id, url: enlace.url, proveedor: enlace.proveedor } : null };
  if (plan.tipo === 'demo') {
    const lic = db.prepare('SELECT clave, vence_en FROM licencias WHERE venta_id = ?').get(venta.id);
    salida.demo = { clave: lic.clave, vence_en: lic.vence_en, portal: `${ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '')}/portal` };
    if (email) await enviarCorreo({ para: email, asunto: `Tu demo de ${venta.producto_nombre || 'nuestro sistema'} está lista`, html: plantilla('Demo activada', `<p>Hola ${cliente.nombre}. Tu clave de prueba es <code>${lic.clave}</code> y vence el ${String(lic.vence_en).slice(0, 10)}.</p><p>Instala el sistema y pega la clave en Ajustes › Licencia. Cuando quieras activar la versión completa, compra desde el portal o escríbenos.</p>`, { boton: 'Entrar al portal', url: salida.demo.portal }) });
    alertarDuenoSinEsperar('ticket_nuevo', `Demo autoservicio: ${cliente.nombre} (${email}) probó ${venta.producto_nombre || 'un producto'}`, { referencia: `demo:${venta.id}`, url: `/clientes/${cliente.id}` });
  }
  return salida;
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
