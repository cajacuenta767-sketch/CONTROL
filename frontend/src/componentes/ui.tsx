import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { descargarCsv, ErrorApi, ETIQUETA_ESTADO, whatsapp } from '../api';
import { useAvisar } from './toast';

export function Tarjeta({ titulo, children, acciones, className = '' }: { titulo?: ReactNode; children: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <section className={`tarjeta ${className}`}>
      {(titulo || acciones) && (
        <header className="tarjeta-cab">
          <h3>{titulo}</h3>
          <div className="fila">{acciones}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Indicador({ etiqueta, valor, detalle, tono, onClick }: { etiqueta: string; valor: ReactNode; detalle?: ReactNode; tono?: 'ok' | 'alerta' | 'neutro'; onClick?: () => void }) {
  return (
    <div className={`indicador ${tono || ''} ${onClick ? 'clic' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}>
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

export interface Columna<T> {
  titulo: string; celda: (f: T) => ReactNode; ancho?: string; alinear?: 'derecha';
  /** Valor para ordenar al hacer clic en la cabecera. */
  orden?: (f: T) => string | number | null | undefined;
}

export interface PaginacionServidor { pagina: number; total: number; porPagina: number; onCambiar: (pagina: number) => void }

export function Tabla<T>({ columnas, filas, vacio = 'Sin registros', clave, onFila, porPagina = 50, servidor, titulo }: {
  columnas: Columna<T>[]; filas: T[]; vacio?: ReactNode; clave: (f: T) => string | number; onFila?: (f: T) => void; porPagina?: number;
  /** Si se indica, la paginación la hace el servidor y `filas` es la página actual. */
  servidor?: PaginacionServidor; titulo?: string;
}) {
  const [orden, setOrden] = useState<{ i: number; asc: boolean } | null>(null);
  const [paginaLocal, setPaginaLocal] = useState(1);
  useEffect(() => { setPaginaLocal(1); }, [filas]);
  const pagina = servidor ? servidor.pagina : paginaLocal;
  const setPagina = servidor ? servidor.onCambiar : setPaginaLocal;
  if (servidor) porPagina = servidor.porPagina;
  const ordenadas = useMemo(() => {
    if (!orden || !columnas[orden.i]?.orden) return filas;
    const f = columnas[orden.i].orden!;
    return [...filas].sort((a, b) => {
      const va = f(a) ?? '', vb = f(b) ?? '';
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
      return orden.asc ? r : -r;
    });
  }, [filas, orden, columnas]);
  const totalFilas = servidor ? servidor.total : ordenadas.length;
  const paginas = Math.max(1, Math.ceil(totalFilas / porPagina));
  const visibles = servidor ? ordenadas : ordenadas.slice((pagina - 1) * porPagina, pagina * porPagina);
  return (
    <div className="tabla-envoltorio">
      <table className="tabla" aria-label={titulo}>
        <thead>
          <tr>{columnas.map((c, i) => (
            <th key={c.titulo || i} style={{ width: c.ancho }} className={`${c.alinear || ''} ${c.orden ? 'ordenable' : ''}`}
              onClick={c.orden ? () => setOrden((o) => (o?.i === i ? { i, asc: !o.asc } : { i, asc: true })) : undefined}>
              {c.titulo}{orden?.i === i && <span className="flecha">{orden.asc ? ' ▲' : ' ▼'}</span>}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {visibles.length === 0 && <tr><td colSpan={columnas.length} className="vacio">{vacio}</td></tr>}
          {visibles.map((f) => (
            <tr key={clave(f)} onClick={onFila ? () => onFila(f) : undefined} className={onFila ? 'clic' : ''} tabIndex={onFila ? 0 : undefined}
              onKeyDown={onFila ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onFila(f); } : undefined}>
              {columnas.map((c, i) => <td key={c.titulo || i} className={c.alinear}>{c.celda(f)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {paginas > 1 && (
        <div className="paginacion" role="navigation" aria-label="Paginación">
          <button className="btn secundario chico" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span className="suave pequeno">{(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, totalFilas)} de {totalFilas}</span>
          <button className="btn secundario chico" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

const FOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ titulo, abierto, cerrar, children }: { titulo: string; abierto: boolean; cerrar: () => void; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cerrar(); return; }
      if (e.key !== 'Tab' || !caja.current) return;
      const f = Array.from(caja.current.querySelectorAll<HTMLElement>(FOCABLES)).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const primero = f[0], ultimo = f[f.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    // Enfocar el primer control (si el contenido no puso autoFocus).
    const t = setTimeout(() => { if (caja.current && !caja.current.contains(document.activeElement)) (caja.current.querySelector<HTMLElement>(FOCABLES) || caja.current).focus(); }, 0);
    return () => { clearTimeout(t); window.removeEventListener('keydown', h); document.body.style.overflow = ''; anterior?.focus?.(); };
  }, [abierto, cerrar]);
  if (!abierto) return null;
  return (
    <div className="modal-fondo" onClick={cerrar}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header><h3 id="modal-titulo">{titulo}</h3><button className="btn-texto" onClick={cerrar} aria-label="Cerrar">✕</button></header>
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
export function Formulario({ onEnviar, children, textoBoton = 'Guardar', cancelar, exito }: {
  onEnviar: () => Promise<void>; children: ReactNode; textoBoton?: string; cancelar?: () => void; exito?: string;
}) {
  const avisar = useAvisar();
  const [error, setError] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setDetalles([]); setEnviando(true);
    try { await onEnviar(); if (exito) avisar(exito); }
    catch (err) {
      if (err instanceof ErrorApi) { setError(err.message); setDetalles(err.detalles || []); }
      else setError(String(err));
    } finally { setEnviando(false); }
  };
  return (
    <form onSubmit={enviar} className="formulario">
      {children}
      {error && <div className="error" role="alert">{error}{detalles.length > 0 && <ul>{detalles.map((d) => <li key={d}>{d}</li>)}</ul>}</div>}
      <div className="acciones">
        {cancelar && <button type="button" className="btn secundario" onClick={cancelar}>Cancelar</button>}
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Guardando…' : textoBoton}</button>
      </div>
    </form>
  );
}

/** Pide un motivo y ejecuta la acción. Para suspender, revocar, resetear, anular, observar. */
export function AccionConMotivo({ titulo, texto, className = 'btn secundario', onConfirmar, etiquetaMotivo = 'Motivo', extra, exito, descripcion }: {
  titulo: string; texto: string; className?: string; onConfirmar: (motivo: string) => Promise<void>; etiquetaMotivo?: string; extra?: ReactNode; exito?: string; descripcion?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  return (
    <>
      <button className={className} onClick={() => setAbierto(true)}>{texto}</button>
      <Modal titulo={titulo} abierto={abierto} cerrar={() => setAbierto(false)}>
        <Formulario onEnviar={async () => { await onConfirmar(motivo); setAbierto(false); setMotivo(''); }} textoBoton="Confirmar" cancelar={() => setAbierto(false)} exito={exito}>
          {descripcion && <p className="suave" style={{ marginTop: 0 }}>{descripcion}</p>}
          {extra}
          <Campo etiqueta={etiquetaMotivo}><input value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} autoFocus /></Campo>
        </Formulario>
      </Modal>
    </>
  );
}

/** Botón que ejecuta una acción inmediata mostrando aviso de éxito o error. */
export function BotonAccion({ texto, onClick, className = 'btn', exito }: { texto: string; onClick: () => Promise<void>; className?: string; exito?: string }) {
  const avisar = useAvisar();
  const [cargando, setCargando] = useState(false);
  return (
    <button className={className} disabled={cargando} onClick={async (e) => {
      e.stopPropagation(); setCargando(true);
      try { await onClick(); if (exito) avisar(exito); }
      catch (err) { avisar(err instanceof Error ? err.message : String(err), 'error'); }
      finally { setCargando(false); }
    }}>{cargando ? '…' : texto}</button>
  );
}

export function Cargando() { return <div className="cargando" role="status" aria-live="polite"><span className="spinner" aria-hidden /> Cargando…</div>; }

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'ok' | 'alerta' | 'error'; children: ReactNode }) {
  return <div className={`aviso ${tipo}`}>{children}</div>;
}

export function Vacio({ icono = '○', titulo, texto, accion }: { icono?: string; titulo: string; texto?: string; accion?: ReactNode }) {
  return (
    <div className="vacio-estado">
      <div className="vacio-icono" aria-hidden>{icono}</div>
      <strong>{titulo}</strong>
      {texto && <p>{texto}</p>}
      {accion}
    </div>
  );
}

export function Clave({ valor }: { valor: string }) {
  const avisar = useAvisar();
  return (
    <code className="clave" title="Clic para copiar" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(valor).then(() => avisar('Clave copiada')); }}>
      {valor}
    </code>
  );
}

export function BotonWhatsApp({ telefono, texto, etiqueta = 'WhatsApp', className = 'btn secundario chico' }: { telefono?: string | null; texto: string; etiqueta?: string; className?: string }) {
  const url = whatsapp(telefono, texto);
  if (!url) return <span className="suave pequeno" title="El cliente no tiene teléfono">Sin teléfono</span>;
  return <a className={`${className} whatsapp`} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{etiqueta}</a>;
}

export function ExportarCsv({ nombre, filas }: { nombre: string; filas: Record<string, unknown>[] }) {
  return <button className="btn secundario chico" disabled={!filas.length} onClick={() => descargarCsv(nombre, filas)} title="Descargar para Excel">⇩ CSV</button>;
}

export class LimiteErrores extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="tarjeta" style={{ margin: 24 }}>
        <h2>Algo falló en esta pantalla</h2>
        <p className="suave">{this.state.error.message}</p>
        <button className="btn" onClick={() => { this.setState({ error: null }); window.location.reload(); }}>Recargar</button>
      </div>
    );
  }
}
