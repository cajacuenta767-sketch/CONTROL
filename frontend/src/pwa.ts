import { useEffect, useState } from 'react';

let eventoInstalar: any = null;
const oyentes = new Set<() => void>();

/** Registra el service worker y captura el evento de instalación (Chrome, Edge, Android). */
export function registrarPwa() {
  if ('serviceWorker' in navigator && !/localhost:5173/.test(window.location.host)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => null); });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); eventoInstalar = e; oyentes.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { eventoInstalar = null; oyentes.forEach((f) => f()); });
}

/** Estado de instalación y conexión para mostrar el botón "Instalar app" y el aviso sin red. */
export function usePwa() {
  const [puedeInstalar, setPuede] = useState(Boolean(eventoInstalar));
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  useEffect(() => {
    const f = () => setPuede(Boolean(eventoInstalar));
    oyentes.add(f);
    const on = () => setEnLinea(true), off = () => setEnLinea(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { oyentes.delete(f); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const instalar = async () => { if (!eventoInstalar) return; eventoInstalar.prompt(); await eventoInstalar.userChoice.catch(() => null); eventoInstalar = null; setPuede(false); };
  const instalada = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  return { puedeInstalar, instalar, enLinea, instalada };
}
