import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, dinero, fecha, hoy, inicioMes, ETIQUETA_ESTADO } from '../api';
import { useSesion } from '../sesion';
import { Estado, ExportarCsv, Tabla, Tarjeta, Vacio } from '../componentes/ui';

export function Ventas() {
  const { esGestor } = useSesion();
  const [params, setParams] = useSearchParams();
  const [ventas, setVentas] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [equipo, setEquipo] = useState<any[]>([]);
  const nav = useNavigate();
  const filtros = Object.fromEntries(params.entries());
  const pagina = Number(filtros.pagina || 1);
  const POR_PAGINA = 50;

  useEffect(() => {
    api.get<{ filas: any[]; total: number }>('/ventas', { ...filtros, pagina, por_pagina: POR_PAGINA }).then((r) => { setVentas(r.filas); setTotal(r.total); });
  }, [params]);
  useEffect(() => { if (esGestor) api.get<any[]>('/usuarios').then(setEquipo); }, [esGestor]);
  const set = (cambios: Record<string, string>) => { const p = new URLSearchParams(params); for (const [k, v] of Object.entries(cambios)) { if (v) p.set(k, v); else p.delete(k); } if (!('pagina' in cambios)) p.delete('pagina'); setParams(p); };
  const rango = (desde: string, hasta: string) => set({ desde, hasta });
  const esRango = (d: string, h: string) => filtros.desde === d && (filtros.hasta || '') === h;

  const lista = ventas || [];
  const totalPagina = lista.filter((v) => v.estado !== 'anulada').reduce((s, v) => s + (v.total_base ?? v.total), 0);
  const pagado = lista.reduce((s, v) => s + (v.pagado / (v.tipo_cambio || 1)), 0);
  const hayFiltros = Object.keys(filtros).filter((k) => k !== 'pagina').length > 0;

  return (
    <>
      <header>
        <div><h1>Ventas</h1><p>{total} venta(s){total > lista.length ? ` · mostrando ${lista.length}` : ''} · total {dinero(totalPagina)} · cobrado {dinero(pagado)} <span className="suave pequeno">(equivalente en moneda base{total > lista.length ? ', de esta página' : ''})</span></p></div>
        <div className="fila">
          <ExportarCsv nombre="ventas" filas={lista.map((v) => ({ numero: v.numero, fecha: v.creado_en, cliente: v.cliente_nombre, empresa: v.cliente_empresa, producto: v.producto_nombre, plan: v.plan_tipo, cantidad: v.cantidad, total: v.total, pagado: v.pagado, estado: v.estado, vendedor: v.vendedor_nombre }))} />
          <Link to="/ventas/nueva" className="btn">+ Nueva venta</Link>
        </div>
      </header>
      <Tarjeta>
        <div className="filtros">
          <div className="chips">
            <button className={`chip ${esRango(hoy(), '') ? 'activo' : ''}`} onClick={() => rango(hoy(), '')}>Hoy</button>
            <button className={`chip ${esRango(hoy(-6), '') ? 'activo' : ''}`} onClick={() => rango(hoy(-6), '')}>7 días</button>
            <button className={`chip ${esRango(inicioMes(), '') ? 'activo' : ''}`} onClick={() => rango(inicioMes(), '')}>Este mes</button>
            <button className={`chip ${!filtros.desde && !filtros.hasta ? 'activo' : ''}`} onClick={() => rango('', '')}>Todo</button>
          </div>
          <input placeholder="Buscar n.º o cliente" value={filtros.q || ''} onChange={(e) => set({ q: e.target.value })} />
          <select value={filtros.estado || ''} onChange={(e) => set({ estado: e.target.value })}>
            <option value="">Todos los estados</option>{['pendiente', 'pagada', 'anulada'].map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
          </select>
          {esGestor && (
            <select value={filtros.vendedor_id || ''} onChange={(e) => set({ vendedor_id: e.target.value })}>
              <option value="">Todos los vendedores</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          )}
          <input type="date" value={filtros.desde || ''} onChange={(e) => set({ desde: e.target.value })} title="Desde" />
          <input type="date" value={filtros.hasta || ''} onChange={(e) => set({ hasta: e.target.value })} title="Hasta" />
          {hayFiltros && <button className="btn-texto" onClick={() => setParams({})}>Limpiar</button>}
        </div>
        <Tabla filas={lista} clave={(v) => v.id} onFila={(v) => nav(`/ventas/${v.id}`)} titulo="Ventas"
          servidor={{ pagina, total, porPagina: POR_PAGINA, onCambiar: (p) => set({ pagina: p > 1 ? String(p) : '' }) }}
          vacio={ventas === null ? 'Cargando…' : hayFiltros ? 'Ninguna venta coincide con los filtros' : <Vacio icono="🧾" titulo="Todavía no hay ventas" texto="Registra la primera venta y se emitirán sus licencias." accion={<Link to="/ventas/nueva" className="btn chico">+ Nueva venta</Link>} />}
          columnas={[
            { titulo: 'N.º', celda: (v) => v.numero, orden: (v) => v.id },
            { titulo: 'Fecha', celda: (v) => fecha(v.creado_en), orden: (v) => v.creado_en },
            { titulo: 'Cliente', celda: (v) => <>{v.cliente_nombre}{v.cliente_empresa && <span className="suave"> · {v.cliente_empresa}</span>}</>, orden: (v) => v.cliente_nombre },
            { titulo: 'Producto', celda: (v) => <>{v.producto_nombre} <Estado valor={v.plan_tipo} />{v.cantidad > 1 && <span className="suave"> ×{v.cantidad}</span>}</>, orden: (v) => v.producto_nombre },
            ...(esGestor ? [{ titulo: 'Vendedor', celda: (v: any) => v.vendedor_nombre, orden: (v: any) => v.vendedor_nombre }] : []),
            { titulo: 'Total', celda: (v) => dinero(v.total, v.moneda), alinear: 'derecha' as const, orden: (v) => v.total },
            { titulo: 'Pagado', celda: (v) => <>{dinero(v.pagado, v.moneda)}{v.por_confirmar > 0 && <span className="suave pequeno"> (+{dinero(v.por_confirmar)} por confirmar)</span>}</>, alinear: 'derecha' as const, orden: (v) => v.pagado },
            { titulo: 'Estado', celda: (v) => <Estado valor={v.estado} />, orden: (v) => v.estado },
          ]} />
      </Tarjeta>
    </>
  );
}
