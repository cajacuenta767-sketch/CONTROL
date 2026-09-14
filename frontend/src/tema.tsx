import { useEffect, useState } from 'react';
import { recordar } from './api';

export type Tema = 'claro' | 'oscuro';

function temaInicial(): Tema {
  const guardado = recordar.leer('tema');
  if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

export function aplicarTema(t: Tema) {
  document.documentElement.dataset.tema = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'oscuro' ? '#0b1220' : '#0f172a');
}

/** Tema claro/oscuro persistido por navegador. */
export function useTema() {
  const [tema, setTema] = useState<Tema>(temaInicial);
  useEffect(() => { aplicarTema(tema); }, [tema]);
  const alternar = () => setTema((t) => { const n: Tema = t === 'oscuro' ? 'claro' : 'oscuro'; recordar.guardar('tema', n); return n; });
  return { tema, alternar };
}
