# Lo que necesito de ti para dejar todo funcionando

El sistema ya está construido y probado. Lo que falta son cuentas y datos que solo tú
puedes crear o entregar. Cada bloque dice **qué es, dónde se consigue y dónde se pega en
CONTROL**. Nada de esto toca código: todo va en **Ajustes** del panel (solo el dueño lo ve).

## 1. Servidor y dominio (para que exista en internet)

| Qué | Dónde se consigue | Dónde va |
|---|---|---|
| Un servidor Linux (1 vCPU, 1 GB basta para empezar) | Hetzner, DigitalOcean, Contabo o el que prefieras | `docs/04-despliegue.md` tiene los comandos exactos |
| Un dominio o subdominio, p. ej. `control.tuagencia.com` | Tu registrador de dominios (NIC.pe, Namecheap…) | DNS apuntando al servidor; Caddy saca el HTTPS solo |
| Contraseña larga para el superadmin y correo real | Tú | `SUPERADMIN_EMAIL` y `SUPERADMIN_CLAVE` al correr el seed |

Después de entrar: **Ajustes › Agencia**: nombre, dirección fiscal, URL pública y zona horaria.

## 2. Cobros en línea (Culqi para Yape y tarjetas)

| Qué | Dónde se consigue | Dónde va |
|---|---|---|
| Cuenta Culqi validada con tu RUC | culqi.com › Regístrate; piden RUC, cuenta bancaria y DNI del representante | — |
| Llave pública `pk_live_…` y llave secreta `sk_live_…` | Panel Culqi › Desarrollo › Llaves (usa las `_test_` mientras pruebas) | Ajustes › Pasarelas de pago |
| Webhook | Panel Culqi › Desarrollo › Webhooks: URL `https://TU-DOMINIO/api/v1/webhooks/culqi`, eventos `order.status.changed` y `charge.creation.succeeded` | (lo configuras allá) |

Opcional: Stripe y PayPal siguen disponibles para cobrar fuera de Perú (mismas pantallas).

## 3. Facturación electrónica (SUNAT)

| Qué | Dónde se consigue | Dónde va |
|---|---|---|
| RUC, razón social y dirección fiscal de la agencia | SUNAT | Ajustes › Facturación |
| Cuenta en Nubefact (u otro PSE compatible con su API) | nubefact.com › Regístrate; te piden RUC, clave SOL y firmar un contrato | — |
| URL de la API y token de Nubefact | Panel Nubefact › Configuración › API | Ajustes › Facturación |
| Series de boleta y factura (p. ej. B001 y F001) | Las creas en Nubefact | Ajustes › Facturación |
| Decidir si los precios de lista ya incluyen IGV | Tú (recomendado: sí) | Ajustes › Facturación |

Si por ahora no vas a facturar electrónicamente, elige **Manual**: CONTROL numera y guarda
los comprobantes y el Excel contable los lista igual.

## 4. WhatsApp automático (recordatorios y avisos al cliente)

| Qué | Dónde se consigue | Dónde va |
|---|---|---|
| Cuenta de Meta Business verificada | business.facebook.com (piden documentos del negocio) | — |
| App con WhatsApp Cloud API y un número dedicado | developers.facebook.com › Mi app › WhatsApp | — |
| Token permanente y Phone number ID | Misma pantalla de WhatsApp de la app | Ajustes › WhatsApp y alertas |
| Plantillas aprobadas: `cobro_pendiente` ({{1}} cliente, {{2}} monto, {{3}} producto) y `vencimiento` ({{1}} cliente, {{2}} producto, {{3}} fecha) | Meta › WhatsApp Manager › Plantillas (aprueban en horas) | Ajustes › WhatsApp y alertas (nombre de cada plantilla) |

Mientras no esté: los botones de WhatsApp del panel siguen abriendo el chat con el mensaje
escrito, y cada mensaje automático queda registrado como "sin configurar" para que veas
qué se habría enviado.

## 5. Alertas para ti (Telegram, en 5 minutos)

1. En Telegram habla con **@BotFather**, escribe `/newbot`, ponle nombre y copia el **token**.
2. Escríbele cualquier cosa a tu bot nuevo.
3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia el número de `chat.id`.
4. Pega token y chat ID en **Ajustes › WhatsApp y alertas** y pulsa **Probar canales**.

Recibirás: pagos por confirmar, activaciones rechazadas, licencias clonadas, cuotas
vencidas, tickets nuevos, cierres de caja y fallos del planificador. Sin Telegram, llegan a
tu correo.

## 6. Correo saliente (claves, recibos, avisos)

| Qué | Dónde se consigue | Dónde va |
|---|---|---|
| Servidor SMTP: Brevo (gratis hasta 300/día), Zoho, Google Workspace | El proveedor que elijas | Ajustes › Correo, botón **Probar** |
| Un remitente como `no-responder@tuagencia.com` | Tu dominio | Ajustes › Correo |

## 7. Monitoreo (que te avise si CONTROL se cae)

Crea un monitor gratuito en UptimeRobot o Better Stack apuntando a
`https://TU-DOMINIO/api/v1/salud` cada 5 minutos, con aviso a tu correo o Telegram. Ese
chequeo responde error si la base de datos falla o las tareas automáticas se detienen.

## 8. Productos

| Qué | Para qué |
|---|---|
| Instalador o paquete de cada versión de cada producto (o el enlace de GitHub Releases) | Catálogo › Versiones: las instalaciones se actualizan solas con verificación de firma |
| 3 capturas, un video corto y la ficha de venta de cada producto | Catálogo › Material de venta: salen en la página de compra y en la lista de precios del equipo |
| Integrar el SDK en cada producto (`sdk/` y `docs/02-integracion-productos.md`) | Sin esto, los productos no validan licencias |
| Revisar los precios de lista | Lista de precios › Editar (ya están cargados los cuatro niveles) |

## 9. Apps para celular y PC

1. Ya están compilados: [Release apps-v1.0.0](https://github.com/cajacuenta767-sketch/CONTROL/releases/tag/apps-v1.0.0) (APK de Android, instalador y portable de Windows). El seed los deja enlazados en **Ajustes › Aplicaciones**.
2. Comparte `https://TU-DOMINIO/descargar` con tu equipo.
3. Para versiones nuevas: **Actions › Apps (Windows y Android) › Run workflow** y actualiza las URLs.

Opcional: keystore de Android (para firmar como release) y certificado de firma de código
de Windows (para evitar el aviso de SmartScreen). Detalle en `docs/07-apps-movil-y-escritorio.md`.

## 10. Equipo

- Crea a cada vendedor en **Equipo** con su comisión (20 % por defecto), tope diario y meta.
- Crea un usuario **Contador** para quien lleve los libros y uno **Soporte** si alguien
  atiende tickets sin vender.
- Cada uno entra, cambia su contraseña y, los que manejan dinero, activan el 2FA en **Mi seguridad**.

## Orden sugerido

1. Servidor y dominio (día 1).
2. SMTP y Telegram (día 1, media hora).
3. Culqi en modo prueba, luego producción (semana 1).
4. SDK en el primer producto y primera venta real (semana 1).
5. Nubefact cuando salga la primera factura que te pidan (o antes, si ya facturas).
6. WhatsApp Cloud API cuando tengas volumen; hasta entonces, botones manuales.
