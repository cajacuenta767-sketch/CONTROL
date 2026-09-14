import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dinero, fecha, ETIQUETA_METODO } from '../api';
import { useSesion } from '../sesion';
import { AccionConMotivo, Aviso, BotonAccion, BotonWhatsApp, Campo, Cargando, Clave, Estado, Formulario, Modal, Tabla, Tarjeta } from '../componentes/ui';

export function VentaDetalle() {
  const { id } = useParams();
  const { esGestor, esSuper } = useSesion();
  const [v, setV] = useState<any | null>(null);
  const [cliente, setCliente] = useState<any | null>(null);
  const [pagoAbierto, setPagoAbierto] = useState(false);
  const [pago, setPago] = useState({ monto: 0, metodo: 'efectivo', referencia: '', comprobante: '' });
  const cargar = useCallback(() => api.get<any>(`/ventas/${id}`).then((x) => { setV(x); api.get<any>(`/clientes/${x.cliente_id}`).then(setCliente).catch(() => null); }), [id]);
  useEffect(() => { cargar(); }, [cargar]);
  if (!v) return <Cargando />;

  const pendienteReal = v.saldo - v.por_confirmar;
  const abrirPago = () => { setPago({ monto: pendienteReal, metodo: 'efectivo', referencia: '', comprobante: '' }); setPagoAbierto(true); };
  const registrarPago = async () => { await api.post(`/ventas/${id}/pagos`, { ...pago, referencia: pago.referencia || undefined, comprobante: pago.comprobante || undefined }); setPagoAbierto(false); await cargar(); };
  const comisionTotal = v.comisiones.filter((c: any) => c.estado !== 'revertida').reduce((s: number, c: any) => s + c.monto, 0);
  const licencias = v.es_renovacion && v.licencia_renovada ? [v.licencia_renovada] : v.licencias;
  const activas = licencias.filter((l: any) => l.estado === 'activa');
  const mensajeClaves = `Hola ${v.cliente_nombre}, gracias por tu compra de ${v.producto_nombre}. ${activas.length > 1 ? 'Estas son tus claves de licencia' : 'Esta es tu clave de licencia'}:\n\n${activas.map((l: any) => `${l.etiqueta ? `${l.etiqueta}: ` : ''}${l.clave}`).join('\n')}\n\nActívala en el sistema, en Ajustes › Licencia. Cada clave se vincula al primer equipo donde la actives. Cualquier duda me escribes.`;
  const mensajeCobro = `Hola ${v.cliente_nombre}, te recuerdo el saldo pendiente de ${dinero(pendienteReal, v.moneda)} por ${v.producto_nombre} (venta ${v.numero}). Apenas se confirme el pago se activan tus licencias. ¿Me confirmas el medio de pago que prefieres?`;

  return (
    <>
      <header>
        <div><h1>Venta {v.numero} <Estado valor={v.estado} /></h1><p>{fecha(v.creado_en, true)} · vendedor {v.vendedor_nombre}</p></div>
        <div className="fila">
          {v.estado === 'pagada' && activas.length > 0 && <BotonWhatsApp telefono={cliente?.telefono} texto={mensajeClaves} etiqueta="Enviar claves por WhatsApp" className="btn secundario" />}
          {v.estado === 'pendiente' && pendienteReal > 0 && <BotonWhatsApp telefono={cliente?.telefono} texto={mensajeCobro} etiqueta="Recordar cobro" className="btn secundario" />}
          {v.estado === 'pendiente' && pendienteReal > 0 && <button className="btn" onClick={abrirPago}>+ Registrar cobro</button>}
          {esSuper && v.estado !== 'anulada' && <AccionConMotivo titulo="Anular venta" texto="Anular venta" className="btn peligro" onConfirmar={async (m) => { await api.post(`/ventas/${id}/anular`, { motivo: m }); await cargar(); }} exito="Venta anulada" descripcion="Se revocan sus licencias y se revierten las comisiones. Los pagos confirmados no se devuelven automáticamente." />}
        </div>
      </header>

      {v.estado === 'anulada' && <Aviso tipo="error">Anulada: {v.motivo_anulacion}. Licencias revocadas y comisiones revertidas.</Aviso>}
      {v.estado === 'pendiente' && v.por_confirmar > 0 && <Aviso tipo="alerta">Hay {dinero(v.por_confirmar)} registrados que esperan confirmación de un administrador. Las licencias se activan cuando el total esté confirmado.</Aviso>}
      {v.estado === 'pagada' && activas.length > 0 && v.licencias.every((l: any) => l.estado === 'activa') && <Aviso tipo="ok">Pago completo. Las licencias están activas: envíale las claves al cliente.</Aviso>}

      <div className="grid-2">
        <Tarjeta titulo="Detalle">
          <dl className="definiciones">
            <dt>Cliente</dt><dd><Link to={`/clientes/${v.cliente_id}`}>{v.cliente_nombre}</Link>{v.cliente_empresa && <span className="suave"> · {v.cliente_empresa}</span>}{cliente?.telefono && <span className="suave"> · {cliente.telefono}</span>}</dd>
            <dt>Producto</dt><dd>{v.producto_nombre}</dd>
            <dt>Plan</dt><dd>{v.plan_nombre} <Estado valor={v.plan_tipo} />{v.es_renovacion ? ' · renovación' : ''}</dd>
            <dt>Cantidad</dt><dd>{v.cantidad} × {dinero(v.precio_unitario, v.moneda)}</dd>
            <dt>Descuento</dt><dd>{v.descuento_pct}%</dd>
            <dt><strong>Total</strong></dt><dd><strong>{dinero(v.total, v.moneda)}</strong></dd>
            <dt>Pagado</dt><dd>{dinero(v.pagado, v.moneda)} · saldo {dinero(v.saldo, v.moneda)}</dd>
            <dt>Comisión</dt><dd>{dinero(comisionTotal)} {v.comisiones.length > 0 && <span className="suave pequeno">({v.comisiones.map((c: any) => `${c.pct}% de ${dinero(c.base)}`).join(', ')})</span>}</dd>
            {v.notas && <><dt>Notas</dt><dd>{v.notas}</dd></>}
          </dl>
        </Tarjeta>

        <Tarjeta titulo="Cobros">
          <Tabla filas={v.pagos} clave={(p: any) => p.id} vacio="Sin cobros registrados" columnas={[
            { titulo: 'Fecha', celda: (p: any) => fecha(p.creado_en, true) },
            { titulo: 'Monto', celda: (p: any) => dinero(p.monto, v.moneda), alinear: 'derecha' },
            { titulo: 'Método', celda: (p: any) => <>{ETIQUETA_METODO[p.metodo]}{p.referencia && <span className="suave pequeno"> · {p.referencia}</span>}{p.comprobante && <> · <a href={p.comprobante} target="_blank" rel="noreferrer" className="pequeno">comprobante</a></>}</> },
            { titulo: 'Registró', celda: (p: any) => p.registrado_por_nombre },
            { titulo: 'Estado', celda: (p: any) => <><Estado valor={p.estado} />{p.confirmado_por_nombre && <span className="suave pequeno"> {p.confirmado_por_nombre}</span>}{p.motivo_rechazo && <span className="suave pequeno"> · {p.motivo_rechazo}</span>}</> },
            { titulo: '', celda: (p: any) => esGestor && p.estado === 'pendiente' && v.estado !== 'anulada' ? (
              <div className="fila">
                <BotonAccion texto="Confirmar" className="btn ok chico" exito="Pago confirmado" onClick={async () => { await api.post(`/pagos/${p.id}/confirmar`); await cargar(); }} />
                <AccionConMotivo titulo="Rechazar cobro" texto="Rechazar" className="btn secundario chico" onConfirmar={async (m) => { await api.post(`/pagos/${p.id}/rechazar`, { motivo: m }); await cargar(); }} exito="Cobro rechazado" />
              </div>
            ) : null },
          ]} />
        </Tarjeta>

        <Tarjeta titulo={v.es_renovacion ? 'Licencia renovada' : `Licencias (${v.licencias.length})`}>
          <Tabla filas={licencias} clave={(l: any) => l.id} columnas={[
            { titulo: 'Clave', celda: (l: any) => <Link to={`/licencias/${l.id}`}><Clave valor={l.clave} /></Link> },
            { titulo: 'Etiqueta', celda: (l: any) => l.etiqueta || '—' },
            { titulo: 'Estado', celda: (l: any) => <Estado valor={l.estado} /> },
            { titulo: 'Vence', celda: (l: any) => l.vence_en ? fecha(l.vence_en) : l.estado === 'activa' ? 'Nunca (vitalicia)' : '—' },
            { titulo: 'Soporte hasta', celda: (l: any) => fecha(l.soporte_hasta) },
          ]} />
        </Tarjeta>
      </div>

      <Modal titulo="Registrar cobro" abierto={pagoAbierto} cerrar={() => setPagoAbierto(false)}>
        <Formulario onEnviar={registrarPago} textoBoton="Registrar" cancelar={() => setPagoAbierto(false)} exito="Cobro registrado; pendiente de confirmación">
          <Aviso tipo="info">Saldo pendiente: {dinero(pendienteReal, v.moneda)}. El cobro queda pendiente hasta que un administrador lo confirme.</Aviso>
          <Campo etiqueta="Monto"><input type="number" step="0.01" min={0.01} max={pendienteReal} value={pago.monto} onChange={(e) => setPago({ ...pago, monto: Number(e.target.value) })} required /></Campo>
          <Campo etiqueta="Método">
            <select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>
              {Object.entries(ETIQUETA_METODO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Referencia / n.º de operación"><input value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></Campo>
          <Campo etiqueta="Enlace al comprobante" ayuda="Foto o PDF subido a tu Drive, WhatsApp, etc."><input value={pago.comprobante} onChange={(e) => setPago({ ...pago, comprobante: e.target.value })} /></Campo>
        </Formulario>
      </Modal>
    </>
  );
}
