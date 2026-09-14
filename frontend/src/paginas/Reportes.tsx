import { useEffect, useMemo, useState } from 'react';
import { api, dinero, descargarCsv } from '../api';
import { useSesion } from '../sesion';
import { Cargando, Tabla, Tarjeta, Vacio } from '../componentes/ui';

interface Series { meses: string[]; moneda_base: string; por_producto: Punto[]; por_vendedor: Punto[]; licencias_nuevas: { mes: string; total: number }[] }
interface Punto { mes: string; serie: string; total: number }

const COLORES = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569', '#0d9488'];
const MES = (m: string) => new Date(`${m}-15T00:00:00`).toLocaleDateString('es', { month: 'short', year: '2-digit' });

/** Barras apiladas por mes (SVG puro, sin librerías). */
function BarrasApiladas({ meses, puntos, moneda, formato, compacto }: { meses: string[]; puntos: Punto[]; moneda?: string; formato?: (n: number) => string; compacto?: boolean }) {
  const series = useMemo(() => Array.from(new Set(puntos.map((p) => p.serie))), [puntos]);
  const porMes = useMemo(() => meses.map((m) => ({ mes: m, valores: series.map((s) => puntos.filter((p) => p.mes === m && p.serie === s).reduce((a, p) => a + p.total, 0)) })), [meses, puntos, series]);
  const max = Math.max(1, ...porMes.map((m) => m.valores.reduce((a, b) => a + b, 0)));
  const fmt = formato || ((n: number) => dinero(n, moneda));
  if (!puntos.length) return <Vacio icono="📊" titulo="Sin datos en este periodo" />;
  const W = compacto ? 420 : 720, H = compacto ? 180 : 220, izq = compacto ? 40 : 56, abajo = 26, arriba = 12;
  const anchoMes = (W - izq) / meses.length;
  const barra = Math.min(48, anchoMes * 0.6);
  const escala = (v: number) => ((H - abajo - arriba) * v) / max;
  const lineas = [0, 0.25, 0.5, 0.75, 1];
  return (
    <>
      <svg className="grafico-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras por mes">
        {lineas.filter((l, i) => i === 0 || fmt(max * l) !== fmt(max * lineas[i - 1])).map((l) => (
          <g key={l}>
            <line x1={izq} x2={W} y1={H - abajo - escala(max * l)} y2={H - abajo - escala(max * l)} stroke="currentColor" opacity=".12" />
            <text x={izq - 6} y={H - abajo - escala(max * l) + 3} textAnchor="end">{fmt(max * l).replace(/,00\b/, '')}</text>
          </g>
        ))}
        {porMes.map((m, i) => {
          let y = H - abajo;
          const x = izq + i * anchoMes + (anchoMes - barra) / 2;
          const totalMes = m.valores.reduce((a, b) => a + b, 0);
          return (
            <g key={m.mes}>
              {m.valores.map((v, j) => { const h = escala(v); y -= h; return v > 0 ? <rect key={j} x={x} y={y} width={barra} height={h} fill={COLORES[j % COLORES.length]} rx="2"><title>{`${MES(m.mes)} · ${series[j]}: ${fmt(v)}`}</title></rect> : null; })}
              {totalMes > 0 && <text x={x + barra / 2} y={y - 4} textAnchor="middle" style={{ fontWeight: 600 }}>{fmt(totalMes).replace(/,00\b/, '')}</text>}
              <text x={x + barra / 2} y={H - 8} textAnchor="middle">{MES(m.mes)}</text>
            </g>
          );
        })}
      </svg>
      <div className="leyenda">{series.map((s, j) => <span key={s}><i style={{ background: COLORES[j % COLORES.length] }} />{s}</span>)}</div>
    </>
  );
}

export function Reportes() {
  const { esGestor } = useSesion();
  const [meses, setMeses] = useState(6);
  const [s, setS] = useState<Series | null>(null);
  useEffect(() => { setS(null); api.get<Series>('/reportes/series', { meses }).then(setS); }, [meses]);

  const tabla = useMemo(() => {
    if (!s) return [];
    return s.meses.map((m) => {
      const cobrado = s.por_producto.filter((p) => p.mes === m).reduce((a, p) => a + p.total, 0);
      const lic = s.licencias_nuevas.find((l) => l.mes === m)?.total || 0;
      const mejor = s.por_producto.filter((p) => p.mes === m).sort((a, b) => b.total - a.total)[0];
      return { mes: m, cobrado, licencias: lic, mejor_producto: mejor?.serie || '—' };
    });
  }, [s]);
  const totalPeriodo = tabla.reduce((a, t) => a + t.cobrado, 0);

  return (
    <>
      <header>
        <div><h1>Reportes</h1><p>Cobros confirmados por mes en moneda base{s ? ` (${s.moneda_base})` : ''} · {esGestor ? 'toda la agencia' : 'tus ventas'}</p></div>
        <div className="fila">
          <div className="chips">{[3, 6, 12, 24].map((n) => <button key={n} className={`chip ${meses === n ? 'activo' : ''}`} onClick={() => setMeses(n)}>{n} meses</button>)}</div>
          <button className="btn secundario chico" disabled={!tabla.length} onClick={() => descargarCsv('reporte-mensual', tabla)}>⇩ CSV</button>
        </div>
      </header>
      {!s ? <Cargando /> : (
        <>
          <div className="indicadores">
            <div className="indicador"><span className="indicador-etiqueta">Cobrado en el periodo</span><strong className="indicador-valor">{dinero(totalPeriodo, s.moneda_base)}</strong></div>
            <div className="indicador"><span className="indicador-etiqueta">Promedio mensual</span><strong className="indicador-valor">{dinero(totalPeriodo / Math.max(1, s.meses.length), s.moneda_base)}</strong></div>
            <div className="indicador"><span className="indicador-etiqueta">Licencias activadas</span><strong className="indicador-valor">{s.licencias_nuevas.reduce((a, l) => a + l.total, 0)}</strong></div>
            <div className="indicador"><span className="indicador-etiqueta">Mejor mes</span><strong className="indicador-valor">{tabla.length ? MES([...tabla].sort((a, b) => b.cobrado - a.cobrado)[0].mes) : '—'}</strong></div>
          </div>
          <Tarjeta titulo="Cobros por producto"><BarrasApiladas meses={s.meses} puntos={s.por_producto} moneda={s.moneda_base} /></Tarjeta>
          {esGestor && <Tarjeta titulo="Cobros por vendedor"><BarrasApiladas meses={s.meses} puntos={s.por_vendedor} moneda={s.moneda_base} /></Tarjeta>}
          <div className="grid-2">
            <Tarjeta titulo="Licencias activadas por mes">
              <BarrasApiladas meses={s.meses} puntos={s.licencias_nuevas.map((l) => ({ mes: l.mes, serie: 'Licencias', total: l.total }))} formato={(n) => String(Math.round(n))} compacto />
            </Tarjeta>
            <Tarjeta titulo="Resumen mensual">
              <Tabla filas={tabla} clave={(t) => t.mes} titulo="Resumen mensual" columnas={[
                { titulo: 'Mes', celda: (t) => MES(t.mes) },
                { titulo: 'Cobrado', celda: (t) => dinero(t.cobrado, s.moneda_base), alinear: 'derecha', orden: (t) => t.cobrado },
                { titulo: 'Licencias', celda: (t) => t.licencias, alinear: 'derecha', orden: (t) => t.licencias },
                { titulo: 'Producto líder', celda: (t) => t.mejor_producto },
              ]} />
            </Tarjeta>
          </div>
        </>
      )}
    </>
  );
}
