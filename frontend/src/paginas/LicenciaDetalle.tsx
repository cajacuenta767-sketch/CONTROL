import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, copiar, fecha, plantilla } from '../api';
import { useAjustes } from '../ajustes';
import { useSesion } from '../sesion';
import { AccionConMotivo, Aviso, BotonAccion, BotonWhatsApp, Campo, Cargando, Clave, Estado, Modal, Tabla, Tarjeta } from '../componentes/ui';
import { useAvisar } from '../componentes/toast';

export function LicenciaDetalle() {
  const { id } = useParams();
  const { esSuper } = useSesion();
  const ajustes = useAjustes();
  const [l, setL] = useState<any | null>(null);
  const [etiqueta, setEtiqueta] = useState('');
  const [max, setMax] = useState(1);
  const [clientes, setClientes] = useState<any[]>([]);
  const [clienteDestino, setClienteDestino] = useState('');
  const [emergencia, setEmergencia] = useState<any | null>(null);
  const [huellaEmergencia, setHuellaEmergencia] = useState('');
  const avisar = useAvisar();
  const cargar = useCallback(() => api.get<any>(`/licencias/${id}`).then((x) => { setL(x); setEtiqueta(x.etiqueta || ''); setMax(x.max_activaciones); }), [id]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (esSuper) api.get<any[]>('/clientes').then(setClientes); }, [esSuper]);
  if (!l) return <Cargando />;

  const accion = (ruta: string, extra: object = {}) => async (motivo: string) => { await api.post(`/licencias/${id}/${ruta}`, { motivo, ...extra }); await cargar(); };
  const renovable = ['activa', 'mora', 'suspendida', 'vencida'].includes(l.estado) && l.plan_tipo !== 'demo';
  const mensajeClave = plantilla(ajustes.plantilla_wa_claves || 'Hola {cliente}, {claves_intro}:\n\n{claves}', { cliente: l.cliente_nombre, producto: l.producto_nombre, agencia: ajustes.nombre_agencia || '', claves_intro: 'Esta es tu clave de licencia', claves: `${l.etiqueta ? `${l.etiqueta}: ` : ''}${l.clave}` });

  return (
    <>
      <header>
        <div><h1><Clave valor={l.clave} /> <Estado valor={l.estado} /></h1><p>{l.producto_nombre} · {l.plan_nombre} · {l.cliente_nombre}{l.etiqueta ? ` · ${l.etiqueta}` : ''}</p></div>
        <div className="fila">
          {['activa', 'mora'].includes(l.estado) && <BotonWhatsApp telefono={l.cliente_telefono} texto={mensajeClave} etiqueta="Enviar clave por WhatsApp" className="btn secundario" />}
          {renovable && <Link to={`/ventas/nueva?cliente_id=${l.cliente_id}&renueva=${l.id}`} className="btn">Renovar / mantenimiento</Link>}
          {l.estado !== 'revocada' && (
            <AccionConMotivo titulo="Código de emergencia (72 h)" texto="Código de emergencia" className="btn secundario" etiquetaMotivo="Motivo (queda auditado)" exito="Código generado"
              descripcion="Genera un código firmado que el sistema del cliente acepta sin internet durante 72 horas, solo para el equipo elegido. Úsalo si CONTROL no está disponible, el cliente no tiene red o mientras regulariza un pago."
              extra={<Campo etiqueta="Equipo (huella)"><select value={l.activaciones.some((a: any) => a.huella === huellaEmergencia) ? huellaEmergencia : ''} onChange={(e) => setHuellaEmergencia(e.target.value)}><option value="">Elegir…</option>{l.activaciones.map((a: any) => <option key={a.id} value={a.huella}>{a.nombre_equipo || a.dominio || a.huella}{a.activa ? '' : ' (liberado)'}</option>)}</select><small className="suave">¿Equipo nuevo sin activar? Pega la huella que muestra la pantalla "Licencia" del producto.</small><input placeholder="…o escribe la huella a mano" value={huellaEmergencia} onChange={(e) => setHuellaEmergencia(e.target.value)} style={{ marginTop: 6 }} /></Campo>}
              onConfirmar={async (motivo) => { if (!huellaEmergencia.trim()) throw new Error('Elige o escribe la huella del equipo'); const r = await api.post<any>(`/licencias/${id}/emergencia`, { huella: huellaEmergencia.trim(), motivo }); setEmergencia(r); await cargar(); }} />
          )}
          {esSuper && l.estado !== 'revocada' && (
            <>
              {l.estado === 'suspendida' ? <AccionConMotivo titulo="Reanudar licencia" texto="Reanudar" className="btn ok" onConfirmar={accion('reanudar')} exito="Licencia reanudada" />
                : l.estado !== 'pendiente_pago' && <AccionConMotivo titulo="Suspender licencia" texto="Suspender" onConfirmar={accion('suspender')} exito="Licencia suspendida" descripcion="El sistema del cliente se bloqueará en su próxima verificación. Los datos no se tocan." />}
              <AccionConMotivo titulo="Resetear activaciones" texto="Resetear equipos" onConfirmar={accion('reset')} etiquetaMotivo="Motivo (p. ej. cambio de PC)" exito="Equipos liberados" descripcion="Libera todos los equipos vinculados. El cliente podrá activar de nuevo en uno nuevo." />
              <AccionConMotivo titulo="Revocar licencia" texto="Revocar" className="btn peligro" onConfirmar={accion('revocar')} exito="Licencia revocada" descripcion="Irreversible: la licencia queda inutilizable y no se puede renovar." />
            </>
          )}
        </div>
      </header>

      {l.motivo_estado && l.estado !== 'activa' && <Aviso tipo={l.estado === 'mora' ? 'alerta' : 'error'}>{l.motivo_estado}</Aviso>}
      {l.estado === 'pendiente_pago' && <Aviso tipo="alerta">Se activará automáticamente cuando se confirme el pago de la <Link to={`/ventas/${l.venta_id}`}>venta {l.venta_numero}</Link>.</Aviso>}
      {l.estado === 'activa' && l.activaciones_usadas === 0 && <Aviso tipo="info">Activa pero todavía no instalada en ningún equipo. Envíale la clave al cliente.</Aviso>}
      {l.activaciones.some((a: any) => a.activa && a.desactualizada) && <Aviso tipo="alerta">Instalación desactualizada: el producto va por la versión <strong>{l.producto_version_actual}</strong>. Coordina la actualización con el cliente.</Aviso>}

      <div className="grid-2">
        <Tarjeta titulo="Datos">
          <dl className="definiciones">
            <dt>Cliente</dt><dd><Link to={`/clientes/${l.cliente_id}`}>{l.cliente_nombre}</Link>{l.cliente_empresa && ` · ${l.cliente_empresa}`}</dd>
            <dt>Producto</dt><dd>{l.producto_nombre} <code className="clave">{l.producto_codigo}</code></dd>
            <dt>Plan</dt><dd>{l.plan_nombre} <Estado valor={l.plan_tipo} /></dd>
            <dt>Venta</dt><dd>{l.venta_id ? <Link to={`/ventas/${l.venta_id}`}>{l.venta_numero}</Link> : '—'}</dd>
            <dt>Vendedor</dt><dd>{l.vendedor_nombre || '—'}</dd>
            <dt>Emitida por</dt><dd>{l.emitida_por_nombre} · {fecha(l.creado_en, true)}</dd>
            <dt>Activa desde</dt><dd>{fecha(l.activa_desde)}</dd>
            <dt>Vence</dt><dd>{l.vence_en ? fecha(l.vence_en) : l.activa_desde ? 'Nunca (vitalicia)' : '—'}</dd>
            <dt>Soporte hasta</dt><dd>{fecha(l.soporte_hasta)}</dd>
            <dt>Equipos</dt><dd>{l.activaciones_usadas} de {l.max_activaciones}</dd>
          </dl>
          <div className="fila" style={{ marginTop: 12 }}>
            <input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Etiqueta (p. ej. Sede Centro)" style={{ maxWidth: 260 }} />
            <BotonAccion texto="Guardar etiqueta" className="btn secundario chico" exito="Etiqueta guardada" onClick={async () => { await api.patch(`/licencias/${id}/etiqueta`, { etiqueta: etiqueta || null }); await cargar(); }} />
          </div>
          {esSuper && (
            <div className="fila" style={{ marginTop: 12 }}>
              <AccionConMotivo titulo="Cambiar máximo de equipos" texto="Cambiar máximo de equipos" className="btn secundario chico" onConfirmar={accion('max-activaciones', { max })} exito="Máximo actualizado"
                extra={<Campo etiqueta="Máximo de equipos"><input type="number" min={1} max={100} value={max} onChange={(e) => setMax(Number(e.target.value))} /></Campo>} />
              <AccionConMotivo titulo="Transferir a otro cliente" texto="Transferir" className="btn secundario chico" onConfirmar={accion('transferir', { cliente_id: Number(clienteDestino) })} exito="Licencia transferida"
                extra={<Campo etiqueta="Cliente destino"><select value={clienteDestino} onChange={(e) => setClienteDestino(e.target.value)} required><option value="">Elegir…</option>{clientes.filter((c) => c.id !== l.cliente_id).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}</option>)}</select></Campo>} />
            </div>
          )}
        </Tarjeta>

        <Tarjeta titulo="Activaciones (equipos)">
          <Tabla filas={l.activaciones} clave={(a: any) => a.id} vacio="Todavía no se activó en ningún equipo" columnas={[
            { titulo: 'Equipo', celda: (a: any) => <>{a.nombre_equipo || a.dominio || '—'}<br /><code className="clave">{a.huella}</code></> },
            { titulo: 'Versión', celda: (a: any) => <>{a.version || '—'}{a.desactualizada && <span className="estado aviso" style={{ marginLeft: 6 }} title={`Versión actual: ${l.producto_version_actual}`}>desactualizada</span>}</> },
            { titulo: 'Activada', celda: (a: any) => fecha(a.activada_en, true) },
            { titulo: 'Último latido', celda: (a: any) => fecha(a.ultimo_latido, true) },
            { titulo: 'IP', celda: (a: any) => a.ip || '—' },
            { titulo: '', celda: (a: any) => a.activa ? <Estado valor="activa" /> : <span className="suave pequeno">liberada</span> },
          ]} />
        </Tarjeta>

        {l.codigos_emergencia?.length > 0 && (
          <Tarjeta titulo="Códigos de emergencia emitidos">
            <Tabla filas={l.codigos_emergencia} clave={(c: any) => c.id} titulo="Códigos de emergencia" columnas={[
              { titulo: 'Equipo', celda: (c: any) => <code className="clave">{c.huella}</code> },
              { titulo: 'Motivo', celda: (c: any) => c.motivo || '—' },
              { titulo: 'Emitido', celda: (c: any) => <>{fecha(c.creado_en, true)}<div className="suave pequeno">{c.creado_por_nombre}</div></> },
              { titulo: 'Válido hasta', celda: (c: any) => <>{fecha(c.expira_en, true)} {Date.parse(c.expira_en) > Date.now() ? <Estado valor="activa" /> : <span className="suave pequeno">vencido</span>}</> },
            ]} />
          </Tarjeta>
        )}

        <Tarjeta titulo="Historial">
          <ul className="lista-simple">
            {l.historial.length === 0 && <li className="suave">Sin eventos.</li>}
            {l.historial.map((h: any) => (
              <li key={h.id}>
                <span><strong>{h.accion}</strong> {h.usuario_nombre ? `· ${h.usuario_nombre}` : h.ip ? `· ${h.ip}` : ''}{h.detalle?.motivo && <span className="suave"> · {h.detalle.motivo}</span>}</span>
                <span className="suave pequeno">{fecha(h.creado_en, true)}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </div>

      <Modal titulo="Código de emergencia generado" abierto={!!emergencia} cerrar={() => setEmergencia(null)}>
        {emergencia && (
          <>
            <p className="suave" style={{ marginTop: 0 }}>Válido hasta <strong>{fecha(emergencia.expira_en, true)}</strong> solo para el equipo <code className="clave">{emergencia.huella}</code>. El cliente lo pega en la pantalla "Licencia" de su sistema.</p>
            <textarea readOnly rows={5} value={emergencia.codigo} onFocus={(e) => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            <div className="fila" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => { copiar(emergencia.codigo); avisar('Código copiado'); }}>Copiar código</button>
              <BotonWhatsApp telefono={l.cliente_telefono} etiqueta="Enviar por WhatsApp" texto={`Hola ${l.cliente_nombre}, este es tu código de emergencia de ${l.producto_nombre} (válido ${emergencia.horas} h). Pégalo en la pantalla Licencia del sistema:\n\n${emergencia.codigo}`} />
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
