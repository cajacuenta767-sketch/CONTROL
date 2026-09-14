export type Rol = 'superadmin' | 'admin' | 'vendedor';

export type Rol2 = Rol | 'revendedor';
export interface Usuario {
  id: number; email: string; nombre: string; rol: Rol2;
  comision_pct: number; tope_emisiones_dia: number; tope_demos_semana: number; activo: number;
  debe_cambiar_clave?: number; totp_activo?: number; codigo_ref?: string | null;
  cupo_licencias?: number | null; descuento_mayorista_pct?: number | null; marca_nombre?: string | null;
}

const CLAVE_TOKEN = 'control.token';

export const sesion = {
  token: (): string | null => { try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; } },
  guardar: (t: string) => { try { localStorage.setItem(CLAVE_TOKEN, t); } catch { /* ignorar */ } },
  cerrar: () => { try { localStorage.removeItem(CLAVE_TOKEN); } catch { /* ignorar */ } },
};

export const recordar = {
  leer: (clave: string): string | null => { try { return localStorage.getItem(`control.${clave}`); } catch { return null; } },
  guardar: (clave: string, valor: string | null) => { try { valor === null ? localStorage.removeItem(`control.${clave}`) : localStorage.setItem(`control.${clave}`, valor); } catch { /* ignorar */ } },
};

export class ErrorApi extends Error {
  status: number; detalles?: string[]; cuerpo: any;
  constructor(status: number, cuerpo: any) {
    super(cuerpo?.error || (status === 0 ? 'Sin conexión con el servidor' : `Error ${status}`));
    this.status = status; this.detalles = cuerpo?.detalles; this.cuerpo = cuerpo;
  }
}

let renovando: Promise<boolean> | null = null;

/** Intenta renovar el token de acceso con la cookie httpOnly. Una sola renovación a la vez. */
export async function renovarSesion(): Promise<boolean> {
  if (!renovando) {
    renovando = fetch('/api/v1/auth/renovar', { method: 'POST', credentials: 'include' })
      .then(async (r) => { if (!r.ok) return false; const d = await r.json(); sesion.guardar(d.token); return true; })
      .catch(() => false)
      .finally(() => { renovando = null; });
  }
  return renovando;
}

async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown, reintento = true): Promise<T> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = sesion.token();
  if (t) cabeceras.Authorization = `Bearer ${t}`;
  let r: Response;
  try {
    r = await fetch(`/api/v1${ruta}`, { method: metodo, headers: cabeceras, credentials: 'include', body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  } catch {
    throw new ErrorApi(0, null);
  }
  const datos = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    const esAuth = ruta.startsWith('/auth/login') || ruta.startsWith('/auth/renovar') || ruta.startsWith('/auth/2fa/verificar') || ruta.startsWith('/auth/recuperar') || ruta.startsWith('/auth/restablecer');
    if (r.status === 401 && !esAuth) {
      // Token vencido: renovar una vez y reintentar la misma llamada.
      if (reintento && (await renovarSesion())) return llamar<T>(metodo, ruta, cuerpo, false);
      sesion.cerrar();
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    if (r.status === 403 && datos?.codigo === 'cambiar_clave' && !window.location.pathname.startsWith('/cambiar-clave')) {
      window.location.href = '/cambiar-clave';
    }
    throw new ErrorApi(r.status, datos);
  }
  return datos as T;
}

const query = (params?: Record<string, unknown>) => {
  if (!params) return '';
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return q.length ? `?${q.join('&')}` : '';
};

export const api = {
  get: <T,>(ruta: string, params?: Record<string, unknown>) => llamar<T>('GET', `${ruta}${query(params)}`),
  post: <T,>(ruta: string, cuerpo?: unknown) => llamar<T>('POST', ruta, cuerpo ?? {}),
  patch: <T,>(ruta: string, cuerpo?: unknown) => llamar<T>('PATCH', ruta, cuerpo ?? {}),
  /** Descarga un binario autenticado (PDF, comprobante) y lo abre en otra pestaña. */
  abrir: async (ruta: string) => {
    const t = sesion.token();
    const r = await fetch(`/api/v1${ruta}`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, credentials: 'include' });
    if (!r.ok) throw new ErrorApi(r.status, await r.json().catch(() => null));
    const url = URL.createObjectURL(await r.blob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  /** Sube un archivo (multipart) al campo "archivo". */
  subir: async <T,>(ruta: string, archivo: File): Promise<T> => {
    const t = sesion.token();
    const fd = new FormData(); fd.append('archivo', archivo);
    const r = await fetch(`/api/v1${ruta}`, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, credentials: 'include', body: fd });
    const datos = await r.json().catch(() => null);
    if (!r.ok) throw new ErrorApi(r.status, datos);
    return datos as T;
  },
};

/** Rellena una plantilla con {marcadores}. */
export const plantilla = (texto: string, vars: Record<string, string | number | null | undefined>) =>
  String(texto || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '') as string);

export const copiar = (texto: string) => navigator.clipboard?.writeText(texto);

export const dinero = (n: number | null | undefined, moneda = 'USD') =>
  new Intl.NumberFormat('es', { style: 'currency', currency: moneda, maximumFractionDigits: 2 }).format(Number(n || 0));

export const fecha = (s: string | null | undefined, conHora = false) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}${s.length > 10 ? 'Z' : 'T00:00:00'}`);
  if (Number.isNaN(d.getTime())) return s;
  return conHora ? d.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : d.toLocaleDateString('es', { dateStyle: 'medium' });
};

/** Fecha de hoy en la zona horaria del navegador (YYYY-MM-DD). */
export const hoy = (desplazamientoDias = 0) => {
  const d = new Date(Date.now() + desplazamientoDias * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const inicioMes = () => hoy().slice(0, 8) + '01';

/** Enlace a WhatsApp con mensaje prellenado; null si no hay teléfono. */
export const whatsapp = (telefono: string | null | undefined, texto: string) => {
  const n = String(telefono || '').replace(/\D/g, '');
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : null;
};

/** Descarga un CSV con las filas dadas (separador ; para Excel en español). */
export function descargarCsv(nombre: string, filas: Record<string, unknown>[]) {
  if (!filas.length) return;
  const columnas = Object.keys(filas[0]);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [columnas.join(';'), ...filas.map((f) => columnas.map((c) => esc(f[c])).join(';'))].join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${nombre}-${hoy()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente_pago: 'Pendiente de pago', activa: 'Activa', mora: 'En mora', suspendida: 'Suspendida', vencida: 'Vencida', revocada: 'Revocada',
  pendiente: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada', confirmado: 'Confirmado', rechazado: 'Rechazado',
  devengada: 'Devengada', liquidada: 'Liquidada', revertida: 'Revertida', cerrado: 'Por aprobar', aprobado: 'Aprobado', observado: 'Observado',
  mensual: 'Mensual', anual: 'Anual', vitalicio: 'Vitalicio', sucursal_extra: 'Sucursal extra', mantenimiento: 'Mantenimiento', demo: 'Demo',
  superadmin: 'Superadmin', admin: 'Admin', vendedor: 'Vendedor', revendedor: 'Revendedor',
  abierto: 'Abierto', respondido: 'Respondido', cerrado_ticket: 'Cerrado', pagado: 'Pagado', cancelado: 'Cancelado', expirado: 'Expirado',
};

export const ETIQUETA_METODO: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', paypal: 'PayPal', stripe: 'Stripe', otro: 'Otro',
};

/* ---------- Portal del cliente (token propio, sin redirección a /login) ---------- */
const CLAVE_PORTAL = 'control.portal';
export const sesionPortal = {
  token: (): string | null => { try { return localStorage.getItem(CLAVE_PORTAL); } catch { return null; } },
  guardar: (t: string) => { try { localStorage.setItem(CLAVE_PORTAL, t); } catch { /* ignorar */ } },
  cerrar: () => { try { localStorage.removeItem(CLAVE_PORTAL); } catch { /* ignorar */ } },
};

async function llamarPortal<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = sesionPortal.token();
  if (t) cabeceras.Authorization = `Bearer ${t}`;
  let r: Response;
  try { r = await fetch(`/api/v1/portal${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }); }
  catch { throw new ErrorApi(0, null); }
  const datos = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 && ruta !== '/acceso') sesionPortal.cerrar();
    throw new ErrorApi(r.status, datos);
  }
  return datos as T;
}

export const apiPortal = {
  get: <T,>(ruta: string) => llamarPortal<T>('GET', ruta),
  post: <T,>(ruta: string, cuerpo?: unknown) => llamarPortal<T>('POST', ruta, cuerpo ?? {}),
  abrir: async (ruta: string) => {
    const t = sesionPortal.token();
    const r = await fetch(`/api/v1/portal${ruta}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (!r.ok) throw new ErrorApi(r.status, await r.json().catch(() => null));
    const url = URL.createObjectURL(await r.blob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};
