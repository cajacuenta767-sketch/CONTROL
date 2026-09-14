import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, dinero, ETIQUETA_ESTADO } from '../api';
import { useSesion } from '../sesion';

interface Resultado { clientes: any[]; ventas: any[]; licencias: any[] }
interface Item { grupo: string; texto: string; detalle?: string; ruta: string }

/** Paleta de búsqueda global (Ctrl+K / ⌘K): clientes, ventas, licencias y accesos rápidos. */
export function Buscador({ abierto, cerrar }: { abierto: boolean; cerrar: () => void }) {
  const nav = useNavigate();
  const { esGestor, esSuper } = useSesion();
  const [q, setQ] = useState('');
  const [r, setR] = useState<Resultado | null>(null);
  const [activo, setActivo] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => { if (abierto) { setQ(''); setR(null); setActivo(0); setTimeout(() => entrada.current?.focus(), 0); } }, [abierto]);
  useEffect(() => {
    if (!abierto || q.trim().length < 2) { setR(null); return; }
    const t = setTimeout(() => api.get<Resultado>('/reportes/buscar', { q }).then(setR).catch(() => setR(null)), 180);
    return () => clearTimeout(t);
  }, [q, abierto]);

  const accesos: Item[] = useMemo(() => [
    { grupo: 'Ir a', texto: 'Nueva venta', ruta: '/ventas/nueva' }, { grupo: 'Ir a', texto: 'Ventas', ruta: '/ventas' }, { grupo: 'Ir a', texto: 'Licencias', ruta: '/licencias' },
    { grupo: 'Ir a', texto: 'Clientes', ruta: '/clientes' }, { grupo: 'Ir a', texto: 'Caja', ruta: '/caja' }, { grupo: 'Ir a', texto: 'Comisiones', ruta: '/comisiones' },
    { grupo: 'Ir a', texto: 'Reportes', ruta: '/reportes' }, { grupo: 'Ir a', texto: 'Tickets de soporte', ruta: '/tickets' }, { grupo: 'Ir a', texto: 'Mi seguridad', ruta: '/seguridad' },
    ...(esGestor ? [{ grupo: 'Ir a', texto: 'Catálogo', ruta: '/catalogo' }, { grupo: 'Ir a', texto: 'Equipo', ruta: '/equipo' }, { grupo: 'Ir a', texto: 'Auditoría', ruta: '/auditoria' }] : []),
    ...(esSuper ? [{ grupo: 'Ir a', texto: 'Ajustes', ruta: '/ajustes' }] : []),
  ], [esGestor, esSuper]);

  const items: Item[] = useMemo(() => {
    const n = q.trim().toLowerCase();
    const rapidos = accesos.filter((a) => !n || a.texto.toLowerCase().includes(n));
    if (!r) return rapidos;
    return [
      ...r.clientes.map((c) => ({ grupo: 'Clientes', texto: c.nombre, detalle: [c.empresa, c.telefono].filter(Boolean).join(' · '), ruta: `/clientes/${c.id}` })),
      ...r.ventas.map((v) => ({ grupo: 'Ventas', texto: `${v.numero} · ${v.cliente}`, detalle: `${dinero(v.total, v.moneda)} · ${ETIQUETA_ESTADO[v.estado] || v.estado}`, ruta: `/ventas/${v.id}` })),
      ...r.licencias.map((l) => ({ grupo: 'Licencias', texto: l.clave, detalle: `${l.cliente} · ${l.producto}${l.etiqueta ? ` · ${l.etiqueta}` : ''} · ${ETIQUETA_ESTADO[l.estado] || l.estado}`, ruta: `/licencias/${l.id}` })),
      ...rapidos,
    ];
  }, [r, q, accesos]);

  useEffect(() => { setActivo(0); }, [items.length, q]);
  if (!abierto) return null;

  const ir = (it: Item) => { cerrar(); nav(it.ruta); };
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && items[activo]) { e.preventDefault(); ir(items[activo]); }
    else if (e.key === 'Escape') cerrar();
  };
  let grupoAnterior = '';
  return (
    <div className="buscador-fondo" onClick={cerrar}>
      <div className="buscador" role="dialog" aria-modal="true" aria-label="Búsqueda global" onClick={(e) => e.stopPropagation()}>
        <input ref={entrada} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={teclas} placeholder="Buscar cliente, n.º de venta, clave de licencia…" aria-label="Buscar" role="combobox" aria-expanded aria-controls="buscador-lista" aria-activedescendant={items[activo] ? `buscador-${activo}` : undefined} />
        <div className="buscador-lista" id="buscador-lista" role="listbox">
          {items.length === 0 && <div className="buscador-item suave">{q.trim().length >= 2 && !r ? 'Buscando…' : 'Sin resultados'}</div>}
          {items.map((it, i) => {
            const titulo = it.grupo !== grupoAnterior ? <div className="buscador-grupo" key={`g${i}`}>{it.grupo}</div> : null;
            grupoAnterior = it.grupo;
            return (
              <div key={`w${i}`}>
                {titulo}
                <div id={`buscador-${i}`} role="option" aria-selected={i === activo} className={`buscador-item ${i === activo ? 'activo' : ''}`} onMouseEnter={() => setActivo(i)} onClick={() => ir(it)}>
                  <span>{it.texto}</span>{it.detalle && <small>{it.detalle}</small>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="buscador-pie"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></div>
      </div>
    </div>
  );
}
