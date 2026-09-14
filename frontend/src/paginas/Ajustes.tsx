import { useEffect, useState } from 'react';
import { api } from '../api';
import { Campo, Formulario, Tarjeta } from '../componentes/ui';
import { SeguridadCuenta } from './Seguridad';

const CAMPOS: { clave: string; etiqueta: string; ayuda: string; tipo?: string }[] = [
  { clave: 'nombre_agencia', etiqueta: 'Nombre de la agencia', ayuda: 'Aparece en recibos y correos.' },
  { clave: 'moneda_base', etiqueta: 'Moneda base', ayuda: 'Código ISO de 3 letras. Los precios de lista se definen en esta moneda.' },
  { clave: 'tope_descuento_pct', etiqueta: 'Descuento máximo para vendedores y admins (%)', ayuda: 'El superadmin no tiene tope.', tipo: 'number' },
  { clave: 'comision_renovacion_pct', etiqueta: 'Comisión por renovación después del primer año (%)', ayuda: 'Durante el primer año se usa la comisión normal del vendedor.', tipo: 'number' },
  { clave: 'gracia_dias', etiqueta: 'Días de gracia tras el vencimiento', ayuda: 'La licencia pasa a "mora" y sigue funcionando con aviso; después se suspende.', tipo: 'number' },
  { clave: 'demo_dias', etiqueta: 'Duración de las demos (días)', ayuda: 'Si el plan demo no define su propia duración.', tipo: 'number' },
  { clave: 'soporte_vitalicio_dias', etiqueta: 'Soporte incluido en el vitalicio (días)', ayuda: 'Después se vende el plan de mantenimiento.', tipo: 'number' },
  { clave: 'metodos_en_mano', etiqueta: 'Métodos que el vendedor entrega en mano', ayuda: 'Separados por coma. Definen el "a entregar" del cierre de caja.' },
  { clave: 'url_publica', etiqueta: 'URL pública del panel', ayuda: 'Se usa en los enlaces de los correos (recuperar contraseña, recibos). Ej.: https://control.tuagencia.com' },
  { clave: 'desfase_horario_horas', etiqueta: 'Zona horaria (horas respecto a UTC)', ayuda: 'Define qué es "hoy" para la caja y los reportes. Lima/Bogotá/Quito: -5 · La Paz/Santiago/Caracas: -4 · Buenos Aires: -3 · México: -6.', tipo: 'number' },
];

export function Ajustes() {
  const [v, setV] = useState<Record<string, string>>({});
  const [clavePublica, setClavePublica] = useState('');
  useEffect(() => {
    api.get<Record<string, string>>('/ajustes').then(setV);
    fetch('/api/v1/licencias/clave-publica').then((r) => r.json()).then((r) => setClavePublica(r.clave_publica_base64));
  }, []);

  return (
    <>
      <header><div><h1>Ajustes</h1><p>Reglas globales del negocio.</p></div></header>
      <div className="grid-2">
        <Tarjeta titulo="Reglas">
          <Formulario onEnviar={async () => { await api.patch('/ajustes', v); }} exito="Ajustes guardados">
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
          <SeguridadCuenta />
        </div>
      </div>
    </>
  );
}
