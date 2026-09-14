import { useEffect, useState } from 'react';
import { api, fecha, sesion } from '../api';
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
    { clave: 'tope_descuento_pct', etiqueta: 'Descuento máximo que puede dar un vendedor (%)', ayuda: 'Por encima de esto la venta se rechaza; solo tú puedes superarlo.', tipo: 'number' },
    { clave: 'tope_descuento_admin_pct', etiqueta: 'Descuento máximo que puede dar un admin (%)', tipo: 'number' },
    { clave: 'niveles_precio', etiqueta: 'Niveles de precio sugeridos', ayuda: 'JSON con nombre, mensual, anual y vitalicio. Aparecen como botones en Lista de precios › Editar.', tipo: 'textarea' },
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
    { clave: 'culqi_clave_publica', etiqueta: 'Culqi · llave pública (pk_live_… / pk_test_…)', ayuda: 'Culqi cobra en Perú con Yape, tarjetas y PagoEfectivo. Se activa sola cuando ambas llaves están puestas.' },
    { clave: 'culqi_clave_secreta', etiqueta: 'Culqi · llave secreta (sk_live_… / sk_test_…)', ayuda: 'En el panel de Culqi registra el webhook {url}/api/v1/webhooks/culqi para los eventos order.status.changed y charge.creation.succeeded.', tipo: 'password' },
  ] },
  { titulo: 'Correo (SMTP)', descripcion: 'Necesario para recuperar contraseñas, avisos de vencimiento y recordatorios. Sin SMTP, los correos quedan registrados pero no se envían.', campos: [
    { clave: 'smtp_host', etiqueta: 'Servidor SMTP', ayuda: 'Ej.: smtp.gmail.com, smtp.zoho.com, smtp-relay.brevo.com' },
    { clave: 'smtp_puerto', etiqueta: 'Puerto', ayuda: '587 (STARTTLS) o 465 (SSL)', tipo: 'number' },
    { clave: 'smtp_usuario', etiqueta: 'Usuario' },
    { clave: 'smtp_clave', etiqueta: 'Contraseña o clave de aplicación', tipo: 'password' },
    { clave: 'smtp_desde', etiqueta: 'Remitente', ayuda: 'Ej.: "Mi Agencia" <no-responder@miagencia.com>' },
  ] },
  { titulo: 'WhatsApp y alertas', descripcion: 'WhatsApp Cloud API (Meta) para recordatorios automáticos al cliente; Telegram o WhatsApp para avisarte a ti. Prueba los canales desde el botón de abajo.', campos: [
    { clave: 'whatsapp_token', etiqueta: 'WhatsApp · token permanente de la app de Meta', tipo: 'password' },
    { clave: 'whatsapp_telefono_id', etiqueta: 'WhatsApp · ID del número (Phone number ID)' },
    { clave: 'whatsapp_modo', etiqueta: 'WhatsApp · modo de envío', ayuda: 'Meta solo entrega texto libre si el cliente escribió en las últimas 24 h. Para iniciar conversaciones necesitas plantillas aprobadas.', tipo: 'select', opciones: [['texto', 'Texto libre (ventana de 24 h)'], ['plantilla', 'Plantillas aprobadas']] },
    { clave: 'whatsapp_plantilla_cobro', etiqueta: 'Nombre de la plantilla de recordatorio de cobro', ayuda: 'Variables en orden: {{1}} cliente, {{2}} monto, {{3}} producto.' },
    { clave: 'whatsapp_plantilla_vencimiento', etiqueta: 'Nombre de la plantilla de vencimiento', ayuda: 'Variables: {{1}} cliente, {{2}} producto, {{3}} fecha.' },
    { clave: 'whatsapp_idioma', etiqueta: 'Código de idioma de las plantillas', ayuda: 'es, es_PE, es_MX…' },
    { clave: 'recordatorio_cobro_dias', etiqueta: 'Días tras la venta para recordar el cobro pendiente', ayuda: '0 desactiva.', tipo: 'number' },
    { clave: 'cuotas_gracia_dias', etiqueta: 'Días de gracia de una cuota vencida antes de pausar el sistema', tipo: 'number' },
    { clave: 'telegram_token', etiqueta: 'Telegram · token del bot (de @BotFather)', tipo: 'password' },
    { clave: 'telegram_chat_id', etiqueta: 'Telegram · chat ID donde recibes las alertas', ayuda: 'Escríbele al bot y consulta https://api.telegram.org/bot<token>/getUpdates para ver tu chat id.' },
    { clave: 'telefono_dueno', etiqueta: 'Tu WhatsApp para alertas', ayuda: 'Requiere WhatsApp configurado arriba. Si no hay Telegram ni WhatsApp, las alertas llegan a tu correo.' },
    { clave: 'alertas_dueno', etiqueta: 'Alertas activas', ayuda: 'Separadas por coma: pago_por_confirmar, activacion_rechazada, instalacion_clonada, cuota_vencida, ticket_nuevo, cierre_caja, planificador_detenido.', tipo: 'textarea' },
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
  const [tareas, setTareas] = useState<any | null>(null);
  const [respaldos, setRespaldos] = useState<any[]>([]);
  const [errores, setErrores] = useState<any[]>([]);
  const cargarCorreos = () => api.get<any>('/correos').then((r) => setCorreos(r.filas)).catch(() => null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const cargarMensajes = () => api.get<any[]>('/sistema/mensajes').then(setMensajes).catch(() => null);
  const cargarSistema = async () => {
    setTareas(await api.get<any>('/sistema/tareas').catch(() => null));
    setRespaldos(await api.get<any[]>('/sistema/respaldos').catch(() => []));
    setErrores(await api.get<any[]>('/errores').catch(() => []));
  };
  const descargarRespaldo = async (nombre: string) => {
    const t = sesion.token();
    const r = await fetch(`/api/v1/sistema/respaldos/${encodeURIComponent(nombre)}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
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
        <button className={`chip ${seccion === -4 ? 'activo' : ''}`} onClick={() => { setSeccion(-4); cargarMensajes(); }}>WhatsApp y Telegram enviados</button>
        <button className={`chip ${seccion === -3 ? 'activo' : ''}`} onClick={() => { setSeccion(-3); cargarSistema(); }}>Sistema</button>
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
      {seccion === -3 && (
        <div className="grid-2">
          <Tarjeta titulo="Tareas automáticas" acciones={<BotonAccion texto="Ejecutar ahora" className="btn secundario chico" exito="Tareas ejecutadas" onClick={async () => { await api.post('/sistema/tareas/ejecutar', {}); await cargarSistema(); }} />}>
            <p className="suave pequeno" style={{ marginTop: 0 }}>Cada 10 minutos: estados de licencias, avisos de vencimiento, recordatorios de cobro, cuotas vencidas, recordatorio de caja, renovaciones automáticas, respaldo diario y limpieza.</p>
            {tareas ? (
              <dl className="definiciones">
                <dt>Última corrida</dt><dd>{tareas.ultima_ejecucion ? fecha(tareas.ultima_ejecucion, true) : 'Todavía no (arranca al minuto de iniciar)'}</dd>
                {tareas.ultimo_resultado && Object.entries(tareas.ultimo_resultado).filter(([k]) => k !== 'errores').map(([k, val]) => <><dt key={`k${k}`}>{k.replace(/_/g, ' ')}</dt><dd key={`v${k}`}>{String(val ?? '—')}</dd></>)}
                <dt>Errores</dt><dd>{tareas.ultimo_resultado?.errores?.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{tareas.ultimo_resultado.errores.map((e: string, i: number) => <li key={i} className="pequeno">{e}</li>)}</ul> : 'Ninguno'}</dd>
              </dl>
            ) : <p className="suave">Cargando…</p>}
          </Tarjeta>
          <Tarjeta titulo="Respaldos" acciones={<BotonAccion texto="Crear respaldo ahora" className="btn secundario chico" exito="Respaldo creado" onClick={async () => { await api.post('/sistema/respaldos', {}); await cargarSistema(); }} />}>
            <p className="suave pequeno" style={{ marginTop: 0 }}>Carpeta: <code className="clave">{tareas?.directorio_respaldos || '…'}</code>. Copia esta carpeta fuera del servidor cada día.</p>
            <Tabla filas={respaldos} clave={(r) => r.nombre} vacio="Aún no hay respaldos" columnas={[
              { titulo: 'Archivo', celda: (r) => <span className="pequeno">{r.nombre}</span> },
              { titulo: 'Fecha', celda: (r) => fecha(r.creado_en, true) },
              { titulo: 'Tamaño', celda: (r) => `${(r.bytes / 1024).toFixed(0)} KB`, alinear: 'derecha' },
              { titulo: '', celda: (r) => <BotonAccion texto="Descargar" className="btn secundario chico" onClick={() => descargarRespaldo(r.nombre)} /> },
            ]} />
          </Tarjeta>
          <Tarjeta titulo="Errores del servidor (últimos 200)">
            <Tabla filas={errores} clave={(e) => e.id} vacio="Sin errores registrados" columnas={[
              { titulo: 'Fecha', celda: (e) => fecha(e.creado_en, true) },
              { titulo: 'Ruta', celda: (e) => <code className="clave">{e.ruta}</code> },
              { titulo: 'Mensaje', celda: (e) => <span className="pequeno">{e.mensaje}</span> },
            ]} />
          </Tarjeta>
        </div>
      )}
      {seccion === -4 && (
        <Tarjeta titulo="Mensajes por WhatsApp y Telegram" acciones={<div className="fila"><BotonAccion texto="Probar canales" className="btn secundario chico" exito="Prueba enviada; revisa el estado abajo" onClick={async () => { await api.post('/sistema/mensajes/probar'); await cargarMensajes(); }} /><button className="btn secundario chico" onClick={cargarMensajes}>Actualizar</button></div>}>
          <p className="suave pequeno" style={{ marginTop: 0 }}>Todo mensaje queda registrado aunque el canal no esté configurado, así ves qué se habría enviado.</p>
          <Tabla filas={mensajes} clave={(m) => m.id} vacio="Todavía no hay mensajes" columnas={[
            { titulo: 'Fecha', celda: (m) => fecha(m.creado_en, true) },
            { titulo: 'Canal', celda: (m) => m.canal },
            { titulo: 'Para', celda: (m) => m.para },
            { titulo: 'Texto', celda: (m) => <span className="pequeno" style={{ display: 'block', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.texto}>{m.plantilla ? `[${m.plantilla}] ` : ''}{m.texto}</span> },
            { titulo: 'Estado', celda: (m) => <><Estado valor={m.estado === 'enviado' ? 'confirmado' : m.estado === 'error' ? 'rechazado' : 'pendiente'} />{m.estado === 'sin_configurar' && <span className="suave pequeno"> canal sin configurar</span>}{m.error && <span className="suave pequeno"> · {m.error}</span>}</> },
          ]} />
        </Tarjeta>
      )}
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
