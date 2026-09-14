import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fecha } from '../api';
import { useSesion } from '../sesion';
import { Campo, Formulario, Modal, Tabla, Tarjeta } from '../componentes/ui';

export function Clientes() {
  const { esGestor } = useSesion();
  const [clientes, setClientes] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [nc, setNc] = useState({ nombre: '', empresa: '', telefono: '', email: '', pais: '', notas: '' });
  const nav = useNavigate();
  const cargar = () => api.get<any[]>('/clientes', { q }).then(setClientes);
  useEffect(() => { cargar(); }, [q]);

  return (
    <>
      <header><div><h1>Clientes</h1><p>{clientes.length} cliente(s)</p></div><button className="btn" onClick={() => setAbierto(true)}>+ Nuevo cliente</button></header>
      <Tarjeta>
        <div className="filtros"><input placeholder="Buscar nombre, empresa, correo o teléfono" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Tabla filas={clientes} clave={(c) => c.id} onFila={(c) => nav(`/clientes/${c.id}`)} columnas={[
          { titulo: 'Nombre', celda: (c) => <>{c.nombre}{c.empresa && <span className="suave"> · {c.empresa}</span>}</> },
          { titulo: 'Contacto', celda: (c) => <>{c.telefono || ''}{c.telefono && c.email ? ' · ' : ''}{c.email || ''}</> },
          { titulo: 'País', celda: (c) => c.pais || '—' },
          { titulo: 'Licencias', celda: (c) => `${c.licencias_activas} activas / ${c.licencias}`, alinear: 'derecha' },
          ...(esGestor ? [{ titulo: 'Vendedor', celda: (c: any) => c.vendedor_nombre || '—' }] : []),
          { titulo: 'Alta', celda: (c) => fecha(c.creado_en) },
        ]} />
      </Tarjeta>
      <Modal titulo="Nuevo cliente" abierto={abierto} cerrar={() => setAbierto(false)}>
        <Formulario onEnviar={async () => { await api.post('/clientes', { ...nc, email: nc.email || undefined }); setAbierto(false); setNc({ nombre: '', empresa: '', telefono: '', email: '', pais: '', notas: '' }); await cargar(); }} cancelar={() => setAbierto(false)}>
          <Campo etiqueta="Nombre"><input value={nc.nombre} onChange={(e) => setNc({ ...nc, nombre: e.target.value })} required autoFocus /></Campo>
          <Campo etiqueta="Empresa / negocio"><input value={nc.empresa} onChange={(e) => setNc({ ...nc, empresa: e.target.value })} /></Campo>
          <Campo etiqueta="Teléfono (WhatsApp)"><input value={nc.telefono} onChange={(e) => setNc({ ...nc, telefono: e.target.value })} /></Campo>
          <Campo etiqueta="Correo"><input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Campo>
          <Campo etiqueta="País"><input value={nc.pais} onChange={(e) => setNc({ ...nc, pais: e.target.value })} placeholder="PE, BO, CO…" /></Campo>
          <Campo etiqueta="Notas"><textarea rows={2} value={nc.notas} onChange={(e) => setNc({ ...nc, notas: e.target.value })} /></Campo>
        </Formulario>
      </Modal>
    </>
  );
}
