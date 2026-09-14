import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, fecha } from '../api';
import { useSesion } from '../sesion';
import { Aviso, BotonAccion, Campo, Formulario, Tabla, Tarjeta } from '../componentes/ui';

/** Sección de seguridad de la cuenta: contraseña, 2FA y sesiones. Se usa en Ajustes. */
export function SeguridadCuenta() {
  const { usuario, refrescar } = useSesion();
  const [miClave, setMiClave] = useState({ clave_actual: '', clave_nueva: '' });
  const [conf, setConf] = useState<{ secreto: string; url: string; qr: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [off, setOff] = useState({ codigo: '', clave: '' });
  const [sesiones, setSesiones] = useState<any[]>([]);
  const cargarSesiones = () => api.get<any[]>('/auth/sesiones').then(setSesiones);
  useEffect(() => { cargarSesiones(); }, []);

  const iniciar2fa = async () => {
    const r = await api.post<{ secreto: string; url: string }>('/auth/2fa/configurar');
    const qr = await QRCode.toDataURL(r.url, { width: 200, margin: 1 });
    setConf({ ...r, qr });
  };

  return (
    <>
      <Tarjeta titulo="Mi contraseña">
        <Formulario onEnviar={async () => { await api.post('/auth/cambiar-clave', miClave); setMiClave({ clave_actual: '', clave_nueva: '' }); }} textoBoton="Cambiar" exito="Contraseña actualizada">
          <Campo etiqueta="Contraseña actual"><input type="password" value={miClave.clave_actual} onChange={(e) => setMiClave({ ...miClave, clave_actual: e.target.value })} required autoComplete="current-password" /></Campo>
          <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 10 caracteres, con letras y números."><input type="password" minLength={10} value={miClave.clave_nueva} onChange={(e) => setMiClave({ ...miClave, clave_nueva: e.target.value })} required autoComplete="new-password" /></Campo>
        </Formulario>
      </Tarjeta>

      <Tarjeta titulo="Verificación en dos pasos (2FA)">
        {usuario?.totp_activo ? (
          <>
            <Aviso tipo="ok">Activada. Al entrar se te pedirá el código de tu app de autenticación.</Aviso>
            <Formulario onEnviar={async () => { await api.post('/auth/2fa/desactivar', off); setOff({ codigo: '', clave: '' }); await refrescar(); }} textoBoton="Desactivar 2FA" exito="2FA desactivada">
              <Campo etiqueta="Código actual de la app"><input inputMode="numeric" maxLength={7} value={off.codigo} onChange={(e) => setOff({ ...off, codigo: e.target.value })} required /></Campo>
              <Campo etiqueta="Tu contraseña"><input type="password" value={off.clave} onChange={(e) => setOff({ ...off, clave: e.target.value })} required /></Campo>
            </Formulario>
          </>
        ) : conf ? (
          <div className="grid-2">
            <div>
              <p className="suave">1. Escanea el código con Google Authenticator, Authy, 1Password o similar.</p>
              <img src={conf.qr} alt="Código QR para la app de autenticación" width={200} height={200} style={{ borderRadius: 8, border: '1px solid var(--borde)' }} />
              <p className="suave pequeno">Si no puedes escanear, ingresa esta clave a mano: <code className="clave">{conf.secreto}</code></p>
            </div>
            <div>
              <p className="suave">2. Escribe el código de 6 dígitos que muestra la app para confirmar.</p>
              <Formulario onEnviar={async () => { await api.post('/auth/2fa/activar', { codigo }); setConf(null); setCodigo(''); await refrescar(); }} textoBoton="Activar 2FA" exito="2FA activada" cancelar={() => setConf(null)}>
                <Campo etiqueta="Código"><input inputMode="numeric" maxLength={7} value={codigo} onChange={(e) => setCodigo(e.target.value)} required autoFocus /></Campo>
              </Formulario>
            </div>
          </div>
        ) : (
          <>
            <p className="suave">Recomendado para superadministradores y administradores: aunque alguien consiga tu contraseña, no podrá entrar sin tu teléfono.</p>
            <BotonAccion texto="Configurar 2FA" onClick={iniciar2fa} />
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo="Sesiones activas" acciones={<BotonAccion texto="Cerrar todas" className="btn secundario chico" exito="Sesiones cerradas" onClick={async () => { await api.post('/auth/sesiones/cerrar-todas'); await cargarSesiones(); }} />}>
        <Tabla filas={sesiones} clave={(s) => s.id} vacio="Sin sesiones" columnas={[
          { titulo: 'Equipo', celda: (s) => <span className="pequeno">{s.agente || '—'}</span> },
          { titulo: 'IP', celda: (s) => s.ip || '—' },
          { titulo: 'Inicio', celda: (s) => fecha(s.creado_en, true) },
          { titulo: 'Último uso', celda: (s) => fecha(s.ultimo_uso, true) },
          { titulo: '', celda: (s) => <BotonAccion texto="Cerrar" className="btn secundario chico" onClick={async () => { await api.post(`/auth/sesiones/${s.id}/revocar`); await cargarSesiones(); }} /> },
        ]} />
        <p className="suave pequeno">Cada sesión dura 30 días sin uso. El acceso se renueva solo mientras trabajas.</p>
      </Tarjeta>
    </>
  );
}
