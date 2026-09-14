import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useSesion } from './sesion';
import { useTema } from './tema';
import { Cargando, LimiteErrores } from './componentes/ui';
import { Buscador } from './componentes/buscador';
import { Login } from './paginas/Login';
import { Recuperar, Restablecer, CambiarClave } from './paginas/Recuperar';
import { Comprar, PagarDemo, PagoResultado, PedidoPublico } from './paginas/Publico';
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
import { Reportes } from './paginas/Reportes';
import { Tickets, TicketDetalle } from './paginas/Tickets';
import { SeguridadCuenta } from './paginas/Seguridad';
import { PortalAcceso, PortalInicio } from './paginas/Portal';
import { Precios } from './paginas/Precios';
import { Guia } from './paginas/Guia';

const I = {
  panel: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>,
  ventas: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>,
  licencias: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M16 4l3 3M13 7l3 3"/></svg>,
  clientes: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 016 5"/></svg>,
  caja: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/></svg>,
  comisiones: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></svg>,
  catalogo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg>,
  equipo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18"/></svg>,
  reportes: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>,
  tickets: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>,
  precios: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12l-8 8-9-9V4h7z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>,
  guia: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/></svg>,
  auditoria: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3h8l4 4v14H4V3z"/><path d="M8 12h8M8 16h5"/></svg>,
  ajustes: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>,
};

const TITULOS: [string, string][] = [
  ['/ventas/nueva', 'Nueva venta'], ['/ventas', 'Ventas'], ['/licencias', 'Licencias'], ['/clientes', 'Clientes'], ['/caja', 'Caja'],
  ['/comisiones', 'Comisiones'], ['/reportes', 'Reportes'], ['/tickets', 'Tickets'], ['/precios', 'Lista de precios'], ['/guia', 'Cómo funciona'], ['/seguridad', 'Mi seguridad'], ['/portal', 'Portal del cliente'], ['/catalogo', 'Catálogo'], ['/equipo', 'Equipo'], ['/auditoria', 'Auditoría'], ['/ajustes', 'Ajustes'], ['/login', 'Entrar'], ['/comprar', 'Comprar'], ['/pagar', 'Pagar'], ['/pedido', 'Mi pedido'],
];

export function App() {
  const { usuario, cargando, salir, esGestor, esSuper } = useSesion();
  const ubicacion = useLocation();
  const [menu, setMenu] = useState(false);
  const [buscar, setBuscar] = useState(false);
  const { tema, alternar } = useTema();
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBuscar((b) => !b); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    setMenu(false);
    const t = TITULOS.find(([p]) => ubicacion.pathname.startsWith(p))?.[1] || 'Panel';
    document.title = `${t} · CONTROL`;
  }, [ubicacion.pathname]);

  const publica = ['/comprar', '/pagar/', '/pago-exitoso', '/pago-cancelado', '/pedido/', '/portal'].some((p) => ubicacion.pathname.startsWith(p));
  if (publica) {
    return (
      <Routes>
        <Route path="/portal" element={<PortalAcceso />} />
        <Route path="/portal/inicio" element={<PortalInicio />} />
        <Route path="/comprar" element={<Comprar />} />
        <Route path="/pagar/demo/:id" element={<PagarDemo />} />
        <Route path="/pago-exitoso" element={<PagoResultado exito />} />
        <Route path="/pago-cancelado" element={<PagoResultado exito={false} />} />
        <Route path="/pedido/:numero" element={<PedidoPublico />} />
      </Routes>
    );
  }
  if (cargando) return <div className="login-form" style={{ minHeight: '100vh' }}><Cargando /></div>;
  if (!usuario) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/recuperar" element={<Recuperar />} />
        <Route path="/restablecer/:token" element={<Restablecer />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (usuario.debe_cambiar_clave) return <CambiarClave />;
  if (['/login', '/recuperar', '/cambiar-clave'].includes(ubicacion.pathname) || ubicacion.pathname.startsWith('/restablecer')) return <Navigate to="/" replace />;

  const grupos: { titulo?: string; enlaces: { a: string; t: string; i: keyof typeof I }[] }[] = [
    { enlaces: [{ a: '/', t: 'Panel', i: 'panel' }, { a: '/ventas', t: 'Ventas', i: 'ventas' }, { a: '/licencias', t: 'Licencias', i: 'licencias' }, { a: '/clientes', t: 'Clientes', i: 'clientes' }, { a: '/tickets', t: 'Soporte', i: 'tickets' }] },
    { titulo: 'Dinero', enlaces: [{ a: '/precios', t: 'Lista de precios', i: 'precios' }, { a: '/caja', t: 'Caja', i: 'caja' }, { a: '/comisiones', t: esSuper ? 'Comisiones' : 'Mis comisiones', i: 'comisiones' }, { a: '/reportes', t: 'Reportes', i: 'reportes' }] },
    ...(esGestor ? [{ titulo: esSuper ? 'Dueño' : 'Administración', enlaces: [...(esSuper ? [{ a: '/catalogo', t: 'Catálogo', i: 'catalogo' as const }] : []), { a: '/equipo', t: 'Equipo', i: 'equipo' as const }, ...(esSuper ? [{ a: '/auditoria', t: 'Auditoría', i: 'auditoria' as const }, { a: '/ajustes', t: 'Ajustes', i: 'ajustes' as const }] : [])] }] : []),
    { titulo: 'Ayuda', enlaces: [{ a: '/guia', t: 'Cómo funciona', i: 'guia' }] },
  ];
  const rolTexto = usuario.rol === 'superadmin' ? 'Superadministrador' : usuario.rol === 'admin' ? 'Administrador' : usuario.rol === 'revendedor' ? `Revendedor · cupo ${usuario.cupo_licencias ?? 0}` : `Vendedor · ${usuario.comision_pct}% comisión`;

  return (
    <div className="app">
      <a className="saltar" href="#principal">Saltar al contenido</a>
      <div className="topbar">
        <span className="marca"><span className="logo">C</span>CONTROL</span>
        <div className="fila" style={{ gap: 4 }}>
          <button className="hamburguesa" onClick={() => setBuscar(true)} aria-label="Buscar" style={{ fontSize: 18 }}>⌕</button>
          <button className="hamburguesa" onClick={() => setMenu(true)} aria-label="Abrir menú" aria-expanded={menu}>☰</button>
        </div>
      </div>
      {menu && <div className="velo" onClick={() => setMenu(false)} />}
      <Buscador abierto={buscar} cerrar={() => setBuscar(false)} />
      <nav className={`lateral ${menu ? 'abierto' : ''}`} aria-label="Navegación principal">
        <div className="marca"><span className="logo">C</span><span>CONTROL<small>Panel de la agencia</small></span></div>
        <button className="buscar-btn" onClick={() => setBuscar(true)} aria-label="Abrir búsqueda global"><span>⌕ Buscar…</span><kbd>Ctrl K</kbd></button>
        {grupos.map((g, gi) => (
          <div key={gi} style={{ display: 'contents' }}>
            {g.titulo && <div className="seccion">{g.titulo}</div>}
            {g.enlaces.map((e) => <NavLink key={e.a} to={e.a} end={e.a === '/'} className={({ isActive }) => (isActive ? 'activa' : '')}>{I[e.i]}{e.t}</NavLink>)}
          </div>
        ))}
        <div className="usuario">
          <strong>{usuario.nombre}</strong>
          <span className="suave">{rolTexto}</span>
          <div className="fila" style={{ gap: 6 }}><button className="btn secundario chico" onClick={salir}>Cerrar sesión</button><NavLink to="/seguridad" className="btn secundario chico" title="Contraseña, 2FA y sesiones">Seguridad</NavLink></div>
          <button className="tema-btn" onClick={alternar} aria-pressed={tema === 'oscuro'}>{tema === 'oscuro' ? '☀ Modo claro' : '☾ Modo oscuro'}</button>
        </div>
      </nav>
      <main className="contenido" id="principal" tabIndex={-1}>
        <LimiteErrores>
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
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/tickets/:id" element={<TicketDetalle />} />
            <Route path="/seguridad" element={<><header><div><h1>Mi seguridad</h1><p>Contraseña, verificación en dos pasos y sesiones abiertas.</p></div></header><div className="grid-2"><div><SeguridadCuenta /></div></div></>} />
            <Route path="/precios" element={<Precios />} />
            <Route path="/guia" element={<Guia />} />
            {esSuper && <Route path="/catalogo" element={<Catalogo />} />}
            {esGestor && <Route path="/equipo" element={<Equipo />} />}
            {esSuper && <Route path="/auditoria" element={<Auditoria />} />}
            {esSuper && <Route path="/ajustes" element={<Ajustes />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </LimiteErrores>
      </main>
    </div>
  );
}
