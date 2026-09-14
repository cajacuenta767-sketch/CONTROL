import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dinero, fecha, hoy, ETIQUETA_METODO } from '../api';
import { useSesion } from '../sesion';
import { AccionConMotivo, Aviso, BotonAccion, Campo, Estado, ExportarCsv, Formulario, Indicador, Tabla, Tarjeta } from '../componentes/ui';

export function Caja() {
  const { usuario, esGestor, esSuper } = useSesion();
  const [dia, setDia] = useState<any | null>(null);
  const [fechaDia, setFechaDia] = useState(hoy());
  const [vendedorId, setVendedorId] = useState<string>('');
  const [equipo, setEquipo] = useState<any[]>([]);
  const [cierres, setCierres] = useState<any[]>([]);
  const [observacion, setObservacion] = useState('');

  const cargarDia = useCallback(() => api.get<any>('/caja/dia', { fecha: fechaDia, vendedor_id: vendedorId || undefined }).then(setDia), [fechaDia, vendedorId]);
  const cargarCierres = useCallback(() => api.get<any[]>('/caja').then(setCierres), []);
  useEffect(() => { cargarDia(); }, [cargarDia]);
  useEffect(() => { cargarCierres(); }, [cargarCierres]);
  useEffect(() => { if (esGestor) api.get<any[]>('/usuarios').then((u) => setEquipo(u.filter((x) => x.activo))); }, [esGestor]);

  const esMiDia = !vendedorId || Number(vendedorId) === usuario!.id;
  const cerrar = async () => { await api.post('/caja/cerrar', { fecha: fechaDia, observacion: observacion || undefined }); setObservacion(''); await cargarDia(); await cargarCierres(); };
  const revisar = async (id: number, estado: string, obs?: string) => { await api.post(`/caja/${id}/revisar`, { estado, observacion: obs }); await cargarCierres(); await cargarDia(); };
  const porAprobar = cierres.filter((c) => c.estado === 'cerrado').length;

  return (
    <>
      <header>
        <div><h1>Caja</h1><p>Cada vendedor cierra su caja al final del día. {esSuper ? 'Tú apruebas u observas cada cierre.' : 'El superadministrador la aprueba.'}</p></div>
        <div className="fila">
          <ExportarCsv nombre="cierres-caja" filas={cierres.map((c) => ({ fecha: c.fecha, vendedor: c.vendedor_nombre, cobrado: c.total_cobrado, a_entregar: c.a_entregar, comision: c.comision_dia, cobros: c.cantidad_pagos, estado: c.estado, observacion: c.observacion }))} />
          <button className="btn secundario" onClick={() => window.print()}>Imprimir</button>
        </div>
      </header>

      {esSuper && porAprobar > 0 && <Aviso tipo="alerta">Tienes {porAprobar} cierre(s) por aprobar en el historial de abajo.</Aviso>}

      <Tarjeta titulo={`Caja del ${fecha(fechaDia)}`} acciones={
        <div className="filtros no-imprimir" style={{ marginBottom: 0 }}>
          {esGestor && <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}><option value="">Mi caja</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select>}
          <input type="date" value={fechaDia} max={hoy()} onChange={(e) => setFechaDia(e.target.value)} />
        </div>}>
        {dia && (
          <>
            <div className="indicadores">
              <Indicador etiqueta="Cobrado" valor={dinero(dia.total_cobrado)} detalle={`${dia.cantidad_pagos} cobro(s)`} />
              <Indicador etiqueta="A entregar en mano" valor={dinero(dia.a_entregar)} detalle="Efectivo" tono="alerta" />
              <Indicador etiqueta="Comisión del día" valor={dinero(dia.comision_dia)} detalle="Se liquida aparte" />
              <Indicador etiqueta="Estado" valor={dia.cierre ? <Estado valor={dia.cierre.estado} /> : 'Abierta'} tono={dia.cierre ? 'ok' : 'neutro'} />
            </div>
            <div className="grid-2">
              <div>
                <h3>Por método</h3>
                <ul className="lista-simple">
                  {Object.entries(dia.por_metodo).map(([m, v]) => <li key={m}><span>{ETIQUETA_METODO[m] || m}</span><strong>{dinero(v as number)}</strong></li>)}
                  {Object.keys(dia.por_metodo).length === 0 && <li className="suave">Sin cobros ese día.</li>}
                </ul>
              </div>
              <div>
                <h3>Cobros</h3>
                <Tabla filas={dia.pagos} clave={(p: any) => p.id} vacio="Sin cobros" columnas={[
                  { titulo: 'Venta', celda: (p: any) => p.venta_numero },
                  { titulo: 'Cliente', celda: (p: any) => p.cliente_nombre },
                  { titulo: 'Monto', celda: (p: any) => dinero(p.monto), alinear: 'derecha' },
                  { titulo: 'Método', celda: (p: any) => ETIQUETA_METODO[p.metodo] },
                  { titulo: 'Estado', celda: (p: any) => <Estado valor={p.estado} /> },
                ]} />
              </div>
            </div>
            {dia.cierre ? (
              <Aviso tipo={dia.cierre.estado === 'aprobado' ? 'ok' : dia.cierre.estado === 'observado' ? 'alerta' : 'info'}>
                Caja cerrada el {fecha(dia.cierre.cerrado_en, true)} · <Estado valor={dia.cierre.estado} />{dia.cierre.observacion && ` · ${dia.cierre.observacion}`}
              </Aviso>
            ) : esMiDia ? (
              <Formulario onEnviar={cerrar} textoBoton={`Cerrar caja del ${fecha(fechaDia)}`} exito="Caja cerrada. Queda pendiente de aprobación.">
                <Aviso tipo="alerta">Al cerrar, el total queda fijo y no se puede modificar. Revisa que todos los cobros del día estén registrados.</Aviso>
                <Campo etiqueta="Observación (opcional)"><input value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Faltó registrar…, diferencia de…" /></Campo>
              </Formulario>
            ) : <Aviso tipo="info">Este vendedor todavía no cerró su caja de ese día.</Aviso>}
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo="Historial de cierres">
        <Tabla filas={cierres} clave={(c) => c.id} vacio="Sin cierres todavía" columnas={[
          { titulo: 'Fecha', celda: (c) => fecha(c.fecha), orden: (c) => c.fecha },
          ...(esGestor ? [{ titulo: 'Vendedor', celda: (c: any) => c.vendedor_nombre, orden: (c: any) => c.vendedor_nombre }] : []),
          { titulo: 'Cobrado', celda: (c) => dinero(c.total_cobrado), alinear: 'derecha', orden: (c) => c.total_cobrado },
          { titulo: 'A entregar', celda: (c) => dinero(c.a_entregar), alinear: 'derecha', orden: (c) => c.a_entregar },
          { titulo: 'Comisión', celda: (c) => dinero(c.comision_dia), alinear: 'derecha' },
          { titulo: 'Cobros', celda: (c) => c.cantidad_pagos, alinear: 'derecha' },
          { titulo: 'Estado', celda: (c) => <><Estado valor={c.estado} />{c.observacion && <span className="suave pequeno"> · {c.observacion}</span>}</>, orden: (c) => c.estado },
          { titulo: '', celda: (c) => esSuper && c.estado !== 'aprobado' ? (
            <div className="fila">
              <BotonAccion texto="Aprobar" className="btn ok chico" exito="Cierre aprobado" onClick={() => revisar(c.id, 'aprobado')} />
              <AccionConMotivo titulo="Observar cierre" texto="Observar" className="btn secundario chico" etiquetaMotivo="Qué no cuadra" onConfirmar={(m) => revisar(c.id, 'observado', m)} exito="Cierre observado" />
            </div>
          ) : null },
        ]} />
      </Tarjeta>
      <p className="suave pequeno no-imprimir">Las comisiones no se descuentan de la caja: se pagan por <Link to="/comisiones">liquidación</Link>.</p>
    </>
  );
}
