import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, dinero, fecha, hoy, inicioMes } from '../api';
import { useSesion } from '../sesion';
import { BotonAccion, Campo, Estado, ExportarCsv, Formulario, Indicador, Modal, Tabla, Tarjeta } from '../componentes/ui';

export function Comisiones() {
  const { esGestor, esSuper } = useSesion();
  const nav = useNavigate();
  const [comisiones, setComisiones] = useState<any[]>([]);
  const [liquidaciones, setLiquidaciones] = useState<any[]>([]);
  const [equipo, setEquipo] = useState<any[]>([]);
  const [vendedorId, setVendedorId] = useState('');
  const [estado, setEstado] = useState('');
  const [nueva, setNueva] = useState(false);
  const [f, setF] = useState({ vendedor_id: '', desde: inicioMes(), hasta: hoy() });
  const [detalle, setDetalle] = useState<any | null>(null);

  const cargar = useCallback(async () => {
    setComisiones(await api.get<any[]>('/comisiones', { vendedor_id: vendedorId || undefined, estado: estado || undefined }));
    setLiquidaciones(await api.get<any[]>('/liquidaciones', { vendedor_id: vendedorId || undefined }));
  }, [vendedorId, estado]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (esGestor) api.get<any[]>('/usuarios').then((u) => setEquipo(u.filter((x) => x.rol !== 'superadmin'))); }, [esGestor]);

  const pendiente = comisiones.filter((c) => c.estado === 'devengada').reduce((s, c) => s + c.monto, 0);
  const liquidada = comisiones.filter((c) => c.estado === 'liquidada').reduce((s, c) => s + c.monto, 0);

  return (
    <>
      <header>
        <div><h1>Comisiones</h1><p>Se devengan con cada cobro confirmado y se pagan por liquidación (semanal o quincenal).</p></div>
        <div className="fila">
          <ExportarCsv nombre="comisiones" filas={comisiones.map((c) => ({ fecha: c.creado_en, vendedor: c.vendedor_nombre, venta: c.venta_numero, cliente: c.cliente_nombre, producto: c.producto_nombre, base: c.base, pct: c.pct, monto: c.monto, estado: c.estado, liquidacion: c.liquidacion_id }))} />
          {esSuper && <button className="btn" onClick={() => setNueva(true)}>+ Liquidar</button>}
        </div>
      </header>
      <div className="indicadores">
        <Indicador etiqueta="Pendiente de liquidar" valor={dinero(pendiente)} tono="alerta" />
        <Indicador etiqueta="Ya liquidado" valor={dinero(liquidada)} tono="ok" />
      </div>
      <div className="filtros">
        {esGestor && <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}><option value="">Todos</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select>}
        <select value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos los estados</option><option value="devengada">Devengada</option><option value="liquidada">Liquidada</option><option value="revertida">Revertida</option></select>
      </div>
      <div className="grid-2">
        <Tarjeta titulo="Liquidaciones">
          <Tabla filas={liquidaciones} clave={(l) => l.id} vacio="Sin liquidaciones todavía" onFila={(l) => api.get<any>(`/liquidaciones/${l.id}`).then(setDetalle)} columnas={[
            { titulo: 'N.º', celda: (l) => `#${l.id}` },
            ...(esGestor ? [{ titulo: 'Vendedor', celda: (l: any) => l.vendedor_nombre }] : []),
            { titulo: 'Periodo', celda: (l) => `${fecha(l.desde)} – ${fecha(l.hasta)}` },
            { titulo: 'Total', celda: (l) => dinero(l.total), alinear: 'derecha' },
            { titulo: 'Estado', celda: (l) => <><Estado valor={l.estado === 'pagada' ? 'pagada' : 'pendiente'} />{l.pagada_en && <span className="suave pequeno"> {fecha(l.pagada_en)}</span>}</> },
            { titulo: '', celda: (l) => <div className="fila"><BotonAccion texto="PDF" className="btn secundario chico" onClick={() => api.abrir(`/liquidaciones/${l.id}/recibo.pdf`)} />{esSuper && l.estado === 'pendiente' && <BotonAccion texto="Marcar pagada" className="btn ok chico" exito="Liquidación pagada" onClick={async () => { await api.post(`/liquidaciones/${l.id}/pagar`); await cargar(); }} />}</div> },
          ]} />
        </Tarjeta>
        <Tarjeta titulo="Detalle de comisiones">
          <Tabla filas={comisiones} clave={(c) => c.id} vacio="Sin comisiones todavía" onFila={(c) => nav(`/ventas/${c.venta_id}`)} columnas={[
            { titulo: 'Fecha', celda: (c) => fecha(c.creado_en), orden: (c) => c.creado_en },
            ...(esGestor ? [{ titulo: 'Vendedor', celda: (c: any) => c.vendedor_nombre, orden: (c: any) => c.vendedor_nombre }] : []),
            { titulo: 'Venta', celda: (c) => <>{c.venta_numero}<br /><span className="suave pequeno">{c.cliente_nombre} · {c.producto_nombre}</span></> },
            { titulo: 'Base', celda: (c) => dinero(c.base), alinear: 'derecha', orden: (c) => c.base },
            { titulo: '%', celda: (c) => `${c.pct}%`, alinear: 'derecha' },
            { titulo: 'Comisión', celda: (c) => <strong style={{ color: c.monto < 0 ? 'var(--mal)' : undefined }}>{dinero(c.monto)}</strong>, alinear: 'derecha', orden: (c) => c.monto },
            { titulo: 'Estado', celda: (c) => <Estado valor={c.estado} />, orden: (c) => c.estado },
          ]} />
        </Tarjeta>
      </div>

      <Modal titulo="Nueva liquidación" abierto={nueva} cerrar={() => setNueva(false)}>
        <Formulario onEnviar={async () => { await api.post('/liquidaciones', { ...f, vendedor_id: Number(f.vendedor_id) }); setNueva(false); await cargar(); }} textoBoton="Crear liquidación" cancelar={() => setNueva(false)} exito="Liquidación creada">
          <Campo etiqueta="Vendedor"><select value={f.vendedor_id} onChange={(e) => setF({ ...f, vendedor_id: e.target.value })} required><option value="">Elegir…</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Desde"><input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} required /></Campo>
          <Campo etiqueta="Hasta"><input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} required /></Campo>
          <p className="suave pequeno">Incluye todas las comisiones devengadas del periodo que aún no estén en otra liquidación. Las reversiones de ventas anuladas se descuentan.</p>
        </Formulario>
      </Modal>

      <Modal titulo={`Liquidación #${detalle?.id || ''} · ${detalle?.vendedor_nombre || ''}`} abierto={Boolean(detalle)} cerrar={() => setDetalle(null)}>
        {detalle && (
          <>
            <p>{fecha(detalle.desde)} – {fecha(detalle.hasta)} · <strong>{dinero(detalle.total)}</strong> · <Estado valor={detalle.estado === 'pagada' ? 'pagada' : 'pendiente'} /></p>
            <Tabla filas={detalle.comisiones} clave={(c: any) => c.id} columnas={[
              { titulo: 'Venta', celda: (c: any) => `${c.venta_numero} · ${c.cliente_nombre}` },
              { titulo: 'Base', celda: (c: any) => dinero(c.base), alinear: 'derecha' },
              { titulo: '%', celda: (c: any) => `${c.pct}%`, alinear: 'derecha' },
              { titulo: 'Monto', celda: (c: any) => dinero(c.monto), alinear: 'derecha' },
            ]} />
            <div className="acciones" style={{ marginTop: 12, textAlign: 'right' }}><BotonAccion texto="Recibo PDF" className="btn secundario" onClick={() => api.abrir(`/liquidaciones/${detalle.id}/recibo.pdf`)} /></div>
          </>
        )}
      </Modal>
    </>
  );
}
