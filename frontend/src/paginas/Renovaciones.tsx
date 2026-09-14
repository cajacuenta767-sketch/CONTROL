import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, copiar, dinero, fecha, whatsapp } from '../api';
import { useAvisar } from '../componentes/toast';
import { Aviso, BotonAccion, Cargando, Estado, Tabla, Tarjeta, Vacio } from '../componentes/ui';

/** Campaña de renovación: todo lo que vence en N días, con enlaces de pago y mensajes de golpe. */
export function Renovaciones() {
  const avisar = useAvisar();
  const [dias, setDias] = useState(30);
  const [filas, setFilas] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pasarelas, setPasarelas] = useState<Record<string, boolean>>({});
  const [proveedor, setProveedor] = useState('');
  const [resultado, setResultado] = useState<any | null>(null);
  const cargar = useCallback(() => api.get<any[]>('/renovaciones', { dias }).then((f) => { setFilas(f); setSel(new Set()); }), [dias]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { api.get<Record<string, boolean>>('/ventas/pasarelas').then((p) => { setPasarelas(p); setProveedor(Object.entries(p).find(([k, on]) => on && k !== 'demo')?.[0] || (p.demo ? 'demo' : '')); }); }, []);
  const lista = filas || [];
  const total = useMemo(() => lista.reduce((s, l) => s + l.precio, 0), [lista]);
  const alternar = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const generar = async (enviar: boolean) => {
    const r = await api.post<any>('/renovaciones/generar', { licencia_ids: Array.from(sel), proveedor: proveedor || undefined, enviar });
    setResultado(r); await cargar();
  };
  const activaWa = Object.keys(pasarelas).length > 0;

  return (
    <>
      <header>
        <div><h1>Renovaciones</h1><p>{lista.length} licencia(s) vencen en {dias} días · {dinero(total)} en juego. Genera los enlaces de pago y los mensajes de una vez.</p></div>
        <div className="chips">{[7, 15, 30, 60].map((d) => <button key={d} className={`chip ${dias === d ? 'activo' : ''}`} onClick={() => setDias(d)}>{d} días</button>)}</div>
      </header>
      {resultado && (
        <Aviso tipo="ok">
          <strong>{resultado.resultados.filter((r: any) => !r.error).length} renovación(es) preparadas</strong>{resultado.proveedor ? ` con enlaces de ${resultado.proveedor}` : ' (sin pasarela: el mensaje lleva al portal)'}.
          {resultado.resultados.some((r: any) => r.envio === 'enviado') && ` ${resultado.resultados.filter((r: any) => r.envio === 'enviado').length} WhatsApp enviados.`}
          {resultado.resultados.some((r: any) => r.envio === 'sin_configurar') && ' WhatsApp automático sin configurar: usa los botones de WhatsApp de cada fila.'}
          {resultado.resultados.filter((r: any) => r.error).map((r: any) => <div key={r.licencia_id} className="pequeno">· {r.cliente || r.licencia_id}: {r.error}</div>)}
        </Aviso>
      )}
      <Tarjeta acciones={<div className="fila">
        <label className="pequeno">Pasarela <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} style={{ width: 'auto' }}><option value="">Sin enlace (portal)</option>{Object.entries(pasarelas).filter(([, on]) => on).map(([k]) => <option key={k} value={k}>{k}</option>)}</select></label>
        <BotonAccion texto={`Generar enlaces (${sel.size})`} className="btn secundario chico" onClick={() => generar(false)} />
        <BotonAccion texto={`Generar y enviar WhatsApp (${sel.size})`} className="btn chico" onClick={() => generar(true)} />
      </div>} titulo={<label className="fila" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={sel.size > 0 && sel.size === lista.length} onChange={(e) => setSel(e.target.checked ? new Set(lista.map((l) => l.id)) : new Set())} /> Seleccionar todo</label>}>
        {filas === null ? <Cargando /> : (
          <Tabla filas={lista} clave={(l) => l.id} titulo="Renovaciones" vacio={<Vacio icono="🔄" titulo="Nada vence en este plazo" texto="Prueba con más días." />} columnas={[
            { titulo: '', celda: (l) => <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(l.id)} onChange={() => alternar(l.id)} onClick={(e) => e.stopPropagation()} /> },
            { titulo: 'Cliente', celda: (l) => <><Link to={`/clientes/${l.cliente_id}`}>{l.cliente_nombre}</Link><div className="suave pequeno">{l.telefono || 'sin teléfono'}</div></>, orden: (l) => l.cliente_nombre },
            { titulo: 'Producto', celda: (l) => <>{l.producto_nombre} <Estado valor={l.plan_tipo} />{l.etiqueta && <span className="suave"> · {l.etiqueta}</span>}</> },
            { titulo: 'Vence', celda: (l) => <>{fecha(l.vence_en)} <Estado valor={l.estado} /></>, orden: (l) => l.vence_en },
            { titulo: 'Precio', celda: (l) => dinero(l.precio), alinear: 'derecha' },
            { titulo: 'Renovación', celda: (l) => l.venta_renovacion_id ? <><Link to={`/ventas/${l.venta_renovacion_id}`}>venta creada</Link>{l.enlace_pago && <> · <button className="btn-texto pequeno" onClick={() => { copiar(l.enlace_pago); avisar('Enlace copiado'); }}>copiar enlace</button></>}</> : <span className="suave pequeno">sin iniciar</span> },
            { titulo: 'Mensaje', celda: (l) => <>{l.ultimo_mensaje ? <span className="suave pequeno">enviado {fecha(l.ultimo_mensaje, true)}</span> : null}{l.telefono && <a className="btn secundario chico whatsapp" style={{ marginLeft: 6 }} target="_blank" rel="noreferrer" href={whatsapp(l.telefono, `Hola ${l.cliente_nombre}, tu licencia de ${l.producto_nombre} vence el ${fecha(l.vence_en)}. ${l.enlace_pago ? `Renueva aquí: ${l.enlace_pago}` : '¿Coordinamos la renovación?'}`)!}>WhatsApp</a>}</> },
            { titulo: 'Vendedor', celda: (l) => l.vendedor_nombre || '—' },
          ]} />
        )}
        {!activaWa && <p className="suave pequeno">Cargando pasarelas…</p>}
      </Tarjeta>
    </>
  );
}
