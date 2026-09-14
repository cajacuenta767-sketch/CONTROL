import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Aviso, Campo, Formulario } from '../componentes/ui';
import { MarcaLogin } from './Login';

export function Recuperar() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  return (
    <div className="login">
      <MarcaLogin />
      <main className="login-form">
        <div className="tarjeta">
          <h2>Recuperar contraseña</h2>
          <p className="sub">Te enviaremos un enlace por correo para elegir una nueva. Vale por 1 hora.</p>
          {enviado ? (
            <Aviso tipo="ok">Si el correo existe en la agencia, en unos minutos recibirás el enlace. Revisa también la carpeta de spam.</Aviso>
          ) : (
            <Formulario onEnviar={async () => { await api.post('/auth/recuperar', { email }); setEnviado(true); }} textoBoton="Enviar enlace">
              <Campo etiqueta="Correo"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Campo>
            </Formulario>
          )}
          <p className="pie"><Link to="/login">← Volver a entrar</Link></p>
        </div>
      </main>
    </div>
  );
}

export function Restablecer() {
  const { token } = useParams();
  const nav = useNavigate();
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [listo, setListo] = useState(false);
  return (
    <div className="login">
      <MarcaLogin />
      <main className="login-form">
        <div className="tarjeta">
          <h2>Nueva contraseña</h2>
          <p className="sub">Mínimo 10 caracteres, con letras y números.</p>
          {listo ? (
            <><Aviso tipo="ok">Contraseña cambiada. Ya puedes entrar.</Aviso><button className="btn" onClick={() => nav('/login')}>Ir a entrar</button></>
          ) : (
            <Formulario onEnviar={async () => {
              if (clave !== clave2) throw new Error('Las contraseñas no coinciden');
              await api.post('/auth/restablecer', { token, clave }); setListo(true);
            }} textoBoton="Guardar contraseña">
              <Campo etiqueta="Nueva contraseña"><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required minLength={10} autoFocus autoComplete="new-password" /></Campo>
              <Campo etiqueta="Repetir contraseña"><input type="password" value={clave2} onChange={(e) => setClave2(e.target.value)} required minLength={10} autoComplete="new-password" /></Campo>
            </Formulario>
          )}
        </div>
      </main>
    </div>
  );
}

/** Pantalla obligatoria cuando la cuenta fue creada o reseteada por el superadmin. */
export function CambiarClave() {
  const nav = useNavigate();
  const [actual, setActual] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  return (
    <div className="login">
      <MarcaLogin />
      <main className="login-form">
        <div className="tarjeta">
          <h2>Crea tu contraseña</h2>
          <p className="sub">Tu cuenta tiene una contraseña temporal. Elige una propia para continuar: mínimo 10 caracteres, con letras y números.</p>
          <Formulario onEnviar={async () => {
            if (clave !== clave2) throw new Error('Las contraseñas no coinciden');
            await api.post('/auth/cambiar-clave', { clave_actual: actual, clave_nueva: clave });
            window.location.href = '/';
          }} textoBoton="Guardar y continuar">
            <Campo etiqueta="Contraseña temporal (la que te dieron)"><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} required autoFocus autoComplete="current-password" /></Campo>
            <Campo etiqueta="Nueva contraseña"><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required minLength={10} autoComplete="new-password" /></Campo>
            <Campo etiqueta="Repetir contraseña"><input type="password" value={clave2} onChange={(e) => setClave2(e.target.value)} required minLength={10} autoComplete="new-password" /></Campo>
          </Formulario>
          <p className="pie"><button className="btn-texto" onClick={() => nav('/login')}>Cerrar sesión</button></p>
        </div>
      </main>
    </div>
  );
}
