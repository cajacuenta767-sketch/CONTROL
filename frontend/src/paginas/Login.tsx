import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorApi, recordar } from '../api';
import { useSesion } from '../sesion';

const PRODUCTOS = ['DENTAL-PRO', 'BARBER-PRO', 'FarmaSys', 'GYM-PRO', 'Repara-Pro', 'Supero POS', 'Sencillo', 'Vendly', 'Habitta', 'ReservaFlow', 'Avendia'];

export function MarcaLogin() {
  return (
    <aside className="login-marca">
      <div className="logo">C</div>
      <h1>CONTROL</h1>
      <p className="lema">El panel central de la agencia: licencias, ventas, comisiones y caja de todos tus sistemas en un solo lugar.</p>
      <ul>
        <li><span>🔑</span><div><strong>Una licencia por instalación.</strong><br />Cada sucursal con su clave, atada a un equipo, verificable sin internet.</div></li>
        <li><span>％</span><div><strong>Comisiones automáticas.</strong><br />Cada cobro confirmado devenga la comisión del vendedor al instante.</div></li>
        <li><span>💵</span><div><strong>Caja diaria y auditoría.</strong><br />Cada vendedor cierra su día, tú apruebas, y todo queda registrado.</div></li>
      </ul>
      <div className="productos">{PRODUCTOS.map((p) => <span key={p}>{p}</span>)}</div>
    </aside>
  );
}

export function Login() {
  const { entrar, verificar2fa } = useSesion();
  const guardado = recordar.leer('email');
  const [email, setEmail] = useState(guardado || '');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [recordarme, setRecordarme] = useState(Boolean(guardado));
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [tokenTemporal, setTokenTemporal] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      if (tokenTemporal) {
        await verificar2fa(tokenTemporal, codigo);
      } else {
        const t = await entrar(email.trim(), clave);
        recordar.guardar('email', recordarme ? email.trim() : null);
        if (t) setTokenTemporal(t);
      }
    } catch (err) {
      if (err instanceof ErrorApi) setError(err.status === 429 ? 'Demasiados intentos desde esta red. Espera unos minutos.' : err.message);
      else setError('No se pudo iniciar sesión');
      if (err instanceof ErrorApi && err.status === 401 && tokenTemporal && /venció/.test(err.message)) { setTokenTemporal(null); setCodigo(''); }
    } finally { setCargando(false); }
  };

  return (
    <div className="login">
      <MarcaLogin />
      <main className="login-form">
        <div className="tarjeta">
          {tokenTemporal ? (
            <>
              <h2>Verificación en dos pasos</h2>
              <p className="sub">Abre tu app de autenticación (Google Authenticator, Authy…) e ingresa el código de 6 dígitos.</p>
              <form onSubmit={enviar} className="formulario">
                <label className="campo"><span>Código</span>
                  <input inputMode="numeric" pattern="[0-9 ]*" maxLength={7} value={codigo} onChange={(e) => setCodigo(e.target.value)} required autoFocus autoComplete="one-time-code" placeholder="123 456" style={{ fontSize: 22, letterSpacing: '.2em', textAlign: 'center' }} />
                </label>
                {error && <div className="error" role="alert">{error}</div>}
                <button type="submit" className="btn" disabled={cargando}>{cargando ? 'Verificando…' : 'Verificar'}</button>
              </form>
              <p className="pie"><button className="btn-texto" onClick={() => { setTokenTemporal(null); setCodigo(''); setError(null); }}>← Volver</button> · ¿Perdiste el teléfono? El superadministrador puede quitarte el 2FA desde Equipo.</p>
            </>
          ) : (
            <>
              <h2>Bienvenido</h2>
              <p className="sub">Entra con la cuenta que te asignó la agencia.</p>
              <form onSubmit={enviar} className="formulario">
                <label className="campo"><span>Correo</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!guardado} autoComplete="username" placeholder="tu@correo.com" />
                </label>
                <label className="campo"><span>Contraseña</span>
                  <div className="campo-clave">
                    <input type={ver ? 'text' : 'password'} value={clave} onChange={(e) => setClave(e.target.value)} required autoFocus={Boolean(guardado)} autoComplete="current-password" placeholder="••••••••" />
                    <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{ver ? 'Ocultar' : 'Mostrar'}</button>
                  </div>
                </label>
                <label className="recordar"><input type="checkbox" checked={recordarme} onChange={(e) => setRecordarme(e.target.checked)} /> Recordar mi correo en este equipo</label>
                {error && <div className="error" role="alert">{error}</div>}
                <button type="submit" className="btn" disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
              </form>
              <p className="pie"><Link to="/descargar">Descargar la app para celular y PC</Link> · <Link to="/recuperar">¿Olvidaste tu contraseña?</Link></p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
