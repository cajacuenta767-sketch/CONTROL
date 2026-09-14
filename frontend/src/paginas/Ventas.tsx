import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, dinero, fecha } from '../api';
import { useSesion } from '../sesion';
import { Estado, Tabla, Tarjeta } from '../componentes/ui';

export function Ventas() {
  const { esGestor } = useSesion();
  const [params, setParams] = useSearchParams();
  const [ventas, setVentas] = useState<any[]>([]);
  const [equipo, setEquipo] = useState<any[]>([]);
  const nav = useNavigate();
  const filtros = Object.fromEntries(params.entries());

  useEffect(() => { api.get<any[]>('/ventas', filtros).then(setVentas); }, [params]);
  useEffect(() => { if (esGestor) api.get<any[]>('/usuarios').then(setEquipo); }, [esGestor]);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };

  const total = ventas.filter((v) => v.estado !== 'anulada').reduce((s, v) => s + v.total, 0);

  return (
    <>
      <header><div><h1>Ventas</h1><p>{ventas.length} venta(s) · {dinero(total)}</p></div><Link to="/ventas/nueva" className="btn">+ Nueva venta</Link></header>
      <Tarjeta>
        <div className="filtros">
          <input placeholder="Buscar n.º o cliente" value={filtros.q || ''} onChange={(e) => set('q', e.target.value)} />
          <select value={filtros.estado || ''} onChange={(e) => set('estado', e.target.value)}>
            <option value="">Todos los estados</option><option value="pendiente">Pendiente</option><option value="pagada">Pagada</option><option value="anulada">Anulada</option>
          </select>
          {esGestor && (
            <select value={filtros.vendedor_id || ''} onChange={(e) => set('vendedor_id', e.target.value)}>
              <option value="">Todos los vendedores</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          )}
          <input type="date" value={filtros.desde || ''} onChange={(e) => set('desde', e.target.value)} />
          <input type="date" value={filtros.hasta || ''} onChange={(e) => set('hasta', e.target.value)} />
        </div>
        <Tabla filas={ventas} clave={(v) => v.id} onFila={(v) => nav(`/ventas/${v.id}`)} columnas={[
          { titulo: 'N.º', celda: (v) => v.numero },
          { titulo: 'Fecha', celda: (v) => fecha(v.creado_en) },
          { titulo: 'Cliente', celda: (v) => <>{v.cliente_nombre}{v.cliente_empresa && <span className="suave"> · {v.cliente_empresa}</span>}</> },
          { titulo: 'Producto', celda: (v) => <>{v.producto_nombre} <Estado valor={v.plan_tipo} />{v.cantidad > 1 && <span className="suave"> ×{v.cantidad}</span>}</> },
          ...(esGestor ? [{ titulo: 'Vendedor', celda: (v: any) => v.vendedor_nombre }] : []),
          { titulo: 'Total', celda: (v) => dinero(v.total, v.moneda), alinear: 'derecha' as const },
          { titulo: 'Pagado', celda: (v) => <>{dinero(v.pagado, v.moneda)}{v.por_confirmar > 0 && <span className="suave pequeno"> (+{dinero(v.por_confirmar)} por confirmar)</span>}</>, alinear: 'derecha' as const },
          { titulo: 'Estado', celda: (v) => <Estado valor={v.estado} /> },
        ]} />
      </Tarjeta>
    </>
  );
}
