import { useEffect, useState } from 'react';
import { api, dinero, fecha, ETIQUETA_ESTADO } from '../api';
import { useAvisar } from '../componentes/toast';
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
  const [material, setMaterial] = useState<any | null>(null);
  const [versiones, setVersiones] = useState<any | null>(null);
  const [nv, setNv] = useState<any>({ version: '', notas: '', url_externa: '', archivo: null as File | null, marcar_actual: true });
  const avisar = useAvisar();
  const abrirVersiones = async (p: any) => { setVersiones({ producto: p, lista: await api.get<any[]>(`/productos/${p.id}/versiones`) }); setNv({ version: '', notas: '', url_externa: '', archivo: null, marcar_actual: true }); };
  const publicar = async () => {
    const t = (await import('../api')).sesion.token();
    const fd = new FormData(); fd.append('version', nv.version); fd.append('notas', nv.notas); if (nv.url_externa) fd.append('url_externa', nv.url_externa); if (nv.archivo) fd.append('archivo', nv.archivo); fd.append('marcar_actual', nv.marcar_actual ? '1' : '0');
    const r = await fetch(`/api/v1/productos/${versiones.producto.id}/versiones`, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, credentials: 'include', body: fd });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.error || 'No se pudo publicar');
    await abrirVersiones(versiones.producto); await cargar();
  };
  const leerMaterial = (p: any) => { try { return p.material ? JSON.parse(p.material) : {}; } catch { return {}; } };
  const cargar = () => api.get<any[]>('/productos', { todos: 1 }).then(setProductos);
  useEffect(() => { cargar(); }, []);

  return (
    <>
      <header><div><h1>Catálogo</h1><p>Productos y planes con sus precios de lista. Los precios están en la moneda base.</p></div>{esSuper && <button className="btn" onClick={() => setNuevoProducto(true)}>+ Producto</button>}</header>
      {productos.map((p) => (
        <Tarjeta key={p.id} titulo={<>{p.nombre} <code className="clave">{p.codigo}</code>{!p.activo && <Estado valor="suspendida" />}</>}
          acciones={<div className="fila"><span className="suave pequeno">{p.licencias_activas} activas / {p.licencias_total} licencias{p.instalaciones_desactualizadas > 0 && <> · <span className="estado aviso">{p.instalaciones_desactualizadas} desactualizada(s)</span></>}</span>
            {esSuper ? <VersionProducto producto={p} alGuardar={cargar} /> : p.version_actual && <span className="suave pequeno">v{p.version_actual}</span>}
            {esSuper && <button className="btn secundario chico" onClick={() => abrirVersiones(p)}>Versiones</button>}
            {esSuper && <button className="btn secundario chico" onClick={() => { const m = leerMaterial(p); setMaterial({ producto: p, ficha: m.ficha || '', video_url: m.video_url || '', capturas: (m.capturas || []).join('\n'), beneficios: (m.beneficios || []).join('\n'), objeciones: (m.objeciones || []).map((o: any) => `${o.p} => ${o.r}`).join('\n') }); }}>Material de venta</button>}
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
            { titulo: 'Cuotas', celda: (pl: any) => pl.cuotas > 1 ? `hasta ${pl.cuotas}` : 'contado', alinear: 'derecha' },
            { titulo: '', celda: (pl: any) => <>{!pl.activo && <Estado valor="suspendida" />} {esSuper && <button className="btn secundario chico" onClick={() => setEditPlan({ ...pl, comision_pct: pl.comision_pct ?? '' })}>Editar</button>}</> },
          ]} />
        </Tarjeta>
      ))}

      <Modal titulo={`Versiones · ${versiones?.producto?.nombre || ''}`} abierto={!!versiones} cerrar={() => setVersiones(null)}>
        {versiones && (
          <>
            <p className="suave" style={{ marginTop: 0 }}>Publica el instalador o paquete de cada versión. Las instalaciones preguntan a CONTROL si hay algo nuevo, descargan con su licencia y verifican el archivo con la firma. Marcar como actual dispara el aviso "desactualizada" en las que van atrás.</p>
            <Tabla filas={versiones.lista} clave={(v: any) => v.id} vacio="Todavía no publicaste ninguna versión" columnas={[
              { titulo: 'Versión', celda: (v: any) => <><strong>{v.version}</strong>{versiones.producto.version_actual === v.version && <> <Estado valor="activa" /></>}{!v.publicada && <> <Estado valor="revocada" /></>}</> },
              { titulo: 'Notas', celda: (v: any) => <span className="pequeno">{v.notas || '—'}</span> },
              { titulo: 'Origen', celda: (v: any) => v.archivo ? <span className="pequeno">archivo · {((v.tamano || 0) / 1048576).toFixed(1)} MB<br /><code className="clave" title={v.sha256}>{String(v.sha256 || '').slice(0, 12)}…</code></span> : <a className="pequeno" href={v.url_externa} target="_blank" rel="noreferrer">URL externa</a> },
              { titulo: 'Publicada', celda: (v: any) => <>{fecha(v.creado_en)}<div className="suave pequeno">{v.creado_por_nombre}</div></> },
              { titulo: '', celda: (v: any) => v.publicada ? <BotonAccion texto="Retirar" className="btn secundario chico" exito="Versión retirada" onClick={async () => { await api.get(`/productos/${versiones.producto.id}/versiones`); await fetch(`/api/v1/productos/${versiones.producto.id}/versiones/${v.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${(await import('../api')).sesion.token()}` } }); await abrirVersiones(versiones.producto); await cargar(); }} /> : null },
            ]} />
            <h3 style={{ margin: '14px 0 8px' }}>Publicar versión nueva</h3>
            <Formulario textoBoton="Publicar" exito="Versión publicada" onEnviar={publicar}>
              <div className="fila"><Campo etiqueta="Versión"><input value={nv.version} onChange={(e) => setNv({ ...nv, version: e.target.value })} placeholder="1.4.0" required pattern="[0-9]+(\.[0-9]+){0,3}.*" /></Campo><Campo etiqueta="Marcar como versión actual"><select value={nv.marcar_actual ? '1' : '0'} onChange={(e) => setNv({ ...nv, marcar_actual: e.target.value === '1' })}><option value="1">Sí</option><option value="0">No (solo publicar)</option></select></Campo></div>
              <Campo etiqueta="Notas de la versión (las ve el cliente)"><textarea rows={2} value={nv.notas} onChange={(e) => setNv({ ...nv, notas: e.target.value })} /></Campo>
              <Campo etiqueta="Archivo (instalador o paquete, hasta 500 MB)"><input type="file" onChange={(e) => setNv({ ...nv, archivo: e.target.files?.[0] || null })} /></Campo>
              <Campo etiqueta="…o URL externa de descarga (GitHub Releases, Drive)"><input value={nv.url_externa} onChange={(e) => setNv({ ...nv, url_externa: e.target.value })} placeholder="https://github.com/…/releases/download/…" /></Campo>
            </Formulario>
          </>
        )}
      </Modal>

      <Modal titulo={`Material de venta · ${material?.producto?.nombre || ''}`} abierto={!!material} cerrar={() => setMaterial(null)}>
        {material && (
          <Formulario textoBoton="Guardar material" cancelar={() => setMaterial(null)} exito="Material guardado" onEnviar={async () => {
            const lineas = (t: string) => t.split('\n').map((x: string) => x.trim()).filter(Boolean);
            const m = { ficha: material.ficha, video_url: material.video_url || null, capturas: lineas(material.capturas), beneficios: lineas(material.beneficios), objeciones: lineas(material.objeciones).map((l: string) => { const [p, ...r] = l.split('=>'); return { p: p.trim(), r: r.join('=>').trim() }; }) };
            await api.patch(`/productos/${material.producto.id}`, { material: JSON.stringify(m) }); setMaterial(null); await cargar();
          }}>
            <p className="suave" style={{ marginTop: 0 }}>Lo que necesita un vendedor nuevo para vender en su primera semana. Ficha, beneficios, capturas y video salen también en la página pública de compra; las objeciones son internas.</p>
            <Campo etiqueta="Ficha (2 o 3 frases que se le dicen al cliente)"><textarea rows={3} value={material.ficha} onChange={(e) => setMaterial({ ...material, ficha: e.target.value })} /></Campo>
            <Campo etiqueta="Beneficios (uno por línea)"><textarea rows={4} value={material.beneficios} onChange={(e) => setMaterial({ ...material, beneficios: e.target.value })} placeholder="Agenda de citas con recordatorio por WhatsApp&#10;Caja diaria sin cuaderno" /></Campo>
            <Campo etiqueta="Capturas (URL de imagen, una por línea)"><textarea rows={3} value={material.capturas} onChange={(e) => setMaterial({ ...material, capturas: e.target.value })} /></Campo>
            <Campo etiqueta="Video de demostración (URL de YouTube o similar)"><input value={material.video_url} onChange={(e) => setMaterial({ ...material, video_url: e.target.value })} /></Campo>
            <Campo etiqueta="Objeciones frecuentes y respuesta (una por línea, formato: objeción => respuesta)"><textarea rows={4} value={material.objeciones} onChange={(e) => setMaterial({ ...material, objeciones: e.target.value })} placeholder="Es caro => Cuesta menos que una cita perdida al mes" /></Campo>
          </Formulario>
        )}
      </Modal>

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
          <Formulario onEnviar={async () => { await api.patch(`/planes/${editPlan.id}`, { nombre: editPlan.nombre, precio: Number(editPlan.precio), max_activaciones: Number(editPlan.max_activaciones), comision_pct: editPlan.comision_pct === '' ? null : Number(editPlan.comision_pct), duracion_dias: editPlan.duracion_dias ? Number(editPlan.duracion_dias) : null, activo: Boolean(editPlan.activo), cuotas: Number(editPlan.cuotas || 1) }); setEditPlan(null); await cargar(); }} cancelar={() => setEditPlan(null)} exito="Plan actualizado">
            <Campo etiqueta="Nombre"><input value={editPlan.nombre} onChange={(e) => setEditPlan({ ...editPlan, nombre: e.target.value })} required /></Campo>
            <Campo etiqueta="Precio"><input type="number" step="0.01" min={0} value={editPlan.precio} onChange={(e) => setEditPlan({ ...editPlan, precio: e.target.value })} /></Campo>
            <Campo etiqueta="Duración en días"><input type="number" min={1} value={editPlan.duracion_dias || ''} onChange={(e) => setEditPlan({ ...editPlan, duracion_dias: e.target.value })} /></Campo>
            <Campo etiqueta="Equipos por licencia"><input type="number" min={1} value={editPlan.max_activaciones} onChange={(e) => setEditPlan({ ...editPlan, max_activaciones: e.target.value })} /></Campo>
            <Campo etiqueta="Comisión % (vacío = la del vendedor)"><input type="number" min={0} max={100} step={0.5} value={editPlan.comision_pct} onChange={(e) => setEditPlan({ ...editPlan, comision_pct: e.target.value })} /></Campo>
            <Campo etiqueta="Cuotas máximas" ayuda="1 = solo al contado. Con más, el vendedor puede ofrecer pago mensual en cuotas; la licencia se activa con la primera."><input type="number" min={1} max={12} value={editPlan.cuotas ?? 1} onChange={(e) => setEditPlan({ ...editPlan, cuotas: Number(e.target.value) })} /></Campo>
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
