import { useEffect, useState } from 'react';
import { api } from '../api';
import { usePwa } from '../pwa';

interface Plataforma { disponible: boolean; url: string | null; tamano: number | null; actualizado_en: string | null }
interface Estado { version: string; plataformas: Record<string, Plataforma> }
const MB = (n: number | null) => (n ? `${(n / 1048576).toFixed(0)} MB` : '');
const so = () => (/android/i.test(navigator.userAgent) ? 'android' : /windows/i.test(navigator.userAgent) ? 'windows' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : 'otro');

const ICONO = {
  android: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M17.6 9.5l1.5-2.6a.4.4 0 00-.7-.4l-1.5 2.6A8.9 8.9 0 0012 8.3c-1.7 0-3.4.5-4.9.8L5.6 6.5a.4.4 0 00-.7.4l1.5 2.6A7.4 7.4 0 003 15.5h18a7.4 7.4 0 00-3.4-6zM8.5 13a.9.9 0 110-1.8.9.9 0 010 1.8zm7 0a.9.9 0 110-1.8.9.9 0 010 1.8z"/></svg>,
  windows: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3 5.5l7.5-1v7H3zm8.5-1.2L21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zm8.5 0H21V21l-9.5-1.3z"/></svg>,
  windows_portable: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="8" width="13" height="8" rx="2"/><path d="M16 10h3a2 2 0 012 2 2 2 0 01-2 2h-3M7 12h5"/></svg>,
  web: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>,
};

/**
 * Tarjetas de descarga de la app (Android, Windows, portable e instalación desde el navegador).
 * `tono="oscuro"` para fondos oscuros (pantalla de entrada); `compacto` para el panel.
 */
export function TarjetasDescarga({ tono = 'claro', compacto = false, titulo }: { tono?: 'claro' | 'oscuro'; compacto?: boolean; titulo?: string }) {
  const [e, setE] = useState<Estado | null>(null);
  const pwa = usePwa();
  useEffect(() => { api.get<Estado>('/publico/descargas').then(setE).catch(() => null); }, []);
  if (!e) return null;
  const p = e.plataformas;
  const actual = so();
  const items = [
    p.android?.disponible && { k: 'android', t: 'Android', d: `APK · ${MB(p.android.tamano) || 'instala desde el archivo'}`, url: p.android.url!, rec: actual === 'android' },
    p.windows?.disponible && { k: 'windows', t: 'Windows', d: `Instalador · ${MB(p.windows.tamano) || 'un clic'}`, url: p.windows.url!, rec: actual === 'windows' },
    p.windows_portable?.disponible && { k: 'windows_portable', t: 'Windows portable', d: 'Sin instalar · USB o PC prestada', url: p.windows_portable.url!, rec: false },
    (pwa.puedeInstalar && !pwa.instalada) && { k: 'web', t: 'Instalar desde el navegador', d: actual === 'ios' ? 'Compartir › Añadir a inicio' : 'Sin descargar nada', accion: pwa.instalar, rec: actual === 'ios' || actual === 'otro' },
  ].filter(Boolean) as { k: keyof typeof ICONO; t: string; d: string; url?: string; accion?: () => void; rec: boolean }[];
  if (!items.length) return null;
  return (
    <div className={`descargas ${tono} ${compacto ? 'compacto' : ''}`}>
      {titulo && <div className="descargas-titulo">{titulo}{e.version && <span> · v{e.version}</span>}</div>}
      <div className="descargas-lista">
        {items.map((it) => {
          const contenido = <><span className="descargas-icono">{ICONO[it.k]}</span><span className="descargas-texto"><strong>{it.t}{it.rec && <em> · tu equipo</em>}</strong><small>{it.d}</small></span><span className="descargas-flecha" aria-hidden>⤓</span></>;
          return it.url
            ? <a key={it.k} className={`descargas-item ${it.rec ? 'recomendado' : ''}`} href={it.url}>{contenido}</a>
            : <button key={it.k} type="button" className={`descargas-item ${it.rec ? 'recomendado' : ''}`} onClick={it.accion}>{contenido}</button>;
        })}
      </div>
    </div>
  );
}
