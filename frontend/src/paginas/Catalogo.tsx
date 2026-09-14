import { useEffect, useState } from 'react';
import { api, dinero, ETIQUETA_ESTADO } from '../api';
import { useSesion } from '../sesion';
import { BotonAccion, Campo, Estado, Formulario, Modal, Tabla, Tarjeta } from '../componentes/ui';

const TIPOS = ['mensual', 'anual', 'vitalicio', 'sucursal_extra', 'mantenimiento', 'demo'];

export function Catalogo() {
  const { esSuper } = useSesion();
  const [productos, setProductos] = useState<any[]>([]);
  const [nuevoProducto, setNuevoProducto] = useState(false);
  const [np, setNp] = useState({ codigo: '', nombre: '', descripcion: '' });
  const [planPara, setPlanPara] = useState<any | null>(null);
  const [nplan, setNplan] = useState<any>({ codigo: '', nombre: '', tipo: 'mensual', precio: 0, max_activaciones: 1, comision_pct: '' });
  const [editPlan, setEditPlan] = useState<any | null>(null);
  const cargar = () => api.get<any[]>('/productos', { todos: 1 }).then(setProductos);
  useEffect(() => { cargar(); }, []);

  return (
    <>
      <header><div><h1>Catálogo</h1><p>Productos y planes con sus precios de lista. Los precios están en la moneda base.</p></div>{esSuper && <button className="btn" onClick={() => setNuevoProducto(true)}>+ Producto</button>}</header>
      {productos.map((p) => (
        <Tarjeta key={p.id} titulo={<>{p.nombre} <code className="clave">{p.codigo}</code>{!p.activo && <Estado valor="suspendida" />}</>}
          acciones={<div className="fila"><span className="suave pequeno">{p.licencias_activas} activas / {p.licencias_total} licencias{p.instalaciones_desactualizadas > 0 && <> · <span className="estado aviso">{p.instalaciones_desactualizadas} desactualizada(s)</span></>}</span>
            {esSuper ? <VersionProducto producto={p} alGuardar={cargar} /> : p.version_actual && <span className="suave pequeno">v{p.version_actual}</span>}
            {esSuper && <><button className="btn secundario chico" onClick={() => { setPlanPara(p); setNplan({ codigo: '', nombre: '', tipo: 'mensual', precio: 0, max_activaciones: 1, comision_pct: '' }); }}>+ Plan</button>
              <BotonAccion texto={p.activo ? 'Desactivar' : 'Activar'} className="btn secundario chico" exito={p.activo ? 'Producto desactivado' : 'Producto activado'} onClick={async () => { await api.patch(`/productos/${p.id}`, { activo: !p.activo }); await cargar(); }} /></>}</div>}>
          {p.descripcion && <p className="suave" style={{ marginTop: 0 }}>{p.descripcion}</p>}
          <Tabla filas={p.planes} clave={(pl: any) => pl.id} vacio="Sin planes: agrega uno para poder vender este producto" columnas={[
            { titulo: 'Plan', celda: (pl: any) => <>{pl.nombre} <code className="clave">{pl.codigo}</code></> },
            { titulo: 'Tipo', celda: (pl: any) => <Estado valor={pl.tipo} /> },
            { titulo: 'Precio', celda: (pl: any) => dinero(pl.precio), alinear: 'derecha' },
            { titulo: 'Duración', celda: (pl: any) => pl.duracion_dias ? `${pl.duracion_dias} días` : pl.tipo === 'vitalicio' || pl.tipo === 'sucursal_extra' ? 'Sin vencimiento' : '—' },
            { titulo: 'Equipos', celda: (pl: any) => pl.max_activaciones, alinear: 'derecha' },
            { titulo: 'Comisión', celda: (pl: any) => pl.comision_pct != null ? `${pl.comision_pct}%` : 'la del vendedor' },
            { titulo: '', celda: (pl: any) => <>{!pl.activo && <Estado valor="suspendida" />} {esSuper && <button className="btn secundario chico" onClick={() => setEditPlan({ ...pl, comision_pct: pl.comision_pct ?? '' })}>Editar</button>}</> },
          ]} />
        </Tarjeta>
      ))}

      <Modal titulo="Nuevo producto" abierto={nuevoProducto} cerrar={() => setNuevoProducto(false)}>
        <Formulario onEnviar={async () => { await api.post('/productos', np); setNuevoProducto(false); setNp({ codigo: '', nombre: '', descripcion: '' }); await cargar(); }} cancelar={() => setNuevoProducto(false)} exito="Producto creado">
          <Campo etiqueta="Código" ayuda="Minúsculas, números y guiones. Es el identificador que usa el software al activarse."><input value={np.codigo} onChange={(e) => setNp({ ...np, codigo: e.target.value })} required pattern="[a-z0-9-]+" autoFocus /></Campo>
          <Campo etiqueta="Nombre"><input value={np.nombre} onChange={(e) => setNp({ ...np, nombre: e.target.value })} required /></Campo>
          <Campo etiqueta="Descripción"><input value={np.descripcion} onChange={(e) => setNp({ ...np, descripcion: e.target.value })} /></Campo>
        </Formulario>
      </Modal>

      <Modal titulo={`Nuevo plan · ${planPara?.nombre || ''}`} abierto={Boolean(planPara)} cerrar={() => setPlanPara(null)}>
        <Formulario onEnviar={async () => { await api.post('/planes', { ...nplan, producto_id: planPara.id, precio: Number(nplan.precio), max_activaciones: Number(nplan.max_activaciones), comision_pct: nplan.comision_pct === '' ? null : Number(nplan.comision_pct), duracion_dias: nplan.duracion_dias ? Number(nplan.duracion_dias) : undefined }); setPlanPara(null); await cargar(); }} cancelar={() => setPlanPara(null)} exito="Plan creado">
          <Campo etiqueta="Tipo"><select value={nplan.tipo} onChange={(e) => setNplan({ ...nplan, tipo: e.target.value })}>{TIPOS.map((t) => <option key={t} value={t}>{ETIQUETA_ESTADO[t]}</option>)}</select></Campo>
          <Campo etiqueta="Código"><input value={nplan.codigo} onChange={(e) => setNplan({ ...nplan, codigo: e.target.value })} required pattern="[a-z0-9-]+" placeholder="mensual, anual, vitalicio…" /></Campo>
          <Campo etiqueta="Nombre"><input value={nplan.nombre} onChange={(e) => setNplan({ ...nplan, nombre: e.target.value })} required /></Campo>
          <Campo etiqueta="Precio"><input type="number" step="0.01" min={0} value={nplan.precio} onChange={(e) => setNplan({ ...nplan, precio: e.target.value })} required /></Campo>
          <Campo etiqueta="Duración en días" ayuda="Vacío usa la del tipo: mensual 30, anual 365, demo 7, vitalicio sin vencimiento."><input type="number" min={1} value={nplan.duracion_dias || ''} onChange={(e) => setNplan({ ...nplan, duracion_dias: e.target.value })} /></Campo>
          <Campo etiqueta="Equipos por licencia"><input type="number" min={1} value={nplan.max_activaciones} onChange={(e) => setNplan({ ...nplan, max_activaciones: e.target.value })} /></Campo>
          <Campo etiqueta="Comisión % (vacío = la del vendedor)"><input type="number" min={0} max={100} step={0.5} value={nplan.comision_pct} onChange={(e) => setNplan({ ...nplan, comision_pct: e.target.value })} /></Campo>
        </Formulario>
      </Modal>

      <Modal titulo={`Editar plan · ${editPlan?.nombre || ''}`} abierto={Boolean(editPlan)} cerrar={() => setEditPlan(null)}>
        {editPlan && (
          <Formulario onEnviar={async () => { await api.patch(`/planes/${editPlan.id}`, { nombre: editPlan.nombre, precio: Number(editPlan.precio), max_activaciones: Number(editPlan.max_activaciones), comision_pct: editPlan.comision_pct === '' ? null : Number(editPlan.comision_pct), duracion_dias: editPlan.duracion_dias ? Number(editPlan.duracion_dias) : null, activo: Boolean(editPlan.activo) }); setEditPlan(null); await cargar(); }} cancelar={() => setEditPlan(null)} exito="Plan actualizado">
            <Campo etiqueta="Nombre"><input value={editPlan.nombre} onChange={(e) => setEditPlan({ ...editPlan, nombre: e.target.value })} required /></Campo>
            <Campo etiqueta="Precio"><input type="number" step="0.01" min={0} value={editPlan.precio} onChange={(e) => setEditPlan({ ...editPlan, precio: e.target.value })} /></Campo>
            <Campo etiqueta="Duración en días"><input type="number" min={1} value={editPlan.duracion_dias || ''} onChange={(e) => setEditPlan({ ...editPlan, duracion_dias: e.target.value })} /></Campo>
            <Campo etiqueta="Equipos por licencia"><input type="number" min={1} value={editPlan.max_activaciones} onChange={(e) => setEditPlan({ ...editPlan, max_activaciones: e.target.value })} /></Campo>
            <Campo etiqueta="Comisión % (vacío = la del vendedor)"><input type="number" min={0} max={100} step={0.5} value={editPlan.comision_pct} onChange={(e) => setEditPlan({ ...editPlan, comision_pct: e.target.value })} /></Campo>
            <Campo etiqueta="Activo"><select value={editPlan.activo ? '1' : '0'} onChange={(e) => setEditPlan({ ...editPlan, activo: e.target.value === '1' })}><option value="1">Sí</option><option value="0">No</option></select></Campo>
          </Formulario>
        )}
      </Modal>
    </>
  );
}

/** Versión vigente del producto: las instalaciones que reporten otra se marcan como desactualizadas. */
function VersionProducto({ producto, alGuardar }: { producto: any; alGuardar: () => Promise<unknown> }) {
  const [v, setV] = useState(producto.version_actual || '');
  useEffect(() => { setV(producto.version_actual || ''); }, [producto.version_actual]);
  return (
    <span className="fila" style={{ gap: 4 }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Versión actual" style={{ width: 120 }} aria-label={`Versión actual de ${producto.nombre}`} />
      {v !== (producto.version_actual || '') && <BotonAccion texto="Guardar" className="btn chico" exito="Versión guardada" onClick={async () => { await api.patch(`/productos/${producto.id}`, { version_actual: v || null }); await alGuardar(); }} />}
    </span>
  );
}
