import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fecha } from '../api';
import { Tabla, Tarjeta } from '../componentes/ui';

export function Auditoria() {
  const [datos, setDatos] = useState<{ filas: any[]; total: number; pagina: number; porPagina: number } | null>(null);
  const [params] = useSearchParams();
  const [accion, setAccion] = useState(params.get('accion') || '');
  const [pagina, setPagina] = useState(1);
  useEffect(() => { api.get<any>('/auditoria', { accion: accion || undefined, pagina, por_pagina: 50 }).then(setDatos); }, [accion, pagina]);
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;

  return (
    <>
      <header><div><h1>Auditoría</h1><p>Registro de solo inserción. Nada se edita ni se borra.</p></div></header>
      <Tarjeta>
        <div className="filtros">
          <input placeholder="Filtrar por acción (venta., pago., licencia., caja., activacion.)" value={accion} onChange={(e) => { setAccion(e.target.value); setPagina(1); }} style={{ minWidth: 340 }} />
          <span className="suave">{datos?.total ?? 0} evento(s)</span>
        </div>
        <Tabla filas={datos?.filas || []} clave={(a) => a.id} columnas={[
          { titulo: 'Fecha', celda: (a) => fecha(a.creado_en, true), ancho: '150px' },
          { titulo: 'Usuario', celda: (a) => a.usuario_nombre ? <>{a.usuario_nombre} <span className="suave pequeno">{a.usuario_rol}</span></> : <span className="suave">sistema / producto</span> },
          { titulo: 'Acción', celda: (a) => <code className="clave">{a.accion}</code> },
          { titulo: 'Entidad', celda: (a) => a.entidad ? `${a.entidad} #${a.entidad_id ?? ''}` : '—' },
          { titulo: 'Detalle', celda: (a) => a.detalle ? <span className="pequeno">{Object.entries(a.detalle).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</span> : '—' },
          { titulo: 'IP', celda: (a) => a.ip || '—' },
        ]} />
        <div className="fila" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn secundario chico" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span className="suave">Página {pagina} de {paginas}</span>
          <button className="btn secundario chico" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>
      </Tarjeta>
    </>
  );
}
