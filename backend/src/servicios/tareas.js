import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { obtenerDb, ajuste, ajusteNumero, ahoraSql, hoyLocal, modZona, desfaseHoras } from '../db.js';
import { config, dirDatos } from '../config.js';
import { auditar } from './auditoria.js';
import { actualizarEstadosPorFecha } from './licencias.js';
import { enviarCorreo, plantilla } from './correo.js';
import { crearVenta } from './ventas.js';
import { crearEnlace, proveedoresDisponibles } from './pagos_en_linea.js';
import { enviarWhatsapp, alertarDueno } from './mensajeria.js';

const urlPublica = () => ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '');
const estado = { ultima_ejecucion: null, ultimo_resultado: null, ejecutando: false, errores: [] };

/** Registra que un aviso ya se envió; devuelve false si ya existía. */
function marcar(tipo, referencia, canal, detalle) {
  try {
    obtenerDb().prepare('INSERT INTO notificaciones (tipo, referencia, canal, detalle) VALUES (?, ?, ?, ?)').run(tipo, String(referencia), canal, detalle ? JSON.stringify(detalle) : null);
    return true;
  } catch { return false; }
}

const fechaLegible = (s) => (s ? String(s).slice(0, 10) : '');
const rellenar = (texto, vars) => String(texto || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

/* ---------- 0. Recordatorio automático de cobro por WhatsApp ---------- */

/** Ventas pendientes con saldo, registradas hace N días y sin recordatorio: WhatsApp al cliente con el enlace de pago si existe. */
export async function recordatoriosCobro() {
  const db = obtenerDb();
  const dias = ajusteNumero('recordatorio_cobro_dias', 3);
  if (dias <= 0) return { recordatorios_cobro: 0 };
  const filas = db.prepare(`SELECT v.id, v.numero, v.total, v.moneda, c.nombre AS cliente, c.telefono, pr.nombre AS producto,
      (SELECT COALESCE(SUM(p.monto),0) FROM pagos p WHERE p.venta_id = v.id AND p.estado != 'rechazado') AS comprometido,
      (SELECT e.url FROM enlaces_pago e WHERE e.venta_id = v.id AND e.estado = 'pendiente' ORDER BY e.id DESC LIMIT 1) AS enlace
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id JOIN productos pr ON pr.id = v.producto_id
    WHERE v.estado = 'pendiente' AND v.total > 0 AND c.telefono IS NOT NULL AND v.creado_en <= datetime('now', ?)`).all(`-${dias} days`);
  let enviados = 0;
  for (const v of filas) {
    const saldo = Math.round((v.total - v.comprometido) * 100) / 100;
    if (saldo <= 0) continue;
    if (!marcar('recordatorio_cobro', String(v.id), 'whatsapp', { saldo })) continue;
    const texto = rellenar(ajuste('plantilla_wa_cobro', ''), { cliente: v.cliente, monto: `${saldo} ${v.moneda}`, producto: v.producto, venta: v.numero, enlace: v.enlace || '' });
    await enviarWhatsapp({ para: v.telefono, texto, plantilla: ajuste('whatsapp_plantilla_cobro', '') || null, variables: [v.cliente, `${saldo} ${v.moneda}`, v.producto], referencia: `cobro:${v.id}` });
    enviados++;
  }
  return { recordatorios_cobro: enviados };
}

/* ---------- 0b. Cuotas vencidas ---------- */

/** Cuota impaga pasados los días de gracia: se marca vencida, se suspenden las licencias de la venta y se avisa. */
export async function cuotasVencidas() {
  const db = obtenerDb();
  const gracia = ajusteNumero('cuotas_gracia_dias', 5);
  const filas = db.prepare(`SELECT cu.*, v.numero AS venta_numero, v.moneda, c.nombre AS cliente, c.telefono, pr.nombre AS producto
    FROM cuotas cu JOIN ventas v ON v.id = cu.venta_id JOIN clientes c ON c.id = v.cliente_id JOIN productos pr ON pr.id = v.producto_id
    WHERE cu.estado = 'pendiente' AND v.estado != 'anulada' AND cu.vence_en <= datetime('now', ?)`).all(`-${gracia} days`);
  let suspendidas = 0;
  for (const cu of filas) {
    db.prepare("UPDATE cuotas SET estado = 'vencida' WHERE id = ?").run(cu.id);
    const motivo = `Cuota ${cu.numero} de ${cu.monto} ${cu.moneda} vencida el ${fechaLegible(cu.vence_en)}`;
    const r = db.prepare("UPDATE licencias SET estado = 'suspendida', motivo_estado = ? WHERE venta_id = ? AND estado IN ('activa','mora')").run(motivo, cu.venta_id);
    suspendidas += Number(r.changes);
    auditar({ accion: 'cuota.vencida', entidad: 'venta', entidadId: cu.venta_id, detalle: { cuota: cu.numero, monto: cu.monto, licencias_suspendidas: Number(r.changes) } });
    if (cu.telefono) await enviarWhatsapp({ para: cu.telefono, texto: `Hola ${cu.cliente}, la cuota ${cu.numero} de ${cu.monto} ${cu.moneda} por ${cu.producto} (venta ${cu.venta_numero}) está vencida y el sistema quedó pausado. Regularízala para reactivarlo al instante.`, referencia: `cuota_vencida:${cu.id}` });
    await alertarDueno('cuota_vencida', `${cu.cliente} · ${cu.producto} · cuota ${cu.numero} de ${cu.monto} ${cu.moneda} (venta ${cu.venta_numero})`, { referencia: cu.id, url: `/ventas/${cu.venta_id}` });
  }
  return { cuotas_vencidas: filas.length, licencias_suspendidas_por_cuota: suspendidas };
}

/* ---------- 1. Avisos de vencimiento ---------- */

export async function avisosVencimiento() {
  const db = obtenerDb();
  const dias = ajuste('dias_aviso_vencimiento', '30,7,1').split(',').map((d) => Number(d.trim())).filter((d) => Number.isFinite(d) && d >= 0);
  const agencia = ajuste('nombre_agencia', 'CONTROL');
  let enviados = 0;
  for (const d of dias) {
    const filas = db
      .prepare(`SELECT l.id, l.clave, l.etiqueta, l.vence_en, c.nombre AS cliente, c.email, c.telefono, pr.nombre AS producto, u.email AS vendedor_email, u.nombre AS vendedor, u.marca_nombre
        FROM licencias l JOIN clientes c ON c.id = l.cliente_id JOIN productos pr ON pr.id = l.producto_id LEFT JOIN usuarios u ON u.id = l.vendedor_id JOIN planes pl ON pl.id = l.plan_id
        WHERE l.estado IN ('activa','mora') AND pl.tipo != 'demo' AND l.vence_en IS NOT NULL AND date(l.vence_en, ?) = date('now', ?, ?)`)
      .all(modZona(), modZona(), `+${d} days`);
    for (const l of filas) {
      if (!marcar(`vencimiento_${d}`, `${l.id}:${fechaLegible(l.vence_en)}`, l.email ? 'correo' : 'panel', { dias: d })) continue;
      enviados++;
      const marca = l.marca_nombre || agencia;
      if (l.telefono) {
        const texto = rellenar(ajuste('plantilla_wa_renovacion', ''), { cliente: l.cliente, producto: l.producto, vence: fechaLegible(l.vence_en), agencia: marca, enlace: `${urlPublica()}/portal` });
        await enviarWhatsapp({ para: l.telefono, texto, plantilla: ajuste('whatsapp_plantilla_vencimiento', '') || null, variables: [l.cliente, l.producto, fechaLegible(l.vence_en)], referencia: `vencimiento:${l.id}:${d}` });
      }
      if (l.email) {
        await enviarCorreo({
          para: l.email, asunto: d === 0 ? `Tu licencia de ${l.producto} vence hoy` : `Tu licencia de ${l.producto} vence en ${d} día(s)`,
          html: plantilla(`Renovación de ${l.producto}`, `<p>Hola ${l.cliente}. Tu licencia <code>${l.clave}</code>${l.etiqueta ? ` (${l.etiqueta})` : ''} vence el <strong>${fechaLegible(l.vence_en)}</strong>.</p><p>Renuévala a tiempo para no perder acceso. ${l.vendedor ? `Tu asesor es ${l.vendedor}.` : ''}</p><p>Atentamente, ${marca}.</p>`),
        });
      }
      if (l.vendedor_email) {
        await enviarCorreo({
          para: l.vendedor_email, asunto: `Renovación próxima: ${l.cliente} · ${l.producto} (${d} días)`,
          html: plantilla('Oportunidad de renovación', `<p>La licencia de <strong>${l.cliente}</strong> para ${l.producto} vence el ${fechaLegible(l.vence_en)}. Contáctalo para renovar.</p>`, { boton: 'Ver licencia', url: `${urlPublica()}/licencias/${l.id}` }),
        });
      }
    }
  }
  return { avisos_vencimiento: enviados };
}

/* ---------- 2. Recordatorio de cierre de caja ---------- */

export async function recordatorioCaja({ forzar = false } = {}) {
  const db = obtenerDb();
  const hora = Number(new Date(Date.now() + desfaseHoras() * 3600000).toISOString().slice(11, 13));
  if (!forzar && hora < ajusteNumero('hora_recordatorio_caja', 20)) return { recordatorios_caja: 0 };
  const hoy = hoyLocal();
  const pendientes = db
    .prepare(`SELECT u.id, u.nombre, u.email FROM usuarios u WHERE u.activo = 1 AND u.rol IN ('vendedor','admin','revendedor')
      AND EXISTS (SELECT 1 FROM pagos p WHERE p.registrado_por = u.id AND date(p.creado_en, ?) = ? AND p.estado != 'rechazado')
      AND NOT EXISTS (SELECT 1 FROM cierres_caja c WHERE c.vendedor_id = u.id AND c.fecha = ?)`)
    .all(modZona(), hoy, hoy);
  let n = 0;
  for (const u of pendientes) {
    if (!marcar('caja_recordatorio', `${u.id}:${hoy}`, 'correo')) continue;
    n++;
    await enviarCorreo({ para: u.email, asunto: 'Recuerda cerrar tu caja de hoy', html: plantilla('Cierre de caja pendiente', `<p>Hola ${u.nombre}. Registraste cobros hoy y todavía no cerraste la caja del ${hoy}.</p>`, { boton: 'Cerrar caja', url: `${urlPublica()}/caja` }) });
  }
  return { recordatorios_caja: n };
}

/* ---------- 3. Renovación automática ---------- */

export async function renovacionesAutomaticas() {
  const db = obtenerDb();
  const dias = ajusteNumero('renovacion_automatica_dias', 7);
  if (!dias) return { renovaciones: 0 };
  const pasarelas = proveedoresDisponibles();
  const proveedor = pasarelas.stripe ? 'stripe' : pasarelas.paypal ? 'paypal' : pasarelas.demo ? 'demo' : null;
  const superadmin = db.prepare("SELECT * FROM usuarios WHERE rol = 'superadmin' AND activo = 1 ORDER BY id LIMIT 1").get();
  if (!superadmin) return { renovaciones: 0 };
  const filas = db
    .prepare(`SELECT l.*, pl.tipo AS plan_tipo, c.email, c.nombre AS cliente, pr.nombre AS producto
      FROM licencias l JOIN planes pl ON pl.id = l.plan_id JOIN clientes c ON c.id = l.cliente_id JOIN productos pr ON pr.id = l.producto_id
      WHERE l.estado IN ('activa','mora') AND pl.tipo IN ('mensual','anual') AND l.vence_en IS NOT NULL
        AND l.vence_en <= datetime('now', ?) AND NOT EXISTS (SELECT 1 FROM ventas v WHERE v.renueva_licencia_id = l.id AND v.estado = 'pendiente')`)
    .all(`+${dias} days`);
  let n = 0;
  for (const l of filas) {
    if (!marcar('renovacion_auto', `${l.id}:${fechaLegible(l.vence_en)}`, 'venta')) continue;
    try {
      const venta = crearVenta({ cliente_id: l.cliente_id, plan_id: l.plan_id, renueva_licencia_id: l.id, vendedor_id: l.vendedor_id ?? superadmin.id, notas: 'Renovación automática' }, superadmin, { origen: 'renovacion automatica' });
      let enlace = null;
      if (proveedor) { try { enlace = await crearEnlace(venta.id, proveedor, superadmin); } catch (e) { estado.errores.push(`enlace renovación ${venta.numero}: ${e.message}`); } }
      n++;
      if (l.email) {
        await enviarCorreo({
          para: l.email, asunto: `Renueva tu licencia de ${l.producto}`,
          html: plantilla(`Tu ${l.producto} vence el ${fechaLegible(l.vence_en)}`, `<p>Hola ${l.cliente}. Preparamos la renovación de tu licencia <code>${l.clave}</code> por ${venta.total.toFixed(2)} ${venta.moneda}.</p><p>${enlace ? 'Paga en línea y se extiende sola, sin cortes.' : 'Coordina el pago con tu asesor.'}</p>`, enlace ? { boton: 'Pagar renovación', url: enlace.url } : {}),
        });
      }
      auditar({ accion: 'renovacion.automatica', entidad: 'licencia', entidadId: l.id, detalle: { venta: venta.numero, enlace: enlace?.url ?? null } });
    } catch (e) {
      estado.errores.push(`renovación licencia ${l.id}: ${e.message}`);
    }
  }
  return { renovaciones: n };
}

/* ---------- 4. Respaldos ---------- */

export const DIR_RESPALDOS = resolve(dirDatos(), 'respaldos');

export function crearRespaldo({ manual = false } = {}) {
  mkdirSync(DIR_RESPALDOS, { recursive: true });
  const nombre = `control-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)}${manual ? '-manual' : ''}.db`;
  const destino = resolve(DIR_RESPALDOS, nombre);
  obtenerDb().exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  const conservar = Math.max(1, ajusteNumero('respaldos_conservar', 14));
  const lista = listarRespaldos();
  for (const r of lista.slice(conservar)) { if (!r.nombre.includes('-manual')) unlinkSync(resolve(DIR_RESPALDOS, r.nombre)); }
  return { nombre, bytes: statSync(destino).size };
}

export function listarRespaldos() {
  if (!existsSync(DIR_RESPALDOS)) return [];
  return readdirSync(DIR_RESPALDOS).filter((f) => f.endsWith('.db')).map((f) => { const st = statSync(resolve(DIR_RESPALDOS, f)); return { nombre: f, bytes: st.size, creado_en: st.mtime.toISOString() }; }).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
}

export function rutaRespaldo(nombre) {
  const ruta = resolve(DIR_RESPALDOS, basename(nombre));
  return ruta.startsWith(DIR_RESPALDOS) && existsSync(ruta) ? ruta : null;
}

function respaldoDiario() {
  if (config.rutaBaseDatos === ':memory:') return { respaldo: null };
  const hoy = hoyLocal();
  if (!marcar('respaldo_diario', hoy, 'archivo')) return { respaldo: null };
  return { respaldo: crearRespaldo().nombre };
}

/* ---------- 5. Limpieza ---------- */

function limpieza() {
  const db = obtenerDb();
  const s = db.prepare("DELETE FROM sesiones WHERE expira_en < ? OR (revocada = 1 AND ultimo_uso < datetime('now','-30 days'))").run(ahoraSql());
  const t = db.prepare("DELETE FROM tokens_recuperacion WHERE expira_en < datetime('now','-1 day')").run();
  db.prepare("DELETE FROM errores WHERE creado_en < datetime('now','-90 days')").run();
  db.prepare("UPDATE enlaces_pago SET estado = 'expirado' WHERE estado = 'pendiente' AND creado_en < datetime('now','-30 days')").run();
  return { sesiones_limpiadas: Number(s.changes), tokens_limpiados: Number(t.changes) };
}

/* ---------- Orquestación ---------- */

export async function ejecutarTareas({ forzarCaja = false } = {}) {
  if (estado.ejecutando) return estado.ultimo_resultado;
  estado.ejecutando = true;
  estado.errores = [];
  const resultado = {};
  const paso = async (nombre, fn) => { try { Object.assign(resultado, await fn()); } catch (e) { estado.errores.push(`${nombre}: ${e.message}`); } };
  await paso('estados', async () => { actualizarEstadosPorFecha(); return { estados: 'ok' }; });
  await paso('vencimientos', avisosVencimiento);
  await paso('cobros', recordatoriosCobro);
  await paso('cuotas', cuotasVencidas);
  await paso('caja', () => recordatorioCaja({ forzar: forzarCaja }));
  await paso('renovaciones', renovacionesAutomaticas);
  await paso('respaldo', async () => respaldoDiario());
  await paso('limpieza', async () => limpieza());
  estado.ultima_ejecucion = new Date().toISOString();
  estado.ultimo_resultado = { ...resultado, errores: [...estado.errores] };
  if (estado.errores.length) alertarDueno('planificador_detenido', `Fallaron tareas: ${estado.errores.join(' | ')}`, { referencia: new Date().toISOString().slice(0, 13) }).catch(() => null);
  estado.ejecutando = false;
  return estado.ultimo_resultado;
}

export function estadoTareas() {
  return { ...estado, respaldos: listarRespaldos().slice(0, 5), directorio_respaldos: DIR_RESPALDOS };
}

let temporizador = null;
/** Arranca el planificador: primera corrida al minuto, luego cada 10 minutos. */
export function iniciarPlanificador() {
  if (temporizador) return;
  setTimeout(() => ejecutarTareas().catch(() => null), 60 * 1000).unref();
  temporizador = setInterval(() => ejecutarTareas().catch(() => null), 10 * 60 * 1000);
  temporizador.unref();
}
