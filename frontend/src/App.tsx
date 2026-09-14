import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useSesion } from './sesion';
import { Cargando } from './componentes/ui';
import { Login } from './paginas/Login';
import { Panel } from './paginas/Panel';
import { Ventas } from './paginas/Ventas';
import { VentaNueva } from './paginas/VentaNueva';
import { VentaDetalle } from './paginas/VentaDetalle';
import { Licencias } from './paginas/Licencias';
import { LicenciaDetalle } from './paginas/LicenciaDetalle';
import { Clientes } from './paginas/Clientes';
import { ClienteDetalle } from './paginas/ClienteDetalle';
import { Catalogo } from './paginas/Catalogo';
import { Equipo } from './paginas/Equipo';
import { Caja } from './paginas/Caja';
import { Comisiones } from './paginas/Comisiones';
import { Auditoria } from './paginas/Auditoria';
import { Ajustes } from './paginas/Ajustes';

export function App() {
  const { usuario, cargando, salir, esGestor, esSuper } = useSesion();
  const ubicacion = useLocation();
  if (cargando) return <div className="login"><Cargando /></div>;
  if (!usuario) return ubicacion.pathname === '/login' ? <Login /> : <Navigate to="/login" replace />;
  if (ubicacion.pathname === '/login') return <Navigate to="/" replace />;

  const enlaces = [
    { a: '/', t: 'Panel', i: '▦' },
    { a: '/ventas', t: 'Ventas', i: '🧾' },
    { a: '/licencias', t: 'Licencias', i: '🔑' },
    { a: '/clientes', t: 'Clientes', i: '👥' },
    { a: '/caja', t: 'Caja', i: '💵' },
    { a: '/comisiones', t: 'Comisiones', i: '％' },
    ...(esGestor ? [{ a: '/catalogo', t: 'Catálogo', i: '📦' }, { a: '/equipo', t: 'Equipo', i: '🧑‍💼' }, { a: '/auditoria', t: 'Auditoría', i: '📋' }] : []),
    ...(esSuper ? [{ a: '/ajustes', t: 'Ajustes', i: '⚙️' }] : []),
  ];

  return (
    <div className="app">
      <nav className="lateral">
        <div className="marca">CONTROL<small>Panel de la agencia</small></div>
        {enlaces.map((e) => <NavLink key={e.a} to={e.a} end={e.a === '/'} className={({ isActive }) => (isActive ? 'activa' : '')}><span>{e.i}</span>{e.t}</NavLink>)}
        <div className="usuario">
          <strong>{usuario.nombre}</strong>
          <span className="suave">{usuario.rol === 'superadmin' ? 'Superadministrador' : usuario.rol === 'admin' ? 'Administrador' : `Vendedor · ${usuario.comision_pct}% comisión`}</span>
          <button className="btn secundario chico" onClick={salir}>Cerrar sesión</button>
        </div>
      </nav>
      <main className="contenido">
        <Routes>
          <Route path="/" element={<Panel />} />
          <Route path="/ventas" element={<Ventas />} />
          <Route path="/ventas/nueva" element={<VentaNueva />} />
          <Route path="/ventas/:id" element={<VentaDetalle />} />
          <Route path="/licencias" element={<Licencias />} />
          <Route path="/licencias/:id" element={<LicenciaDetalle />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:id" element={<ClienteDetalle />} />
          <Route path="/caja" element={<Caja />} />
          <Route path="/comisiones" element={<Comisiones />} />
          {esGestor && <Route path="/catalogo" element={<Catalogo />} />}
          {esGestor && <Route path="/equipo" element={<Equipo />} />}
          {esGestor && <Route path="/auditoria" element={<Auditoria />} />}
          {esSuper && <Route path="/ajustes" element={<Ajustes />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
