import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fecha, hoy, whatsapp } from '../api';
import { useSesion } from '../sesion';
import { useAvisar } from '../componentes/toast';
import { Aviso, BotonAccion, Campo, Cargando, Formulario, Modal, Tarjeta } from '../componentes/ui';

const ETAPAS: [string, string][] = [['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['demo', 'Demo instalada'], ['propuesta', 'Propuesta'], ['ganado', 'Ganado'], ['perdido', 'Perdido']];
const VACIO = { nombre: '', negocio: '', telefono: '', email: '', rubro: '', producto_id: '', notas: '', proximo_paso: '', proximo_paso_en: '' };

/** Embudo de prospectos: de "me pasaron un contacto" a cliente con licencia. */
export function Prospectos() {
  const { esGestor } = useSesion();
  const nav = useNavigate();
  const avisar = useAvisar();
  const [lista, setLista] = useState<any[] | null>(null);
  const [embudo, setEmbudo] = useState<any | null>(null);
  const [productos, setProductos] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState<any>(VACIO);
  const [abierto, setAbierto] = useState<any | null>(null);
  const [perder, setPerder] = useState<any | null>(null);
  const [motivo, setMotivo] = useState('');
  const cargar = useCallback(async () => { setLista(await api.get<any[]>('/prospectos', { q })); setEmbudo(await api.get<any>('/prospectos/embudo')); }, [q]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { api.get<any[]>('/productos').then(setProductos); }, []);
  const mover = async (p: any, etapa: string) => {
    if (etapa === 'perdido') { setPerder(p); setMotivo(''); return; }
    if (etapa === 'ganado') { const r = await api.post<any>(`/prospectos/${p.id}/convertir`); avisar('Convertido en cliente'); await cargar(); nav(`/ventas/nueva?cliente_id=${r.cliente_id}`); return; }
    await api.patch(`/prospectos/${p.id}`, { etapa }); await cargar();
  };
  if (!lista) return <Cargando />;
  const vencidos = lista.filter((p) => !['ganado', 'perdido'].includes(p.etapa) && p.proximo_paso_en && p.proximo_paso_en.slice(0, 10) <= hoy());

  return (
    <>
      <header>
        <div><h1>Prospectos</h1><p>{embudo?.total ?? 0} en total · conversión {embudo?.tasa_conversion ?? '—'}% · {embudo?.pendientes_hoy ?? 0} paso(s) para hoy</p></div>
        <div className="fila"><input placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} /><button className="btn" onClick={() => { setF(VACIO); setNuevo(true); }}>+ Prospecto</button></div>
      </header>
      {vencidos.length > 0 && <Aviso tipo="alerta"><strong>{vencidos.length} seguimiento(s) pendiente(s) hoy:</strong> {vencidos.slice(0, 5).map((p) => p.nombre).join(', ')}{vencidos.length > 5 ? '…' : ''}</Aviso>}
      {embudo && (
        <div className="indicadores">
          {ETAPAS.slice(0, 4).map(([k, t]) => <div key={k} className="indicador"><span className="indicador-etiqueta">{t}</span><strong className="indicador-valor">{embudo.por_etapa[k]}</strong></div>)}
          <div className="indicador ok"><span className="indicador-etiqueta">Ganados</span><strong className="indicador-valor">{embudo.por_etapa.ganado}</strong><span className="indicador-detalle">de demo a venta: {embudo.demos_a_venta ?? '—'}%</span></div>
          <div className="indicador"><span className="indicador-etiqueta">Perdidos</span><strong className="indicador-valor">{embudo.por_etapa.perdido}</strong>{embudo.motivos_perdida[0] && <span className="indicador-detalle">sobre todo por: {embudo.motivos_perdida[0].motivo}</span>}</div>
        </div>
      )}
      <div className="tablero-kanban">
        {ETAPAS.map(([k, t]) => (
          <div key={k} className="kanban-col">
            <h3>{t} <span className="suave">{lista.filter((p) => p.etapa === k).length}</span></h3>
            {lista.filter((p) => p.etapa === k).map((p) => (
              <div key={p.id} className={`kanban-tarjeta ${p.proximo_paso_en && p.proximo_paso_en.slice(0, 10) <= hoy() && !['ganado', 'perdido'].includes(k) ? 'vencida' : ''}`} onClick={() => setAbierto(p)} role="button" tabIndex={0}>
                <strong>{p.nombre}</strong>{p.negocio && <div className="suave pequeno">{p.negocio}{p.rubro ? ` · ${p.rubro}` : ''}</div>}
                {p.producto_nombre && <div className="pequeno">{p.producto_nombre}</div>}
                {p.proximo_paso && <div className="pequeno" style={{ marginTop: 4 }}>→ {p.proximo_paso}{p.proximo_paso_en && <span className="suave"> · {fecha(p.proximo_paso_en)}</span>}</div>}
                {esGestor && <div className="suave pequeno">{p.vendedor_nombre}</div>}
                {p.cliente_id && <div className="pequeno"><a href={`/clientes/${p.cliente_id}`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); nav(`/clientes/${p.cliente_id}`); }}>ver cliente</a></div>}
              </div>
            ))}
          </div>
        ))}
      </div>

      <Modal titulo="Nuevo prospecto" abierto={nuevo} cerrar={() => setNuevo(false)}>
        <Formulario onEnviar={async () => { await api.post('/prospectos', { ...f, producto_id: f.producto_id ? Number(f.producto_id) : null, email: f.email || null, proximo_paso_en: f.proximo_paso_en || null }); setNuevo(false); await cargar(); }} cancelar={() => setNuevo(false)} exito="Prospecto creado">
          <Campo etiqueta="Nombre de la persona"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required autoFocus /></Campo>
          <Campo etiqueta="Negocio"><input value={f.negocio} onChange={(e) => setF({ ...f, negocio: e.target.value })} /></Campo>
          <div className="fila"><Campo etiqueta="WhatsApp"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></Campo><Campo etiqueta="Rubro"><input value={f.rubro} onChange={(e) => setF({ ...f, rubro: e.target.value })} placeholder="barbería, clínica…" /></Campo></div>
          <Campo etiqueta="Producto que le interesa"><select value={f.producto_id} onChange={(e) => setF({ ...f, producto_id: e.target.value })}><option value="">Sin definir</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
          <div className="fila"><Campo etiqueta="Próximo paso"><input value={f.proximo_paso} onChange={(e) => setF({ ...f, proximo_paso: e.target.value })} placeholder="Llamar, visitar, instalar demo…" /></Campo><Campo etiqueta="Cuándo"><input type="date" value={f.proximo_paso_en} onChange={(e) => setF({ ...f, proximo_paso_en: e.target.value })} /></Campo></div>
          <Campo etiqueta="Notas"><textarea rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Campo>
        </Formulario>
      </Modal>

      <Modal titulo={abierto ? abierto.nombre : ''} abierto={!!abierto} cerrar={() => setAbierto(null)}>
        {abierto && (
          <>
            <dl className="definiciones">
              <dt>Negocio</dt><dd>{abierto.negocio || '—'}{abierto.rubro ? ` · ${abierto.rubro}` : ''}</dd>
              <dt>Contacto</dt><dd>{abierto.telefono || '—'}{abierto.email ? ` · ${abierto.email}` : ''}</dd>
              <dt>Producto</dt><dd>{abierto.producto_nombre || '—'}</dd>
              <dt>Etapa</dt><dd><select value={abierto.etapa} onChange={async (e) => { const et = e.target.value; setAbierto(null); await mover(abierto, et); }} style={{ width: 'auto' }}>{ETAPAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></dd>
              {abierto.motivo_perdida && <><dt>Motivo</dt><dd>{abierto.motivo_perdida}</dd></>}
              <dt>Notas</dt><dd>{abierto.notas || '—'}</dd>
            </dl>
            <Formulario textoBoton="Guardar seguimiento" exito="Guardado" onEnviar={async () => { await api.patch(`/prospectos/${abierto.id}`, { proximo_paso: abierto.proximo_paso || null, proximo_paso_en: abierto.proximo_paso_en || null, notas: abierto.notas || null }); setAbierto(null); await cargar(); }}>
              <div className="fila"><Campo etiqueta="Próximo paso"><input value={abierto.proximo_paso || ''} onChange={(e) => setAbierto({ ...abierto, proximo_paso: e.target.value })} /></Campo><Campo etiqueta="Cuándo"><input type="date" value={(abierto.proximo_paso_en || '').slice(0, 10)} onChange={(e) => setAbierto({ ...abierto, proximo_paso_en: e.target.value })} /></Campo></div>
              <Campo etiqueta="Notas"><textarea rows={3} value={abierto.notas || ''} onChange={(e) => setAbierto({ ...abierto, notas: e.target.value })} /></Campo>
            </Formulario>
            <div className="fila" style={{ marginTop: 8 }}>
              {abierto.telefono && <a className="btn secundario chico whatsapp" target="_blank" rel="noreferrer" href={whatsapp(abierto.telefono, `Hola ${abierto.nombre}, soy de la agencia. ¿Te instalo la demo gratis de 7 días de ${abierto.producto_nombre || 'nuestro sistema'}?`)!}>WhatsApp</a>}
              {!abierto.cliente_id && <BotonAccion texto="Convertir en cliente y vender" className="btn chico" onClick={() => mover(abierto, 'ganado')} />}
            </div>
          </>
        )}
      </Modal>

      <Modal titulo="Marcar como perdido" abierto={!!perder} cerrar={() => setPerder(null)}>
        <Formulario textoBoton="Confirmar" cancelar={() => setPerder(null)} exito="Prospecto marcado como perdido" onEnviar={async () => { await api.patch(`/prospectos/${perder.id}`, { etapa: 'perdido', motivo_perdida: motivo }); setPerder(null); await cargar(); }}>
          <Campo etiqueta="¿Por qué se perdió?" ayuda="Sirve para ver qué falla: precio, producto, competencia, sin respuesta…"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} autoFocus list="motivos" /><datalist id="motivos"><option value="Precio" /><option value="Compró otro sistema" /><option value="No respondió" /><option value="Le falta una función" /><option value="No es el momento" /></datalist></Campo>
        </Formulario>
      </Modal>
    </>
  );
}
