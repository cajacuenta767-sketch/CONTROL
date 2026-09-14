# Integrar un producto con CONTROL

Cada producto del catálogo necesita tres cosas para quedar licenciado:

1. **Su clave de licencia** en una variable de entorno o en su pantalla de ajustes
   (`CONTROL_LICENCIA=CTL-XXXX-XXXX-XXXX-XXXX`).
2. **La URL de CONTROL** (`CONTROL_URL=https://control.tuagencia.com`).
3. **La clave pública Ed25519** de CONTROL embebida en el código (se obtiene una vez en
   `GET /api/v1/licencias/clave-publica`). Con ella el producto verifica los tokens sin
   depender de la red.

## Protocolo

| Paso | Llamada | Respuesta |
|---|---|---|
| Activar | `POST /api/v1/licencias/activar` `{ clave, producto, huella, dominio?, nombre_equipo?, version? }` | `{ ok, token, licencia: { estado, vence_en, soporte_hasta, etiqueta, version_actual, desactualizada } }` |
| Latido (cada 24 h) | `POST /api/v1/licencias/latido` `{ clave, huella, version? }` | Token renovado + mismos datos de `licencia` |
| Clave pública | `GET /api/v1/licencias/clave-publica` | `{ algoritmo: 'Ed25519', clave_publica }` |

El **token** es `base64url(payload).base64url(firma)`. El payload incluye `clave`,
`producto`, `huella`, `estado`, `vence_en`, `emitido_en` y `expira_en` (7 días). El producto:

- Guarda el último token válido en disco o base de datos.
- Al arrancar, verifica la firma con la clave pública y que `expira_en` no haya pasado.
- Si el token está por vencer o el estado es `mora`, intenta un latido. Sin red, sigue
  funcionando hasta `expira_en` (esa es la gracia offline).
- Si `estado` es `suspendida`, `vencida` o `revocada`, bloquea la app y muestra el motivo.

### Huella

- **Web instalada por cliente** (Laravel, Next.js, Express, FastAPI): usa el dominio o, en
  su defecto, un UUID generado en la primera ejecución y guardado en disco.
- **Escritorio** (Supero-Pos en Electron): hash de `hostname + id de máquina`.
- **Móvil / PWA** (Sencillo): UUID generado al instalar y guardado en almacenamiento local.

Los SDK de ejemplo están en `sdk/`:

| Carpeta | Para |
|---|---|
| `sdk/node/control-licencia.js` | Express, Next.js, NestJS, Electron |
| `sdk/php/ControlLicencia.php` | Laravel (DENTAL-PRO) |
| `sdk/python/control_licencia.py` | FastAPI (Avendia) |

Cada uno expone `activar()`, `verificar()` y `latido()`, y un middleware o dependencia que
bloquea las rutas cuando la licencia no es válida.

## Versión del producto y aviso de actualización

Envía siempre `version` en activar y latido. En CONTROL → Catálogo el superadmin fija la
**versión actual** de cada producto; cada respuesta incluye `licencia.version_actual` y
`licencia.desactualizada`. El panel muestra cuántas instalaciones van atrasadas (alerta del
panel, contador en Catálogo y etiqueta por equipo en cada licencia) y la pantalla estándar
"Licencia" del producto avisa al cliente.

## Código de emergencia (72 h)

Cuando el producto no puede validar (CONTROL caído, cliente sin internet, pago en trámite),
un vendedor o admin genera desde la licencia un **código de emergencia**: un token firmado
con la misma clave privada, con `emergencia: true`, `estado: 'activa'` y `expira_en` a 72 h,
válido solo para la huella indicada. El producto lo verifica con la clave pública y lo guarda
como token normal (`aplicarCodigoEmergencia()` / `aplicar_codigo_emergencia()`), sin red.
Queda registrado en `codigos_emergencia` y en la auditoría de la licencia.

## Pantalla estándar "Licencia"

Todos los productos muestran la misma pantalla (estado, vencimiento, equipo, versión,
"Reactivar" y campo para el código de emergencia). En Node basta
`app.use('/licencia', licencia.pantallaExpress({ nombre: 'DENTAL-PRO' }))`; para Laravel,
FastAPI, Electron o PWA está la plantilla y la guía en `sdk/pantalla-licencia/`.

## Recomendación para productos nuevos

Agrega el SDK a la plantilla base de la fábrica (SECRETARIA-IA) para que BARBER-PRO y los
siguientes productos nazcan licenciados.
