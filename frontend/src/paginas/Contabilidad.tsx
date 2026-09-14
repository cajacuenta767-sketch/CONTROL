import { useEffect, useState } from 'react';
import { api, dinero, fecha, sesion } from '../api';
import { useAvisar } from '../componentes/toast';
import { AccionConMotivo, Aviso, BotonAccion, Estado, Tabla, Tarjeta } from '../componentes/ui';

const mesActual = () => new Date().toISOString().slice(0, 7);

/** Cierre contable del mes: resumen, descarga del Excel y comprobantes electrónicos. */
export function Contabilidad() {
  const avisar = useAvisar();
  const [mes, setMes] = useState(mesActual());
  const [resumen, setResumen] = useState<any[] | null>(null);
  const [comprobantes, setComprobantes] = useState<any[]>([]);
  const cargar = () => Promise.all([api.get<any>('/reportes/contable', { mes, formato: 'json' }), api.get<any[]>('/comprobantes', { mes })]).then(([r, c]) => { setResumen(r.resumen); setComprobantes(c); });
  useEffect(() => { setResumen(null); cargar(); }, [mes]);
  const descargar = async () => {
    const t = sesion.token();
    const r = await fetch(`/api/v1/reportes/contable?mes=${mes}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (!r.ok) { avisar('No se pudo generar el archivo', 'error'); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = `contabilidad-${mes}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  return (
    <>
      <header>
        <div><h1>Contabilidad</h1><p>Todo lo del mes en un Excel para el contador: ventas, cobros por método, comisiones, cierres de caja y comprobantes.</p></div>
        <div className="fila"><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} max={mesActual()} /><BotonAccion texto="Descargar Excel del mes" className="btn" onClick={descargar} /></div>
      </header>
      <div className="grid-2">
        <Tarjeta titulo={`Resumen ${mes}`}>
          {resumen ? <dl className="definiciones">{resumen.map((r) => <div key={r.Concepto} style={{ display: 'contents' }}><dt>{r.Concepto}</dt><dd>{typeof r.Valor === 'number' && !/registradas|confirmados|emitidos/.test(r.Concepto) ? dinero(r.Valor) : String(r.Valor)}</dd></div>)}</dl> : <p className="suave">Calculando…</p>}
          <p className="suave pequeno">El Excel trae una hoja por bloque. Los importes base están en la moneda base; los cobros también en la moneda del cliente.</p>
        </Tarjeta>
        <Tarjeta titulo="Comprobantes electrónicos del mes">
          {comprobantes.length === 0 && <Aviso tipo="info">Sin comprobantes este mes. Se emiten desde cada venta (Emitir boleta o factura) o solos al confirmar el cobro si activas la emisión automática en Ajustes › Facturación.</Aviso>}
          <Tabla filas={comprobantes} clave={(c) => c.id} vacio="" titulo="Comprobantes" columnas={[
            { titulo: 'Fecha', celda: (c) => fecha(c.creado_en) },
            { titulo: 'Comprobante', celda: (c) => <><strong>{c.serie}-{c.numero}</strong> <span className="suave pequeno">{c.tipo}</span></> },
            { titulo: 'Cliente', celda: (c) => <>{c.cliente_razon_social}<div className="suave pequeno">{c.cliente_documento_tipo} {c.cliente_documento}</div></> },
            { titulo: 'Total', celda: (c) => <>{dinero(c.total, c.moneda)}<div className="suave pequeno">IGV {dinero(c.igv, c.moneda)}</div></>, alinear: 'derecha' },
            { titulo: 'Estado', celda: (c) => <><Estado valor={c.estado === 'aceptado' ? 'confirmado' : c.estado === 'anulado' ? 'anulada' : c.estado === 'error' || c.estado === 'rechazado' ? 'rechazado' : 'pendiente'} />{c.error && <div className="suave pequeno">{c.error}</div>}</> },
            { titulo: '', celda: (c) => <div className="fila">{c.enlace_pdf && <a className="btn secundario chico" href={c.enlace_pdf} target="_blank" rel="noreferrer">PDF</a>}{c.estado === 'aceptado' && <AccionConMotivo titulo="Anular comprobante" texto="Anular" className="btn secundario chico" exito="Comprobante anulado" onConfirmar={async (m) => { await api.post(`/comprobantes/${c.id}/anular`, { motivo: m }); await cargar(); }} descripcion="Se comunica la baja a SUNAT (si hay proveedor) y queda anulado aquí." />}</div> },
          ]} />
        </Tarjeta>
      </div>
    </>
  );
}
