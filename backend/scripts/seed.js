/**
 * Datos iniciales: superadmin, equipo de ejemplo, catálogo real de la agencia y
 * una venta de demostración. Idempotente: si ya hay usuarios no hace nada.
 *
 *   npm run seed
 *   SUPERADMIN_EMAIL=tu@correo.com SUPERADMIN_CLAVE=TuClaveSegura npm run seed
 */
import { obtenerDb } from '../src/db.js';
import { obtenerClaves } from '../src/firmas.js';
import { crearUsuario } from '../src/servicios/usuarios.js';
import { crearProducto, crearPlan } from '../src/servicios/catalogo.js';
import { crearCliente } from '../src/servicios/clientes.js';
import { crearVenta, registrarPago, confirmarPago } from '../src/servicios/ventas.js';

const db = obtenerDb();
obtenerClaves();

if (db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c > 0) {
  console.log('La base ya tiene datos; no se siembra nada.');
  process.exit(0);
}

const superadmin = crearUsuario({
  email: process.env.SUPERADMIN_EMAIL || 'dueno@agencia.test',
  nombre: process.env.SUPERADMIN_NOMBRE || 'Dueño de la agencia',
  clave: process.env.SUPERADMIN_CLAVE || 'Control2026!',
  rol: 'superadmin',
});
const soloDemo = process.env.SOLO_SUPERADMIN === '1';

const catalogo = [
  ['dental-pro', 'DENTAL-PRO (OdontoSuite)', 'Gestión de clínicas dentales', 79, 790, 1490, 390],
  ['barber-pro', 'BARBER-PRO', 'Gestión de barberías', 29, 290, 590, 190],
  ['farmasys', 'FarmaSys', 'Gestión integral de farmacias', 59, 590, 1190, 350],
  ['repara-pro', 'Repara-Pro (Taller)', 'Talleres de reparación de celulares', 39, 390, 790, 250],
  ['gym-pro', 'GYM-PRO', 'Gestión de gimnasios', 49, 490, 990, 290],
  ['supero-pos', 'Supero POS', 'Punto de venta de escritorio', 39, 390, 790, 250],
  ['sencillo', 'Sencillo (Kiosco.PE)', 'Bodegas: ventas, stock y fiados', 9, 90, 190, 60],
  ['vendly', 'Vendly', 'Tiendas online multi-vendedor', 49, 490, 990, 290],
  ['habitta', 'Habitta', 'Sistema inmobiliario', 59, 590, 1190, 350],
  ['reservaflow', 'ReservaFlow', 'Sistema de reservas', 29, 290, 590, 190],
  ['avendia', 'Avendia 3.0', 'Documentos con IA', 49, 490, 990, 290],
];

const planesPorProducto = {};
for (const [codigo, nombre, descripcion, mensual, anual, vitalicio, sucursal] of catalogo) {
  const p = crearProducto({ codigo, nombre, descripcion }, superadmin);
  planesPorProducto[codigo] = {
    mensual: crearPlan({ producto_id: p.id, codigo: 'mensual', nombre: 'Mensual', tipo: 'mensual', precio: mensual }, superadmin),
    anual: crearPlan({ producto_id: p.id, codigo: 'anual', nombre: 'Anual', tipo: 'anual', precio: anual }, superadmin),
    vitalicio: crearPlan({ producto_id: p.id, codigo: 'vitalicio', nombre: 'Vitalicio', tipo: 'vitalicio', precio: vitalicio }, superadmin),
    sucursal: crearPlan({ producto_id: p.id, codigo: 'sucursal-extra', nombre: 'Sucursal adicional', tipo: 'sucursal_extra', precio: sucursal }, superadmin),
    mantenimiento: crearPlan({ producto_id: p.id, codigo: 'mantenimiento', nombre: 'Mantenimiento anual', tipo: 'mantenimiento', precio: Math.round(vitalicio * 0.2) }, superadmin),
    demo: crearPlan({ producto_id: p.id, codigo: 'demo', nombre: 'Demo 7 días', tipo: 'demo', precio: 0, duracion_dias: 7 }, superadmin),
  };
}
console.log(`Catálogo: ${catalogo.length} productos con 6 planes cada uno.`);

if (!soloDemo) {
  const admin = crearUsuario({ email: 'admin@agencia.test', nombre: 'Ana Admin', clave: 'Control2026!', rol: 'admin', tope_emisiones_dia: 30 }, superadmin);
  const v1 = crearUsuario({ email: 'carlos@agencia.test', nombre: 'Carlos Vendedor', clave: 'Control2026!', rol: 'vendedor', comision_pct: 20 }, superadmin);
  const v2 = crearUsuario({ email: 'lucia@agencia.test', nombre: 'Lucía Vendedora', clave: 'Control2026!', rol: 'vendedor', comision_pct: 20 }, superadmin);

  const c1 = crearCliente({ nombre: 'Dra. Patricia Ramos', empresa: 'Clínica Dental Sonrisa', email: 'patricia@sonrisa.test', telefono: '+51 999 111 222', pais: 'PE', moneda: 'USD' }, v1);
  const c2 = crearCliente({ nombre: 'Jorge Quispe', empresa: 'Barbería El Corte', telefono: '+51 999 333 444', pais: 'PE' }, v2);
  const c3 = crearCliente({ nombre: 'María Fernández', empresa: 'Farmacia Central', telefono: '+591 7 555 666', pais: 'BO' }, v1);

  // Venta vitalicia con 2 sucursales, pagada y confirmada → licencias activas y comisión devengada.
  const venta1 = crearVenta({ cliente_id: c1.id, plan_id: planesPorProducto['dental-pro'].vitalicio.id, cantidad: 2, etiquetas: ['Sede Miraflores', 'Sede San Isidro'] }, v1);
  const pago1 = registrarPago(venta1.id, { monto: venta1.total, metodo: 'transferencia', referencia: 'OP-778812' }, v1);
  confirmarPago(pago1.pagos[0].id, admin);

  // Venta mensual con pago en efectivo aún sin confirmar.
  const venta2 = crearVenta({ cliente_id: c2.id, plan_id: planesPorProducto['barber-pro'].mensual.id }, v2);
  registrarPago(venta2.id, { monto: venta2.total, metodo: 'efectivo' }, v2);

  // Demo activa.
  crearVenta({ cliente_id: c3.id, plan_id: planesPorProducto.farmasys.demo.id }, v1);

  console.log('Equipo de ejemplo: admin@agencia.test, carlos@agencia.test, lucia@agencia.test (clave Control2026!).');
}

console.log(`Superadmin: ${superadmin.email} (clave ${process.env.SUPERADMIN_CLAVE || 'Control2026!'}).`);
console.log('Listo.');
