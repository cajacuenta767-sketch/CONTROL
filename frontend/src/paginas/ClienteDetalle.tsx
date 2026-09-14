import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dinero, fecha } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, Clave, Estado, Formulario, Modal, Tabla, Tarjeta, Vacio } from '../componentes/ui';
import { Semaforo } from './Clientes';

const TIPO_EVENTO: Record<string, string> = { venta: 'Venta', pago: 'Pago', activacion: 'Activación', ticket: 'Ticket', licencia: 'Licencia' };

export function ClienteDetalle() {
  const { id } = useParams();
  const { esGestor } = useSesion();
  const nav = useNavigate();
  const [c, setC] = useState<any | null>(null);
  const [editar, setEditar] = useState(false);
  const [f, setF] = useState<any>({});
  const [equipo, setEquipo] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [salud, setSalud] = useState<any | null>(null);
  useEffect(() => { api.get<any>(`/clientes/${id}/salud`).then(setSalud).catch(() => null); }, [id]);
  useEffect(() => { api.get<any[]>(`/clientes/${id}/historial`).then(setHistorial).catch(() => setHistorial([])); }, [id]);
  const cargar = useCallback(() => api.get<any>(`/clientes/${id}`).then((x) => { setC(x); setF({ nombre: x.nombre, empresa: x.empresa || '', telefono: x.telefono || '', email: x.email || '', pais: x.pais || '', notas: x.notas || '', vendedor_id: x.vendedor_id || '' }); }), [id]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (esGestor) api.get<any[]>('/usuarios').then(setEquipo); }, [esGestor]);
  if (!c) return <Cargando />;

  return (
    <>
      <header>
        <div><h1>{c.nombre} {salud && <Semaforo s={salud} />}</h1><p>{c.empresa || 'Sin empresa'} · {c.pais || 'país no indicado'} · vendedor {c.vendedor_nombre || '—'}</p></div>
        <div className="fila">
          <Link to={`/ventas/nueva?cliente_id=${c.id}`} className="btn">+ Venta para este cliente</Link>
          <button className="btn secundario" onClick={() => setEditar(true)}>Editar</button>
        </div>
      </header>
      {salud && salud.semaforo !== 'verde' && salud.semaforo !== 'sin_licencias' && (
        <div className={`aviso ${salud.semaforo === 'rojo' ? 'error' : 'alerta'}`}><strong>Cliente en riesgo ({salud.puntaje}/100):</strong> {salud.factores.join(' · ')}. Llámalo antes de que se vaya.</div>
      )}
      <div className="grid-2">
        <Tarjeta titulo="Contacto">
          <dl className="definiciones">
            <dt>Teléfono</dt><dd>{c.telefono ? <a href={`https://wa.me/${String(c.telefono).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{c.telefono}</a> : '—'}</dd>
            <dt>Correo</dt><dd>{c.email || '—'}</dd>
            <dt>Moneda</dt><dd>{c.moneda}</dd>
            <dt>Notas</dt><dd>{c.notas || '—'}</dd>
            <dt>Alta</dt><dd>{fecha(c.creado_en)}</dd>
          </dl>
        </Tarjeta>
        <Tarjeta titulo={`Licencias (${c.licencias.length})`}>
          <Tabla filas={c.licencias} clave={(l: any) => l.id} vacio="Sin licencias" onFila={(l: any) => nav(`/licencias/${l.id}`)} columnas={[
            { titulo: 'Clave', celda: (l: any) => <Clave valor={l.clave} /> },
            { titulo: 'Producto', celda: (l: any) => <>{l.producto_nombre}{l.etiqueta && <span className="suave"> · {l.etiqueta}</span>}</> },
            { titulo: 'Estado', celda: (l: any) => <Estado valor={l.estado} /> },
            { titulo: 'Vence', celda: (l: any) => l.vence_en ? fecha(l.vence_en) : l.estado === 'activa' ? 'Nunca' : '—' },
          ]} />
        </Tarjeta>
        <Tarjeta titulo={`Ventas (${c.ventas.length})`}>
          <Tabla filas={c.ventas} clave={(v: any) => v.id} vacio="Sin ventas" onFila={(v: any) => nav(`/ventas/${v.id}`)} columnas={[
            { titulo: 'N.º', celda: (v: any) => v.numero },
            { titulo: 'Fecha', celda: (v: any) => fecha(v.creado_en) },
            { titulo: 'Producto', celda: (v: any) => <>{v.producto_nombre} <Estado valor={v.plan_tipo} /></> },
            { titulo: 'Total', celda: (v: any) => dinero(v.total, v.moneda), alinear: 'derecha' },
            { titulo: 'Estado', celda: (v: any) => <Estado valor={v.estado} /> },
          ]} />
        </Tarjeta>
        <Tarjeta titulo="Línea de tiempo" acciones={<span className="suave pequeno">ventas, pagos, activaciones, tickets</span>}>
          {historial === null ? <Cargando /> : historial.length === 0 ? <Vacio icono="🕓" titulo="Sin actividad todavía" /> : (
            <ul className="linea-tiempo">
              {historial.map((e, i) => (
                <li key={i} className={e.tipo} style={{ cursor: e.tipo === 'venta' || e.tipo === 'pago' || e.tipo === 'activacion' || e.tipo === 'licencia' ? 'pointer' : undefined }}
                  onClick={() => { if (e.tipo === 'venta' || e.tipo === 'pago') nav(`/ventas/${e.ref_id}`); else if (e.tipo === 'activacion' || e.tipo === 'licencia') nav(`/licencias/${e.ref_id}`); else if (e.tipo === 'ticket') nav(`/tickets/${e.ref_id}`); }}>
                  <div className="cuando">{fecha(e.fecha, true)} · {TIPO_EVENTO[e.tipo] || e.tipo}</div>
                  <div><strong>{e.titulo}</strong>{e.detalle && <span className="suave"> · {e.detalle}</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
      <Modal titulo="Editar cliente" abierto={editar} cerrar={() => setEditar(false)}>
        <Formulario onEnviar={async () => { await api.patch(`/clientes/${id}`, { ...f, email: f.email || null, vendedor_id: f.vendedor_id ? Number(f.vendedor_id) : undefined }); setEditar(false); await cargar(); }} cancelar={() => setEditar(false)} exito="Cliente actualizado">
          <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></Campo>
          <Campo etiqueta="Empresa"><input value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} /></Campo>
          <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></Campo>
          <Campo etiqueta="Correo"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
          <Campo etiqueta="País"><input value={f.pais} onChange={(e) => setF({ ...f, pais: e.target.value })} /></Campo>
          <Campo etiqueta="Notas"><textarea rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Campo>
          {esGestor && <Campo etiqueta="Vendedor asignado"><select value={f.vendedor_id} onChange={(e) => setF({ ...f, vendedor_id: e.target.value })}><option value="">—</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>}
        </Formulario>
      </Modal>
    </>
  );
}
