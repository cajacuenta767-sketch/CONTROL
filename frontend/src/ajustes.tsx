import { useEffect, useState } from 'react';
import { api } from './api';

let cache: Record<string, string> | null = null;
let promesa: Promise<Record<string, string>> | null = null;

/** Ajustes de la agencia (plantillas, moneda, agencia…). Se cargan una vez por sesión. */
export function useAjustes() {
  const [ajustes, setAjustes] = useState<Record<string, string>>(cache || {});
  useEffect(() => {
    if (cache) return;
    promesa = promesa || api.get<Record<string, string>>('/ajustes').then((a) => { cache = a; return a; });
    promesa.then(setAjustes).catch(() => null);
  }, []);
  return ajustes;
}

export function invalidarAjustes() { cache = null; promesa = null; }
