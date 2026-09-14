import { useEffect, useState } from 'react';
import { api, dinero, hoy } from '../api';
import { useSesion } from '../sesion';
import { BotonAccion, Campo, Estado, Formulario, Modal, Tabla, Tarjeta } from '../componentes/ui';

const VACIO = { email: '', nombre: '', clave: '', rol: 'vendedor', comision_pct: 20, tope_emisiones_dia: 20, tope_demos_semana: 10, telefono: '' };

export function Equipo() {
  const { esSuper, usuario } = useSesion();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState<any>(VACIO);
  const [editar, setEditar] = useState<any | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const cargar = () => api.get<any[]>('/usuarios').then(setUsuarios);
  useEffect(() => { cargar(); }, []);

  const campos = (v: any, set: (x: any) => void, conClave: boolean) => (
    <>
      {conClave && <Campo etiqueta="Correo"><input type="email" value={v.email} onChange={(e) => set({ ...v, email: e.target.value })} required /></Campo>}
      <Campo etiqueta="Nombre"><input value={v.nombre} onChange={(e) => set({ ...v, nombre: e.target.value })} required /></Campo>
      <Campo etiqueta={conClave ? 'Contraseña temporal' : 'Nueva contraseña temporal (vacío = no cambia)'} ayuda="Mínimo 10 caracteres con letras y números. El usuario deberá cambiarla al entrar."><input type="password" value={v.clave || ''} onChange={(e) => set({ ...v, clave: e.target.value })} required={conClave} minLength={10} /></Campo>
      <Campo etiqueta="Rol"><select value={v.rol} onChange={(e) => set({ ...v, rol: e.target.value })}><option value="vendedor">Vendedor</option><option value="revendedor">Revendedor externo</option><option value="admin">Administrador</option><option value="superadmin">Superadministrador</option></select></Campo>
      {v.rol === 'revendedor' && (
        <>
          <Campo etiqueta="Cupo de licencias prepagadas" ayuda="Cada venta que registre descuenta 1 por licencia. Con cupo, sus ventas se confirman solas."><input type="number" min={0} value={v.cupo_licencias ?? 0} onChange={(e) => set({ ...v, cupo_licencias: Number(e.target.value) })} /></Campo>
          <Campo etiqueta="Descuento mayorista %" ayuda="Precio que paga el revendedor respecto a la lista. Su ganancia es la diferencia con lo que cobre."><input type="number" min={0} max={90} value={v.descuento_mayorista_pct ?? 30} onChange={(e) => set({ ...v, descuento_mayorista_pct: Number(e.target.value) })} /></Campo>
          <Campo etiqueta="Marca blanca (nombre que ven sus clientes)"><input value={v.marca_nombre || ''} onChange={(e) => set({ ...v, marca_nombre: e.target.value })} /></Campo>
        </>
      )}
      <Campo etiqueta="Comisión %"><input type="number" min={0} max={100} step={0.5} value={v.comision_pct} onChange={(e) => set({ ...v, comision_pct: Number(e.target.value) })} /></Campo>
      <Campo etiqueta="Tope de licencias por día" ayuda="No aplica al superadmin."><input type="number" min={0} value={v.tope_emisiones_dia} onChange={(e) => set({ ...v, tope_emisiones_dia: Number(e.target.value) })} /></Campo>
      <Campo etiqueta="Tope de demos por semana"><input type="number" min={0} value={v.tope_demos_semana} onChange={(e) => set({ ...v, tope_demos_semana: Number(e.target.value) })} /></Campo>
      <Campo etiqueta="Teléfono"><input value={v.telefono || ''} onChange={(e) => set({ ...v, telefono: e.target.value })} /></Campo>
    </>
  );

  return (
    <>
      <header><div><h1>Equipo</h1><p>{esSuper ? 'Vendedores y administradores, con lo que emitió y ganó cada uno.' : 'Vendedores y administradores con sus topes. Lo que gana cada uno solo lo ve el dueño.'}</p></div>{esSuper && <button className="btn" onClick={() => { setF(VACIO); setNuevo(true); }}>+ Usuario</button>}</header>
      <Tarjeta>
        <Tabla filas={usuarios} clave={(u) => u.id} columnas={[
          { titulo: 'Nombre', celda: (u) => <>{u.nombre}<br /><span className="suave pequeno">{u.email}</span></>, orden: (u) => u.nombre },
          { titulo: 'Rol', celda: (u) => <><Estado valor={u.rol} />{!u.activo && <> <Estado valor="suspendida" /></>}{u.bloqueado_hasta && <> <Estado valor="mora" /></>}{u.totp_activo ? <span className="suave pequeno"> · 2FA</span> : null}{u.rol === 'revendedor' && <span className="suave pequeno"> · cupo {u.cupo_licencias ?? 0}</span>}</> },
          { titulo: 'Código', celda: (u) => u.codigo_ref ? <code className="clave">{u.codigo_ref}</code> : '—' },
          ...(esSuper ? [{ titulo: 'Comisión', celda: (u: any) => `${u.comision_pct}%`, alinear: 'derecha' as const }] : []),
          { titulo: 'Licencias emitidas', celda: (u) => <>{u.licencias_emitidas} <span className="suave pequeno">(hoy {u.licencias_hoy}{u.rol !== 'superadmin' ? ` / ${u.tope_emisiones_dia}` : ''})</span></>, alinear: 'derecha' },
          { titulo: 'Ventas', celda: (u) => u.ventas, alinear: 'derecha' },
          ...(esSuper ? [
            { titulo: 'Vendido (pagado)', celda: (u: any) => dinero(u.total_vendido), alinear: 'derecha' as const, orden: (u: any) => u.total_vendido },
            { titulo: 'Comisión pendiente', celda: (u: any) => dinero(u.comision_pendiente), alinear: 'derecha' as const },
            { titulo: 'Comisión pagada', celda: (u: any) => dinero(u.comision_liquidada), alinear: 'derecha' as const },
            { titulo: 'Meta del mes', celda: (u: any) => u.rol === 'vendedor' ? (u.meta_mes ? <><div className="pequeno">{dinero(u.vendido_mes)} / {dinero(u.meta_mes)}</div><div className={`barra-meta ${u.vendido_mes >= u.meta_mes ? '' : 'pendiente'}`}><div style={{ width: `${Math.min(100, (u.vendido_mes / Math.max(1, u.meta_mes)) * 100)}%` }} /></div></> : <span className="suave pequeno">sin meta</span>) : '—' },
          ] : []),
          { titulo: '', celda: (u) => esSuper ? <div className="fila"><button className="btn secundario chico" onClick={() => setEditar({ ...u, clave: '' })}>Editar</button>{u.rol === 'vendedor' && <button className="btn secundario chico" onClick={() => setMeta({ usuario_id: u.id, nombre: u.nombre, mes: hoy().slice(0, 7), objetivo_monto: u.meta_mes ?? 1000, bono_pct: u.meta_bono_pct ?? 5 })}>Meta</button>}{u.id !== usuario!.id && <BotonAccion texto={u.activo ? 'Desactivar' : 'Activar'} className="btn secundario chico" exito={u.activo ? 'Usuario desactivado' : 'Usuario activado'} onClick={async () => { await api.patch(`/usuarios/${u.id}`, { activo: !u.activo }); await cargar(); }} />}{u.bloqueado_hasta && <BotonAccion texto="Desbloquear" className="btn secundario chico" exito="Usuario desbloqueado" onClick={async () => { await api.patch(`/usuarios/${u.id}`, { desbloquear: true }); await cargar(); }} />}{u.totp_activo && u.id !== usuario!.id ? <BotonAccion texto="Quitar 2FA" className="btn secundario chico" exito="2FA quitado" onClick={async () => { await api.post(`/usuarios/${u.id}/quitar-2fa`); await cargar(); }} /> : null}</div> : null },
        ]} />
      </Tarjeta>
      <Modal titulo={`Meta mensual · ${meta?.nombre || ''}`} abierto={Boolean(meta)} cerrar={() => setMeta(null)}>
        {meta && <Formulario onEnviar={async () => { await api.post('/usuarios/metas', { usuario_id: meta.usuario_id, mes: meta.mes, objetivo_monto: Number(meta.objetivo_monto), bono_pct: Number(meta.bono_pct) }); setMeta(null); await cargar(); }} cancelar={() => setMeta(null)} exito="Meta guardada">
          <Campo etiqueta="Mes"><input type="month" value={meta.mes} onChange={(e) => setMeta({ ...meta, mes: e.target.value })} required /></Campo>
          <Campo etiqueta="Objetivo en ventas pagadas (moneda base)"><input type="number" min={0} step="1" value={meta.objetivo_monto} onChange={(e) => setMeta({ ...meta, objetivo_monto: e.target.value })} required /></Campo>
          <Campo etiqueta="Bono al cumplirla (puntos de comisión extra)" ayuda="Se suma a su comisión en los cobros confirmados después de alcanzar la meta."><input type="number" min={0} max={50} step="0.5" value={meta.bono_pct} onChange={(e) => setMeta({ ...meta, bono_pct: e.target.value })} /></Campo>
        </Formulario>}
      </Modal>
      <Modal titulo="Nuevo usuario" abierto={nuevo} cerrar={() => setNuevo(false)}>
        <Formulario onEnviar={async () => { await api.post('/usuarios', { ...f, telefono: f.telefono || undefined }); setNuevo(false); await cargar(); }} cancelar={() => setNuevo(false)} exito="Usuario creado">{campos(f, setF, true)}</Formulario>
      </Modal>
      <Modal titulo={`Editar · ${editar?.nombre || ''}`} abierto={Boolean(editar)} cerrar={() => setEditar(null)}>
        {editar && <Formulario onEnviar={async () => { const { id, email, clave, ...resto } = editar; await api.patch(`/usuarios/${id}`, { nombre: resto.nombre, rol: resto.rol, comision_pct: resto.comision_pct, tope_emisiones_dia: resto.tope_emisiones_dia, tope_demos_semana: resto.tope_demos_semana, telefono: resto.telefono || undefined, clave: clave || undefined, cupo_licencias: resto.rol === 'revendedor' ? resto.cupo_licencias ?? 0 : undefined, descuento_mayorista_pct: resto.rol === 'revendedor' ? resto.descuento_mayorista_pct ?? 30 : undefined, marca_nombre: resto.marca_nombre || null }); setEditar(null); await cargar(); }} cancelar={() => setEditar(null)} exito="Usuario actualizado">{campos(editar, setEditar, false)}</Formulario>}
      </Modal>
    </>
  );
}
