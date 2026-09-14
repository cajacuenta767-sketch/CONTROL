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
