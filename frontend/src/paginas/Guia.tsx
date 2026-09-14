import { Link } from 'react-router-dom';
import { useSesion } from '../sesion';
import { useAjustes } from '../ajustes';
import { Tarjeta } from '../componentes/ui';

const PASOS = [
  { n: 1, t: 'Cliente', d: 'Registras el negocio con teléfono (WhatsApp) y moneda. Un cliente puede tener varias sedes; cada sede será una licencia.', a: '/clientes' },
  { n: 2, t: 'Demo', d: 'Le instalas la demo gratis de 7 días desde Nueva venta › plan Demo. Se activa al instante. La venta se cierra el día 5 o 6.', a: '/ventas/nueva' },
  { n: 3, t: 'Venta', d: 'Eliges producto y plan (mensual, anual o vitalicio). El precio lo pone la lista; tú solo aplicas tu descuento permitido. Se emiten las licencias en "pendiente de pago".', a: '/precios' },
  { n: 4, t: 'Cobro', d: 'Registras el pago (efectivo, Yape, transferencia…) con su comprobante, o le envías un enlace de pago para que pague solo.', a: '/ventas' },
  { n: 5, t: 'Confirmación', d: 'Un admin o el dueño confirma el pago. En ese momento la licencia se activa y tu comisión queda devengada.', a: '/ventas?estado=pendiente' },
  { n: 6, t: 'Activación', d: 'El cliente pega la clave en su sistema. Queda atada a ese equipo. Si cambia de PC, el dueño libera el equipo.', a: '/licencias' },
  { n: 7, t: 'Caja', d: 'Al final del día cierras tu caja: lo cobrado en mano se entrega. El dueño aprueba u observa el cierre.', a: '/caja' },
  { n: 8, t: 'Liquidación', d: 'El dueño liquida las comisiones devengadas (semanal o quincenal) y te entrega el recibo en PDF.', a: '/comisiones' },
];

const PERMISOS: { que: string; vendedor: string; admin: string; dueno: string }[] = [
  { que: 'Ver la lista de precios y el simulador', vendedor: 'Sí', admin: 'Sí', dueno: 'Sí' },
  { que: 'Cambiar precios del catálogo', vendedor: 'No', admin: 'No', dueno: 'Sí' },
  { que: 'Descuento en una venta', vendedor: 'Hasta su tope', admin: 'Hasta su tope (mayor)', dueno: 'Sin tope' },
  { que: 'Registrar ventas y cobros', vendedor: 'De sus clientes', admin: 'De cualquier cliente', dueno: 'Sí' },
  { que: 'Confirmar o rechazar un pago', vendedor: 'No', admin: 'Sí', dueno: 'Sí' },
  { que: 'Ver ventas y licencias', vendedor: 'Solo las suyas', admin: 'Todas', dueno: 'Todas' },
  { que: 'Suspender, revocar o liberar licencias', vendedor: 'No', admin: 'No', dueno: 'Sí' },
  { que: 'Código de emergencia (72 h)', vendedor: 'De sus licencias', admin: 'Sí', dueno: 'Sí' },
  { que: 'Ver comisiones', vendedor: 'Solo las suyas', admin: 'Solo las suyas', dueno: 'De todo el equipo' },
  { que: 'Liquidar y pagar comisiones', vendedor: 'No', admin: 'No', dueno: 'Sí' },
  { que: 'Caja', vendedor: 'Cierra la suya', admin: 'Ve las de todos', dueno: 'Aprueba u observa' },
  { que: 'Equipo', vendedor: 'No', admin: 'Nombres, roles y topes', dueno: 'Todo, incluido lo que gana cada uno' },
  { que: 'Reportes por vendedor', vendedor: 'Solo lo suyo', admin: 'Totales de la agencia', dueno: 'Por producto y por vendedor' },
  { que: 'Catálogo, Auditoría, Ajustes, correos, respaldos', vendedor: 'No', admin: 'No', dueno: 'Sí' },
  { que: 'Facturación electrónica y Excel contable', vendedor: 'No', admin: 'Emite comprobantes', dueno: 'Sí (también el rol Contador)' },
];

export function Guia() {
  const { usuario, esSuper } = useSesion();
  const ajustes = useAjustes();
  const rol = usuario!.rol;
  const tope = rol === 'admin' ? ajustes.tope_descuento_admin_pct || 15 : ajustes.tope_descuento_pct || 10;
  const columna = esSuper ? 'dueno' : rol === 'admin' ? 'admin' : 'vendedor';
  return (
    <>
      <header><div><h1>Cómo funciona CONTROL</h1><p>{esSuper ? 'Tú fijas precios, apruebas dinero y ves todo. El equipo vende dentro de las reglas que pongas aquí.' : `Vendes software listo y barato a negocios pequeños. Tu comisión es ${usuario!.comision_pct}% de cada cobro confirmado y puedes descontar hasta ${tope}%.`}</p></div><Link to="/precios" className="btn">Ver precios y simular una venta</Link></header>

      <Tarjeta titulo="El recorrido de una venta, paso a paso">
        <ol className="guia-pasos">
          {PASOS.map((p) => (
            <li key={p.n}><Link to={p.a}><span className="guia-num">{p.n}</span><strong>{p.t}</strong><p>{p.d}</p></Link></li>
          ))}
        </ol>
      </Tarjeta>

      <div className="grid-2">
        <Tarjeta titulo="Los tres planes, explicados al cliente">
          <ul className="lista-simple guia-lista">
            <li><span><strong>Mensual.</strong> Para entrar sin miedo. Si deja de pagar, {ajustes.gracia_dias || 7} días de gracia y el sistema se pausa solo. Cobras comisión cada mes.</span></li>
            <li><span><strong>Anual.</strong> Ahorra unos 2,5 meses. Tu comisión llega completa de una vez.</span></li>
            <li><span><strong>Vitalicio.</strong> Paga una sola vez. Incluye {Math.round(Number(ajustes.soporte_vitalicio_dias || 365) / 30)} meses de soporte y actualizaciones; después se le ofrece el mantenimiento anual (también con comisión).</span></li>
            <li><span><strong>Sucursal adicional.</strong> Cada sede es una licencia, más barata que la primera. Se ofrece a los tres meses, cuando ya usan el sistema.</span></li>
          </ul>
        </Tarjeta>
        <Tarjeta titulo="Reglas de dinero que aplica el sistema">
          <ul className="lista-simple guia-lista">
            <li><span>El precio nunca se escribe a mano: sale de la lista que fija el dueño. Un vendedor solo puede aplicar un descuento hasta {ajustes.tope_descuento_pct || 10}% y un admin hasta {ajustes.tope_descuento_admin_pct || 15}%.</span></li>
            <li><span>La comisión se calcula sobre lo cobrado en moneda base y se devenga solo cuando el pago está confirmado. Si la venta se anula, la comisión se revierte.</span></li>
            <li><span>Cada vendedor tiene un tope de licencias por día y de demos por semana. El dueño lo ve en Equipo.</span></li>
            <li><span>Si cumples tu meta del mes, tus cobros llevan un bono extra de comisión (lo define el dueño en Equipo › Meta).</span></li>
            <li><span>Todo queda auditado: quién vendió, quién confirmó, quién suspendió y por qué.</span></li>
          </ul>
        </Tarjeta>
      </div>

      <Tarjeta titulo="Quién puede hacer qué" acciones={<span className="suave pequeno">Tu columna está resaltada · Soporte: tickets, licencias y códigos de emergencia · Contador: caja, comisiones y Excel</span>}>
        <div className="tabla-envoltorio">
          <table className="tabla" aria-label="Permisos por rol">
            <thead><tr><th></th><th className={columna === 'vendedor' ? 'guia-yo' : ''}>Vendedor</th><th className={columna === 'admin' ? 'guia-yo' : ''}>Admin</th><th className={columna === 'dueno' ? 'guia-yo' : ''}>Dueño</th></tr></thead>
            <tbody>{PERMISOS.map((p) => <tr key={p.que}><td>{p.que}</td><td className={columna === 'vendedor' ? 'guia-yo' : ''}>{p.vendedor}</td><td className={columna === 'admin' ? 'guia-yo' : ''}>{p.admin}</td><td className={columna === 'dueno' ? 'guia-yo' : ''}>{p.dueno}</td></tr>)}</tbody>
          </table>
        </div>
      </Tarjeta>

      {esSuper && (
        <Tarjeta titulo="Lo que solo tú controlas">
          <ul className="lista-simple guia-lista">
            <li><span><strong>Precios:</strong> en <Link to="/precios">Lista de precios › Editar</Link>. Cambia celdas, aplica un nivel (Micro, Servicios simples, Negocio establecido, Profesional regulado) o sube toda la lista un porcentaje. Queda historial de cada cambio.</span></li>
            <li><span><strong>Topes de descuento y niveles:</strong> en <Link to="/ajustes">Ajustes › Ventas</Link>.</span></li>
            <li><span><strong>Comisiones y metas:</strong> por persona en <Link to="/equipo">Equipo</Link>; liquidaciones en <Link to="/comisiones">Comisiones</Link>.</span></li>
            <li><span><strong>Licencias:</strong> suspender, revocar, liberar equipos y transferir entre clientes, siempre con motivo.</span></li>
            <li><span><strong>Auditoría, correos, respaldos y errores:</strong> solo tú los ves.</span></li>
          </ul>
        </Tarjeta>
      )}
    </>
  );
}
