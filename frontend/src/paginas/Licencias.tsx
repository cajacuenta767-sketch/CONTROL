import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, fecha, ETIQUETA_ESTADO } from '../api';
import { useSesion } from '../sesion';
import { Clave, Estado, ExportarCsv, Tabla, Tarjeta, Vacio } from '../componentes/ui';

const ESTADOS = ['pendiente_pago', 'activa', 'mora', 'suspendida', 'vencida', 'revocada'];

export function Licencias() {
  const { esGestor } = useSesion();
  const [params, setParams] = useSearchParams();
  const [licencias, setLicencias] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [productos, setProductos] = useState<any[]>([]);
  const nav = useNavigate();
  const filtros = Object.fromEntries(params.entries());
  const pagina = Number(filtros.pagina || 1);
  const POR_PAGINA = 50;
  useEffect(() => {
    api.get<{ filas: any[]; total: number; conteo: Record<string, number> }>('/licencias', { ...filtros, pagina, por_pagina: POR_PAGINA })
      .then((r) => { setLicencias(r.filas); setTotal(r.total); setConteo(r.conteo || {}); });
  }, [params]);
  useEffect(() => { api.get<any[]>('/productos').then(setProductos); }, []);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k !== 'pagina') p.delete('pagina'); setParams(p); };
  const todas = useMemo(() => Object.values(conteo).reduce((s, n) => s + n, 0), [conteo]);
  const lista = licencias || [];

  return (
    <>
      <header>
        <div><h1>Licencias</h1><p>{total} licencia(s){total > lista.length ? ` · mostrando ${lista.length}` : ''}. Una licencia es una instalación; el equipo se fija en la primera activación.</p></div>
        <ExportarCsv nombre="licencias" filas={lista.map((l) => ({ clave: l.clave, cliente: l.cliente_nombre, empresa: l.cliente_empresa, etiqueta: l.etiqueta, producto: l.producto_nombre, plan: l.plan_tipo, estado: l.estado, equipos: `${l.activaciones_usadas}/${l.max_activaciones}`, vence: l.vence_en, soporte_hasta: l.soporte_hasta, vendedor: l.vendedor_nombre, emitida: l.creado_en }))} />
      </header>
      <Tarjeta>
        <div className="filtros">
          <div className="chips">
            <button className={`chip ${!filtros.estado ? 'activo' : ''}`} onClick={() => set('estado', '')}>Todas<b>{todas}</b></button>
            {ESTADOS.filter((e) => (conteo[e] || 0) > 0 || filtros.estado === e).map((e) => <button key={e} className={`chip ${filtros.estado === e ? 'activo' : ''}`} onClick={() => set('estado', e)}>{ETIQUETA_ESTADO[e]}<b>{conteo[e] || 0}</b></button>)}
          </div>
          <input placeholder="Buscar clave, cliente o etiqueta" value={filtros.q || ''} onChange={(e) => set('q', e.target.value)} />
          <select value={filtros.producto_id || ''} onChange={(e) => set('producto_id', e.target.value)}><option value="">Todos los productos</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        </div>
        <Tabla filas={lista} clave={(l) => l.id} onFila={(l) => nav(`/licencias/${l.id}`)} titulo="Licencias"
          servidor={{ pagina, total, porPagina: POR_PAGINA, onCambiar: (p) => set('pagina', p > 1 ? String(p) : '') }}
          vacio={licencias === null ? 'Cargando…' : todas === 0 ? <Vacio icono="🔑" titulo="Todavía no hay licencias" texto="Se emiten al registrar una venta." accion={<Link to="/ventas/nueva" className="btn chico">+ Nueva venta</Link>} /> : 'Ninguna licencia coincide'}
          columnas={[
            { titulo: 'Clave', celda: (l) => <Clave valor={l.clave} /> },
            { titulo: 'Cliente', celda: (l) => <>{l.cliente_nombre}{l.etiqueta && <span className="suave"> · {l.etiqueta}</span>}</>, orden: (l) => l.cliente_nombre },
            { titulo: 'Producto', celda: (l) => <>{l.producto_nombre} <Estado valor={l.plan_tipo} /></>, orden: (l) => l.producto_nombre },
            { titulo: 'Estado', celda: (l) => <Estado valor={l.estado} />, orden: (l) => l.estado },
            { titulo: 'Equipos', celda: (l) => `${l.activaciones_usadas}/${l.max_activaciones}`, alinear: 'derecha', orden: (l) => l.activaciones_usadas },
            { titulo: 'Vence', celda: (l) => l.vence_en ? fecha(l.vence_en) : l.estado === 'activa' ? 'Nunca' : '—', orden: (l) => l.vence_en || (l.estado === 'activa' ? '9999' : '') },
            { titulo: 'Último latido', celda: (l) => fecha(l.ultimo_latido, true), orden: (l) => l.ultimo_latido || '' },
            ...(esGestor ? [{ titulo: 'Vendedor', celda: (l: any) => l.vendedor_nombre || '—', orden: (l: any) => l.vendedor_nombre || '' }] : []),
          ]} />
      </Tarjeta>
    </>
  );
}
