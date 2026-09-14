import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePwa } from '../pwa';
import { Cargando } from '../componentes/ui';

interface Plataforma { disponible: boolean; url: string | null; origen: string | null; tamano: number | null; nombre: string; actualizado_en: string | null }
interface Estado { version: string; agencia: string; url_panel: string; plataformas: Record<string, Plataforma> }

const MB = (n: number | null) => (n ? `${(n / 1048576).toFixed(1)} MB` : '');
const esAndroid = () => /android/i.test(navigator.userAgent);
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const esWindows = () => /windows/i.test(navigator.userAgent);

/** Landing pública /descargar: la app para Android, el instalador de Windows y la instalación como app desde el navegador. */
export function Descargar() {
  const [e, setE] = useState<Estado | null>(null);
  const pwa = usePwa();
  useEffect(() => { api.get<Estado>('/publico/descargas').then(setE).catch(() => setE({ version: '', agencia: 'CONTROL', url_panel: '', plataformas: {} })); }, []);
  if (!e) return <div className="landing"><Cargando /></div>;
  const and = e.plataformas.android, win = e.plataformas.windows, port = e.plataformas.windows_portable;
  const recomendado = esAndroid() ? 'android' : esWindows() ? 'windows' : esIOS() ? 'ios' : 'web';

  return (
    <div className="landing">
      <header className="landing-cab">
        <span className="marca"><span className="logo">C</span>{e.agencia}</span>
        <nav><Link to="/login">Entrar al panel</Link><Link to="/portal">Portal del cliente</Link></nav>
      </header>
      <section className="landing-hero">
        <div>
          <h1>CONTROL en tu celular y en tu PC</h1>
          <p>El panel de la agencia como aplicación: ventas, cobros, licencias y caja desde donde estés. Los datos viven en tu servidor; la app solo se conecta a él.</p>
          <div className="landing-botones">
            {and.disponible && <a className={`btn ${recomendado === 'android' ? '' : 'secundario'}`} href={and.url!}>Descargar para Android (APK{and.tamano ? ` · ${MB(and.tamano)}` : ''})</a>}
            {win.disponible && <a className={`btn ${recomendado === 'windows' ? '' : 'secundario'}`} href={win.url!}>Descargar para Windows (instalador{win.tamano ? ` · ${MB(win.tamano)}` : ''})</a>}
            {port?.disponible && <a className="btn secundario" href={port.url!}>Windows portable (sin instalar)</a>}
            {pwa.puedeInstalar && !pwa.instalada && <button className="btn secundario" onClick={pwa.instalar}>Instalar desde el navegador</button>}
          </div>
          {e.version && <p className="suave pequeno">Versión {e.version}{and.actualizado_en || win.actualizado_en ? ` · actualizada el ${new Date(and.actualizado_en || win.actualizado_en!).toLocaleDateString('es')}` : ''}</p>}
          {!and.disponible && !win.disponible && <p className="aviso alerta" style={{ display: 'inline-block' }}>Los instaladores todavía no están publicados. Mientras tanto, instala el panel desde el navegador (más abajo) o entra por la web.</p>}
        </div>
        <div className="landing-telefono" aria-hidden>
          <div className="pantalla">
            <div className="pantalla-cab">CONTROL</div>
            <div className="pantalla-tarjeta"><small>Cobrado hoy</small><strong>S/ 1 980</strong></div>
            <div className="pantalla-tarjeta"><small>Ventas del mes</small><strong>23</strong></div>
            <div className="pantalla-tarjeta"><small>Licencias activas</small><strong>148</strong></div>
            <div className="pantalla-boton">+ Nueva venta</div>
          </div>
        </div>
      </section>

      <section className="landing-grid">
        <div className="landing-card">
          <h2>Android</h2>
          <ol>
            <li>Descarga el APK y ábrelo. Si Android pregunta, permite "instalar apps de esta fuente" (es tu propia app, no viene de la tienda).</li>
            <li>Al abrir por primera vez, escribe la dirección de tu panel{e.url_panel && <>: <code className="clave">{e.url_panel}</code></>}.</li>
            <li>Entra con tu usuario. Queda instalada como cualquier app, con su ícono.</li>
          </ol>
          {!and.disponible && <p className="suave pequeno">Alternativa inmediata: abre el panel en Chrome y usa "Añadir a pantalla de inicio".</p>}
        </div>
        <div className="landing-card">
          <h2>Windows</h2>
          <ol>
            <li>Descarga el instalador y ejecútalo. Si Windows muestra "Windows protegió tu PC", elige <em>Más información › Ejecutar de todas formas</em> (la app no está firmada con certificado comercial).</li>
            <li>Escribe la dirección de tu panel la primera vez; después abre directo.</li>
            <li>Los recibos y archivos se descargan a tu carpeta de Descargas; WhatsApp y pagos se abren en tu navegador.</li>
          </ol>
          {port?.disponible && <p className="suave pequeno">La versión portable no necesita instalación: sirve para una PC prestada o un USB.</p>}
        </div>
        <div className="landing-card">
          <h2>iPhone, iPad y cualquier navegador</h2>
          <ol>
            <li>Abre <code className="clave">{e.url_panel || 'la dirección del panel'}</code> en Safari o Chrome.</li>
            <li>En iPhone: botón Compartir › <em>Añadir a pantalla de inicio</em>. En Chrome de escritorio: ícono de instalar en la barra de direcciones.</li>
            <li>Se abre a pantalla completa, con ícono propio y sin barra del navegador.</li>
          </ol>
        </div>
      </section>

      <section className="landing-grid">
        <div className="landing-card"><h3>Mismos datos en todos lados</h3><p className="suave">La app no guarda copias: todo lo que ves está en tu servidor, con el mismo usuario y los mismos permisos que en la web.</p></div>
        <div className="landing-card"><h3>Hecha para vender en la calle</h3><p className="suave">Nueva venta, foto del comprobante, lista de precios y WhatsApp al cliente en pocos toques. Si se va la señal, el panel te avisa y sigue mostrando lo cargado.</p></div>
        <div className="landing-card"><h3>Actualizaciones</h3><p className="suave">Cuando publiquemos una versión nueva de la app aparecerá aquí. El panel en sí se actualiza solo en el servidor: no necesitas reinstalar por cada mejora.</p></div>
      </section>
      <footer className="publico-pie">Gestión de licencias y ventas con CONTROL · <Link to="/comprar">Catálogo de sistemas</Link></footer>
    </div>
  );
}
