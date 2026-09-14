/**
 * SDK de licencias CONTROL para Node.js (Express, Next.js, NestJS, Electron).
 * Sin dependencias: usa fetch y node:crypto.
 *
 *   import { ControlLicencia } from './control-licencia.js';
 *   const licencia = new ControlLicencia({
 *     url: process.env.CONTROL_URL,              // https://control.tuagencia.com
 *     clave: process.env.CONTROL_LICENCIA,       // CTL-XXXX-XXXX-XXXX-XXXX
 *     producto: 'dental-pro',                    // código del producto en CONTROL
 *     clavePublica: 'BASE64_DE_32_BYTES',        // GET /api/v1/licencias/clave-publica
 *     archivo: './datos/licencia.json',          // dónde guardar el último token válido
 *     version: '1.4.0',
 *   });
 *   await licencia.iniciar();                    // activa o valida offline; lanza si está bloqueada
 *   app.use(licencia.middlewareExpress());       // 402 si la licencia deja de ser válida
 */
import { createPublicKey, createHash, verify } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

const PREFIJO_SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

export class ControlLicencia {
  constructor({ url, clave, producto, clavePublica, archivo = './licencia.json', version, huella, dominio, latidoHoras = 24 }) {
    if (!url || !clave || !producto || !clavePublica) throw new Error('CONTROL: faltan url, clave, producto o clavePublica');
    this.url = url.replace(/\/$/, '');
    this.clave = clave.trim().toUpperCase();
    this.producto = producto;
    this.publica = createPublicKey({ key: Buffer.concat([PREFIJO_SPKI_ED25519, Buffer.from(clavePublica, 'base64')]), format: 'der', type: 'spki' });
    this.archivo = archivo;
    this.version = version;
    this.dominio = dominio;
    this.huella = huella || ControlLicencia.huellaPorDefecto(dominio);
    this.latidoMs = latidoHoras * 3600000;
    this.estado = { valido: false, payload: null, motivo: 'sin iniciar' };
  }

  /** Huella estable: dominio (web) o hash de hostname (escritorio). */
  static huellaPorDefecto(dominio) {
    return createHash('sha256').update(dominio || hostname()).digest('hex').slice(0, 32);
  }

  /** Verifica un token con la clave pública. Devuelve el payload o null. */
  verificar(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [cuerpo, firma] = token.split('.');
    if (!verify(null, Buffer.from(cuerpo), this.publica, Buffer.from(firma, 'base64url'))) return null;
    try {
      const p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
      if (p.clave !== this.clave || p.producto !== this.producto || p.huella !== this.huella) return null;
      if (Date.parse(p.expira_en) < Date.now()) return null;
      return p;
    } catch { return null; }
  }

  leerGuardado() { try { return JSON.parse(readFileSync(this.archivo, 'utf8')).token; } catch { return null; } }
  guardar(token) { try { mkdirSync(dirname(this.archivo), { recursive: true }); writeFileSync(this.archivo, JSON.stringify({ token, guardado_en: new Date().toISOString() })); } catch { /* disco de solo lectura: se sigue en memoria */ } }

  async llamar(ruta, cuerpo) {
    const r = await fetch(`${this.url}/api/v1/licencias/${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const datos = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...datos };
  }

  /** Activa (o re-valida) contra el servidor. */
  async activar() {
    const r = await this.llamar('activar', { clave: this.clave, producto: this.producto, huella: this.huella, dominio: this.dominio, nombre_equipo: hostname(), version: this.version });
    return this.procesarRespuesta(r);
  }

  async latido() {
    const r = await this.llamar('latido', { clave: this.clave, huella: this.huella, version: this.version });
    return this.procesarRespuesta(r);
  }

  procesarRespuesta(r) {
    if (r.licencia) this.info = r.licencia;
    if (r.ok && r.token) {
      const p = this.verificar(r.token);
      if (p) { this.guardar(r.token); this.estado = { valido: true, payload: p, motivo: null }; return this.estado; }
    }
    // Respuesta del servidor con bloqueo explícito (suspendida, revocada, max_activaciones…).
    if (r.status === 403 || r.status === 404) {
      this.estado = { valido: false, payload: r.licencia || null, motivo: r.error || r.codigo || 'licencia inválida', codigo: r.codigo };
    }
    return this.estado;
  }

  /**
   * Arranque: usa el token guardado si sigue válido; si no, intenta activar.
   * Sin red y con token válido, funciona hasta `expira_en` (gracia offline).
   */
  async iniciar() {
    const guardado = this.leerGuardado();
    const p = guardado && this.verificar(guardado);
    if (p) this.estado = { valido: true, payload: p, motivo: null };
    try { await (p ? this.latido() : this.activar()); }
    catch (e) { if (!p) this.estado = { valido: false, payload: null, motivo: `Sin conexión con CONTROL: ${e.message}` }; }
    if (this.latidoMs > 0) { this.temporizador = setInterval(() => this.latido().catch(() => {}), this.latidoMs); this.temporizador.unref?.(); }
    if (!this.estado.valido) throw new Error(`Licencia no válida: ${this.estado.motivo}`);
    return this.estado;
  }

  detener() { if (this.temporizador) clearInterval(this.temporizador); }

  /**
   * Código de emergencia (72 h) que emite la agencia desde CONTROL para este equipo.
   * Se verifica con la misma clave pública y se guarda como token; no necesita red.
   */
  aplicarCodigoEmergencia(codigo) {
    const p = this.verificar(String(codigo || '').trim());
    if (!p || !p.emergencia) { return { ok: false, motivo: p ? 'Ese código no es de emergencia' : 'Código inválido, vencido o de otro equipo' }; }
    this.guardar(String(codigo).trim());
    this.estado = { valido: true, payload: p, motivo: null };
    return { ok: true, expira_en: p.expira_en };
  }

  /** Resumen para la pantalla "Licencia" del producto. */
  resumen() {
    const p = this.estado.payload || {};
    const vigente = this.estado.valido || (p.expira_en && Date.parse(p.expira_en) > Date.now());
    return {
      valido: Boolean(vigente), estado: p.estado || this.estado.codigo || 'desconocido', motivo: this.estado.motivo,
      clave: this.clave, producto: this.producto, plan: p.plan, etiqueta: p.etiqueta, huella: this.huella,
      vence_en: p.vence_en || null, soporte_hasta: p.soporte_hasta || null, sin_conexion_hasta: p.expira_en || null,
      emergencia: Boolean(p.emergencia), version: this.version, version_actual: this.info?.version_actual || null, desactualizada: Boolean(this.info?.desactualizada),
    };
  }

  /**
   * Router Express con la pantalla estándar "Licencia" (GET) y sus acciones (POST):
   * estado, vencimiento, equipo, botón "Reactivar" y campo para el código de emergencia.
   *   app.use('/licencia', licencia.pantallaExpress({ nombre: 'DENTAL-PRO' }));
   */
  pantallaExpress({ nombre = this.producto, marca = 'CONTROL' } = {}) {
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const html = (aviso = '') => pantallaLicenciaHtml({ ...this.resumen(), nombre, marca, aviso, esc });
    return (req, res, next) => {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) return res.type('html').send(html());
      if (req.method === 'GET' && req.path === '/estado.json') return res.json(this.resumen());
      if (req.method === 'POST' && req.path === '/reactivar') {
        return this.activar().then((e) => res.type('html').send(html(e.valido ? 'Licencia verificada correctamente.' : `No se pudo reactivar: ${esc(e.motivo)}`))).catch((e) => res.type('html').send(html(`Sin conexión con CONTROL: ${esc(e.message)}`)));
      }
      if (req.method === 'POST' && req.path === '/emergencia') {
        return leerCuerpo(req).then((cuerpo) => { const r = this.aplicarCodigoEmergencia(cuerpo.codigo); res.type('html').send(html(r.ok ? `Código aplicado: el sistema funciona hasta ${esc(r.expira_en)}.` : esc(r.motivo))); });
      }
      next();
    };
  }

  /** Middleware Express/Next (API routes): bloquea con 402 si la licencia dejó de ser válida. */
  middlewareExpress({ rutasLibres = ['/salud', '/licencia'] } = {}) {
    return (req, res, next) => {
      if (rutasLibres.some((r) => req.path.startsWith(r))) return next();
      const p = this.estado.payload;
      if (this.estado.valido || (p && Date.parse(p.expira_en) > Date.now())) {
        if (p?.estado === 'mora') res.set('X-Licencia-Aviso', 'Licencia vencida: renueva antes de que se suspenda');
        return next();
      }
      res.status(402).json({ error: 'Licencia no válida', motivo: this.estado.motivo, codigo: this.estado.codigo });
    };
  }
}

function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => { try { ok(Object.fromEntries(new URLSearchParams(d))); } catch { ok({}); } }); });
}

/** Pantalla estándar "Licencia": misma en todos los productos. Se puede copiar a otras pilas (ver sdk/pantalla-licencia/). */
export function pantallaLicenciaHtml({ nombre, marca, aviso, esc, valido, estado, motivo, clave, plan, etiqueta, huella, vence_en, soporte_hasta, sin_conexion_hasta, emergencia, version, version_actual, desactualizada }) {
  const f = (d) => (d ? new Date(d).toLocaleDateString('es', { dateStyle: 'medium' }) : '—');
  const tono = valido ? (estado === 'mora' ? '#b45309' : '#15803d') : '#b91c1c';
  const titulo = valido ? (estado === 'mora' ? 'Licencia vencida: renueva pronto' : 'Licencia activa') : 'Licencia no válida';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Licencia · ${esc(nombre)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f9;color:#1f2937;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.c{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;width:min(560px,100%);box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 4px}
.e{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:${tono}}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:16px 0}dt{color:#6b7280}dd{margin:0}
code{background:#f3f4f6;padding:2px 6px;border-radius:6px}form{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}input{flex:1;min-width:200px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px}
button{background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}.s{background:#fff;color:#1f2937;border:1px solid #e5e7eb}.a{background:#fef3c7;color:#b45309;padding:10px 12px;border-radius:8px;margin-bottom:12px}
.p{color:#6b7280;font-size:12px;margin-top:18px}</style></head><body><div class="c">
<h1>${esc(nombre)} · Licencia</h1><span class="e">${esc(titulo)}</span>
${aviso ? `<div class="a" style="margin-top:12px">${aviso}</div>` : ''}
${!valido && motivo ? `<div class="a" style="margin-top:12px">${esc(motivo)}</div>` : ''}
${desactualizada ? `<div class="a" style="margin-top:12px">Hay una versión nueva (${esc(version_actual)}); esta instalación tiene la ${esc(version)}. Pide la actualización a tu asesor.</div>` : ''}
<dl><dt>Clave</dt><dd><code>${esc(clave)}</code></dd><dt>Plan</dt><dd>${esc(plan || '—')}${etiqueta ? ` · ${esc(etiqueta)}` : ''}</dd>
<dt>Vence</dt><dd>${vence_en ? f(vence_en) : valido ? 'Nunca' : '—'}</dd><dt>Soporte hasta</dt><dd>${f(soporte_hasta)}</dd>
<dt>Funciona sin internet hasta</dt><dd>${f(sin_conexion_hasta)}${emergencia ? ' (código de emergencia)' : ''}</dd>
<dt>Equipo</dt><dd><code>${esc(huella)}</code></dd>${version ? `<dt>Versión</dt><dd>${esc(version)}</dd>` : ''}</dl>
<form method="post" action="reactivar"><button>Reactivar / verificar ahora</button></form>
<form method="post" action="emergencia"><input name="codigo" placeholder="Pega aquí el código de emergencia (72 h)" required><button class="s">Aplicar</button></form>
<p class="p">Si el sistema está bloqueado, escribe a tu asesor con la clave y el identificador del equipo. Licencias gestionadas con ${esc(marca)}.</p>
</div></body></html>`;
}
