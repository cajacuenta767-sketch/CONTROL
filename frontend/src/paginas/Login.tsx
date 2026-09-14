import { useState, type FormEvent } from 'react';
import { ErrorApi, recordar } from '../api';
import { useSesion } from '../sesion';

const PRODUCTOS = ['DENTAL-PRO', 'BARBER-PRO', 'FarmaSys', 'GYM-PRO', 'Repara-Pro', 'Supero POS', 'Sencillo', 'Vendly', 'Habitta', 'ReservaFlow', 'Avendia'];

export function Login() {
  const { entrar } = useSesion();
  const guardado = recordar.leer('email');
  const [email, setEmail] = useState(guardado || '');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [recordarme, setRecordarme] = useState(Boolean(guardado));
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      await entrar(email.trim(), clave);
      recordar.guardar('email', recordarme ? email.trim() : null);
    } catch (err) {
      setError(err instanceof ErrorApi ? (err.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : err.message) : 'No se pudo iniciar sesión');
    } finally { setCargando(false); }
  };

  return (
    <div className="login">
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
      <main className="login-form">
        <div className="tarjeta">
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
          <p className="pie">¿Olvidaste tu contraseña? Pídele al superadministrador que te asigne una nueva desde Equipo.</p>
        </div>
      </main>
    </div>
  );
}
