# Revisión del sistema y hoja de mejoras

Revisión completa hecha sobre la primera versión de CONTROL: backend, panel, SDK y
documentación. Primero lo que ya se corrigió en esta ronda; después, lo que queda, ordenado
por impacto para el negocio.

## Corregido en esta ronda

### Backend

| Problema encontrado | Corrección |
|---|---|
| **Zona horaria.** La caja del día, "ventas de hoy", el tope diario de emisiones y los reportes usaban la fecha en UTC. Un cobro a las 8 pm en Lima caía en el día siguiente. | Nuevo ajuste `desfase_horario_horas` (por defecto −5). Todas las consultas "por día" aplican ese desfase. Editable desde Ajustes. |
| Las activaciones rechazadas no quedaban en auditoría porque el registro se escribía dentro de la transacción que luego se revertía. | El rechazo se audita fuera de la transacción. Cubierto por test. |
| Las acciones del panel se auditaban sin IP. | Contexto por petición con `AsyncLocalStorage`; `auditar()` toma la IP automáticamente. |
| `backend/.env.example` existía pero nada lo cargaba. | Los scripts usan `--env-file-if-exists=.env` de Node 22. |
| Se podía arrancar en producción con el secreto JWT por defecto. | El arranque en producción falla con mensaje claro si no se definió `JWT_SECRETO`. |
| Un superadmin podía desactivarse a sí mismo o cambiarse el rol y quedar fuera. | Bloqueado en el servicio y ocultado en el panel. |

### Panel

| Antes | Ahora |
|---|---|
| Login genérico: tarjeta centrada sin contexto. | Pantalla dividida: marca, propuesta de valor y catálogo a la izquierda; formulario con mostrar/ocultar contraseña, recordar correo, mensajes de error claros y aviso de bloqueo por intentos. |
| En móvil el menú lateral se apilaba encima del contenido. | Barra superior con menú desplegable; el lateral se abre como cajón y se cierra al navegar. |
| Ninguna confirmación visual al guardar, confirmar o aprobar. | Avisos flotantes (toasts) en todas las acciones; los errores de acción también se muestran. |
| Las claves se copiaban a mano. Enviarlas al cliente implicaba salir del panel. | Botón "Enviar clave(s) por WhatsApp" con mensaje prellenado en venta y licencia; "Recordar cobro" en ventas pendientes; WhatsApp en renovaciones próximas. |
| Transferir licencia pedía el ID numérico del cliente. | Selector de cliente. |
| Tablas sin orden ni paginación; listas largas incómodas. | Columnas ordenables al hacer clic, paginación de 50, filas clicables con hover. |
| Sin exportación. | Botón CSV (separador `;` para Excel en español) en ventas, licencias, comisiones y cierres. |
| Los indicadores del panel eran solo texto. | Cada indicador lleva a su detalle; el gráfico de cobros tiene eje de fechas; las alertas enlazan a la pantalla correspondiente. |
| Filtros de ventas solo por fecha manual. | Chips "Hoy", "7 días", "Este mes", "Todo" y botón "Limpiar". |
| Licencias sin visión rápida por estado. | Chips con conteo por estado. |
| Sin estados vacíos: tablas en blanco al empezar. | Estados vacíos con explicación y acción ("Registrar venta", "Nuevo cliente"). |
| Sin impresión. | Estilos de impresión para cierre de caja y recibo de liquidación. |
| Un error de JavaScript dejaba la pantalla en blanco. | Límite de errores con botón de recarga. |
| Sin favicon, título fijo en todas las pantallas. | Favicon propio y título por pantalla. |
| Iconos con emojis (se ven distintos en cada sistema). | Iconos SVG propios, navegación agrupada en secciones. |

## Segunda ronda: todo lo pendiente, implementado

Lo que en la primera revisión quedó como pendiente se construyó en cinco fases. Cada punto
está cubierto por tests del backend (`npm test`, 59 pruebas) o por la suite de interfaz
(`npm run e2e`, 16 flujos en Chromium).

### 1. Seguridad y sesiones · hecho

| Mejora | Cómo quedó |
|---|---|
| Contraseña olvidada | `/recuperar` envía un enlace por correo con token de un solo uso (1 h); la clave nueva se valida antes de consumir el token. |
| Doble factor | TOTP (Google Authenticator, Authy) activable por cada usuario en "Mi seguridad"; el superadmin puede quitarlo desde Equipo si se pierde el teléfono. |
| Sesión con renovación | Token de acceso de 1 h + cookie `httpOnly` de refresco rotativa; cierre de sesión que revoca en servidor; lista de sesiones abiertas con revocación. |
| Bloqueo por intentos | 5 intentos fallidos bloquean la cuenta 15 min; desbloqueo manual desde Equipo. |
| Política de contraseñas | Mínimo 10 caracteres con letras y números, sin las más comunes ni el correo o nombre; cambio obligatorio en el primer acceso. |
| CSP | Helmet con CSP activa; el panel no usa estilos ni scripts en línea externos. |

### 2. Negocio · hecho

| Mejora | Cómo quedó |
|---|---|
| Pasarelas de pago | Stripe Checkout y PayPal Orders con webhook/captura que confirman el cobro solos; pasarela "demo" para probar el flujo. |
| Recibos PDF | Recibo de venta, de pago, de liquidación y cierre de caja, con el nombre de la agencia. |
| Comprobante como archivo | Subida de foto o PDF por pago, descargable desde la venta. |
| Multimoneda | Tipos de cambio en Ajustes; cada venta guarda moneda y cambio; caja y comisiones en moneda base con detalle por moneda. |
| Metas y bono | Meta mensual por vendedor con bono adicional al cumplirla; barra de avance en el panel. |
| Enlace de venta | `/comprar?ref=CODIGO` atribuye la compra al vendedor; pedidos externos con API key. |
| Portal del cliente | `/portal`: acceso con clave + correo o teléfono, licencias, recibos, renovación en línea y tickets. |
| Revendedores | Rol con cupo prepagado, descuento mayorista y marca propia; sin comisión. |
| Renovación automática | Tarea programada que crea la venta de renovación y envía el enlace de pago N días antes del vencimiento. |

### 3. Operación · hecho

| Mejora | Cómo quedó |
|---|---|
| Tareas programadas | Barrido de estados, avisos de vencimiento (30/7/1 días) por correo y al vendedor, recordatorio de cierre de caja, renovación automática, respaldo diario y limpieza; visibles en Ajustes → Sistema. |
| Correo transaccional | SMTP configurable con prueba desde Ajustes; todo correo queda registrado aunque no haya SMTP. |
| Respaldo automático | `VACUUM INTO` diario con rotación, descarga desde el panel y `scripts/restaurar.js`. |
| Registro de errores | Los errores 500 se guardan en la tabla `errores` y se ven en Ajustes. |
| Despliegue | Dockerfile, docker-compose con Caddy y guía en `docs/04-despliegue.md`. |
| PostgreSQL | Sigue siendo opcional: SQLite con `VACUUM INTO` cubre el volumen previsto; el SQL es estándar. |

### 4. Panel · hecho

| Mejora | Cómo quedó |
|---|---|
| Búsqueda global | Ctrl+K / ⌘K: clientes, ventas, licencias y accesos rápidos, con teclado. |
| Paginación en servidor | Ventas y licencias piden páginas de 50; los conteos por estado vienen del servidor. |
| Modo oscuro | Conmutador en el lateral, persistente por navegador; respeta la preferencia del sistema. |
| Gráficos | Página Reportes: cobros por producto y por vendedor mes a mes, licencias activadas, exportable a CSV. |
| Historial en cliente | Línea de tiempo con ventas, pagos, activaciones, tickets y cambios de licencia. |
| Plantillas de WhatsApp | Editables en Ajustes (claves, recordatorio de cobro, renovación). |
| Accesibilidad | Foco atrapado y restaurado en modales, filas e indicadores operables por teclado, enlace "saltar al contenido", roles ARIA. |
| Pruebas de interfaz | `frontend/e2e/ejecutar.mjs` levanta un servidor sembrado y recorre login, búsqueda, paginación, reportes, tema, modales, tickets, seguridad, código de emergencia y el portal del cliente. |

### 5. Integración con los productos · hecho

| Mejora | Cómo quedó |
|---|---|
| Pantalla estándar "Licencia" | `pantallaExpress()` en el SDK de Node y plantilla + guía en `sdk/pantalla-licencia/` para Laravel, FastAPI, Electron y PWA. |
| Versión y aviso de desactualización | Versión vigente por producto en Catálogo; `desactualizada` en cada respuesta; alerta en el panel y etiqueta por equipo. |
| Código de emergencia | Token firmado de 72 h por equipo, emitido desde la licencia, auditado; los tres SDK lo aceptan sin red. |
| SDK como paquete | `sdk/node` tiene `package.json` propio para publicarlo en un registro privado o instalarlo por ruta. |
