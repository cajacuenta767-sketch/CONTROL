# Despliegue y operación

## Opción A · Docker + Caddy (recomendada)

Un solo servidor (1 vCPU, 1 GB basta para cientos de licencias). Caddy obtiene el
certificado HTTPS solo.

```bash
git clone https://github.com/cajacuenta767-sketch/CONTROL && cd CONTROL
cat > .env <<EOF
JWT_SECRETO=$(openssl rand -base64 48)
DOMINIO=control.tuagencia.com
ORIGENES=https://control.tuagencia.com
EOF
docker compose up -d --build
docker compose exec control node --no-warnings=ExperimentalWarning backend/scripts/seed.js   # con SUPERADMIN_EMAIL, SUPERADMIN_CLAVE y SOLO_SUPERADMIN=1
```

Apunta el DNS de `control.tuagencia.com` al servidor antes de arrancar. Luego entra al
panel, ve a **Ajustes › Agencia** y pon la **URL pública** (`https://control.tuagencia.com`):
de ella salen los enlaces de correos, pagos y compra.

## Opción B · Node directo + systemd

```bash
sudo useradd -r -m -s /bin/false control
sudo -u control git clone https://github.com/cajacuenta767-sketch/CONTROL /home/control/app
cd /home/control/app && sudo -u control npm ci && sudo -u control npm run build
sudo -u control cp backend/.env.example backend/.env   # edita JWT_SECRETO y ORIGENES
```

`/etc/systemd/system/control.service`:

```ini
[Unit]
Description=CONTROL · panel de la agencia
After=network.target

[Service]
User=control
WorkingDirectory=/home/control/app
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --env-file-if-exists=backend/.env --no-warnings=ExperimentalWarning backend/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now control
```

Pon Caddy o Nginx delante con HTTPS apuntando a `127.0.0.1:4100`.

## Qué configurar después de instalar

| Dónde | Qué |
|---|---|
| Ajustes › Agencia | Nombre, dirección para recibos, **URL pública**, zona horaria |
| Ajustes › Precios y monedas | Moneda base y tipos de cambio |
| Ajustes › Correo | SMTP (Gmail con clave de aplicación, Zoho, Brevo…) y botón **Probar envío** |
| Ajustes › Pasarelas | Stripe (clave + webhook `https://TU-DOMINIO/api/v1/webhooks/stripe`, evento `checkout.session.completed`) y/o PayPal. Desactiva la pasarela demo |
| Ajustes › Seguridad de mi cuenta | Activa el **2FA** en tu cuenta y en las de los admins |
| Equipo | Crea a tus vendedores con contraseña temporal; se les pedirá cambiarla al entrar |

## Tareas automáticas

El servidor ejecuta cada 10 minutos (sin cron externo):

- barrido de estados de licencias (mora, suspendida, vencida);
- avisos de vencimiento a los días configurados (correo al cliente y al vendedor);
- recordatorio de cierre de caja a la hora configurada;
- renovación automática: venta de renovación con enlace de pago y correo al cliente;
- respaldo diario de la base y limpieza de sesiones y tokens vencidos.

El estado y los respaldos se ven en **Ajustes › Sistema** (solo superadmin), donde también
puedes forzar una corrida o crear un respaldo manual.

## Respaldos y restauración

Los respaldos quedan en `datos/respaldos/` (o `/datos/respaldos` en Docker) y se conservan
los últimos N (ajuste `respaldos_conservar`). Los manuales no se borran solos. Copia esa
carpeta fuera del servidor (rclone, S3, Google Drive) con una tarea diaria.

Para restaurar:

```bash
# Detén la API primero
node --no-warnings=ExperimentalWarning backend/scripts/restaurar.js datos/respaldos/control-2026-09-14T03-00-00-000.db
# Arranca la API
```

La base contiene la **clave privada Ed25519** que firma las licencias: perderla obliga a
reactivar todas las instalaciones. Los respaldos la incluyen.

## Actualizar

```bash
git pull && npm ci && npm run build && sudo systemctl restart control   # o docker compose up -d --build
```

Las migraciones de base de datos se aplican solas al arrancar.

## Cuando crezca

SQLite aguanta sin problema decenas de miles de licencias en un solo servidor. Si necesitas
varios servidores o réplicas, el siguiente paso es PostgreSQL: el código usa SQL estándar y
las consultas específicas de SQLite (`date(col, modificador)`, `VACUUM INTO`) están
concentradas en `db.js` y `tareas.js`.

## Monitoreo

`GET /api/v1/salud` devuelve 200 con `{ ok, base_datos, planificador, ultima_tarea }` y 503
si la base falla o las tareas automáticas llevan más de 30 minutos sin correr. Apúntale un
monitor externo (UptimeRobot, Better Stack) cada 5 minutos con aviso a tu correo o Telegram;
el `HEALTHCHECK` del Dockerfile usa la misma ruta. Los fallos internos del planificador
además te llegan como alerta `planificador_detenido` por los canales de Ajustes.
