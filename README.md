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
- **Productos**: cada instalación se activa con una clave `CTL-XXXX-XXXX-XXXX-XXXX` atada
  a un equipo o dominio, y recibe un token firmado (Ed25519) que verifica sin internet.

La especificación completa está en [`docs/01-especificacion.md`](docs/01-especificacion.md)
y la guía para conectar cada producto en [`docs/02-integracion-productos.md`](docs/02-integracion-productos.md).

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
| `npm test` | Tests del backend (flujo completo: venta → pago → activación → caja → liquidación) |
| `npm run build` | Compila el panel en `frontend/dist`; la API lo sirve sola en producción |
| `npm start` | Arranca la API (sirve el panel compilado en el mismo puerto) |

## Producción

1. Copia `backend/.env.example` a `backend/.env` y cambia `JWT_SECRETO` y `ORIGENES`.
2. `npm run build && npm start` detrás de un proxy HTTPS (Caddy, Nginx).
3. Respalda `backend/datos/control.db`: contiene la clave privada Ed25519 que firma las
   licencias. Si se pierde, todas las instalaciones deben reactivarse.

## Estructura

```
backend/   API Express + SQLite (node:sqlite), sin binarios nativos
  src/servicios/   ventas, licencias, caja, catálogo, usuarios, reportes, auditoría
  src/rutas/       endpoints REST bajo /api/v1
  scripts/seed.js  datos iniciales
  test/            tests con node --test + supertest
frontend/  Panel React + Vite + TypeScript
sdk/       Clientes de ejemplo para Node, PHP (Laravel) y Python (FastAPI)
docs/      Especificación e integración
```

## Endpoints públicos para los productos

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/v1/licencias/clave-publica` | Clave pública Ed25519 para embeber en cada producto |
| `POST` | `/api/v1/licencias/activar` | `{ clave, producto, huella, dominio?, nombre_equipo?, version? }` → token firmado |
| `POST` | `/api/v1/licencias/latido` | `{ clave, huella, version? }` → token renovado |

El resto de la API requiere sesión (`Authorization: Bearer …`) y respeta el rol.
