import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, copiar, dinero, fecha, plantilla, ETIQUETA_METODO } from '../api';
import { useSesion } from '../sesion';
import { useAjustes } from '../ajustes';
import { useAvisar } from '../componentes/toast';
import { AccionConMotivo, Aviso, BotonAccion, BotonWhatsApp, Campo, Cargando, Clave, Estado, Formulario, Modal, Tabla, Tarjeta } from '../componentes/ui';

export function VentaDetalle() {
  const { id } = useParams();
  const { esGestor, esSuper } = useSesion();
  const ajustes = useAjustes();
  const avisar = useAvisar();
  const [v, setV] = useState<any | null>(null);
  const [pagoAbierto, setPagoAbierto] = useState(false);
  const [pago, setPago] = useState({ monto: 0, metodo: 'efectivo', referencia: '', comprobante: '' });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [pasarelas, setPasarelas] = useState<Record<string, boolean>>({});
  const [enlaceAbierto, setEnlaceAbierto] = useState(false);
  const [proveedor, setProveedor] = useState('demo');
  const cargar = useCallback(() => api.get<any>(`/ventas/${id}`).then(setV), [id]);
  useEffect(() => { cargar(); api.get<Record<string, boolean>>('/ventas/pasarelas').then(setPasarelas); }, [cargar]);
  if (!v) return <Cargando />;

  const pendienteReal = v.saldo - v.por_confirmar;
  const abrirPago = () => { setPago({ monto: pendienteReal, metodo: 'efectivo', referencia: '', comprobante: '' }); setArchivo(null); setPagoAbierto(true); };
  const registrarPago = async () => {
    const r = await api.post<any>(`/ventas/${id}/pagos`, { ...pago, referencia: pago.referencia || undefined, comprobante: pago.comprobante || undefined });
    if (archivo) { const nuevo = r.pagos[r.pagos.length - 1]; await api.subir(`/pagos/${nuevo.id}/comprobante`, archivo); }
    setPagoAbierto(false); await cargar();
  };
  const crearEnlace = async () => { await api.post(`/ventas/${id}/enlace-pago`, { proveedor }); setEnlaceAbierto(false); await cargar(); };
  const comisionTotal = v.comisiones.filter((c: any) => c.estado !== 'revertida').reduce((s: number, c: any) => s + c.monto, 0);
  const licencias = v.es_renovacion && v.licencia_renovada ? [v.licencia_renovada] : v.licencias;
  const activas = licencias.filter((l: any) => l.estado === 'activa');
  const enlaceVigente = v.enlaces_pago?.find((e: any) => e.estado === 'pendiente');
  const agencia = v.marca_nombre || ajustes.nombre_agencia || 'la agencia';
  const mensajeClaves = plantilla(ajustes.plantilla_wa_claves || 'Hola {cliente}, gracias por tu compra de {producto}. {claves_intro}:\n\n{claves}', {
    cliente: v.cliente_nombre, producto: v.producto_nombre, agencia, claves_intro: activas.length > 1 ? 'Estas son tus claves de licencia' : 'Esta es tu clave de licencia',
    claves: activas.map((l: any) => `${l.etiqueta ? `${l.etiqueta}: ` : ''}${l.clave}`).join('\n'),
  });
  const mensajeCobro = plantilla(ajustes.plantilla_wa_cobro || 'Hola {cliente}, te recuerdo el saldo pendiente de {monto} por {producto} (venta {venta}). {enlace}', {
    cliente: v.cliente_nombre, monto: dinero(pendienteReal, v.moneda), producto: v.producto_nombre, venta: v.numero, agencia, enlace: enlaceVigente ? `Puedes pagar aquí: ${enlaceVigente.url}` : '',
  });
  const distintaMoneda = v.moneda !== v.moneda_base;
  const proveedoresActivos = Object.entries(pasarelas).filter(([, on]) => on).map(([k]) => k);

  return (
    <>
      <header>
        <div><h1>Venta {v.numero} <Estado valor={v.estado} /></h1><p>{fecha(v.creado_en, true)} · vendedor {v.vendedor_nombre}{v.vendedor_rol === 'revendedor' && <> · <Estado valor="revendedor" /> {v.marca_nombre}</>}</p></div>
        <div className="fila">
          <BotonAccion texto="Recibo PDF" className="btn secundario" onClick={() => api.abrir(`/ventas/${id}/recibo.pdf`)} />
          {v.estado === 'pagada' && activas.length > 0 && <BotonWhatsApp telefono={v.cliente_telefono} texto={mensajeClaves} etiqueta="Enviar claves por WhatsApp" className="btn secundario" />}
          {v.estado === 'pendiente' && pendienteReal > 0 && <BotonWhatsApp telefono={v.cliente_telefono} texto={mensajeCobro} etiqueta="Recordar cobro" className="btn secundario" />}
          {v.estado === 'pendiente' && pendienteReal > 0 && proveedoresActivos.length > 0 && <button className="btn secundario" onClick={() => { setProveedor(proveedoresActivos[0]); setEnlaceAbierto(true); }}>Enlace de pago</button>}
          {v.estado === 'pendiente' && pendienteReal > 0 && <button className="btn" onClick={abrirPago}>+ Registrar cobro</button>}
          {esSuper && v.estado !== 'anulada' && <AccionConMotivo titulo="Anular venta" texto="Anular venta" className="btn peligro" onConfirmar={async (m) => { await api.post(`/ventas/${id}/anular`, { motivo: m }); await cargar(); }} exito="Venta anulada" descripcion="Se revocan sus licencias y se revierten las comisiones. Los pagos confirmados no se devuelven automáticamente." />}
        </div>
      </header>

      {v.estado === 'anulada' && <Aviso tipo="error">Anulada: {v.motivo_anulacion}. Licencias revocadas y comisiones revertidas.</Aviso>}
      {v.cuotas > 1 && (
        <Tarjeta titulo={`Pago en ${v.cuotas} cuotas`} className="no-imprimir">
          <div className="chips">
            {v.cuotas_detalle.map((c: any) => <span key={c.id} className={`chip ${c.estado === 'pagada' ? 'activo' : ''}`} style={c.estado === 'vencida' ? { borderColor: 'var(--mal)', color: 'var(--mal)' } : undefined}>Cuota {c.numero} · {dinero(c.monto, v.moneda)} · {c.estado === 'pagada' ? `pagada ${fecha(c.pagada_en)}` : c.estado === 'vencida' ? `vencida el ${fecha(c.vence_en)}` : `vence ${fecha(c.vence_en)}`}</span>)}
          </div>
          <p className="suave pequeno" style={{ margin: '8px 0 0' }}>La licencia se activó con la primera cuota. Si una cuota vence y pasa la gracia, el sistema del cliente se pausa solo hasta que pague.</p>
        </Tarjeta>
      )}
      {v.estado === 'pendiente' && v.por_confirmar > 0 && <Aviso tipo="alerta">Hay {dinero(v.por_confirmar, v.moneda)} registrados que esperan confirmación de un administrador. Las licencias se activan cuando el total esté confirmado.</Aviso>}
      {v.estado === 'pagada' && activas.length > 0 && v.licencias.every((l: any) => l.estado === 'activa') && <Aviso tipo="ok">Pago completo. Las licencias están activas: envíale las claves al cliente.</Aviso>}
      {enlaceVigente && (
        <Aviso tipo="info">
          Enlace de pago vigente ({enlaceVigente.proveedor}) por {dinero(enlaceVigente.monto, enlaceVigente.moneda)}: <a href={enlaceVigente.url} target="_blank" rel="noreferrer">{enlaceVigente.url}</a>
          <button className="btn secundario chico" style={{ marginLeft: 8 }} onClick={() => { copiar(enlaceVigente.url); avisar('Enlace copiado'); }}>Copiar</button>
          <span className="suave pequeno"> · Al pagarse, el cobro se confirma solo y se activan las licencias.</span>
        </Aviso>
      )}

      <div className="grid-2">
        <Tarjeta titulo="Detalle">
          <dl className="definiciones">
            <dt>Cliente</dt><dd><Link to={`/clientes/${v.cliente_id}`}>{v.cliente_nombre}</Link>{v.cliente_empresa && <span className="suave"> · {v.cliente_empresa}</span>}{v.cliente_telefono && <span className="suave"> · {v.cliente_telefono}</span>}</dd>
            <dt>Producto</dt><dd>{v.producto_nombre}</dd>
            <dt>Plan</dt><dd>{v.plan_nombre} <Estado valor={v.plan_tipo} />{v.es_renovacion ? ' · renovación' : ''}</dd>
            <dt>Cantidad</dt><dd>{v.cantidad} × {dinero(v.precio_unitario, v.moneda)}</dd>
            <dt>Descuento</dt><dd>{v.descuento_pct}%{v.vendedor_rol === 'revendedor' && <span className="suave pequeno"> (mayorista)</span>}</dd>
            <dt><strong>Total</strong></dt><dd><strong>{dinero(v.total, v.moneda)}</strong>{distintaMoneda && <span className="suave pequeno"> · equivale a {dinero(v.total_base, v.moneda_base)} (T.C. {v.tipo_cambio})</span>}</dd>
            <dt>Pagado</dt><dd>{dinero(v.pagado, v.moneda)} · saldo {dinero(v.saldo, v.moneda)}</dd>
            <dt>Comisión</dt><dd>{dinero(comisionTotal, v.moneda_base)} {v.comisiones.length > 0 && <span className="suave pequeno">({v.comisiones.map((c: any) => `${c.pct}% de ${dinero(c.base, v.moneda_base)}`).join(', ')})</span>}</dd>
            {v.notas && <><dt>Notas</dt><dd>{v.notas}</dd></>}
          </dl>
        </Tarjeta>

        <Tarjeta titulo="Cobros">
          <Tabla filas={v.pagos} clave={(p: any) => p.id} vacio="Sin cobros registrados" columnas={[
            { titulo: 'Fecha', celda: (p: any) => fecha(p.creado_en, true) },
            { titulo: 'Monto', celda: (p: any) => dinero(p.monto, v.moneda), alinear: 'derecha' },
            { titulo: 'Método', celda: (p: any) => <>{ETIQUETA_METODO[p.metodo]}{p.referencia && <span className="suave pequeno"> · {p.referencia}</span>}</> },
            { titulo: 'Comprobante', celda: (p: any) => p.comprobante_archivo ? <button className="btn-texto" style={{ fontSize: 13 }} onClick={() => api.abrir(`/pagos/${p.id}/comprobante`).catch((e) => avisar(e.message, 'error'))}>Ver archivo</button> : p.comprobante ? <a href={p.comprobante} target="_blank" rel="noreferrer" className="pequeno">enlace</a> : <label className="btn-texto pequeno" style={{ cursor: 'pointer' }}>Adjuntar<input type="file" accept="image/*,application/pdf" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await api.subir(`/pagos/${p.id}/comprobante`, f); avisar('Comprobante adjuntado'); await cargar(); } catch (err) { avisar(err instanceof Error ? err.message : 'Error', 'error'); } }} /></label> },
            { titulo: 'Estado', celda: (p: any) => <><Estado valor={p.estado} />{p.confirmado_por_nombre ? <span className="suave pequeno"> {p.confirmado_por_nombre}</span> : p.estado === 'confirmado' && p.enlace_pago_id ? <span className="suave pequeno"> automático</span> : null}{p.motivo_rechazo && <span className="suave pequeno"> · {p.motivo_rechazo}</span>}</> },
            { titulo: '', celda: (p: any) => (
              <div className="fila">
                {p.estado === 'confirmado' && <BotonAccion texto="PDF" className="btn secundario chico" onClick={() => api.abrir(`/pagos/${p.id}/recibo.pdf`)} />}
                {esGestor && p.estado === 'pendiente' && v.estado !== 'anulada' && <>
                  <BotonAccion texto="Confirmar" className="btn ok chico" exito="Pago confirmado" onClick={async () => { await api.post(`/pagos/${p.id}/confirmar`); await cargar(); }} />
                  <AccionConMotivo titulo="Rechazar cobro" texto="Rechazar" className="btn secundario chico" onConfirmar={async (m) => { await api.post(`/pagos/${p.id}/rechazar`, { motivo: m }); await cargar(); }} exito="Cobro rechazado" />
                </>}
              </div>
            ) },
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

        {v.enlaces_pago?.length > 0 && (
          <Tarjeta titulo="Enlaces de pago">
            <Tabla filas={v.enlaces_pago} clave={(e: any) => e.id} columnas={[
              { titulo: 'Creado', celda: (e: any) => fecha(e.creado_en, true) },
              { titulo: 'Pasarela', celda: (e: any) => e.proveedor },
              { titulo: 'Monto', celda: (e: any) => dinero(e.monto, e.moneda), alinear: 'derecha' },
              { titulo: 'Estado', celda: (e: any) => <Estado valor={e.estado} /> },
              { titulo: 'Enlace', celda: (e: any) => e.estado === 'pendiente' ? <a href={e.url} target="_blank" rel="noreferrer" className="pequeno">abrir</a> : '—' },
            ]} />
          </Tarjeta>
        )}
      </div>

      <Modal titulo="Registrar cobro" abierto={pagoAbierto} cerrar={() => setPagoAbierto(false)}>
        <Formulario onEnviar={registrarPago} textoBoton="Registrar" cancelar={() => setPagoAbierto(false)} exito="Cobro registrado; pendiente de confirmación">
          <Aviso tipo="info">Saldo pendiente: {dinero(pendienteReal, v.moneda)}. El cobro queda pendiente hasta que un administrador lo confirme.</Aviso>
          <Campo etiqueta={`Monto (${v.moneda})`}><input type="number" step="0.01" min={0.01} max={pendienteReal} value={pago.monto} onChange={(e) => setPago({ ...pago, monto: Number(e.target.value) })} required /></Campo>
          <Campo etiqueta="Método">
            <select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>
              {Object.entries(ETIQUETA_METODO).filter(([k]) => !['stripe', 'paypal'].includes(k)).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Referencia / n.º de operación"><input value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></Campo>
          <Campo etiqueta="Comprobante (foto o PDF, máx. 5 MB)"><input type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></Campo>
        </Formulario>
      </Modal>

      <Modal titulo="Crear enlace de pago" abierto={enlaceAbierto} cerrar={() => setEnlaceAbierto(false)}>
        <Formulario onEnviar={crearEnlace} textoBoton="Crear enlace" cancelar={() => setEnlaceAbierto(false)} exito="Enlace creado">
          <p className="suave">El cliente paga en línea por {dinero(pendienteReal, v.moneda)}. Al completarse, el cobro se confirma automáticamente y se activan las licencias.</p>
          <Campo etiqueta="Pasarela">
            <select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              {proveedoresActivos.map((p) => <option key={p} value={p}>{p === 'demo' ? 'Demostración (no cobra de verdad)' : p === 'stripe' ? 'Stripe (tarjeta)' : p === 'culqi' ? 'Culqi (Yape, tarjeta, PagoEfectivo)' : 'PayPal'}</option>)}
            </select>
          </Campo>
        </Formulario>
      </Modal>
    </>
  );
}
