import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, dinero, fecha } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Cargando, Estado, Indicador, Tabla, Tarjeta } from '../componentes/ui';

interface Resumen {
  hoy: string; mes: string;
  ventas: { hoy: { n: number; total: number }; mes: { n: number; total: number } };
  cobrado: { hoy: number; mes: number };
  comisiones: { pendiente: number; liquidada: number; mes: number };
  licencias: { por_estado: Record<string, number>; por_producto: { nombre: string; codigo: string; total: number; activas: number }[]; vencen_pronto: any[] };
  pagos_pendientes: any[]; ultimas_ventas: any[]; caja_hoy: string | null;
  equipo?: any[]; alertas?: Record<string, any>; ventas_por_dia?: { dia: string; total: number }[];
}

export function Panel() {
  const { usuario, esGestor } = useSesion();
  const [r, setR] = useState<Resumen | null>(null);
  const nav = useNavigate();
  useEffect(() => { api.get<Resumen>('/reportes/resumen').then(setR); }, []);
  if (!r) return <Cargando />;

  const totalLic = Object.values(r.licencias.por_estado).reduce((s, n) => s + n, 0);
  const activas = (r.licencias.por_estado.activa || 0) + (r.licencias.por_estado.mora || 0);
  const alertas = r.alertas;
  const hayAlertas = alertas && (alertas.activaciones_rechazadas_24h || alertas.cierres_por_aprobar || alertas.pagos_por_confirmar || alertas.sin_cierre_hoy?.length || alertas.sobre_tope?.length || alertas.instalaciones_sin_latido_7d);
  const maxDia = Math.max(1, ...(r.ventas_por_dia || []).map((d) => d.total));

  return (
    <>
      <header>
        <div><h1>Hola, {usuario!.nombre.split(' ')[0]}</h1><p>{esGestor ? 'Resumen de toda la agencia' : 'Tu resumen'} · {fecha(r.hoy)}</p></div>
        <div className="fila">
          <Link to="/ventas/nueva" className="btn">+ Nueva venta</Link>
          {r.caja_hoy === null && !esGestor && <Link to="/caja" className="btn secundario">Cerrar caja de hoy</Link>}
        </div>
      </header>

      {hayAlertas && (
        <Aviso tipo="alerta">
          <strong>Atención: </strong>
          {[
            alertas.pagos_por_confirmar ? `${alertas.pagos_por_confirmar} pago(s) por confirmar` : null,
            alertas.cierres_por_aprobar ? `${alertas.cierres_por_aprobar} cierre(s) de caja por aprobar` : null,
            alertas.activaciones_rechazadas_24h ? `${alertas.activaciones_rechazadas_24h} activación(es) rechazada(s) en 24 h` : null,
            alertas.sin_cierre_hoy?.length ? `sin cerrar caja hoy: ${alertas.sin_cierre_hoy.join(', ')}` : null,
            alertas.sobre_tope?.length ? `superaron su tope de emisiones: ${alertas.sobre_tope.join(', ')}` : null,
            alertas.instalaciones_sin_latido_7d ? `${alertas.instalaciones_sin_latido_7d} instalación(es) sin latido en 7 días` : null,
          ].filter(Boolean).join(' · ')}
        </Aviso>
      )}

      <div className="indicadores">
        <Indicador etiqueta="Ventas hoy" valor={r.ventas.hoy.n} detalle={dinero(r.ventas.hoy.total)} />
        <Indicador etiqueta="Ventas del mes" valor={r.ventas.mes.n} detalle={dinero(r.ventas.mes.total)} />
        <Indicador etiqueta="Cobrado hoy" valor={dinero(r.cobrado.hoy)} detalle={`Mes: ${dinero(r.cobrado.mes)}`} tono="ok" />
        <Indicador etiqueta={esGestor ? 'Comisiones por liquidar' : 'Mi comisión pendiente'} valor={dinero(r.comisiones.pendiente)} detalle={`Este mes: ${dinero(r.comisiones.mes)}`} />
        <Indicador etiqueta="Licencias activas" valor={activas} detalle={`de ${totalLic} emitidas`} />
        {!esGestor && <Indicador etiqueta="Caja de hoy" valor={r.caja_hoy ? <Estado valor={r.caja_hoy} /> : 'Abierta'} tono={r.caja_hoy ? 'ok' : 'alerta'} />}
      </div>

      <div className="grid-2">
        {r.ventas_por_dia && (
          <Tarjeta titulo="Cobros confirmados · últimos 30 días">
            {r.ventas_por_dia.length === 0 ? <p className="suave">Aún no hay cobros confirmados.</p> : (
              <div className="grafico-barras">
                {r.ventas_por_dia.map((d) => <div key={d.dia} style={{ height: `${(d.total / maxDia) * 100}%` }} data-etiqueta={`${fecha(d.dia)}: ${dinero(d.total)}`} />)}
              </div>
            )}
          </Tarjeta>
        )}

        <Tarjeta titulo="Licencias por estado">
          <ul className="lista-simple">
            {Object.entries(r.licencias.por_estado).map(([e, n]) => <li key={e}><Estado valor={e} /><strong>{n}</strong></li>)}
            {totalLic === 0 && <li className="suave">Todavía no hay licencias.</li>}
          </ul>
        </Tarjeta>

        <Tarjeta titulo="Licencias por producto">
          <Tabla filas={r.licencias.por_producto} clave={(p) => p.codigo} vacio="Sin licencias" columnas={[
            { titulo: 'Producto', celda: (p) => p.nombre },
            { titulo: 'Activas', celda: (p) => p.activas, alinear: 'derecha' },
            { titulo: 'Total', celda: (p) => p.total, alinear: 'derecha' },
          ]} />
        </Tarjeta>

        <Tarjeta titulo="Pagos por confirmar" acciones={r.pagos_pendientes.length > 0 && <Link to="/ventas?estado=pendiente">Ver ventas</Link>}>
          <Tabla filas={r.pagos_pendientes} clave={(p) => p.id} vacio="Nada pendiente" onFila={(p) => nav(`/ventas/${p.venta_id}`)} columnas={[
            { titulo: 'Venta', celda: (p) => p.venta_numero },
            { titulo: 'Cliente', celda: (p) => p.cliente_nombre },
            { titulo: 'Monto', celda: (p) => dinero(p.monto), alinear: 'derecha' },
            { titulo: 'Registró', celda: (p) => p.registrado_por_nombre },
          ]} />
        </Tarjeta>

        <Tarjeta titulo="Vencen en 30 días" acciones={<span className="suave pequeno">Oportunidad de renovación</span>}>
          <Tabla filas={r.licencias.vencen_pronto} clave={(l) => l.id} vacio="Nada por vencer" onFila={(l) => nav(`/licencias/${l.id}`)} columnas={[
            { titulo: 'Cliente', celda: (l) => l.cliente_nombre },
            { titulo: 'Producto', celda: (l) => `${l.producto_nombre}${l.etiqueta ? ` · ${l.etiqueta}` : ''}` },
            { titulo: 'Vence', celda: (l) => fecha(l.vence_en) },
            { titulo: '', celda: (l) => l.cliente_telefono ? <a href={`https://wa.me/${String(l.cliente_telefono).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>WhatsApp</a> : null },
          ]} />
        </Tarjeta>

        {r.equipo && (
          <Tarjeta titulo="Equipo este mes">
            <Tabla filas={r.equipo} clave={(u) => u.id} columnas={[
              { titulo: 'Nombre', celda: (u) => <>{u.nombre} <Estado valor={u.rol} /></> },
              { titulo: 'Ventas', celda: (u) => u.ventas_mes, alinear: 'derecha' },
              { titulo: 'Vendido', celda: (u) => dinero(u.vendido_mes), alinear: 'derecha' },
              { titulo: 'Comisión pend.', celda: (u) => dinero(u.comision_pendiente), alinear: 'derecha' },
              { titulo: 'Hoy / tope', celda: (u) => u.rol === 'superadmin' ? '—' : `${u.emitidas_hoy} / ${u.tope_emisiones_dia}`, alinear: 'derecha' },
              { titulo: 'Demos 7d', celda: (u) => u.demos_semana, alinear: 'derecha' },
            ]} />
          </Tarjeta>
        )}

        <Tarjeta titulo="Últimas ventas" acciones={<Link to="/ventas">Ver todas</Link>}>
          <Tabla filas={r.ultimas_ventas} clave={(v) => v.id} vacio="Sin ventas" onFila={(v) => nav(`/ventas/${v.id}`)} columnas={[
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
