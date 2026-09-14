import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, sesion, recordar, renovarSesion, type Usuario } from './api';

interface Contexto {
  usuario: Usuario | null;
  cargando: boolean;
  /** Devuelve el token temporal si el usuario tiene 2FA; null si ya entró. */
  entrar: (email: string, clave: string) => Promise<string | null>;
  verificar2fa: (tokenTemporal: string, codigo: string) => Promise<void>;
  salir: () => void;
  refrescar: () => Promise<void>;
  esGestor: boolean;
  esSuper: boolean;
}

const Ctx = createContext<Contexto>(null!);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  const refrescar = async () => { const r = await api.get<{ usuario: Usuario }>('/auth/yo'); setUsuario(r.usuario); };

  useEffect(() => {
    (async () => {
      try {
        // Solo intentamos renovar con la cookie si hubo una sesión en este navegador (evita un 401 inútil en visitas nuevas).
        if (!sesion.token() && !(recordar.leer('hay_sesion') && (await renovarSesion()))) return;
        await refrescar();
      } catch { sesion.cerrar(); }
      finally { setCargando(false); }
    })();
  }, []);

  const entrar = async (email: string, clave: string) => {
    const r = await api.post<{ token?: string; usuario?: Usuario; requiere_2fa?: boolean; token_temporal?: string }>('/auth/login', { email, clave });
    if (r.requiere_2fa && r.token_temporal) return r.token_temporal;
    sesion.guardar(r.token!); recordar.guardar('hay_sesion', '1');
    setUsuario(r.usuario!);
    return null;
  };
  const verificar2fa = async (tokenTemporal: string, codigo: string) => {
    const r = await api.post<{ token: string; usuario: Usuario }>('/auth/2fa/verificar', { token_temporal: tokenTemporal, codigo });
    sesion.guardar(r.token); recordar.guardar('hay_sesion', '1');
    setUsuario(r.usuario);
  };
  const salir = () => { api.post('/auth/salir').catch(() => null); sesion.cerrar(); recordar.guardar('hay_sesion', null); setUsuario(null); };

  return (
    <Ctx.Provider value={{ usuario, cargando, entrar, verificar2fa, salir, refrescar, esGestor: usuario?.rol === 'superadmin' || usuario?.rol === 'admin', esSuper: usuario?.rol === 'superadmin' }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSesion = () => useContext(Ctx);
