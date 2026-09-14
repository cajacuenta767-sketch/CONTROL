import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, copiar, dinero, fecha, hoy, inicioMes, plantilla, recordar } from '../api';
import { useAvisar } from '../componentes/toast';
import { useSesion } from '../sesion';
import { useAjustes } from '../ajustes';
import { Aviso, BotonWhatsApp, Cargando, Estado, Indicador, Tabla, Tarjeta, Vacio } from '../componentes/ui';
import { TarjetasDescarga } from '../componentes/descargas';
import { usePwa } from '../pwa';

interface Resumen {
  hoy: string; mes: string;
  ventas: { hoy: { n: number; total: number }; mes: { n: number; total: number } };
  cobrado: { hoy: number; mes: number };
  comisiones: { pendiente: number; liquidada: number; mes: number };
  licencias: { por_estado: Record<string, number>; por_producto: { nombre: string; codigo: string; total: number; activas: number }[]; vencen_pronto: any[] };
  pagos_pendientes: any[]; ultimas_ventas: any[]; caja_hoy: string | null;
  equipo?: any[]; alertas?: Record<string, any>; ventas_por_dia?: { dia: string; total: number }[];
  moneda_base?: string; enlace_venta?: string | null; meta?: { objetivo: number; bono_pct: number; vendido: number; cumplida: boolean } | null;
  salud?: { conteo: Record<string, number>; en_riesgo: any[] };
}

export function Panel() {
  const { usuario, esGestor } = useSesion();
  const avisar = useAvisar();
  const ajustes = useAjustes();
  const [r, setR] = useState<Resumen | null>(null);
  const [guiaVista, setGuiaVista] = useState(() => recordar.leer('guia_vista') === '1');
  const [appsVistas, setAppsVistas] = useState(() => recordar.leer('apps_vistas') === '1');
  const pwa = usePwa();
  const nav = useNavigate();
  useEffect(() => { api.get<Resumen>('/reportes/resumen').then(setR); }, []);
  if (!r) return <Cargando />;

  const totalLic = Object.values(r.licencias.por_estado).reduce((s, n) => s + n, 0);
  const activas = (r.licencias.por_estado.activa || 0) + (r.licencias.por_estado.mora || 0);
  const alertas = r.alertas;
  const hayAlertas = alertas && (alertas.activaciones_rechazadas_24h || alertas.cierres_por_aprobar || alertas.pagos_por_confirmar || alertas.sin_cierre_hoy?.length || alertas.sobre_tope?.length || alertas.instalaciones_sin_latido_7d || alertas.instalaciones_desactualizadas);
  const serie = r.ventas_por_dia || [];
  const maxDia = Math.max(1, ...serie.map((d) => d.total));
  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <>
      <header>
        <div><h1>{saludo}, {usuario!.nombre.split(' ')[0]}</h1><p>{esGestor ? 'Resumen de toda la agencia' : 'Tu resumen'} · {fecha(r.hoy)}</p></div>
        <div className="fila">
          <Link to="/ventas/nueva" className="btn">+ Nueva venta</Link>
          {r.caja_hoy === null && !esGestor && <Link to="/caja" className="btn secundario">Cerrar caja de hoy</Link>}
        </div>
      </header>

      {!guiaVista && (
        <div className="banner-guia">
          <span><strong>{esGestor ? 'Bienvenido al panel.' : `Bienvenido, ${usuario!.nombre.split(' ')[0]}.`}</strong> En dos minutos entiendes cómo se vende, qué gana cada uno y qué puedes hacer con tu rol.</span>
          <span className="fila" style={{ gap: 8 }}><Link to="/guia" className="btn chico">Ver la guía</Link><Link to="/precios" className="btn secundario chico">Precios y simulador</Link><button className="btn-texto" aria-label="Ocultar" onClick={() => { recordar.guardar('guia_vista', '1'); setGuiaVista(true); }}>✕</button></span>
        </div>
      )}
      {!appsVistas && !pwa.instalada && (
        <Tarjeta titulo="Lleva CONTROL en tu celular y en tu PC" acciones={<button className="btn-texto" aria-label="Ocultar" onClick={() => { recordar.guardar('apps_vistas', '1'); setAppsVistas(true); }}>✕</button>}>
          <div className="panel-apps">
            <div>
              <p style={{ margin: '0 0 6px' }}>La misma cuenta, los mismos datos: vende en la calle desde Android, trabaja en Windows sin abrir el navegador. Instalas una vez y listo.</p>
              <p className="suave pequeno" style={{ margin: 0 }}>Al abrir la app te pedirá la dirección de este panel: <code className="clave">{window.location.origin}</code>. <Link to="/descargar">Guía completa</Link>.</p>
            </div>
            <TarjetasDescarga compacto />
          </div>
        </Tarjeta>
      )}
      {hayAlertas && (
        <Aviso tipo="alerta">
          <strong>Atención: </strong>
          {[
            alertas.pagos_por_confirmar ? <Link key="p" to="/ventas?estado=pendiente">{alertas.pagos_por_confirmar} pago(s) por confirmar</Link> : null,
            alertas.cierres_por_aprobar ? <Link key="c" to="/caja">{alertas.cierres_por_aprobar} cierre(s) de caja por aprobar</Link> : null,
            alertas.activaciones_rechazadas_24h ? <Link key="a" to="/auditoria?accion=activacion.rechazada">{alertas.activaciones_rechazadas_24h} activación(es) rechazada(s) en 24 h</Link> : null,
            alertas.sin_cierre_hoy?.length ? <span key="s">sin cerrar caja hoy: {alertas.sin_cierre_hoy.join(', ')}</span> : null,
            alertas.sobre_tope?.length ? <span key="t">superaron su tope de emisiones: {alertas.sobre_tope.join(', ')}</span> : null,
            alertas.instalaciones_sin_latido_7d ? <span key="l">{alertas.instalaciones_sin_latido_7d} instalación(es) sin latido en 7 días</span> : null,
            alertas.instalaciones_desactualizadas ? <Link key="d" to="/catalogo">{alertas.instalaciones_desactualizadas} instalación(es) desactualizada(s)</Link> : null,
          ].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}
        </Aviso>
      )}

      {(r.meta || r.enlace_venta) && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          {r.meta && (
            <Tarjeta titulo="Meta del mes" acciones={r.meta.cumplida ? <Estado valor="activa" /> : <span className="suave pequeno">bono +{r.meta.bono_pct}% al cumplirla</span>}>
              <div className="fila" style={{ justifyContent: 'space-between' }}><strong>{dinero(r.meta.vendido, r.moneda_base)}</strong><span className="suave">de {dinero(r.meta.objetivo, r.moneda_base)}</span></div>
              <div className={`barra-meta ${r.meta.cumplida ? '' : 'pendiente'}`}><div style={{ width: `${Math.min(100, (r.meta.vendido / Math.max(1, r.meta.objetivo)) * 100)}%` }} /></div>
              <p className="suave pequeno" style={{ margin: 0 }}>{r.meta.cumplida ? `Meta cumplida: tus cobros de este mes llevan ${r.meta.bono_pct}% extra de comisión.` : `Te faltan ${dinero(Math.max(0, r.meta.objetivo - r.meta.vendido), r.moneda_base)} en ventas pagadas.`}</p>
            </Tarjeta>
          )}
          {r.enlace_venta && (
            <Tarjeta titulo="Tu enlace de venta" acciones={<button className="btn secundario chico" onClick={() => { copiar(r.enlace_venta!); avisar('Enlace copiado'); }}>Copiar</button>}>
              <p className="suave pequeno" style={{ marginTop: 0 }}>Compártelo en WhatsApp o redes. Toda compra que entre por aquí queda atribuida a ti.</p>
              <code className="clave" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>{r.enlace_venta}</code>
            </Tarjeta>
          )}
        </div>
      )}

      <div className="indicadores">
        <Indicador etiqueta="Ventas hoy" valor={r.ventas.hoy.n} detalle={dinero(r.ventas.hoy.total)} onClick={() => nav(`/ventas?desde=${hoy()}`)} />
        <Indicador etiqueta="Ventas del mes" valor={r.ventas.mes.n} detalle={dinero(r.ventas.mes.total)} onClick={() => nav(`/ventas?desde=${inicioMes()}`)} />
        <Indicador etiqueta="Cobrado hoy" valor={dinero(r.cobrado.hoy)} detalle={`Mes: ${dinero(r.cobrado.mes)}`} tono="ok" onClick={() => nav('/caja')} />
        <Indicador etiqueta={esGestor ? 'Comisiones por liquidar' : 'Mi comisión pendiente'} valor={dinero(r.comisiones.pendiente)} detalle={`Este mes: ${dinero(r.comisiones.mes)}`} onClick={() => nav('/comisiones')} />
        <Indicador etiqueta="Licencias activas" valor={activas} detalle={`de ${totalLic} emitidas`} onClick={() => nav('/licencias?estado=activa')} />
        {!esGestor && <Indicador etiqueta="Caja de hoy" valor={r.caja_hoy ? <Estado valor={r.caja_hoy} /> : 'Abierta'} tono={r.caja_hoy ? 'ok' : 'alerta'} onClick={() => nav('/caja')} />}
      </div>

      <div className="grid-2">
        {r.ventas_por_dia && (
          <Tarjeta titulo="Cobros confirmados · últimos 30 días">
            {serie.length === 0 ? <Vacio icono="📈" titulo="Aún no hay cobros confirmados" texto="Aparecerán aquí cuando confirmes el primer pago." /> : (
              <div className="grafico">
                <div className="grafico-barras">
                  {serie.map((d) => <div key={d.dia} style={{ height: `${Math.max(3, (d.total / maxDia) * 100)}%` }} data-etiqueta={`${fecha(d.dia)}: ${dinero(d.total)}`} />)}
                </div>
                <div className="grafico-eje"><span>{fecha(serie[0].dia)}</span><span>{serie.length} día(s) con cobros · máx. {dinero(maxDia)}</span><span>{fecha(serie[serie.length - 1].dia)}</span></div>
              </div>
            )}
          </Tarjeta>
        )}

        <Tarjeta titulo="Licencias por estado" acciones={<Link to="/licencias">Ver todas</Link>}>
          {totalLic === 0 ? <Vacio icono="🔑" titulo="Todavía no hay licencias" texto="Se emiten automáticamente al registrar una venta." accion={<Link to="/ventas/nueva" className="btn chico">Registrar venta</Link>} /> : (
            <ul className="lista-simple">
              {Object.entries(r.licencias.por_estado).map(([e, n]) => <li key={e} className="clic" onClick={() => nav(`/licencias?estado=${e}`)} style={{ cursor: 'pointer' }}><Estado valor={e} /><strong>{n}</strong></li>)}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Licencias por producto">
          <Tabla filas={r.licencias.por_producto} clave={(p) => p.codigo} vacio="Sin licencias" columnas={[
            { titulo: 'Producto', celda: (p) => p.nombre, orden: (p) => p.nombre },
            { titulo: 'Activas', celda: (p) => p.activas, alinear: 'derecha', orden: (p) => p.activas },
            { titulo: 'Total', celda: (p) => p.total, alinear: 'derecha', orden: (p) => p.total },
          ]} />
        </Tarjeta>

        <Tarjeta titulo="Pagos por confirmar" acciones={r.pagos_pendientes.length > 0 && <Link to="/ventas?estado=pendiente">Ver ventas</Link>}>
          <Tabla filas={r.pagos_pendientes} clave={(p) => p.id} vacio="Nada pendiente de confirmar" onFila={(p) => nav(`/ventas/${p.venta_id}`)} columnas={[
            { titulo: 'Venta', celda: (p) => p.venta_numero },
            { titulo: 'Cliente', celda: (p) => p.cliente_nombre },
            { titulo: 'Monto', celda: (p) => dinero(p.monto), alinear: 'derecha' },
            { titulo: 'Registró', celda: (p) => p.registrado_por_nombre },
          ]} />
        </Tarjeta>

        {r.salud && (
          <Tarjeta titulo="Clientes en riesgo" acciones={<span className="chips"><span className="chip" style={{ color: 'var(--ok)' }}>● {r.salud.conteo.verde || 0}</span><span className="chip" style={{ color: 'var(--aviso)' }}>● {r.salud.conteo.ambar || 0}</span><span className="chip" style={{ color: 'var(--mal)' }}>● {r.salud.conteo.rojo || 0}</span></span>}>
            <Tabla filas={r.salud.en_riesgo} clave={(c) => c.id} vacio="Ningún cliente en riesgo. Bien." onFila={(c) => nav(`/clientes/${c.id}`)} columnas={[
              { titulo: 'Cliente', celda: (c) => <><span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', marginRight: 6, background: c.semaforo === 'rojo' ? 'var(--mal)' : 'var(--aviso)' }} />{c.nombre}</> },
              { titulo: 'Por qué', celda: (c) => <span className="pequeno">{c.factores.join(' · ')}</span> },
              { titulo: '', celda: (c) => <BotonWhatsApp telefono={c.telefono} texto={`Hola ${c.nombre}, te escribo de ${ajustes.nombre_agencia || 'la agencia'} para ver cómo va el sistema y ayudarte con lo que necesites.`} etiqueta="Llamar" /> },
            ]} />
          </Tarjeta>
        )}

        <Tarjeta titulo="Vencen en 30 días" acciones={<Link to="/renovaciones">Campaña de renovación</Link>}>
          <Tabla filas={r.licencias.vencen_pronto} clave={(l) => l.id} vacio="Nada por vencer en los próximos 30 días" onFila={(l) => nav(`/licencias/${l.id}`)} columnas={[
            { titulo: 'Cliente', celda: (l) => l.cliente_nombre },
            { titulo: 'Producto', celda: (l) => `${l.producto_nombre}${l.etiqueta ? ` · ${l.etiqueta}` : ''}` },
            { titulo: 'Vence', celda: (l) => fecha(l.vence_en), orden: (l) => l.vence_en },
            { titulo: '', celda: (l) => <BotonWhatsApp telefono={l.cliente_telefono} texto={plantilla(ajustes.plantilla_wa_renovacion || 'Hola {cliente}, tu licencia de {producto} vence el {vence}. ¿Coordinamos la renovación?', { cliente: l.cliente_nombre, producto: l.producto_nombre, vence: fecha(l.vence_en), agencia: ajustes.nombre_agencia || 'la agencia', enlace: '' })} /> },
          ]} />
        </Tarjeta>

        {r.equipo && (
          <Tarjeta titulo="Equipo este mes" acciones={<Link to="/equipo">Ver equipo</Link>}>
            <Tabla filas={r.equipo} clave={(u) => u.id} columnas={[
              { titulo: 'Nombre', celda: (u) => <>{u.nombre} <Estado valor={u.rol} /></>, orden: (u) => u.nombre },
              { titulo: 'Ventas', celda: (u) => u.ventas_mes, alinear: 'derecha', orden: (u) => u.ventas_mes },
              { titulo: 'Vendido', celda: (u) => dinero(u.vendido_mes), alinear: 'derecha', orden: (u) => u.vendido_mes },
              { titulo: 'Comisión pend.', celda: (u) => dinero(u.comision_pendiente), alinear: 'derecha', orden: (u) => u.comision_pendiente },
              { titulo: 'Hoy / tope', celda: (u) => u.rol === 'superadmin' ? '—' : `${u.emitidas_hoy} / ${u.tope_emisiones_dia}`, alinear: 'derecha' },
              { titulo: 'Demos 7d', celda: (u) => u.demos_semana, alinear: 'derecha' },
            ]} />
          </Tarjeta>
        )}

        <Tarjeta titulo="Últimas ventas" acciones={<Link to="/ventas">Ver todas</Link>}>
          <Tabla filas={r.ultimas_ventas} clave={(v) => v.id} vacio="Sin ventas todavía" onFila={(v) => nav(`/ventas/${v.id}`)} columnas={[
            { titulo: 'N.º', celda: (v) => v.numero },
            { titulo: 'Cliente', celda: (v) => v.cliente_nombre },
            { titulo: 'Producto', celda: (v) => <>{v.producto_nombre} <span className="suave pequeno">{v.plan_tipo}</span></> },
            { titulo: 'Total', celda: (v) => dinero(v.total), alinear: 'derecha' },
            { titulo: 'Estado', celda: (v) => <Estado valor={v.estado} /> },
          ]} />
        </Tarjeta>
      </div>
    </>
  );
}
