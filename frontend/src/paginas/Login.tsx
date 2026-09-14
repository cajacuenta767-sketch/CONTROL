import { useState } from 'react';
import { useSesion } from '../sesion';
import { Campo, Formulario, Tarjeta } from '../componentes/ui';

export function Login() {
  const { entrar } = useSesion();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  return (
    <div className="login">
      <Tarjeta>
        <div className="marca">CONTROL</div>
        <p>Panel de licencias, ventas y caja de la agencia</p>
        <Formulario onEnviar={() => entrar(email, clave)} textoBoton="Entrar">
          <Campo etiqueta="Correo"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" /></Campo>
          <Campo etiqueta="Contraseña"><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="current-password" /></Campo>
        </Formulario>
      </Tarjeta>
    </div>
  );
}
