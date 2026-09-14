import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dinero, fecha, ETIQUETA_ESTADO } from '../api';
import { useAjustes } from '../ajustes';
import { useSesion } from '../sesion';
import { useAvisar } from '../componentes/toast';
import { Aviso, Campo, Cargando, Estado, Modal, Tabla, Tarjeta } from '../componentes/ui';

const TIPOS = ['mensual', 'anual', 'vitalicio', 'sucursal_extra', 'mantenimiento'] as const;
type Tipo = typeof TIPOS[number];
const CORTO: Record<Tipo, string> = { mensual: 'Mensual', anual: 'Anual', vitalicio: 'Vitalicio', sucursal_extra: 'Sucursal +', mantenimiento: 'Manten./año' };
interface Nivel { nombre: string; mensual: number; anual: number; vitalicio: number }

const planDe = (p: any, tipo: string) => p.planes.find((pl: any) => pl.tipo === tipo && pl.activo) || p.planes.find((pl: any) => pl.tipo === tipo);

/**
 * Lista de precios (todos los roles) + simulador de venta. El dueño además edita los precios
 * aquí mismo: cambia celdas, aplica un nivel de un clic o sube todo un porcentaje.
 */
export function Precios() {
  const { usuario, esSuper } = useSesion();
  const ajustes = useAjustes();
  const avisar = useAvisar();
  const [productos, setProductos] = useState<any[] | null>(null);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Record<number, number>>({});
  const [motivo, setMotivo] = useState('');
  const [porcentaje, setPorcentaje] = useState<string>('');
  const [historial, setHistorial] = useState<any[] | null>(null);
  const cargar = () => Promise.all([api.get<any[]>('/productos', esSuper ? { todos: 1 } : undefined), api.get<Nivel[]>('/productos/niveles-precio')]).then(([p, n]) => { setProductos(p); setNiveles(n); });
  useEffect(() => { cargar(); }, []);
  const moneda = ajustes.moneda_base || 'USD';
  let cambios: Record<string, number> = {};
  try { cambios = JSON.parse(ajustes.tipos_cambio || '{}'); } catch { /* sin cambios */ }

  const precioDe = (pl: any) => (pl ? (borrador[pl.id] ?? pl.precio) : null);
  const pendientes = useMemo(() => productos ? Object.entries(borrador).filter(([id, v]) => { const pl = productos.flatMap((p) => p.planes).find((x: any) => x.id === Number(id)); return pl && pl.precio !== v; }) : [], [borrador, productos]);

  const aplicarNivel = (p: any, n: Nivel) => {
    const b = { ...borrador };
    const m = planDe(p, 'mensual'), a = planDe(p, 'anual'), v = planDe(p, 'vitalicio'), s = planDe(p, 'sucursal_extra'), mt = planDe(p, 'mantenimiento');
    if (m) b[m.id] = n.mensual; if (a) b[a.id] = n.anual; if (v) b[v.id] = n.vitalicio;
    if (s) b[s.id] = Math.round(n.vitalicio * 0.4); if (mt) b[mt.id] = Math.round(n.vitalicio * 0.2);
    setBorrador(b);
  };
  const guardar = async () => {
    const lista = pendientes.map(([id, precio]) => ({ plan_id: Number(id), precio }));
    const r = await api.post<any>('/planes/precios', { cambios: lista, motivo: motivo || undefined });
    avisar(`${r.total} precio(s) actualizado(s). Los vendedores ya ven la lista nueva.`);
    setBorrador({}); setMotivo(''); setEditando(false); await cargar();
  };
  const aplicarPorcentaje = async () => {
    const n = Number(porcentaje);
    if (!n) return;
    const r = await api.post<any>('/planes/precios/porcentaje', { porcentaje: n, motivo: `Ajuste general del ${n}%` });
    avisar(`${r.total} precio(s) ajustados un ${n}%`); setPorcentaje(''); await cargar();
  };

  if (!productos) return <Cargando />;
  const visibles = productos.filter((p) => p.activo || esSuper);

  return (
    <>
      <header>
        <div><h1>Lista de precios</h1><p>{esSuper ? 'Tú fijas los precios; el equipo vende con esta lista y solo puede aplicar el descuento que autorices.' : `Precios de lista en ${moneda}. Tu descuento máximo es ${usuario!.rol === 'admin' ? ajustes.tope_descuento_admin_pct || 15 : ajustes.tope_descuento_pct || 10}%; más que eso lo autoriza el dueño.`}</p></div>
        <div className="fila">
          {esSuper && !editando && <button className="btn" onClick={() => setEditando(true)}>Editar precios</button>}
          {esSuper && <button className="btn secundario" onClick={() => api.get<any[]>('/planes/historial-precios').then(setHistorial)}>Historial</button>}
          <Link to="/guia" className="btn secundario">¿Cómo se vende?</Link>
        </div>
      </header>

      {editando && (
        <Aviso tipo="info">
          <strong>Modo edición.</strong> Cambia los precios en la tabla, o aplica un nivel a un producto con los botones de la derecha. Nada se guarda hasta que pulses <em>Guardar cambios</em>. Las ventas ya registradas conservan su precio; las renovaciones futuras usan el nuevo.
        </Aviso>
      )}

      <Tarjeta titulo={`Precios de lista (${moneda})`} acciones={editando ? (
        <div className="fila">
          <input placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ minWidth: 220 }} />
          <button className="btn secundario chico" onClick={() => { setBorrador({}); setEditando(false); }}>Cancelar</button>
          <button className="btn chico" disabled={!pendientes.length} onClick={guardar}>Guardar cambios ({pendientes.length})</button>
        </div>
      ) : <span className="suave pequeno">Anual ≈ 9,5 meses · vitalicio ≈ 20 meses · sucursal 40 % · mantenimiento 20 % del vitalicio</span>}>
        <div className="tabla-envoltorio">
          <table className="tabla" aria-label="Lista de precios">
            <thead><tr><th>Producto</th>{TIPOS.map((t) => <th key={t} className="derecha">{CORTO[t]}</th>)}{editando && <th>Aplicar nivel</th>}</tr></thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.55 }}>
                  <td><strong>{p.nombre}</strong>{!p.activo && <> <Estado valor="suspendida" /></>}<div className="suave pequeno">{p.descripcion}</div></td>
                  {TIPOS.map((t) => {
                    const pl = planDe(p, t);
                    if (!pl) return <td key={t} className="derecha suave">—</td>;
                    const v = precioDe(pl)!;
                    const cambiado = borrador[pl.id] !== undefined && borrador[pl.id] !== pl.precio;
                    return (
                      <td key={t} className="derecha">
                        {editando ? <input type="number" min={0} step={1} value={v} onChange={(e) => setBorrador({ ...borrador, [pl.id]: Number(e.target.value) })} style={{ width: 90, textAlign: 'right', borderColor: cambiado ? 'var(--primario)' : undefined }} aria-label={`${p.nombre} ${CORTO[t]}`} />
                          : <><strong>{dinero(v, moneda)}</strong>{pl.precio_anterior != null && pl.precio_desde && <div className="suave pequeno" title={`Antes ${dinero(pl.precio_anterior, moneda)}`}>desde {fecha(pl.precio_desde)}</div>}</>}
                      </td>
                    );
                  })}
                  {editando && <td><div className="chips">{niveles.map((n, i) => <button key={n.nombre} className="chip" title={`${n.nombre}: ${n.mensual} / ${n.anual} / ${n.vitalicio}`} onClick={() => aplicarNivel(p, n)}>N{i + 1}</button>)}</div></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editando && (
          <div className="fila" style={{ marginTop: 14, justifyContent: 'space-between' }}>
            <div className="suave pequeno">Niveles: {niveles.map((n, i) => `N${i + 1} ${n.nombre} (${n.mensual}/${n.anual}/${n.vitalicio})`).join(' · ')}. Se editan en Ajustes › Ventas.</div>
            <div className="fila"><span className="pequeno">Subir o bajar todo</span><input type="number" step={1} placeholder="%" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} style={{ width: 80 }} /><button className="btn secundario chico" disabled={!Number(porcentaje)} onClick={aplicarPorcentaje}>Aplicar a toda la lista</button></div>
          </div>
        )}
      </Tarjeta>

      {!esSuper && Object.keys(cambios).length > 1 && (
        <Tarjeta titulo="En la moneda del cliente">
          <p className="suave pequeno" style={{ marginTop: 0 }}>Referencia con los tipos de cambio de Ajustes. El cobro real se calcula al registrar la venta.</p>
          <div className="chips">{Object.entries(cambios).filter(([m]) => m !== moneda).map(([m, tc]) => <span key={m} className="chip">{m} · ×{tc}</span>)}</div>
        </Tarjeta>
      )}

      <Simulador productos={visibles.filter((p) => p.activo)} moneda={moneda} cambios={cambios} />

      <Modal titulo="Historial de cambios de precio" abierto={!!historial} cerrar={() => setHistorial(null)}>
        <Tabla filas={historial || []} clave={(h: any) => h.id} vacio="Todavía no cambiaste ningún precio" columnas={[
          { titulo: 'Cuándo', celda: (h: any) => fecha(h.creado_en, true) },
          { titulo: 'Plan', celda: (h: any) => <>{h.producto_nombre} · {ETIQUETA_ESTADO[h.plan_tipo] || h.plan_tipo}</> },
          { titulo: 'Antes', celda: (h: any) => dinero(h.precio_anterior, moneda), alinear: 'derecha' },
          { titulo: 'Después', celda: (h: any) => <strong>{dinero(h.precio_nuevo, moneda)}</strong>, alinear: 'derecha' },
          { titulo: 'Quién / motivo', celda: (h: any) => <>{h.usuario_nombre}{h.motivo && <div className="suave pequeno">{h.motivo}</div>}</> },
        ]} />
      </Modal>
    </>
  );
}

/** Simulador: elige producto, plan, cantidad y descuento y ve qué paga el cliente, qué gana el vendedor y qué recibe la agencia. */
function Simulador({ productos, moneda, cambios }: { productos: any[]; moneda: string; cambios: Record<string, number> }) {
  const { usuario, esSuper } = useSesion();
  const ajustes = useAjustes();
  const [productoId, setProductoId] = useState('');
  const [tipo, setTipo] = useState<Tipo>('vitalicio');
  const [cantidad, setCantidad] = useState(1);
  const [descuento, setDescuento] = useState(0);
  const [monedaCliente, setMonedaCliente] = useState(moneda);
  const [pctVendedor, setPctVendedor] = useState<number>(usuario!.comision_pct ?? 20);
  useEffect(() => { if (!productoId && productos.length) setProductoId(String(productos[0].id)); }, [productos, productoId]);
  const producto = productos.find((p) => String(p.id) === productoId);
  const plan = producto ? planDe(producto, tipo) : null;
  const sucursal = producto ? planDe(producto, 'sucursal_extra') : null;
  const tope = esSuper ? 100 : Number(usuario!.rol === 'admin' ? ajustes.tope_descuento_admin_pct || 15 : ajustes.tope_descuento_pct || 10);
  if (!producto || !plan) return null;
  const pct = plan.comision_pct ?? pctVendedor;
  const extra = Math.max(0, cantidad - 1);
  const base = plan.precio + (sucursal && extra > 0 && tipo === 'vitalicio' ? extra * sucursal.precio : extra * plan.precio);
  const desc = Math.min(descuento, tope);
  const totalBase = base * (1 - desc / 100);
  const tc = monedaCliente === moneda ? 1 : cambios[monedaCliente] || 1;
  const comision = (totalBase * pct) / 100;
  const meses = tipo === 'mensual' ? 1 : tipo === 'anual' ? 12 : 0;

  return (
    <Tarjeta titulo="Simulador de venta" acciones={<span className="suave pequeno">Para entender qué cobra el cliente y qué gana cada uno</span>}>
      <div className="grid-2">
        <div>
          <Campo etiqueta="Producto"><select value={productoId} onChange={(e) => setProductoId(e.target.value)}>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Plan"><div className="chips">{(['mensual', 'anual', 'vitalicio'] as Tipo[]).filter((t) => planDe(producto, t)).map((t) => <button key={t} className={`chip ${tipo === t ? 'activo' : ''}`} onClick={() => setTipo(t)}>{CORTO[t]} · {dinero(planDe(producto, t).precio, moneda)}</button>)}</div></Campo>
          <div className="fila">
            <Campo etiqueta="Sedes / licencias"><input type="number" min={1} max={20} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value)))} style={{ width: 90 }} /></Campo>
            <Campo etiqueta={`Descuento % (máx. ${tope}%)`}><input type="number" min={0} max={tope} step={1} value={descuento} onChange={(e) => setDescuento(Math.max(0, Number(e.target.value)))} style={{ width: 90 }} /></Campo>
            <Campo etiqueta="Moneda del cliente"><select value={monedaCliente} onChange={(e) => setMonedaCliente(e.target.value)} style={{ width: 110 }}>{[moneda, ...Object.keys(cambios).filter((m) => m !== moneda)].map((m) => <option key={m} value={m}>{m}</option>)}</select></Campo>
            {esSuper && <Campo etiqueta="Comisión del vendedor %"><input type="number" min={0} max={100} value={pctVendedor} onChange={(e) => setPctVendedor(Number(e.target.value))} style={{ width: 90 }} /></Campo>}
          </div>
          {descuento > tope && <Aviso tipo="alerta">Un descuento del {descuento}% supera tu tope ({tope}%). El sistema lo rechazará; pídeselo al dueño.</Aviso>}
        </div>
        <div>
          <dl className="definiciones">
            <dt>Precio de lista</dt><dd>{dinero(plan.precio, moneda)}{extra > 0 && <span className="suave pequeno"> + {extra} sede(s) {tipo === 'vitalicio' && sucursal ? `a ${dinero(sucursal.precio, moneda)} (precio de sucursal adicional)` : `al mismo precio`}</span>}</dd>
            <dt>Subtotal</dt><dd>{dinero(base, moneda)}</dd>
            {desc > 0 && <><dt>Descuento {desc}%</dt><dd>−{dinero(base - totalBase, moneda)}</dd></>}
            <dt><strong>El cliente paga</strong></dt><dd><strong>{dinero(totalBase * tc, monedaCliente)}</strong>{tc !== 1 && <span className="suave pequeno"> · {dinero(totalBase, moneda)} en base</span>}{meses === 1 && <span className="suave pequeno"> cada mes</span>}{meses === 12 && <span className="suave pequeno"> por el año (equivale a {dinero(totalBase / 12, moneda)}/mes)</span>}</dd>
            <dt>Gana el vendedor ({pct}%)</dt><dd className="ok"><strong style={{ color: 'var(--ok)' }}>{dinero(comision, moneda)}</strong>{meses === 1 && <span className="suave pequeno"> cada mes que el cliente pague</span>}</dd>
            <dt>Recibe la agencia</dt><dd>{dinero(totalBase - comision, moneda)}</dd>
          </dl>
          <p className="suave pequeno" style={{ marginBottom: 0 }}>{tipo === 'vitalicio' ? `El vitalicio incluye ${ajustes.soporte_vitalicio_dias || 365} días de soporte y actualizaciones; después se ofrece el mantenimiento anual.` : tipo === 'mensual' ? `Si el cliente deja de pagar, tiene ${ajustes.gracia_dias || 7} días de gracia y luego el sistema se suspende solo.` : 'El anual ahorra al cliente unos 2,5 meses frente al mensual y a ti te asegura la comisión de una vez.'}</p>
        </div>
      </div>
    </Tarjeta>
  );
}

