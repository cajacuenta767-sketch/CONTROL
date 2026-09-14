import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fecha, ETIQUETA_ESTADO } from '../api';
import { Campo, Cargando, Clave, Formulario, Tabla, Tarjeta, Vacio } from '../componentes/ui';

const ESTADOS = ['abierto', 'respondido', 'cerrado'];
const etiquetaTicket = (e: string) => (e === 'cerrado' ? 'Cerrado' : ETIQUETA_ESTADO[e] || e);
const EstadoTicket = ({ valor }: { valor: string }) => <span className={`estado ${valor === 'abierto' ? 'aviso' : valor === 'respondido' ? 'info' : 'neutro'}`}>{etiquetaTicket(valor)}</span>;

export function Tickets() {
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<any[] | null>(null);
  const nav = useNavigate();
  const estado = params.get('estado') || '';
  useEffect(() => { api.get<any[]>('/tickets', { estado }).then(setLista); }, [estado]);
  const filas = lista || [];
  const abiertos = filas.filter((t) => t.estado === 'abierto').length;
  return (
    <>
      <header>
        <div><h1>Tickets de soporte</h1><p>Consultas que los clientes abren desde su portal. {abiertos > 0 && <strong>{abiertos} sin responder.</strong>}</p></div>
      </header>
      <Tarjeta>
        <div className="filtros">
          <div className="chips">
            <button className={`chip ${!estado ? 'activo' : ''}`} onClick={() => setParams({})}>Todos</button>
            {ESTADOS.map((e) => <button key={e} className={`chip ${estado === e ? 'activo' : ''}`} onClick={() => setParams({ estado: e })}>{etiquetaTicket(e)}</button>)}
          </div>
        </div>
        <Tabla filas={filas} clave={(t) => t.id} onFila={(t) => nav(`/tickets/${t.id}`)} titulo="Tickets"
          vacio={lista === null ? 'Cargando…' : <Vacio icono="💬" titulo="No hay tickets" texto="Cuando un cliente escriba desde el portal aparecerá aquí." />}
          columnas={[
            { titulo: '#', celda: (t) => t.id, orden: (t) => t.id },
            { titulo: 'Asunto', celda: (t) => <><strong>{t.asunto}</strong><div className="suave pequeno" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.ultimo_mensaje}</div></> },
            { titulo: 'Cliente', celda: (t) => t.cliente_nombre, orden: (t) => t.cliente_nombre },
            { titulo: 'Licencia', celda: (t) => t.licencia_clave ? <>{t.producto} <Clave valor={t.licencia_clave} /></> : '—' },
            { titulo: 'Estado', celda: (t) => <EstadoTicket valor={t.estado} />, orden: (t) => t.estado },
            { titulo: 'Mensajes', celda: (t) => t.mensajes, alinear: 'derecha' },
            { titulo: 'Actualizado', celda: (t) => fecha(t.actualizado_en, true), orden: (t) => t.actualizado_en },
          ]} />
      </Tarjeta>
    </>
  );
}

export function TicketDetalle() {
  const { id } = useParams();
  const [t, setT] = useState<any | null>(null);
  const [texto, setTexto] = useState('');
  const [cerrar, setCerrar] = useState(false);
  const cargar = useCallback(() => api.get<any>(`/tickets/${id}`).then(setT), [id]);
  useEffect(() => { cargar(); }, [cargar]);
  if (!t) return <Cargando />;
  return (
    <>
      <header>
        <div><h1>#{t.id} · {t.asunto}</h1><p><Link to={`/clientes/${t.cliente_id}`}>{t.cliente_nombre}</Link>{t.licencia_clave && <> · {t.producto} <Clave valor={t.licencia_clave} /></>} · abierto el {fecha(t.creado_en, true)}</p></div>
        <div className="fila"><EstadoTicket valor={t.estado} /><Link to="/tickets" className="btn secundario chico">← Tickets</Link></div>
      </header>
      <div className="grid-2">
        <Tarjeta titulo="Conversación">
          <div className="conversacion">
            {t.mensajes.map((m: any) => (
              <div key={m.id} className={`mensaje ${m.autor_tipo}`}>
                <div className="quien">{m.autor_tipo === 'cliente' ? t.cliente_nombre : m.usuario_nombre || 'Agencia'} · {fecha(m.creado_en, true)}</div>
                <p>{m.texto}</p>
              </div>
            ))}
          </div>
        </Tarjeta>
        <Tarjeta titulo="Responder">
          {t.estado === 'cerrado' && <p className="suave" style={{ marginTop: 0 }}>El ticket está cerrado. Puedes responder igualmente; se reabrirá como respondido.</p>}
          <Formulario textoBoton={cerrar ? 'Responder y cerrar' : 'Enviar respuesta'} exito="Respuesta enviada al cliente" onEnviar={async () => { await api.post(`/tickets/${id}/responder`, { texto, cerrar }); setTexto(''); setCerrar(false); await cargar(); }}>
            <Campo etiqueta="Mensaje" ayuda="El cliente lo recibirá por correo (si tiene) y lo verá en su portal."><textarea rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} required minLength={1} /></Campo>
            <label className="fila" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={cerrar} onChange={(e) => setCerrar(e.target.checked)} /> Cerrar el ticket con esta respuesta</label>
          </Formulario>
          {t.cliente_telefono && <p className="suave pequeno">Teléfono del cliente: <a href={`https://wa.me/${String(t.cliente_telefono).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{t.cliente_telefono}</a></p>}
        </Tarjeta>
      </div>
    </>
  );
}

export { EstadoTicket, etiquetaTicket };
