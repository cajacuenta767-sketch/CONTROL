import { useEffect, useState } from 'react';
import { api, dinero, fecha, ETIQUETA_ESTADO } from '../api';
import { Cargando } from '../componentes/ui';

/** Tablero del equipo: ranking del mes en pantalla grande. Se actualiza solo cada minuto. */
export function Tablero() {
  const [t, setT] = useState<any | null>(null);
  const [pantalla, setPantalla] = useState(false);
  useEffect(() => {
    const cargar = () => api.get<any>('/reportes/tablero').then(setT).catch(() => null);
    cargar(); const id = setInterval(cargar, 60000); return () => clearInterval(id);
  }, []);
  if (!t) return <Cargando />;
  const max = Math.max(1, ...t.equipo.map((u: any) => u.cobrado_mes));
  const medallas = ['🥇', '🥈', '🥉'];
  return (
    <div className={pantalla ? 'tablero-pantalla' : ''}>
      <header>
        <div><h1>Tablero del equipo · {new Date(`${t.mes}-15`).toLocaleDateString('es', { month: 'long', year: 'numeric' })}</h1><p>Día {t.dia_del_mes} de {t.dias_mes} · cobrado {dinero(t.totales.cobrado_mes, t.moneda_base)} · {t.totales.ventas_mes} venta(s) · {t.totales.ventas_hoy} hoy</p></div>
        <button className="btn secundario chico no-imprimir" onClick={() => setPantalla(!pantalla)}>{pantalla ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>
      </header>
      <div className="ranking">
        {t.equipo.map((u: any) => (
          <div key={u.id} className={`ranking-fila ${u.puesto <= 3 ? 'podio' : ''}`}>
            <div className="ranking-puesto">{medallas[u.puesto - 1] || u.puesto}</div>
            <div className="ranking-nombre"><strong>{u.nombre}</strong><div className="suave pequeno">{u.ventas_mes} venta(s) · {u.licencias_mes} licencia(s) · {u.demos_mes} demo(s) · {u.prospectos_abiertos} prospecto(s)</div>
              <div className="barra-meta"><div style={{ width: `${(u.cobrado_mes / max) * 100}%` }} /></div>
              {u.meta && <div className="suave pequeno">meta {dinero(u.meta, t.moneda_base)} · {Math.min(100, Math.round((u.cobrado_mes / u.meta) * 100))}%</div>}
            </div>
            <div className="ranking-monto">{dinero(u.cobrado_mes, t.moneda_base)}{u.ventas_hoy > 0 && <div className="estado ok" style={{ marginTop: 4 }}>+{u.ventas_hoy} hoy</div>}</div>
          </div>
        ))}
        {t.equipo.length === 0 && <p className="suave">Todavía no hay ventas este mes. La primera abre el ranking.</p>}
      </div>
      {t.ultimas_ventas.length > 0 && (
        <div className="ticker">
          {t.ultimas_ventas.map((v: any) => <span key={v.numero} className="chip">{v.vendedor} vendió {v.producto} ({ETIQUETA_ESTADO[v.plan_tipo] || v.plan_tipo}) a {v.cliente} · {dinero(v.total_base, t.moneda_base)} · {fecha(v.creado_en)}</span>)}
        </div>
      )}
    </div>
  );
}
