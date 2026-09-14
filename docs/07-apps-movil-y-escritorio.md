# CONTROL en el celular y en la PC

El panel ya es una aplicación web instalable (PWA). Además hay dos aplicaciones nativas que
lo envuelven para que se abra como cualquier app, con ícono propio y sin navegador:

| Plataforma | Qué es | Carpeta | Se compila con |
|---|---|---|---|
| Android | App Capacitor (WebView) que abre tu panel | `apps/android` | GitHub Actions (necesita Android SDK y Java) |
| Windows | App Electron con ventana propia, menú y descargas | `apps/escritorio` | GitHub Actions o tu PC con Node |
| iPhone y navegador | Instalación desde Safari o Chrome ("Añadir a pantalla de inicio") | `frontend/public/manifest.webmanifest` | Nada que compilar |

Las apps **no guardan datos**: la primera vez piden la dirección del panel
(`https://control.tuagencia.com`), la comprueban contra `/api/v1/salud` y la guardan en el
dispositivo. Desde ahí todo es el mismo panel, con los mismos usuarios y permisos.

## La página de descarga

`https://TU-DOMINIO/descargar` es pública y muestra los botones de Android, Windows y
"instalar desde el navegador", con instrucciones por plataforma. Lo que ofrece sale de
**Ajustes › Aplicaciones**:

- **Subir archivo**: el APK o el `.exe` quedan en `backend/datos/descargas` y se sirven desde
  el propio servidor (`/api/v1/publico/descargas/android`, `/windows`, `/windows_portable`).
- **URL externa**: si prefieres no alojarlos, pega la URL del archivo en el Release de GitHub.
- **Versión**: el número que ve el visitante.

## Generar los instaladores (una vez, y cada vez que cambies la app)

1. En GitHub: **Actions › Apps (Windows y Android) › Run workflow**, escribe la versión
   (por ejemplo `1.0.0`). También se dispara al crear una etiqueta `apps-v1.0.0`.
2. En unos minutos aparece un **Release** `apps-v1.0.0` con:
   - `CONTROL-Instalador-1.0.0.exe` (instalador de un clic) y `CONTROL-Portable-1.0.0.exe`.
   - `CONTROL-android.apk`.
3. Pega esas URLs (o sube los archivos) en **Ajustes › Aplicaciones**.

### Firmas

- **Android**: sin secretos, el APK sale firmado con la clave de depuración; instala igual
  ("instalar de fuentes desconocidas") y sirve para tu equipo. Para publicar en Play Store o
  evitar el aviso, crea un keystore y guarda en los secretos del repositorio
  `ANDROID_KEYSTORE_B64` (el archivo en base64), `ANDROID_KEYSTORE_CLAVE`, `ANDROID_KEY_ALIAS`
  y `ANDROID_KEY_CLAVE`; el flujo firmará la versión release.
- **Windows**: sin certificado de firma de código, SmartScreen muestra "Windows protegió tu
  PC" la primera vez (Más información › Ejecutar de todas formas). Un certificado EV o
  Azure Trusted Signing lo elimina; es opcional.

## Compilar Windows en tu propia PC

```bash
cd apps/escritorio
npm install
npm run instalador:win      # deja dist/CONTROL-Instalador-1.0.0.exe y el portable
```

También sirve `npm run empaquetar:win` para una carpeta ejecutable sin instalador
(`dist/CONTROL-win32-x64/CONTROL.exe`), que es lo que se verifica en este repositorio.

## Compilar Android en tu propia PC

Necesitas Android Studio (SDK + Java 21). Luego:

```bash
cd apps/android
npm install
npx cap add android && npx cap sync android
cd android && ./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
```

## Qué hace cada app por dentro

- **Windows** (`apps/escritorio/main.js`): ventana con el panel, menú en español (ir al panel,
  recargar, cambiar servidor, zoom, pantalla completa), enlaces externos al navegador,
  descargas a la carpeta del usuario, cookie de sesión conservada entre aperturas.
- **Android** (`apps/android/www/index.html` + Capacitor): pantalla de conexión, navegación
  al panel dentro del WebView con permiso a cualquier dominio, ícono y color de la agencia.
  El panel, al ser PWA, funciona completo dentro (cámara para comprobantes, WhatsApp, PDF).
