# CONTROL · Panel central de licencias, ventas y caja

Sistema propio de la agencia para **vender, licenciar y cobrar** todos los productos del
catálogo (DENTAL-PRO, FarmaSys, Repara-Pro, GYM-PRO, Supero-Pos, Sencillo, Vendly, Habitta,
ReservaFlow, Avendia, BARBER-PRO…) desde un solo panel.

- **Superadmin** (dueño): ve y controla todo; aprueba cobros y cierres de caja; revoca y
  resetea licencias; liquida comisiones.
- **Admin**: registra ventas y confirma cobros con un tope diario de licencias; todo queda
  auditado.
- **Vendedor**: registra ventas y cobros de sus clientes, genera demos, cierra su caja del
  día y ve su comisión (20 % por defecto).
- **Revendedor**: compra licencias con descuento mayorista y cupo prepagado, con su marca.
- **Productos**: cada instalación se activa con una clave `CTL-XXXX-XXXX-XXXX-XXXX` atada
  a un equipo o dominio, y recibe un token firmado (Ed25519) que verifica sin internet.
- **Clientes**: portal propio en `/portal` (licencias, recibos, renovación en línea, tickets).

## Qué incluye

| Área | Funciones |
|---|---|
| Seguridad | Sesión corta con renovación por cookie, bloqueo por intentos, política de contraseñas, recuperación por correo, 2FA TOTP, CSP, auditoría con IP |
| Dinero | Multimoneda con tipo de cambio, comprobantes adjuntos, recibos PDF, pasarelas (Stripe, PayPal, demo) con webhook, metas y bono, enlace de venta por vendedor, pedidos externos con API key, revendedores |
| Operación | Tareas programadas (avisos de vencimiento, recordatorio de caja, renovación automática, respaldos con rotación), correo SMTP, registro de errores, Docker + Caddy |
| Panel | Búsqueda global (Ctrl+K), paginación en servidor, modo oscuro, reportes mensuales, línea de tiempo del cliente, tickets de soporte, plantillas de WhatsApp, accesible por teclado |
| Precios y roles | Lista de precios editable solo por el dueño (niveles, ajuste porcentual, historial), simulador de venta, topes de descuento por rol, guía "Cómo funciona" con la matriz de permisos; admin y vendedor no ven comisiones ajenas, auditoría ni ajustes |
| Integración | SDK Node, PHP y Python; pantalla estándar "Licencia"; versión vigente por producto con alerta de instalaciones desactualizadas; código de emergencia de 72 h sin internet |

La especificación completa está en [`docs/01-especificacion.md`](docs/01-especificacion.md),
la guía para conectar cada producto en [`docs/02-integracion-productos.md`](docs/02-integracion-productos.md)
la revisión y el estado de cada mejora en [`docs/03-revision-y-mejoras.md`](docs/03-revision-y-mejoras.md)
el despliegue en [`docs/04-despliegue.md`](docs/04-despliegue.md) y la lista de precios por tipo de
negocio en [`docs/05-precios-y-posicionamiento.md`](docs/05-precios-y-posicionamiento.md).

## Puesta en marcha

Requisitos: Node.js 22 o superior (SQLite viene integrado, no hay que instalar nada más).

```bash
npm install
npm run seed      # crea la base con tu superadmin, el catálogo y datos de ejemplo
npm run dev       # API en http://localhost:4100 · panel en http://localhost:5173
```

Cuentas que crea el seed (contraseña `Control2026!`):

| Rol | Correo |
|---|---|
| Superadmin | `dueno@agencia.test` |
| Admin | `admin@agencia.test` |
| Vendedores | `carlos@agencia.test`, `lucia@agencia.test` |

Para producción, crea solo tu usuario real y sin datos de ejemplo:

```bash
SUPERADMIN_EMAIL=tu@correo.com SUPERADMIN_NOMBRE="Tu nombre" SUPERADMIN_CLAVE='UnaClaveLarga' SOLO_SUPERADMIN=1 npm run seed
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | API y panel en modo desarrollo |
| `npm test` | Tests del backend (59: flujo completo, seguridad, dinero, tareas, portal, emergencia, precios y roles) |
| `npm run e2e` | Compila el panel y recorre 16 flujos en Chromium con Playwright (servidor temporal sembrado) |
| `npm run build` | Compila el panel en `frontend/dist`; la API lo sirve sola en producción |
| `npm start` | Arranca la API (sirve el panel compilado en el mismo puerto) |

## Producción

1. Copia `backend/.env.example` a `backend/.env` y cambia `JWT_SECRETO` y `ORIGENES`.
   Sin `JWT_SECRETO` propio, el arranque en producción se detiene.
2. `npm run build && npm start` detrás de un proxy HTTPS (Caddy, Nginx).
3. En Ajustes, verifica la **zona horaria** (−5 para Lima/Bogotá, −4 para La Paz/Santiago):
   define qué día es "hoy" para la caja y los reportes.
4. Respalda `backend/datos/control.db`: contiene la clave privada Ed25519 que firma las
   licencias. Si se pierde, todas las instalaciones deben reactivarse.

## Estructura

```
backend/   API Express + SQLite (node:sqlite), sin binarios nativos
  src/servicios/   ventas, licencias, caja, catálogo, usuarios, reportes, auditoría
  src/rutas/       endpoints REST bajo /api/v1
  scripts/seed.js  datos iniciales
  test/            tests con node --test + supertest
frontend/  Panel React + Vite + TypeScript
sdk/       Clientes para Node, PHP (Laravel) y Python (FastAPI) + pantalla estándar "Licencia"
frontend/e2e/  Pruebas de extremo a extremo con Playwright
docs/      Especificación e integración
```

## Endpoints públicos para los productos

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/v1/licencias/clave-publica` | Clave pública Ed25519 para embeber en cada producto |
| `POST` | `/api/v1/licencias/activar` | `{ clave, producto, huella, dominio?, nombre_equipo?, version? }` → token firmado + `licencia.version_actual` / `desactualizada` |
| `POST` | `/api/v1/licencias/latido` | `{ clave, huella, version? }` → token renovado |
| `GET` | `/api/v1/publico/catalogo` | Catálogo, precios y pasarelas para la página de compra |
| `POST` | `/api/v1/publico/pedidos` | Pedido externo (DevMarket, web) con `X-Api-Key` opcional |
| `POST` | `/api/v1/portal/acceso` | Portal del cliente: clave de licencia + correo o teléfono |

Con sesión, `POST /api/v1/licencias/:id/emergencia` emite un código firmado de 72 h para un
equipo concreto; el producto lo acepta sin red (ver `sdk/pantalla-licencia/`).

El resto de la API requiere sesión (`Authorization: Bearer …`) y respeta el rol.
