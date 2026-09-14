import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { ErrorApi, ETIQUETA_ESTADO } from '../api';

export function Tarjeta({ titulo, children, acciones, className = '' }: { titulo?: ReactNode; children: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <section className={`tarjeta ${className}`}>
      {(titulo || acciones) && (
        <header className="tarjeta-cab">
          <h3>{titulo}</h3>
          <div>{acciones}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Indicador({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor: ReactNode; detalle?: ReactNode; tono?: 'ok' | 'alerta' | 'neutro' }) {
  return (
    <div className={`indicador ${tono || ''}`}>
      <span className="indicador-etiqueta">{etiqueta}</span>
      <strong className="indicador-valor">{valor}</strong>
      {detalle && <span className="indicador-detalle">{detalle}</span>}
    </div>
  );
}

const TONO: Record<string, string> = {
  activa: 'ok', pagada: 'ok', confirmado: 'ok', aprobado: 'ok', liquidada: 'ok', devengada: 'info',
  pendiente_pago: 'aviso', pendiente: 'aviso', cerrado: 'aviso', mora: 'aviso', observado: 'aviso',
  suspendida: 'mal', vencida: 'mal', revocada: 'mal', anulada: 'mal', rechazado: 'mal', revertida: 'mal',
  superadmin: 'info', admin: 'info', vendedor: 'neutro',
};

export function Estado({ valor }: { valor: string }) {
  return <span className={`estado ${TONO[valor] || 'neutro'}`}>{ETIQUETA_ESTADO[valor] || valor}</span>;
}

export function Tabla<T>({ columnas, filas, vacio = 'Sin registros', clave, onFila }: {
  columnas: { titulo: string; celda: (f: T) => ReactNode; ancho?: string; alinear?: 'derecha' }[];
  filas: T[]; vacio?: string; clave: (f: T) => string | number; onFila?: (f: T) => void;
}) {
  return (
    <div className="tabla-envoltorio">
      <table className="tabla">
        <thead><tr>{columnas.map((c) => <th key={c.titulo} style={{ width: c.ancho }} className={c.alinear}>{c.titulo}</th>)}</tr></thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={columnas.length} className="vacio">{vacio}</td></tr>}
          {filas.map((f) => (
            <tr key={clave(f)} onClick={onFila ? () => onFila(f) : undefined} className={onFila ? 'clic' : ''}>
              {columnas.map((c) => <td key={c.titulo} className={c.alinear}>{c.celda(f)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ titulo, abierto, cerrar, children }: { titulo: string; abierto: boolean; cerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!abierto) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [abierto, cerrar]);
  if (!abierto) return null;
  return (
    <div className="modal-fondo" onClick={cerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header><h3>{titulo}</h3><button className="btn-texto" onClick={cerrar} aria-label="Cerrar">✕</button></header>
        {children}
      </div>
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      {children}
      {ayuda && <small>{ayuda}</small>}
    </label>
  );
}

/** Formulario con manejo de envío, errores de la API y estado de carga. */
export function Formulario({ onEnviar, children, textoBoton = 'Guardar', cancelar }: {
  onEnviar: () => Promise<void>; children: ReactNode; textoBoton?: string; cancelar?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setDetalles([]); setEnviando(true);
    try { await onEnviar(); }
    catch (err) {
      if (err instanceof ErrorApi) { setError(err.message); setDetalles(err.detalles || []); }
      else setError(String(err));
    } finally { setEnviando(false); }
  };
  return (
    <form onSubmit={enviar} className="formulario">
      {children}
      {error && <div className="error">{error}{detalles.length > 0 && <ul>{detalles.map((d) => <li key={d}>{d}</li>)}</ul>}</div>}
      <div className="acciones">
        {cancelar && <button type="button" className="btn secundario" onClick={cancelar}>Cancelar</button>}
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Guardando…' : textoBoton}</button>
      </div>
    </form>
  );
}

/** Pide un motivo y ejecuta la acción. Para suspender, revocar, resetear, anular, observar. */
export function AccionConMotivo({ titulo, texto, className = 'btn secundario', onConfirmar, etiquetaMotivo = 'Motivo', extra }: {
  titulo: string; texto: string; className?: string; onConfirmar: (motivo: string) => Promise<void>; etiquetaMotivo?: string; extra?: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  return (
    <>
      <button className={className} onClick={() => setAbierto(true)}>{texto}</button>
      <Modal titulo={titulo} abierto={abierto} cerrar={() => setAbierto(false)}>
        <Formulario onEnviar={async () => { await onConfirmar(motivo); setAbierto(false); setMotivo(''); }} textoBoton="Confirmar" cancelar={() => setAbierto(false)}>
          {extra}
          <Campo etiqueta={etiquetaMotivo}><input value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} autoFocus /></Campo>
        </Formulario>
      </Modal>
    </>
  );
}

export function Cargando() { return <p className="cargando">Cargando…</p>; }

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'ok' | 'alerta' | 'error'; children: ReactNode }) {
  return <div className={`aviso ${tipo}`}>{children}</div>;
}

export function Clave({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <code className="clave" title="Copiar" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(valor).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1200); }); }}>
      {valor}{copiado && <span className="copiado"> ✓</span>}
    </code>
  );
}
