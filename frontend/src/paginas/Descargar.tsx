import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePwa } from '../pwa';

interface Plataforma { disponible: boolean; url: string | null; origen: string | null; tamano: number | null; nombre: string; actualizado_en: string | null }
interface Estado { version: string; agencia: string; url_panel: string; plataformas: Record<string, Plataforma> }

const MB = (n: number | null) => (n ? ` · ${(n / 1048576).toFixed(0)} MB` : '');
const so = () => (/android/i.test(navigator.userAgent) ? 'android' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : /windows/i.test(navigator.userAgent) ? 'windows' : 'web');

const Ico = {
  win: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>,
  and: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>,
  web: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>,
  down: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/></svg>,
  escudo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>,
};
const FUNCIONES: [string, string][] = [
  ['Ventas y cobros', 'Nueva venta en pocos toques, foto del comprobante, enlace de pago por Yape o tarjeta y confirmación con licencia activada al instante.'],
  ['Licencias', 'Una clave por instalación, estado en vivo, código de emergencia de 72 h y aviso cuando un cliente va con versión atrasada.'],
  ['Caja y comisiones', 'Cierre de caja diario, comisión devengada por cada cobro confirmado y liquidaciones con recibo en PDF.'],
  ['Prospectos y renovaciones', 'Embudo de prospectos, campañas de renovación masivas y semáforo de salud por cliente.'],
  ['Lista de precios', 'Los precios los fija el dueño; el equipo vende con la lista y el simulador muestra qué gana cada uno.'],
  ['Portal del cliente', 'Tus clientes ven sus licencias, descargan recibos, renuevan y abren tickets sin llamarte.'],
  ['Reportes y contabilidad', 'Cobros por producto y vendedor, tablero del equipo y Excel mensual para el contador.'],
  ['Alertas', 'Pagos por confirmar, activaciones rechazadas y cuotas vencidas te llegan por Telegram o WhatsApp.'],
];

/** Landing pública /descargar: hero con descargas, tarjetas de instalación, confianza y funciones. */
export function Descargar() {
  const [e, setE] = useState<Estado | null>(null);
  const pwa = usePwa();
  useEffect(() => { api.get<Estado>('/publico/descargas').then(setE).catch(() => setE({ version: '', agencia: 'CONTROL', url_panel: '', plataformas: {} })); }, []);
  const p = e?.plataformas || {};
  const and = p.android, win = p.windows, port = p.windows_portable;
  const mio = so();
  const panel = e?.url_panel || window.location.origin;

  return (
    <div className="dl">
      <section className="dl-hero">
        <div className="dl-ancho">
          <div className="dl-marca"><span className="logo">C</span><div><strong>CONTROL</strong><small>{e ? `Versión ${e.version || '1.0.0'} · ${e.agencia}` : ' '}</small></div></div>
          <h1>El panel de tu agencia,<br />en tu celular y en tu PC</h1>
          <p>Ventas, cobros, licencias, caja y comisiones desde donde estés. Úsalo en la web, instálalo en Windows o llévalo en tu Android. Los datos viven en tu servidor; la app solo se conecta a él.</p>
          <div className="dl-botones">
            <a className={`dl-btn ${mio === 'windows' || mio === 'web' ? 'primario' : ''} ${!win?.disponible ? 'apagado' : ''}`} href={win?.url || '#instalar'}>{Ico.win}<span>Descargar para Windows</span></a>
            <a className={`dl-btn ${mio === 'android' ? 'primario' : ''} ${!and?.disponible ? 'apagado' : ''}`} href={and?.url || '#instalar'}>{Ico.and}<span>Descargar para Android</span></a>
            <Link className="dl-btn texto" to="/login">{Ico.web}<span>Abrir la versión web</span></Link>
          </div>
        </div>
      </section>

      <section className="dl-ancho" id="instalar">
        <h2>Instalar</h2>
        <p className="dl-sub">Elige tu plataforma. Las tres usan la misma cuenta y muestran lo mismo.</p>
        <div className="dl-tarjetas">
          <div className="dl-tarjeta">
            <div className="dl-ico">{Ico.win}</div>
            <h3>Windows</h3>
            <p className="dl-desc">Aplicación de escritorio con ventana propia y descargas directas (Windows 10/11, 64 bits).</p>
            <ol>
              <li>Descarga <code>{win?.nombre || 'CONTROL-Instalador.exe'}</code> y ejecútalo.</li>
              <li>Si aparece "Windows protegió tu PC", elige <em>Más información › Ejecutar de todas formas</em>.</li>
              <li>Escribe la dirección de tu panel la primera vez: <code>{panel}</code>.</li>
            </ol>
            {win?.disponible ? <a className="dl-btn primario ancho" href={win.url!}>{Ico.down}<span>Descargar instalador{MB(win.tamano)}</span></a> : <span className="dl-btn apagado ancho">Instalador en preparación</span>}
            {port?.disponible && <a className="dl-enlace" href={port.url!}>Prefiero la versión portable (sin instalar)</a>}
          </div>
          <div className="dl-tarjeta">
            <div className="dl-ico">{Ico.and}</div>
            <h3>Android</h3>
            <p className="dl-desc">App con ícono propio que abre tu panel a pantalla completa. También puedes instalarlo desde Chrome.</p>
            <ol>
              <li>Descarga el APK y ábrelo desde las notificaciones o la carpeta Descargas.</li>
              <li>Si pregunta, permite "instalar apps de esta fuente": es tu propia app, no viene de la tienda.</li>
              <li>Escribe la dirección de tu panel y entra con tu usuario.</li>
            </ol>
            {and?.disponible ? <a className="dl-btn primario ancho" href={and.url!}>{Ico.down}<span>Descargar APK{MB(and.tamano)}</span></a> : <span className="dl-btn apagado ancho">APK en preparación</span>}
            {pwa.puedeInstalar && !pwa.instalada && <button className="dl-enlace" onClick={pwa.instalar}>O instalar directo desde este navegador</button>}
          </div>
          <div className="dl-tarjeta">
            <div className="dl-ico">{Ico.web}</div>
            <h3>Web, iPhone y iPad</h3>
            <p className="dl-desc">Sin instalar nada: entra desde cualquier navegador. En iPhone queda como app con "Añadir a pantalla de inicio".</p>
            <ol>
              <li>Abre <code>{panel}</code> en Safari o Chrome.</li>
              <li>Botón Compartir › <em>Añadir a pantalla de inicio</em> (iPhone) o el ícono de instalar en la barra (Chrome).</li>
              <li>Se abre a pantalla completa con ícono propio.</li>
            </ol>
            <Link className="dl-btn ancho" to="/login">{Ico.web}<span>Entrar al panel</span></Link>
            <Link className="dl-enlace" to="/portal">Portal para tus clientes</Link>
          </div>
        </div>
      </section>

      <section className="dl-ancho">
        <div className="dl-confianza">
          <div className="dl-ico">{Ico.escudo}</div>
          <div>
            <h3>Tus datos, en tu servidor</h3>
            <p>Las apps no guardan copias ni tienen datos propios: se conectan a tu CONTROL por HTTPS con el mismo usuario, contraseña y verificación en dos pasos que en la web. Si cambias un precio o confirmas un cobro en la PC, en el celular ya está. Si pierdes el teléfono, cierras su sesión desde <em>Mi seguridad</em> y listo.</p>
            <Link className="dl-btn chico" to="/guia">Ver cómo funciona</Link>
          </div>
        </div>
      </section>

      <section className="dl-ancho">
        <h2>Todo lo que incluye</h2>
        <p className="dl-sub">Las mismas funciones en web, Windows y Android.</p>
        <div className="dl-funciones">
          {FUNCIONES.map(([t, d]) => <div key={t} className="dl-funcion"><strong>{t}</strong><p>{d}</p></div>)}
        </div>
      </section>

      <footer className="dl-pie"><span>CONTROL {e?.version ? `v${e.version}` : ''} · {e?.agencia || ''}</span><span><Link to="/comprar">Catálogo de sistemas</Link> · <Link to="/login">Entrar</Link></span></footer>
    </div>
  );
}
