import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, dinero, ETIQUETA_ESTADO } from '../api';
import { useSesion } from '../sesion';
import { useAjustes } from '../ajustes';
import { Aviso, Campo, Formulario, Modal, Tarjeta } from '../componentes/ui';

export function VentaNueva() {
  const { esGestor, esSuper, usuario } = useSesion();
  const esRevendedor = usuario!.rol === 'revendedor';
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [productos, setProductos] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [equipo, setEquipo] = useState<any[]>([]);
  const ajustes = useAjustes();
  const [clienteId, setClienteId] = useState(params.get('cliente_id') || '');
  const [productoId, setProductoId] = useState('');
  const [planId, setPlanId] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [descuento, setDescuento] = useState(0);
  const [vendedorId, setVendedorId] = useState('');
  const [notas, setNotas] = useState('');
  const [renueva, setRenueva] = useState(params.get('renueva') || '');
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [nc, setNc] = useState({ nombre: '', empresa: '', telefono: '', email: '', pais: '', moneda: '' });

  useEffect(() => {
    api.get<any[]>('/productos').then(setProductos);
    api.get<any[]>('/clientes').then(setClientes);
    if (esGestor) api.get<any[]>('/usuarios').then((u) => setEquipo(u.filter((x) => x.activo)));
  }, [esGestor]);

  const producto = productos.find((p) => String(p.id) === productoId);
  const plan = producto?.planes.find((p: any) => String(p.id) === planId && p.activo);
  const cliente = clientes.find((c) => String(c.id) === clienteId);
  const topeDesc = Number(ajustes.tope_descuento_pct || 10);
  const esRenovacion = Boolean(renueva);
  const descuentoEfectivo = esRevendedor ? (usuario!.descuento_mayorista_pct ?? 30) : descuento;
  const totalBase = useMemo(() => (plan ? (plan.tipo === 'demo' ? 0 : plan.precio) * (esRenovacion ? 1 : cantidad) * (1 - descuentoEfectivo / 100) : 0), [plan, cantidad, descuentoEfectivo, esRenovacion]);
  const monedaBase = ajustes.moneda_base || 'USD';
  const monedaCliente = cliente?.moneda || monedaBase;
  let tipoCambio = 1;
  try { tipoCambio = monedaCliente === monedaBase ? 1 : Number(JSON.parse(ajustes.tipos_cambio || '{}')[monedaCliente]) || 0; } catch { tipoCambio = 0; }
  const total = totalBase * tipoCambio;
  const pct = esRevendedor ? 0 : plan?.comision_pct ?? usuario!.comision_pct;

  const crearCliente = async () => {
    const c = await api.post<any>('/clientes', { ...nc, email: nc.email || undefined, moneda: nc.moneda || undefined });
    setClientes((l) => [c, ...l]); setClienteId(String(c.id)); setNuevoCliente(false);
  };

  const enviar = async () => {
    const v = await api.post<any>('/ventas', {
      cliente_id: Number(clienteId), plan_id: Number(planId), cantidad: esRenovacion ? 1 : cantidad,
      etiquetas: etiquetas.map((e, i) => e || `Sucursal ${i + 1}`), descuento_pct: descuento || undefined,
      vendedor_id: vendedorId ? Number(vendedorId) : undefined, notas: notas || undefined,
      renueva_licencia_id: renueva ? Number(renueva) : undefined,
    });
    nav(`/ventas/${v.id}`);
  };

  return (
    <>
      <header><div><h1>Nueva venta</h1><p>Cada unidad genera una licencia propia. Queda pendiente hasta confirmar el cobro.</p></div></header>
      <div className="grid-2">
        <Tarjeta>
          <Formulario onEnviar={enviar} textoBoton={plan?.tipo === 'demo' ? 'Generar demo' : 'Registrar venta'} cancelar={() => nav(-1)}>
            {esRenovacion && <Aviso tipo="info">Renovación de la licencia #{renueva}. Al confirmar el pago se extiende su vigencia. <button type="button" className="btn-texto" onClick={() => setRenueva('')}>Quitar</button></Aviso>}
            <Campo etiqueta="Cliente">
              <div className="fila">
                <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required style={{ flex: 1 }}>
                  <option value="">Elegir cliente…</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}</option>)}
                </select>
                <button type="button" className="btn secundario" onClick={() => setNuevoCliente(true)}>+ Nuevo</button>
              </div>
            </Campo>
            <Campo etiqueta="Producto">
              <select value={productoId} onChange={(e) => { setProductoId(e.target.value); setPlanId(''); }} required>
                <option value="">Elegir producto…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            {producto && (
              <Campo etiqueta="Plan">
                <select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
                  <option value="">Elegir plan…</option>
                  {producto.planes.filter((p: any) => p.activo).map((p: any) => <option key={p.id} value={p.id}>{p.nombre} · {ETIQUETA_ESTADO[p.tipo]} · {dinero(p.precio)}</option>)}
                </select>
              </Campo>
            )}
            {plan && plan.tipo !== 'demo' && !esRenovacion && (
              <Campo etiqueta="Cantidad de sucursales / instalaciones" ayuda="Se emite una licencia por cada una.">
                <input type="number" min={1} max={50} value={cantidad} onChange={(e) => { const n = Math.max(1, Number(e.target.value)); setCantidad(n); setEtiquetas((et) => Array.from({ length: n }, (_, i) => et[i] || '')); }} />
              </Campo>
            )}
            {cantidad > 1 && !esRenovacion && plan?.tipo !== 'demo' && (
              <Campo etiqueta="Nombre de cada sucursal">
                {Array.from({ length: cantidad }, (_, i) => (
                  <input key={i} placeholder={`Sucursal ${i + 1}`} value={etiquetas[i] || ''} onChange={(e) => setEtiquetas((et) => { const n = [...et]; n[i] = e.target.value; return n; })} style={{ marginBottom: 6 }} />
                ))}
              </Campo>
            )}
            {esRevendedor && plan && plan.tipo !== 'demo' && <Aviso tipo="info">Precio mayorista: {usuario!.descuento_mayorista_pct ?? 30}% de descuento sobre lista. {(usuario!.cupo_licencias ?? 0) >= cantidad ? `Se descontará de tu cupo (${usuario!.cupo_licencias}) y la venta se confirma al instante.` : 'Sin cupo suficiente: la venta queda pendiente hasta que la agencia confirme tu pago.'}</Aviso>}
            {plan && plan.tipo !== 'demo' && !esRevendedor && (
              <Campo etiqueta={`Descuento % (máximo ${esSuper ? 'sin límite' : `${topeDesc}%`})`}>
                <input type="number" min={0} max={esSuper ? 100 : topeDesc} step={0.5} value={descuento} onChange={(e) => setDescuento(Number(e.target.value))} />
              </Campo>
            )}
            {esGestor && (
              <Campo etiqueta="Vendedor que lleva la comisión" ayuda="Por defecto, el vendedor del cliente o quien registra.">
                <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
                  <option value="">Automático{cliente?.vendedor_nombre ? ` (${cliente.vendedor_nombre})` : ''}</option>
                  {equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.comision_pct}%</option>)}
                </select>
              </Campo>
            )}
            <Campo etiqueta="Notas"><textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
          </Formulario>
        </Tarjeta>

        <Tarjeta titulo="Resumen">
          <dl className="definiciones">
            <dt>Cliente</dt><dd>{cliente?.nombre || '—'}</dd>
            <dt>Producto</dt><dd>{producto?.nombre || '—'}</dd>
            <dt>Plan</dt><dd>{plan ? `${plan.nombre} (${ETIQUETA_ESTADO[plan.tipo]})` : '—'}</dd>
            <dt>Precio unitario</dt><dd>{plan ? dinero(plan.tipo === 'demo' ? 0 : plan.precio) : '—'}</dd>
            <dt>Licencias</dt><dd>{esRenovacion ? 'Renueva 1 existente' : cantidad}</dd>
            <dt>Descuento</dt><dd>{descuentoEfectivo}%{esRevendedor && <span className="suave pequeno"> (mayorista)</span>}</dd>
            <dt>Moneda</dt><dd>{monedaCliente}{monedaCliente !== monedaBase && (tipoCambio ? <span className="suave pequeno"> · T.C. {tipoCambio}</span> : <span className="estado mal"> sin tipo de cambio</span>)}</dd>
            <dt><strong>Total</strong></dt><dd><strong>{dinero(total, monedaCliente)}</strong>{monedaCliente !== monedaBase && tipoCambio ? <span className="suave pequeno"> · {dinero(totalBase, monedaBase)}</span> : null}</dd>
            {!esRevendedor && <><dt>Comisión ({pct}%)</dt><dd>{dinero((totalBase * pct) / 100, monedaBase)} <span className="suave pequeno">se devenga al confirmar el cobro</span></dd></>}
          </dl>
          {plan?.tipo === 'demo' && <Aviso tipo="info">La demo se activa al instante por {plan.duracion_dias || ajustes.demo_dias || 7} días y cuenta para tu tope semanal.</Aviso>}
          {plan?.tipo === 'vitalicio' && <Aviso tipo="info">Vitalicio: uso perpetuo con soporte y actualizaciones por {ajustes.soporte_vitalicio_dias || 365} días; luego se vende el plan de mantenimiento.</Aviso>}
        </Tarjeta>
      </div>

      <Modal titulo="Nuevo cliente" abierto={nuevoCliente} cerrar={() => setNuevoCliente(false)}>
        <Formulario onEnviar={crearCliente} cancelar={() => setNuevoCliente(false)} exito="Cliente creado">
          <Campo etiqueta="Nombre"><input value={nc.nombre} onChange={(e) => setNc({ ...nc, nombre: e.target.value })} required autoFocus /></Campo>
          <Campo etiqueta="Empresa / negocio"><input value={nc.empresa} onChange={(e) => setNc({ ...nc, empresa: e.target.value })} /></Campo>
          <Campo etiqueta="Teléfono (WhatsApp)"><input value={nc.telefono} onChange={(e) => setNc({ ...nc, telefono: e.target.value })} /></Campo>
          <Campo etiqueta="Correo"><input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Campo>
          <Campo etiqueta="País"><input value={nc.pais} onChange={(e) => setNc({ ...nc, pais: e.target.value })} placeholder="PE, BO, CO…" /></Campo>
          <Campo etiqueta="Moneda en la que paga" ayuda="Debe tener tipo de cambio en Ajustes."><select value={nc.moneda} onChange={(e) => setNc({ ...nc, moneda: e.target.value })}><option value="">{monedaBase} (base)</option>{(() => { try { return Object.keys(JSON.parse(ajustes.tipos_cambio || '{}')).filter((m) => m !== monedaBase).map((m) => <option key={m} value={m}>{m}</option>); } catch { return null; } })()}</select></Campo>
        </Formulario>
      </Modal>
    </>
  );
}
