import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fecha } from '../api';
import { useSesion } from '../sesion';
import { Clave, Estado, Tabla, Tarjeta } from '../componentes/ui';

const ESTADOS = ['pendiente_pago', 'activa', 'mora', 'suspendida', 'vencida', 'revocada'];

export function Licencias() {
  const { esGestor } = useSesion();
  const [params, setParams] = useSearchParams();
  const [licencias, setLicencias] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const nav = useNavigate();
  const filtros = Object.fromEntries(params.entries());
  useEffect(() => { api.get<any[]>('/licencias', filtros).then(setLicencias); }, [params]);
  useEffect(() => { api.get<any[]>('/productos').then(setProductos); }, []);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };

  return (
    <>
      <header><div><h1>Licencias</h1><p>{licencias.length} licencia(s). Una licencia es una instalación; el equipo se fija en la primera activación.</p></div></header>
      <Tarjeta>
        <div className="filtros">
          <input placeholder="Buscar clave, cliente o etiqueta" value={filtros.q || ''} onChange={(e) => set('q', e.target.value)} />
          <select value={filtros.estado || ''} onChange={(e) => set('estado', e.target.value)}><option value="">Todos los estados</option>{ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}</select>
          <select value={filtros.producto_id || ''} onChange={(e) => set('producto_id', e.target.value)}><option value="">Todos los productos</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        </div>
        <Tabla filas={licencias} clave={(l) => l.id} onFila={(l) => nav(`/licencias/${l.id}`)} columnas={[
          { titulo: 'Clave', celda: (l) => <Clave valor={l.clave} /> },
          { titulo: 'Cliente', celda: (l) => <>{l.cliente_nombre}{l.etiqueta && <span className="suave"> · {l.etiqueta}</span>}</> },
          { titulo: 'Producto', celda: (l) => <>{l.producto_nombre} <Estado valor={l.plan_tipo} /></> },
          { titulo: 'Estado', celda: (l) => <Estado valor={l.estado} /> },
          { titulo: 'Equipos', celda: (l) => `${l.activaciones_usadas}/${l.max_activaciones}`, alinear: 'derecha' },
          { titulo: 'Vence', celda: (l) => l.vence_en ? fecha(l.vence_en) : l.estado === 'activa' ? 'Nunca' : '—' },
          { titulo: 'Último latido', celda: (l) => fecha(l.ultimo_latido, true) },
          ...(esGestor ? [{ titulo: 'Vendedor', celda: (l: any) => l.vendedor_nombre || '—' }] : []),
        ]} />
      </Tarjeta>
    </>
  );
}
