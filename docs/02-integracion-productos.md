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
| Activar | `POST /api/v1/licencias/activar` `{ clave, producto, huella, dominio?, nombre_equipo?, version? }` | `{ ok, token, licencia: { estado, vence_en, soporte_hasta, etiqueta } }` |
| Latido (cada 24 h) | `POST /api/v1/licencias/latido` `{ clave, huella, version? }` | Token renovado |
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

## Recomendación para productos nuevos

Agrega el SDK a la plantilla base de la fábrica (SECRETARIA-IA) para que BARBER-PRO y los
siguientes productos nazcan licenciados.
