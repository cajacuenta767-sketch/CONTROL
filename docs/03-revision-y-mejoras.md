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

## Pendiente, por prioridad

### 1. Seguridad y sesiones

- **Contraseña olvidada.** Hoy depende del superadmin. Falta un flujo por correo con token de un solo uso.
- **Doble factor** para superadmin y admins (TOTP). Son las cuentas que mueven dinero.
- **Sesión con renovación.** El JWT dura 12 h y vive en `localStorage`. Mejor: token corto más cookie de refresco `httpOnly`, y cierre de sesión que invalide en servidor.
- **Bloqueo por intentos** por cuenta, no solo por IP, y aviso al superadmin.
- **Política de contraseñas** mínima (longitud 10, sin las 10 000 más comunes) y cambio obligatorio en el primer acceso.
- **Cabeceras CSP** activas en Helmet una vez que el panel deje de usar estilos en línea.

### 2. Negocio

- **Pasarelas de pago** (Stripe, PayPal, Culqi) con webhook que confirma el cobro solo; hoy todo cobro se confirma a mano.
- **Recibos en PDF** para el cliente (venta y pago) y para el vendedor (liquidación), con el nombre y logo de la agencia.
- **Comprobante como archivo.** Hoy es un enlace; falta subir foto o PDF y guardarlo.
- **Multimoneda real.** La venta guarda moneda y tipo de cambio, pero el panel muestra todo en USD. Falta mostrar el importe cobrado en la moneda del cliente y el equivalente en moneda base.
- **Metas y ranking** por vendedor con comisión escalonada al superar la meta.
- **Enlace de venta con código** de vendedor para compras que entren solas desde DevMarket.
- **Portal del cliente**: ver sus licencias, descargar recibos, pagar renovación, abrir ticket de soporte.
- **Revendedores externos** con stock de licencias prepagado y marca blanca.
- **Renovación automática** de planes mensuales cuando haya pasarela.

### 3. Operación

- **Tareas programadas** en servidor: barrido de estados (hoy se ejecuta al consultar), aviso de vencimiento a 30, 7 y 1 día por WhatsApp o correo, recordatorio de cierre de caja a las 8 pm.
- **Correo transaccional** (claves, recibos, avisos) con un proveedor SMTP.
- **Respaldo automático** de la base con rotación, y un comando de restauración probado.
- **PostgreSQL** cuando haya más de un servidor o más de unas decenas de miles de licencias; el código usa SQL estándar y la migración es directa.
- **Registro de errores** centralizado (p. ej. Sentry) y métricas de latidos por producto.
- **Despliegue** documentado con Caddy o Nginx, HTTPS y variable `ORIGENES` correcta.

### 4. Panel

- **Búsqueda global** (Ctrl+K) sobre clientes, ventas y claves.
- **Paginación en servidor** cuando las listas superen los 500 registros que hoy se cargan de golpe.
- **Modo oscuro** y ajuste de densidad para quien pasa el día en el panel.
- **Gráficos** de ventas por producto y por vendedor con comparación mes a mes.
- **Historial en cliente**: línea de tiempo de ventas, pagos, activaciones y tickets.
- **Plantillas de WhatsApp editables** desde Ajustes, en lugar de textos fijos.
- **Accesibilidad**: revisar contraste en chips y navegación por teclado en modales.
- **Pruebas de interfaz** automáticas con Playwright sobre el flujo venta → cobro → activación.

### 5. Integración con los productos

- Publicar el SDK de Node como paquete privado y añadirlo a la plantilla base de SECRETARIA-IA.
- Pantalla estándar "Licencia" en cada producto (estado, vence, equipo, botón "reactivar").
- Reporte de versión en el latido y aviso en CONTROL cuando una instalación esté desactualizada.
- Modo de emergencia: un código de un solo uso firmado por CONTROL para desbloquear 72 h sin red.
