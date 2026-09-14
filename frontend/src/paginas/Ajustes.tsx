import { useEffect, useState } from 'react';
import { api } from '../api';
import { Aviso, Campo, Formulario, Tarjeta } from '../componentes/ui';

const CAMPOS: { clave: string; etiqueta: string; ayuda: string; tipo?: string }[] = [
  { clave: 'nombre_agencia', etiqueta: 'Nombre de la agencia', ayuda: 'Aparece en recibos y correos.' },
  { clave: 'moneda_base', etiqueta: 'Moneda base', ayuda: 'Código ISO de 3 letras. Los precios de lista se definen en esta moneda.' },
  { clave: 'tope_descuento_pct', etiqueta: 'Descuento máximo para vendedores y admins (%)', ayuda: 'El superadmin no tiene tope.', tipo: 'number' },
  { clave: 'comision_renovacion_pct', etiqueta: 'Comisión por renovación después del primer año (%)', ayuda: 'Durante el primer año se usa la comisión normal del vendedor.', tipo: 'number' },
  { clave: 'gracia_dias', etiqueta: 'Días de gracia tras el vencimiento', ayuda: 'La licencia pasa a "mora" y sigue funcionando con aviso; después se suspende.', tipo: 'number' },
  { clave: 'demo_dias', etiqueta: 'Duración de las demos (días)', ayuda: 'Si el plan demo no define su propia duración.', tipo: 'number' },
  { clave: 'soporte_vitalicio_dias', etiqueta: 'Soporte incluido en el vitalicio (días)', ayuda: 'Después se vende el plan de mantenimiento.', tipo: 'number' },
  { clave: 'metodos_en_mano', etiqueta: 'Métodos que el vendedor entrega en mano', ayuda: 'Separados por coma. Definen el "a entregar" del cierre de caja.' },
];

export function Ajustes() {
  const [v, setV] = useState<Record<string, string>>({});
  const [guardado, setGuardado] = useState(false);
  const [clavePublica, setClavePublica] = useState('');
  const [miClave, setMiClave] = useState({ clave_actual: '', clave_nueva: '' });
  useEffect(() => {
    api.get<Record<string, string>>('/ajustes').then(setV);
    fetch('/api/v1/licencias/clave-publica').then((r) => r.json()).then((r) => setClavePublica(r.clave_publica_base64));
  }, []);

  return (
    <>
      <header><div><h1>Ajustes</h1><p>Reglas globales del negocio.</p></div></header>
      <div className="grid-2">
        <Tarjeta titulo="Reglas">
          {guardado && <Aviso tipo="ok">Guardado.</Aviso>}
          <Formulario onEnviar={async () => { await api.patch('/ajustes', v); setGuardado(true); setTimeout(() => setGuardado(false), 2000); }}>
            {CAMPOS.map((c) => (
              <Campo key={c.clave} etiqueta={c.etiqueta} ayuda={c.ayuda}>
                <input type={c.tipo || 'text'} value={v[c.clave] ?? ''} onChange={(e) => setV({ ...v, [c.clave]: e.target.value })} />
              </Campo>
            ))}
          </Formulario>
        </Tarjeta>
        <div>
          <Tarjeta titulo="Clave pública para los productos">
            <p className="suave pequeno">Embebe esta clave Ed25519 en cada software para que verifique los tokens de licencia sin conexión. Es pública: no es un secreto.</p>
            <textarea readOnly rows={3} value={clavePublica} onFocus={(e) => e.currentTarget.select()} />
            <p className="suave pequeno">La clave privada vive en la base de datos de CONTROL. Respáldala: si se pierde, hay que reemitir todas las activaciones.</p>
          </Tarjeta>
          <Tarjeta titulo="Mi contraseña">
            <Formulario onEnviar={async () => { await api.post('/auth/cambiar-clave', miClave); setMiClave({ clave_actual: '', clave_nueva: '' }); }} textoBoton="Cambiar">
              <Campo etiqueta="Contraseña actual"><input type="password" value={miClave.clave_actual} onChange={(e) => setMiClave({ ...miClave, clave_actual: e.target.value })} required /></Campo>
              <Campo etiqueta="Nueva contraseña"><input type="password" minLength={8} value={miClave.clave_nueva} onChange={(e) => setMiClave({ ...miClave, clave_nueva: e.target.value })} required /></Campo>
            </Formulario>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
