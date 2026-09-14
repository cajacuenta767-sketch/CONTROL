import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, dinero, ETIQUETA_ESTADO } from '../api';
import { Aviso, Campo, Cargando, Formulario, Tarjeta } from '../componentes/ui';

function Marco({ agencia, children }: { agencia?: string; children: React.ReactNode }) {
  return (
    <div className="publico">
      <header className="publico-cab"><span className="logo">C</span><strong>{agencia || 'CONTROL'}</strong></header>
      <main className="publico-cuerpo">{children}</main>
      <footer className="publico-pie">Pagos y licencias gestionados con CONTROL.</footer>
    </div>
  );
}

/** Página pública de compra: /comprar?ref=CODIGO */
export function Comprar() {
  const [params] = useSearchParams();
  const ref = params.get('ref') || '';
  const [cat, setCat] = useState<any | null>(null);
  const [vendedor, setVendedor] = useState<any | null>(null);
  const [planId, setPlanId] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [moneda, setMoneda] = useState('');
  const [pasarela, setPasarela] = useState('');
  const [cliente, setCliente] = useState({ nombre: '', empresa: '', email: '', telefono: '', pais: '' });
  const [resultado, setResultado] = useState<any | null>(null);

  useEffect(() => {
    api.get<any>('/publico/catalogo').then((c) => { setCat(c); setMoneda(c.moneda_base); const p = Object.entries(c.pasarelas).find(([, on]) => on)?.[0]; setPasarela(p || ''); });
    if (ref) api.get<any>(`/publico/vendedor/${ref}`).then(setVendedor).catch(() => setVendedor(null));
  }, [ref]);

  const plan = useMemo(() => cat?.productos.flatMap((p: any) => p.planes.map((pl: any) => ({ ...pl, producto: p }))).find((pl: any) => String(pl.id) === planId), [cat, planId]);
  const tc = cat?.tipos_cambio?.[moneda] || 1;
  const total = plan ? plan.precio * cantidad * tc : 0;

  if (!cat) return <Marco><Cargando /></Marco>;
  if (resultado) {
    return (
      <Marco agencia={vendedor?.marca || cat.agencia}>
        <Tarjeta>
          <h2>Pedido {resultado.venta.numero} registrado</h2>
          <p>Total: <strong>{dinero(resultado.venta.total, resultado.venta.moneda)}</strong></p>
          {resultado.enlace_pago ? (
            <><p>Completa el pago para recibir tus claves de licencia al instante.</p><a className="btn" href={resultado.enlace_pago.url}>Pagar ahora</a></>
          ) : <Aviso tipo="info">Te contactaremos para coordinar el pago. Guarda el número de pedido.</Aviso>}
          <p className="suave pequeno" style={{ marginTop: 16 }}>Consulta el estado en cualquier momento con tu correo en <Link to={`/pedido/${resultado.venta.numero}`}>esta página</Link>.</p>
        </Tarjeta>
      </Marco>
    );
  }

  return (
    <Marco agencia={vendedor?.marca || cat.agencia}>
      <h1 style={{ marginBottom: 4 }}>Elige tu sistema</h1>
      <p className="suave" style={{ marginTop: 0 }}>{vendedor ? `Te atiende ${vendedor.nombre}. ` : ''}Licencia por instalación, activación inmediata al pagar.</p>
      <div className="grid-2">
        <Tarjeta titulo="1. Producto y plan">
          <div className="planes">
            {cat.productos.map((p: any) => (
              <div key={p.id} className="producto-publico">
                <strong>{p.nombre}</strong>{p.descripcion && <p className="suave pequeno" style={{ margin: '2px 0 6px' }}>{p.descripcion}</p>}
                <div className="chips">
                  {p.planes.map((pl: any) => <button key={pl.id} className={`chip ${planId === String(pl.id) ? 'activo' : ''}`} onClick={() => setPlanId(String(pl.id))}>{ETIQUETA_ESTADO[pl.tipo]} · {dinero(pl.precio, cat.moneda_base)}</button>)}
                  {p.planes.length === 0 && <span className="suave pequeno">Consultar</span>}
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
        <div>
          <Tarjeta titulo="2. Tus datos">
            <Formulario onEnviar={async () => {
              if (!plan) throw new Error('Elige un plan');
              const r = await api.post<any>('/publico/pedidos', { plan_id: plan.id, cantidad, ref: ref || undefined, moneda, pasarela: pasarela || undefined, cliente: { ...cliente, empresa: cliente.empresa || undefined, telefono: cliente.telefono || undefined, pais: cliente.pais || undefined } });
              setResultado(r);
            }} textoBoton={pasarela ? 'Continuar al pago' : 'Enviar pedido'}>
              <Campo etiqueta="Nombre"><input value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} required /></Campo>
              <Campo etiqueta="Negocio"><input value={cliente.empresa} onChange={(e) => setCliente({ ...cliente, empresa: e.target.value })} /></Campo>
              <Campo etiqueta="Correo"><input type="email" value={cliente.email} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} required /></Campo>
              <Campo etiqueta="WhatsApp"><input value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} placeholder="+51 999 999 999" /></Campo>
              <div className="grid-3" style={{ gap: 8 }}>
                <Campo etiqueta="Sucursales"><input type="number" min={1} max={20} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value)))} /></Campo>
                <Campo etiqueta="Moneda"><select value={moneda} onChange={(e) => setMoneda(e.target.value)}>{Object.keys(cat.tipos_cambio || { [cat.moneda_base]: 1 }).map((m) => <option key={m} value={m}>{m}</option>)}</select></Campo>
                <Campo etiqueta="Pago"><select value={pasarela} onChange={(e) => setPasarela(e.target.value)}><option value="">Coordinar después</option>{Object.entries(cat.pasarelas).filter(([, on]) => on).map(([k]) => <option key={k} value={k}>{k === 'demo' ? 'Demostración' : k === 'stripe' ? 'Tarjeta' : 'PayPal'}</option>)}</select></Campo>
              </div>
              <div className="indicador" style={{ marginBottom: 12 }}><span className="indicador-etiqueta">Total</span><strong className="indicador-valor">{plan ? dinero(total, moneda) : '—'}</strong>{plan && <span className="indicador-detalle">{plan.producto.nombre} · {ETIQUETA_ESTADO[plan.tipo]} × {cantidad}</span>}</div>
            </Formulario>
          </Tarjeta>
        </div>
      </div>
    </Marco>
  );
}

/** Pasarela de demostración: /pagar/demo/:id */
export function PagarDemo() {
  const { id } = useParams();
  const [e, setE] = useState<any | null>(null);
  const [hecho, setHecho] = useState(false);
  useEffect(() => { api.get<any>(`/publico/enlaces/${id}`).then(setE); }, [id]);
  if (!e) return <Marco><Cargando /></Marco>;
  return (
    <Marco agencia={e.agencia}>
      <Tarjeta>
        <h2>Pago de {dinero(e.monto, e.moneda)}</h2>
        <p className="suave">{e.producto_nombre} · {e.plan_nombre} · pedido {e.venta_numero} · {e.cliente_nombre}</p>
        {hecho || e.estado === 'pagado' ? (
          <Aviso tipo="ok">Pago confirmado. Tus licencias ya están activas; recibirás las claves de tu vendedor. <Link to={`/pedido/${e.venta_numero}`}>Ver mi pedido</Link></Aviso>
        ) : e.estado !== 'pendiente' ? <Aviso tipo="error">Este enlace ya no está vigente.</Aviso> : (
          <>
            <Aviso tipo="alerta">Pasarela de demostración: no se cobra nada. Sirve para probar el flujo completo antes de conectar Stripe o PayPal.</Aviso>
            <Formulario onEnviar={async () => { await api.post(`/publico/enlaces/${id}/demo/confirmar`); setHecho(true); }} textoBoton="Simular pago aprobado">
              <Campo etiqueta="Número de tarjeta (simulado)"><input defaultValue="4242 4242 4242 4242" /></Campo>
            </Formulario>
          </>
        )}
      </Tarjeta>
    </Marco>
  );
}

export function PagoResultado({ exito }: { exito: boolean }) {
  const [params] = useSearchParams();
  return (
    <Marco>
      <Tarjeta>
        {exito ? <><h2>¡Pago recibido!</h2><Aviso tipo="ok">Tu pago se confirmó y las licencias quedaron activas. Tu vendedor te enviará las claves; también puedes consultarlas en tu pedido.</Aviso></>
          : <><h2>Pago no completado</h2><Aviso tipo="error">{params.get('error') || 'El pago se canceló o no se pudo completar. Puedes intentarlo de nuevo desde el enlace que te enviaron.'}</Aviso></>}
      </Tarjeta>
    </Marco>
  );
}

/** Consulta pública de un pedido con el correo: /pedido/:numero */
export function PedidoPublico() {
  const { numero } = useParams();
  const [email, setEmail] = useState('');
  const [p, setP] = useState<any | null>(null);
  return (
    <Marco>
      <Tarjeta titulo={`Pedido ${numero}`}>
        {!p ? (
          <Formulario onEnviar={async () => setP(await api.get<any>(`/publico/pedidos/${numero}`, { email }))} textoBoton="Consultar">
            <Campo etiqueta="Correo con el que compraste"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Campo>
          </Formulario>
        ) : (
          <>
            <dl className="definiciones">
              <dt>Producto</dt><dd>{p.producto} · {p.plan}</dd>
              <dt>Total</dt><dd>{dinero(p.total, p.moneda)} · pagado {dinero(p.pagado, p.moneda)}</dd>
              <dt>Estado</dt><dd>{ETIQUETA_ESTADO[p.estado] || p.estado}</dd>
            </dl>
            {p.enlace_pago && <p><a className="btn" href={p.enlace_pago}>Pagar ahora</a></p>}
            {p.licencias.length > 0 && <><h3 style={{ marginTop: 14 }}>Tus claves</h3><ul className="lista-simple">{p.licencias.map((l: any) => <li key={l.clave}><code className="clave">{l.clave}</code><span className="suave">{l.etiqueta || ''}</span></li>)}</ul></>}
          </>
        )}
      </Tarjeta>
    </Marco>
  );
}
