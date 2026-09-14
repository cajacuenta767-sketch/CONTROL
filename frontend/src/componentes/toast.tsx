import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tipo = 'ok' | 'error' | 'info';
interface Aviso { id: number; texto: string; tipo: Tipo }
const Ctx = createContext<(texto: string, tipo?: Tipo) => void>(() => {});

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((texto: string, tipo: Tipo = 'ok') => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'error' ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={avisar}>
      {children}
      <div className="avisos" aria-live="polite">
        {avisos.map((a) => <div key={a.id} className={`toast ${a.tipo}`} onClick={() => setAvisos((l) => l.filter((x) => x.id !== a.id))}>{a.texto}</div>)}
      </div>
    </Ctx.Provider>
  );
}

/** `const avisar = useAvisar(); avisar('Guardado')` */
export const useAvisar = () => useContext(Ctx);
