import { useEffect, useState } from 'react';
import { api, dinero } from '../api';
import { useSesion } from '../sesion';
import { BotonAccion, Campo, Estado, Formulario, Modal, Tabla, Tarjeta } from '../componentes/ui';

const VACIO = { email: '', nombre: '', clave: '', rol: 'vendedor', comision_pct: 20, tope_emisiones_dia: 20, tope_demos_semana: 10, telefono: '' };

export function Equipo() {
  const { esSuper, usuario } = useSesion();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState<any>(VACIO);
  const [editar, setEditar] = useState<any | null>(null);
  const cargar = () => api.get<any[]>('/usuarios').then(setUsuarios);
  useEffect(() => { cargar(); }, []);

  const campos = (v: any, set: (x: any) => void, conClave: boolean) => (
    <>
      {conClave && <Campo etiqueta="Correo"><input type="email" value={v.email} onChange={(e) => set({ ...v, email: e.target.value })} required /></Campo>}
      <Campo etiqueta="Nombre"><input value={v.nombre} onChange={(e) => set({ ...v, nombre: e.target.value })} required /></Campo>
      <Campo etiqueta={conClave ? 'Contraseña' : 'Nueva contraseña (vacío = no cambia)'}><input type="password" value={v.clave || ''} onChange={(e) => set({ ...v, clave: e.target.value })} required={conClave} minLength={8} /></Campo>
      <Campo etiqueta="Rol"><select value={v.rol} onChange={(e) => set({ ...v, rol: e.target.value })}><option value="vendedor">Vendedor</option><option value="admin">Administrador</option><option value="superadmin">Superadministrador</option></select></Campo>
      <Campo etiqueta="Comisión %"><input type="number" min={0} max={100} step={0.5} value={v.comision_pct} onChange={(e) => set({ ...v, comision_pct: Number(e.target.value) })} /></Campo>
      <Campo etiqueta="Tope de licencias por día" ayuda="No aplica al superadmin."><input type="number" min={0} value={v.tope_emisiones_dia} onChange={(e) => set({ ...v, tope_emisiones_dia: Number(e.target.value) })} /></Campo>
      <Campo etiqueta="Tope de demos por semana"><input type="number" min={0} value={v.tope_demos_semana} onChange={(e) => set({ ...v, tope_demos_semana: Number(e.target.value) })} /></Campo>
      <Campo etiqueta="Teléfono"><input value={v.telefono || ''} onChange={(e) => set({ ...v, telefono: e.target.value })} /></Campo>
    </>
  );

  return (
    <>
      <header><div><h1>Equipo</h1><p>Vendedores y administradores, con lo que emitió y ganó cada uno.</p></div>{esSuper && <button className="btn" onClick={() => { setF(VACIO); setNuevo(true); }}>+ Usuario</button>}</header>
      <Tarjeta>
        <Tabla filas={usuarios} clave={(u) => u.id} columnas={[
          { titulo: 'Nombre', celda: (u) => <>{u.nombre}<br /><span className="suave pequeno">{u.email}</span></>, orden: (u) => u.nombre },
          { titulo: 'Rol', celda: (u) => <><Estado valor={u.rol} />{!u.activo && <> <Estado valor="suspendida" /></>}</> },
          { titulo: 'Comisión', celda: (u) => `${u.comision_pct}%`, alinear: 'derecha' },
          { titulo: 'Licencias emitidas', celda: (u) => <>{u.licencias_emitidas} <span className="suave pequeno">(hoy {u.licencias_hoy}{u.rol !== 'superadmin' ? ` / ${u.tope_emisiones_dia}` : ''})</span></>, alinear: 'derecha' },
          { titulo: 'Ventas', celda: (u) => u.ventas, alinear: 'derecha' },
          { titulo: 'Vendido (pagado)', celda: (u) => dinero(u.total_vendido), alinear: 'derecha', orden: (u) => u.total_vendido },
          { titulo: 'Comisión pendiente', celda: (u) => dinero(u.comision_pendiente), alinear: 'derecha' },
          { titulo: 'Comisión pagada', celda: (u) => dinero(u.comision_liquidada), alinear: 'derecha' },
          { titulo: '', celda: (u) => esSuper ? <div className="fila"><button className="btn secundario chico" onClick={() => setEditar({ ...u, clave: '' })}>Editar</button>{u.id !== usuario!.id && <BotonAccion texto={u.activo ? 'Desactivar' : 'Activar'} className="btn secundario chico" exito={u.activo ? 'Usuario desactivado' : 'Usuario activado'} onClick={async () => { await api.patch(`/usuarios/${u.id}`, { activo: !u.activo }); await cargar(); }} />}</div> : null },
        ]} />
      </Tarjeta>
      <Modal titulo="Nuevo usuario" abierto={nuevo} cerrar={() => setNuevo(false)}>
        <Formulario onEnviar={async () => { await api.post('/usuarios', { ...f, telefono: f.telefono || undefined }); setNuevo(false); await cargar(); }} cancelar={() => setNuevo(false)} exito="Usuario creado">{campos(f, setF, true)}</Formulario>
      </Modal>
      <Modal titulo={`Editar · ${editar?.nombre || ''}`} abierto={Boolean(editar)} cerrar={() => setEditar(null)}>
        {editar && <Formulario onEnviar={async () => { const { id, email, clave, ...resto } = editar; await api.patch(`/usuarios/${id}`, { nombre: resto.nombre, rol: resto.rol, comision_pct: resto.comision_pct, tope_emisiones_dia: resto.tope_emisiones_dia, tope_demos_semana: resto.tope_demos_semana, telefono: resto.telefono || undefined, clave: clave || undefined }); setEditar(null); await cargar(); }} cancelar={() => setEditar(null)} exito="Usuario actualizado">{campos(editar, setEditar, false)}</Formulario>}
      </Modal>
    </>
  );
}
