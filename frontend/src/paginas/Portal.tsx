import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPortal, dinero, fecha, sesionPortal, ErrorApi } from '../api';
import { useAvisar } from '../componentes/toast';
import { Aviso, BotonAccion, Campo, Cargando, Clave, Estado, Formulario, Modal, Tabla, Tarjeta, Vacio } from '../componentes/ui';
import { EstadoTicket } from './Tickets';

function Marco({ agencia, acciones, children }: { agencia?: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <div className="publico">
      <header className="publico-cab"><span className="logo">C</span><strong style={{ flex: 1 }}>{agencia || 'Portal del cliente'}</strong>{acciones}</header>
      <main className="publico-cuerpo">{children}</main>
      <footer className="publico-pie">Portal del cliente · licencias, recibos y soporte.</footer>
    </div>
  );
}

/** /portal — acceso con clave de licencia + correo o teléfono. */
export function PortalAcceso() {
  const nav = useNavigate();
  const [clave, setClave] = useState('');
  const [contacto, setContacto] = useState('');
  useEffect(() => { if (sesionPortal.token()) nav('/portal/inicio', { replace: true }); }, [nav]);
  return (
    <Marco>
      <div className="login-form" style={{ background: 'transparent', padding: 0 }}>
        <div className="tarjeta">
          <h2>Portal del cliente</h2>
          <p className="sub">Consulta tus licencias, descarga recibos, renueva y escribe a soporte.</p>
          <Formulario textoBoton="Entrar" onEnviar={async () => { const r = await apiPortal.post<{ token: string }>('/acceso', { clave: clave.trim(), contacto: contacto.trim() }); sesionPortal.guardar(r.token); nav('/portal/inicio'); }}>
            <Campo etiqueta="Clave de licencia" ayuda="La que recibiste al comprar (XXXX-XXXX-…)."><input value={clave} onChange={(e) => setClave(e.target.value.toUpperCase())} required autoFocus autoComplete="off" spellCheck={false} /></Campo>
            <Campo etiqueta="Correo o teléfono registrado"><input value={contacto} onChange={(e) => setContacto(e.target.value)} required autoComplete="email" /></Campo>
          </Formulario>
          <p className="pie">¿No tienes los datos? Contacta a tu asesor de ventas.</p>
        </div>
      </div>
    </Marco>
  );
}

interface Resumen {
  cliente: { id: number; nombre: string; empresa?: string; email?: string; telefono?: string };
  agencia: string; licencias: any[]; ventas: any[]; tickets: any[]; pasarelas: Record<string, boolean>;
}

/** /portal/inicio — resumen del cliente. */
export function PortalInicio() {
  const nav = useNavigate();
  const avisar = useAvisar();
  const [r, setR] = useState<Resumen | null>(null);
  const [nuevoTicket, setNuevoTicket] = useState(false);
  const [ticket, setTicket] = useState<any | null>(null);
  const [f, setF] = useState({ asunto: '', texto: '', licencia_id: '' });
  const [respuesta, setRespuesta] = useState('');
  const cargar = useCallback(async () => {
    try { setR(await apiPortal.get<Resumen>('/yo')); }
    catch (e) { if (e instanceof ErrorApi && e.status === 401) nav('/portal', { replace: true }); else avisar(e instanceof Error ? e.message : String(e), 'error'); }
  }, [nav, avisar]);
  useEffect(() => { if (!sesionPortal.token()) nav('/portal', { replace: true }); else cargar(); }, [cargar, nav]);
  const abrirTicket = async (id: number) => setTicket(await apiPortal.get<any>(`/tickets/${id}`));
  if (!r) return <Marco><Cargando /></Marco>;
  const hayPasarela = Object.values(r.pasarelas || {}).some(Boolean);
  const salir = () => { sesionPortal.cerrar(); nav('/portal'); };

  return (
    <Marco agencia={r.agencia} acciones={<button className="btn secundario chico" onClick={salir}>Salir</button>}>
      <h1 style={{ marginBottom: 4 }}>Hola, {r.cliente.nombre.split(' ')[0]}</h1>
      <p className="suave" style={{ marginTop: 0 }}>{r.cliente.empresa ? `${r.cliente.empresa} · ` : ''}{r.licencias.length} licencia(s)</p>

      {(r as any).encuestas_pendientes?.length > 0 && <Encuesta pendiente={(r as any).encuestas_pendientes[0]} alResponder={cargar} />}

      <h2 style={{ margin: '18px 0 10px' }}>Tus licencias</h2>
      {r.licencias.length === 0 ? <Vacio icono="🔑" titulo="No hay licencias" /> : (
        <div className="portal-tarjetas">
          {r.licencias.map((l) => {
            const renovable = ['mensual', 'anual'].includes(l.plan_tipo) && l.estado !== 'revocada';
            const diasParaVencer = l.vence_en ? Math.ceil((new Date(l.vence_en).getTime() - Date.now()) / 86400000) : null;
            return (
              <div key={l.id} className="portal-lic">
                <div className="fila" style={{ justifyContent: 'space-between' }}><h3>{l.producto}</h3><Estado valor={l.estado} /></div>
                <div className="suave pequeno">{l.plan}{l.etiqueta ? ` · ${l.etiqueta}` : ''}</div>
                <p style={{ margin: '8px 0' }}><Clave valor={l.clave} /></p>
                <dl className="definiciones pequeno">
                  <dt>Vence</dt><dd>{l.vence_en ? <>{fecha(l.vence_en)}{diasParaVencer !== null && diasParaVencer <= 30 && diasParaVencer >= 0 && <span className="estado aviso" style={{ marginLeft: 6 }}>en {diasParaVencer} día(s)</span>}</> : l.estado === 'activa' ? 'Nunca (vitalicia)' : '—'}</dd>
                  <dt>Equipos</dt><dd>{l.equipos} de {l.max_activaciones}</dd>
                  {l.soporte_hasta && <><dt>Soporte hasta</dt><dd>{fecha(l.soporte_hasta)}</dd></>}
                  {l.vendedor && <><dt>Tu asesor</dt><dd>{l.vendedor}{l.vendedor_telefono && <> · <a href={`https://wa.me/${String(l.vendedor_telefono).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></>}</dd></>}
                </dl>
                <div className="fila" style={{ marginTop: 10 }}>
                  {renovable && hayPasarela && <BotonAccion className="btn chico" texto="Renovar ahora" onClick={async () => { const x = await apiPortal.post<{ url: string; venta: any }>(`/licencias/${l.id}/renovar`); window.location.href = x.url; }} />}
                  <button className="btn secundario chico" onClick={() => { setF({ asunto: `Consulta sobre ${l.producto}`, texto: '', licencia_id: String(l.id) }); setNuevoTicket(true); }}>Pedir ayuda</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 18 }}>
        <Tarjeta titulo="Compras y recibos">
          <Tabla filas={r.ventas} clave={(v) => v.id} vacio="Sin compras" titulo="Compras" columnas={[
            { titulo: 'N.º', celda: (v) => v.numero },
            { titulo: 'Fecha', celda: (v) => fecha(v.creado_en) },
            { titulo: 'Producto', celda: (v) => <>{v.producto} <span className="suave pequeno">{v.plan}</span></> },
            { titulo: 'Total', celda: (v) => <>{dinero(v.total, v.moneda)}{v.pagado < v.total && <div className="suave pequeno">pagado {dinero(v.pagado, v.moneda)}</div>}</>, alinear: 'derecha' },
            { titulo: 'Estado', celda: (v) => <Estado valor={v.estado} /> },
            { titulo: '', celda: (v) => <div className="fila" style={{ gap: 6 }}>
              {v.enlace_pago && v.estado === 'pendiente' && <a className="btn chico" href={v.enlace_pago}>Pagar</a>}
              {v.pagado > 0 && <BotonAccion className="btn secundario chico" texto="Recibo" onClick={() => apiPortal.abrir(`/ventas/${v.id}/recibo.pdf`)} />}
            </div> },
          ]} />
        </Tarjeta>
        <Tarjeta titulo="Soporte" acciones={<button className="btn chico" onClick={() => { setF({ asunto: '', texto: '', licencia_id: '' }); setNuevoTicket(true); }}>+ Nuevo ticket</button>}>
          {r.tickets.length === 0 ? <p className="suave" style={{ margin: 0 }}>¿Algo no funciona? Abre un ticket y tu asesor te responderá aquí y por correo.</p> : (
            <ul className="lista-simple">
              {r.tickets.map((t) => <li key={t.id} style={{ cursor: 'pointer' }} onClick={() => abrirTicket(t.id)}><span><strong>{t.asunto}</strong><div className="suave pequeno">{fecha(t.actualizado_en, true)} · {t.mensajes} mensaje(s)</div></span><EstadoTicket valor={t.estado} /></li>)}
            </ul>
          )}
        </Tarjeta>
      </div>

      <Modal titulo="Nuevo ticket de soporte" abierto={nuevoTicket} cerrar={() => setNuevoTicket(false)}>
        <Formulario textoBoton="Enviar" cancelar={() => setNuevoTicket(false)} exito="Ticket enviado. Te avisaremos por correo." onEnviar={async () => { await apiPortal.post('/tickets', { asunto: f.asunto, texto: f.texto, licencia_id: f.licencia_id ? Number(f.licencia_id) : undefined }); setNuevoTicket(false); await cargar(); }}>
          <Campo etiqueta="Licencia relacionada"><select value={f.licencia_id} onChange={(e) => setF({ ...f, licencia_id: e.target.value })}><option value="">General</option>{r.licencias.map((l) => <option key={l.id} value={l.id}>{l.producto}{l.etiqueta ? ` · ${l.etiqueta}` : ''}</option>)}</select></Campo>
          <Campo etiqueta="Asunto"><input value={f.asunto} onChange={(e) => setF({ ...f, asunto: e.target.value })} required minLength={3} maxLength={120} /></Campo>
          <Campo etiqueta="Describe el problema"><textarea rows={5} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} required minLength={3} /></Campo>
        </Formulario>
      </Modal>

      <Modal titulo={ticket ? `#${ticket.id} · ${ticket.asunto}` : ''} abierto={!!ticket} cerrar={() => setTicket(null)}>
        {ticket && (
          <>
            <div className="conversacion" style={{ marginBottom: 14 }}>
              {ticket.mensajes.map((m: any) => (
                <div key={m.id} className={`mensaje ${m.autor_tipo === 'cliente' ? 'agencia' : ''}`}>
                  <div className="quien">{m.autor_tipo === 'cliente' ? 'Tú' : m.usuario_nombre || r.agencia} · {fecha(m.creado_en, true)}</div>
                  <p>{m.texto}</p>
                </div>
              ))}
            </div>
            {ticket.estado === 'cerrado' ? <Aviso tipo="info">Este ticket está cerrado. Si necesitas algo más, abre uno nuevo.</Aviso> : (
              <Formulario textoBoton="Responder" onEnviar={async () => { const t = await apiPortal.post<any>(`/tickets/${ticket.id}/responder`, { texto: respuesta }); setRespuesta(''); setTicket(t); await cargar(); }}>
                <Campo etiqueta="Tu respuesta"><textarea rows={3} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} required /></Campo>
              </Formulario>
            )}
          </>
        )}
      </Modal>
    </Marco>
  );
}


/** Encuesta de una pregunta: 1 a 5 estrellas y comentario opcional. */
function Encuesta({ pendiente, alResponder }: { pendiente: any; alResponder: () => Promise<void> }) {
  const avisar = useAvisar();
  const [puntaje, setPuntaje] = useState(0);
  const [comentario, setComentario] = useState('');
  const [listo, setListo] = useState(false);
  if (listo) return <Aviso tipo="ok">¡Gracias! Tu respuesta nos ayuda a mejorar.</Aviso>;
  return (
    <Tarjeta titulo={pendiente.pregunta} acciones={<span className="suave pequeno">Una sola pregunta</span>}>
      <div className="fila" style={{ gap: 4 }} role="radiogroup" aria-label="Puntaje">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} className="btn-texto" aria-label={`${n} de 5`} style={{ fontSize: 26, color: n <= puntaje ? '#f59e0b' : 'var(--borde)' }} onClick={() => setPuntaje(n)}>★</button>)}
      </div>
      {puntaje > 0 && (
        <div className="fila" style={{ marginTop: 8 }}>
          <input placeholder={puntaje <= 3 ? '¿Qué podemos mejorar?' : 'Algo que quieras contarnos (opcional)'} value={comentario} onChange={(e) => setComentario(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <BotonAccion texto="Enviar" className="btn chico" onClick={async () => { await apiPortal.post('/encuestas', { motivo: pendiente.motivo, puntaje, comentario: comentario || undefined, ticket_id: pendiente.ticket_id, venta_id: pendiente.venta_id }); setListo(true); avisar('Gracias por responder'); await alResponder(); }} />
        </div>
      )}
    </Tarjeta>
  );
}
