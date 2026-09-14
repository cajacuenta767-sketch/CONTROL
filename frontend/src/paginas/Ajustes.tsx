import { useEffect, useState } from 'react';
import { api, fecha } from '../api';
import { invalidarAjustes } from '../ajustes';
import { Aviso, BotonAccion, Campo, Estado, Formulario, Tabla, Tarjeta } from '../componentes/ui';
import { SeguridadCuenta } from './Seguridad';

type CampoDef = { clave: string; etiqueta: string; ayuda?: string; tipo?: 'text' | 'number' | 'password' | 'textarea' | 'select'; opciones?: [string, string][] };

const SECCIONES: { titulo: string; descripcion?: string; campos: CampoDef[] }[] = [
  { titulo: 'Agencia', campos: [
    { clave: 'nombre_agencia', etiqueta: 'Nombre de la agencia', ayuda: 'Aparece en recibos, correos y páginas públicas.' },
    { clave: 'direccion_agencia', etiqueta: 'Dirección / datos fiscales', ayuda: 'Se imprime bajo el nombre en los recibos PDF.' },
    { clave: 'url_publica', etiqueta: 'URL pública del panel', ayuda: 'Base de los enlaces de correos, pagos y compra. Ej.: https://control.tuagencia.com' },
    { clave: 'desfase_horario_horas', etiqueta: 'Zona horaria (horas respecto a UTC)', ayuda: 'Lima/Bogotá/Quito −5 · La Paz/Santiago/Caracas −4 · Buenos Aires −3 · México −6.', tipo: 'number' },
  ] },
  { titulo: 'Precios y monedas', campos: [
    { clave: 'moneda_base', etiqueta: 'Moneda base', ayuda: 'Los precios de lista y las comisiones se expresan en esta moneda.' },
    { clave: 'tipos_cambio', etiqueta: 'Tipos de cambio', ayuda: 'JSON: unidades de cada moneda por 1 de la base. Ej.: {"USD":1,"PEN":3.75,"BOB":6.9}', tipo: 'textarea' },
    { clave: 'tope_descuento_pct', etiqueta: 'Descuento máximo para vendedores y admins (%)', tipo: 'number' },
  ] },
  { titulo: 'Comisiones y licencias', campos: [
    { clave: 'comision_renovacion_pct', etiqueta: 'Comisión por renovación después del primer año (%)', tipo: 'number' },
    { clave: 'gracia_dias', etiqueta: 'Días de gracia tras el vencimiento', ayuda: 'La licencia pasa a "mora" y sigue funcionando con aviso; después se suspende.', tipo: 'number' },
    { clave: 'demo_dias', etiqueta: 'Duración de las demos (días)', tipo: 'number' },
    { clave: 'soporte_vitalicio_dias', etiqueta: 'Soporte incluido en el vitalicio (días)', tipo: 'number' },
    { clave: 'metodos_en_mano', etiqueta: 'Métodos que el vendedor entrega en mano', ayuda: 'Separados por coma. Definen el "a entregar" del cierre de caja.' },
    { clave: 'hora_recordatorio_caja', etiqueta: 'Hora del recordatorio de cierre de caja (0-23)', ayuda: 'Se envía por correo a los vendedores con cobros y sin cierre.', tipo: 'number' },
  ] },
  { titulo: 'Pasarelas de pago', descripcion: 'Con una pasarela configurada, los enlaces de pago confirman el cobro solos y activan las licencias.', campos: [
    { clave: 'pasarela_demo', etiqueta: 'Pasarela de demostración', ayuda: 'Permite probar el flujo sin cobrar. Desactívala en producción.', tipo: 'select', opciones: [['1', 'Activa'], ['0', 'Desactivada']] },
    { clave: 'stripe_clave_secreta', etiqueta: 'Stripe · clave secreta (sk_live_… / sk_test_…)', tipo: 'password' },
    { clave: 'stripe_webhook_secreto', etiqueta: 'Stripe · secreto del webhook (whsec_…)', ayuda: 'Configura en Stripe el webhook checkout.session.completed apuntando a {url}/api/v1/webhooks/stripe', tipo: 'password' },
    { clave: 'paypal_cliente', etiqueta: 'PayPal · Client ID' },
    { clave: 'paypal_secreto', etiqueta: 'PayPal · Secret', tipo: 'password' },
    { clave: 'paypal_sandbox', etiqueta: 'PayPal · entorno', tipo: 'select', opciones: [['1', 'Sandbox (pruebas)'], ['0', 'Producción']] },
  ] },
  { titulo: 'Correo (SMTP)', descripcion: 'Necesario para recuperar contraseñas, avisos de vencimiento y recordatorios. Sin SMTP, los correos quedan registrados pero no se envían.', campos: [
    { clave: 'smtp_host', etiqueta: 'Servidor SMTP', ayuda: 'Ej.: smtp.gmail.com, smtp.zoho.com, smtp-relay.brevo.com' },
    { clave: 'smtp_puerto', etiqueta: 'Puerto', ayuda: '587 (STARTTLS) o 465 (SSL)', tipo: 'number' },
    { clave: 'smtp_usuario', etiqueta: 'Usuario' },
    { clave: 'smtp_clave', etiqueta: 'Contraseña o clave de aplicación', tipo: 'password' },
    { clave: 'smtp_desde', etiqueta: 'Remitente', ayuda: 'Ej.: "Mi Agencia" <no-responder@miagencia.com>' },
  ] },
  { titulo: 'Avisos automáticos', campos: [
    { clave: 'dias_aviso_vencimiento', etiqueta: 'Días antes del vencimiento para avisar', ayuda: 'Separados por coma. Ej.: 30,7,1' },
    { clave: 'renovacion_automatica_dias', etiqueta: 'Días antes del vencimiento para generar la renovación con enlace de pago', ayuda: '0 desactiva. Requiere pasarela y correo configurados.', tipo: 'number' },
    { clave: 'respaldos_conservar', etiqueta: 'Respaldos diarios a conservar', tipo: 'number' },
  ] },
  { titulo: 'Plantillas de WhatsApp', descripcion: 'Marcadores disponibles: {cliente} {producto} {agencia} {claves} {claves_intro} {monto} {venta} {vence} {enlace}', campos: [
    { clave: 'plantilla_wa_claves', etiqueta: 'Envío de claves', tipo: 'textarea' },
    { clave: 'plantilla_wa_cobro', etiqueta: 'Recordatorio de cobro', tipo: 'textarea' },
    { clave: 'plantilla_wa_renovacion', etiqueta: 'Renovación próxima', tipo: 'textarea' },
  ] },
  { titulo: 'Integraciones', campos: [
    { clave: 'api_key_pedidos', etiqueta: 'API key para pedidos externos (DevMarket)', ayuda: 'Envíala en la cabecera X-Api-Key al llamar a POST /api/v1/publico/pedidos.', tipo: 'password' },
    { clave: 'portal_activo', etiqueta: 'Portal del cliente', tipo: 'select', opciones: [['1', 'Activo'], ['0', 'Desactivado']] },
  ] },
];

export function Ajustes() {
  const [v, setV] = useState<Record<string, string>>({});
  const [clavePublica, setClavePublica] = useState('');
  const [correoPrueba, setCorreoPrueba] = useState('');
  const [correos, setCorreos] = useState<any[]>([]);
  const [seccion, setSeccion] = useState(0);
  const cargarCorreos = () => api.get<any>('/correos').then((r) => setCorreos(r.filas)).catch(() => null);
  useEffect(() => {
    api.get<Record<string, string>>('/ajustes').then(setV);
    fetch('/api/v1/licencias/clave-publica').then((r) => r.json()).then((r) => setClavePublica(r.clave_publica_base64));
    cargarCorreos();
  }, []);
  const s = SECCIONES[seccion];

  return (
    <>
      <header><div><h1>Ajustes</h1><p>Reglas del negocio, pasarelas, correo e integraciones.</p></div></header>
      <div className="chips" style={{ marginBottom: 14 }}>
        {SECCIONES.map((x, i) => <button key={x.titulo} className={`chip ${i === seccion ? 'activo' : ''}`} onClick={() => setSeccion(i)}>{x.titulo}</button>)}
        <button className={`chip ${seccion === -1 ? 'activo' : ''}`} onClick={() => setSeccion(-1)}>Seguridad de mi cuenta</button>
        <button className={`chip ${seccion === -2 ? 'activo' : ''}`} onClick={() => setSeccion(-2)}>Correos enviados</button>
      </div>

      {seccion >= 0 && (
        <div className="grid-2">
          <Tarjeta titulo={s.titulo}>
            {s.descripcion && <p className="suave" style={{ marginTop: 0 }}>{s.descripcion.replace('{url}', v.url_publica || '')}</p>}
            <Formulario onEnviar={async () => { await api.patch('/ajustes', Object.fromEntries(s.campos.map((c) => [c.clave, v[c.clave] ?? '']))); invalidarAjustes(); }} exito="Ajustes guardados">
              {s.campos.map((c) => (
                <Campo key={c.clave} etiqueta={c.etiqueta} ayuda={c.ayuda?.replace('{url}', v.url_publica || '')}>
                  {c.tipo === 'textarea' ? <textarea rows={c.clave === 'tipos_cambio' ? 2 : 4} value={v[c.clave] ?? ''} onChange={(e) => setV({ ...v, [c.clave]: e.target.value })} />
                    : c.tipo === 'select' ? <select value={v[c.clave] ?? ''} onChange={(e) => setV({ ...v, [c.clave]: e.target.value })}>{c.opciones!.map(([val, t]) => <option key={val} value={val}>{t}</option>)}</select>
                    : <input type={c.tipo === 'password' ? 'text' : c.tipo || 'text'} value={v[c.clave] ?? ''} onChange={(e) => setV({ ...v, [c.clave]: e.target.value })} placeholder={c.tipo === 'password' ? 'Sin configurar' : ''} autoComplete="off" />}
                </Campo>
              ))}
            </Formulario>
            {s.titulo === 'Correo (SMTP)' && (
              <div className="fila" style={{ marginTop: 8 }}>
                <input type="email" placeholder="Enviar prueba a…" value={correoPrueba} onChange={(e) => setCorreoPrueba(e.target.value)} style={{ maxWidth: 260 }} />
                <BotonAccion texto="Probar envío" className="btn secundario" onClick={async () => { const r = await api.post<any>('/ajustes/probar-smtp', { para: correoPrueba }); if (!r.ok) throw new Error(r.error || 'No se pudo enviar'); await cargarCorreos(); }} exito="Correo de prueba enviado" />
                <span className="suave pequeno">Guarda primero los cambios.</span>
              </div>
            )}
          </Tarjeta>
          <div>
            {s.titulo === 'Agencia' && (
              <Tarjeta titulo="Clave pública para los productos">
                <p className="suave pequeno">Embebe esta clave Ed25519 en cada software para que verifique los tokens de licencia sin conexión. Es pública: no es un secreto.</p>
                <textarea readOnly rows={3} value={clavePublica} onFocus={(e) => e.currentTarget.select()} />
                <p className="suave pequeno">La clave privada vive en la base de datos de CONTROL. Respáldala: si se pierde, hay que reemitir todas las activaciones.</p>
              </Tarjeta>
            )}
            {s.titulo === 'Pasarelas de pago' && (
              <Tarjeta titulo="Cómo funciona">
                <ol className="suave" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
                  <li>En una venta pendiente, crea un <strong>enlace de pago</strong> y envíalo al cliente por WhatsApp.</li>
                  <li>El cliente paga con tarjeta (Stripe) o PayPal.</li>
                  <li>La pasarela avisa a CONTROL; el cobro se confirma solo, se devenga la comisión y se activan las licencias.</li>
                </ol>
                <Aviso tipo="info">Webhook de Stripe: <code className="clave">{(v.url_publica || 'https://tu-dominio')}/api/v1/webhooks/stripe</code> · evento <code className="clave">checkout.session.completed</code></Aviso>
              </Tarjeta>
            )}
            {s.titulo === 'Integraciones' && (
              <Tarjeta titulo="Página pública de compra">
                <p className="suave">Cada vendedor tiene su enlace en el panel. La página genérica es:</p>
                <code className="clave" style={{ whiteSpace: 'normal' }}>{(v.url_publica || '')}/comprar</code>
                <p className="suave pequeno">Los pedidos entran atribuidos al vendedor del código <code>?ref=</code>, o al superadministrador si no hay código.</p>
              </Tarjeta>
            )}
          </div>
        </div>
      )}
      {seccion === -1 && <div className="grid-2"><div><SeguridadCuenta /></div></div>}
      {seccion === -2 && (
        <Tarjeta titulo="Correos enviados" acciones={<button className="btn secundario chico" onClick={cargarCorreos}>Actualizar</button>}>
          <Tabla filas={correos} clave={(c) => c.id} vacio="Todavía no se ha enviado ningún correo" columnas={[
            { titulo: 'Fecha', celda: (c) => fecha(c.creado_en, true) },
            { titulo: 'Para', celda: (c) => c.para },
            { titulo: 'Asunto', celda: (c) => c.asunto },
            { titulo: 'Estado', celda: (c) => <><Estado valor={c.estado === 'enviado' ? 'confirmado' : c.estado === 'error' ? 'rechazado' : 'pendiente'} /> {c.estado === 'sin_smtp' && <span className="suave pequeno">sin SMTP configurado</span>}{c.error && <span className="suave pequeno"> · {c.error}</span>}</> },
            { titulo: '', celda: (c) => <BotonAccion texto="Ver" className="btn secundario chico" onClick={async () => { const d = await api.get<any>(`/correos/${c.id}`); const w = window.open('', '_blank'); if (w) { w.document.write(d.html); w.document.close(); } }} /> },
          ]} />
        </Tarjeta>
      )}
    </>
  );
}
