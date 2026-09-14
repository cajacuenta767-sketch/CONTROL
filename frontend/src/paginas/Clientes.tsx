import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fecha } from '../api';
import { useSesion } from '../sesion';
import { Campo, Formulario, Modal, Tabla, Tarjeta, Vacio } from '../componentes/ui';

export function Clientes() {
  const { esGestor } = useSesion();
  const [clientes, setClientes] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [nc, setNc] = useState({ nombre: '', empresa: '', telefono: '', email: '', pais: '', notas: '', moneda: '' });
  const nav = useNavigate();
  const [salud, setSalud] = useState<Record<number, any>>({});
  const cargar = () => api.get<any[]>('/clientes', { q }).then(setClientes);
  useEffect(() => { cargar(); }, [q]);
  useEffect(() => { api.get<any[]>('/clientes/salud').then((l) => setSalud(Object.fromEntries(l.map((c) => [c.id, c])))).catch(() => null); }, []);

  return (
    <>
      <header><div><h1>Clientes</h1><p>{clientes.length} cliente(s)</p></div><button className="btn" onClick={() => setAbierto(true)}>+ Nuevo cliente</button></header>
      <Tarjeta>
        <div className="filtros"><input placeholder="Buscar nombre, empresa, correo o teléfono" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Tabla filas={clientes} clave={(c) => c.id} onFila={(c) => nav(`/clientes/${c.id}`)} vacio={q ? 'Ningún cliente coincide' : <Vacio icono="👥" titulo="Todavía no hay clientes" texto="Crea el primero para poder registrarle una venta." accion={<button className="btn chico" onClick={() => setAbierto(true)}>+ Nuevo cliente</button>} />} columnas={[
          { titulo: 'Nombre', celda: (c) => <>{c.nombre}{c.empresa && <span className="suave"> · {c.empresa}</span>}</>, orden: (c) => c.nombre },
          { titulo: 'Contacto', celda: (c) => <>{c.telefono || ''}{c.telefono && c.email ? ' · ' : ''}{c.email || ''}</> },
          { titulo: 'País', celda: (c) => <>{c.pais || '—'} <span className="suave pequeno">{c.moneda}</span></> },
          { titulo: 'Salud', celda: (c) => <Semaforo s={salud[c.id]} />, orden: (c) => salud[c.id]?.puntaje ?? 101 },
          { titulo: 'Licencias', celda: (c) => `${c.licencias_activas} activas / ${c.licencias}`, alinear: 'derecha' },
          ...(esGestor ? [{ titulo: 'Vendedor', celda: (c: any) => c.vendedor_nombre || '—' }] : []),
          { titulo: 'Alta', celda: (c) => fecha(c.creado_en), orden: (c) => c.creado_en },
        ]} />
      </Tarjeta>
      <Modal titulo="Nuevo cliente" abierto={abierto} cerrar={() => setAbierto(false)}>
        <Formulario onEnviar={async () => { await api.post('/clientes', { ...nc, email: nc.email || undefined, moneda: nc.moneda || undefined }); setAbierto(false); setNc({ nombre: '', empresa: '', telefono: '', email: '', pais: '', notas: '', moneda: '' }); await cargar(); }} cancelar={() => setAbierto(false)} exito="Cliente creado">
          <Campo etiqueta="Nombre"><input value={nc.nombre} onChange={(e) => setNc({ ...nc, nombre: e.target.value })} required autoFocus /></Campo>
          <Campo etiqueta="Empresa / negocio"><input value={nc.empresa} onChange={(e) => setNc({ ...nc, empresa: e.target.value })} /></Campo>
          <Campo etiqueta="Teléfono (WhatsApp)"><input value={nc.telefono} onChange={(e) => setNc({ ...nc, telefono: e.target.value })} /></Campo>
          <Campo etiqueta="Correo"><input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Campo>
          <Campo etiqueta="País"><input value={nc.pais} onChange={(e) => setNc({ ...nc, pais: e.target.value })} placeholder="PE, BO, CO…" /></Campo>
          <Campo etiqueta="Moneda en la que paga" ayuda="Vacío = moneda base. Debe existir tipo de cambio en Ajustes."><input value={nc.moneda} onChange={(e) => setNc({ ...nc, moneda: e.target.value.toUpperCase() })} placeholder="PEN, BOB, COP…" maxLength={3} /></Campo>
          <Campo etiqueta="Notas"><textarea rows={2} value={nc.notas} onChange={(e) => setNc({ ...nc, notas: e.target.value })} /></Campo>
        </Formulario>
      </Modal>
    </>
  );
}

export function Semaforo({ s, detalle = false }: { s?: any; detalle?: boolean }) {
  if (!s || s.semaforo === 'sin_licencias') return <span className="suave pequeno">—</span>;
  const color = s.semaforo === 'verde' ? 'var(--ok)' : s.semaforo === 'ambar' ? 'var(--aviso)' : 'var(--mal)';
  return (
    <span title={s.factores.join(' · ')} className="fila" style={{ gap: 6, display: 'inline-flex' }}>
      <span aria-label={s.semaforo} style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span className="pequeno">{s.puntaje}</span>
      {detalle && <span className="suave pequeno">· {s.factores.join(' · ')}</span>}
    </span>
  );
}
