import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ProveedorSesion } from './sesion';
import { ProveedorAvisos } from './componentes/toast';
import './estilos.css';
import { registrarPwa } from './pwa';

registrarPwa();

ReactDOM.createRoot(document.getElementById('raiz')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProveedorAvisos>
        <ProveedorSesion>
          <App />
        </ProveedorSesion>
      </ProveedorAvisos>
    </BrowserRouter>
  </React.StrictMode>
);
