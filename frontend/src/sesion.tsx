import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, sesion, type Usuario } from './api';

interface Contexto {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (email: string, clave: string) => Promise<void>;
  salir: () => void;
  esGestor: boolean;
  esSuper: boolean;
}

const Ctx = createContext<Contexto>(null!);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!sesion.token()) { setCargando(false); return; }
    api.get<{ usuario: Usuario }>('/auth/yo').then((r) => setUsuario(r.usuario)).catch(() => sesion.cerrar()).finally(() => setCargando(false));
  }, []);

  const entrar = async (email: string, clave: string) => {
    const r = await api.post<{ token: string; usuario: Usuario }>('/auth/login', { email, clave });
    sesion.guardar(r.token);
    setUsuario(r.usuario);
  };
  const salir = () => { sesion.cerrar(); setUsuario(null); };

  return (
    <Ctx.Provider value={{ usuario, cargando, entrar, salir, esGestor: usuario?.rol === 'superadmin' || usuario?.rol === 'admin', esSuper: usuario?.rol === 'superadmin' }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSesion = () => useContext(Ctx);
