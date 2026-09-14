export type Rol = 'superadmin' | 'admin' | 'vendedor';

export interface Usuario {
  id: number; email: string; nombre: string; rol: Rol;
  comision_pct: number; tope_emisiones_dia: number; tope_demos_semana: number; activo: number;
}

const CLAVE_TOKEN = 'control.token';

export const sesion = {
  token: (): string | null => { try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; } },
  guardar: (t: string) => { try { localStorage.setItem(CLAVE_TOKEN, t); } catch { /* ignorar */ } },
  cerrar: () => { try { localStorage.removeItem(CLAVE_TOKEN); } catch { /* ignorar */ } },
};

export class ErrorApi extends Error {
  status: number; detalles?: string[]; cuerpo: any;
  constructor(status: number, cuerpo: any) {
    super(cuerpo?.error || `Error ${status}`);
    this.status = status; this.detalles = cuerpo?.detalles; this.cuerpo = cuerpo;
  }
}

async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = sesion.token();
  if (t) cabeceras.Authorization = `Bearer ${t}`;
  const r = await fetch(`/api/v1${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const datos = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 && !ruta.startsWith('/auth/login')) { sesion.cerrar(); window.location.href = '/login'; }
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
};

export const dinero = (n: number | null | undefined, moneda = 'USD') =>
  new Intl.NumberFormat('es', { style: 'currency', currency: moneda, maximumFractionDigits: 2 }).format(Number(n || 0));

export const fecha = (s: string | null | undefined, conHora = false) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  return conHora ? d.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : d.toLocaleDateString('es', { dateStyle: 'medium' });
};

export const hoy = () => new Date().toISOString().slice(0, 10);

export const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente_pago: 'Pendiente de pago', activa: 'Activa', mora: 'En mora', suspendida: 'Suspendida', vencida: 'Vencida', revocada: 'Revocada',
  pendiente: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada', confirmado: 'Confirmado', rechazado: 'Rechazado',
  devengada: 'Devengada', liquidada: 'Liquidada', revertida: 'Revertida', cerrado: 'Por aprobar', aprobado: 'Aprobado', observado: 'Observado',
  mensual: 'Mensual', anual: 'Anual', vitalicio: 'Vitalicio', sucursal_extra: 'Sucursal extra', mantenimiento: 'Mantenimiento', demo: 'Demo',
  superadmin: 'Superadmin', admin: 'Admin', vendedor: 'Vendedor',
};

export const ETIQUETA_METODO: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', paypal: 'PayPal', stripe: 'Stripe', otro: 'Otro',
};
