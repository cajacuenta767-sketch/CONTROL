// CONTROL de escritorio: una ventana que abre el panel de tu servidor. La dirección se pide la
// primera vez y se guarda en el perfil del usuario; el menú permite cambiarla.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session } = require('electron');
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const RUTA_CONFIG = () => join(app.getPath('userData'), 'config.json');
const leerConfig = () => { try { return JSON.parse(readFileSync(RUTA_CONFIG(), 'utf8')); } catch { return {}; } };
const guardarConfig = (c) => { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(RUTA_CONFIG(), JSON.stringify(c, null, 2)); };
const normalizarUrl = (u) => { let s = String(u || '').trim(); if (!s) return ''; if (!/^https?:\/\//i.test(s)) s = `https://${s}`; return s.replace(/\/+$/, ''); };

let ventana;

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 600, show: false, backgroundColor: '#0f172a', title: 'CONTROL',
    icon: join(__dirname, 'icono.png'),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  ventana.once('ready-to-show', () => ventana.show());
  ventana.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // Enlaces externos (WhatsApp, pasarelas, PDFs) se abren en el navegador; el panel se queda en la ventana.
  ventana.webContents.on('will-navigate', (e, url) => {
    const base = normalizarUrl(leerConfig().servidor);
    if (base && !url.startsWith(base) && !url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });
  ventana.webContents.on('did-fail-load', (e, codigo, desc, url) => { if (codigo !== -3 && !String(url).startsWith('file://')) mostrarConector(`No se pudo conectar con ${url} (${desc}). Revisa la dirección o tu internet.`); });
  ventana.webContents.session.on('will-download', (e, item) => { item.once('done', (ev, estado) => { if (estado === 'completed') shell.showItemInFolder(item.getSavePath()); }); });
  abrirPanel();
}

function abrirPanel() {
  const cfg = leerConfig();
  const url = normalizarUrl(cfg.servidor);
  if (!url) return mostrarConector();
  ventana.loadURL(`${url}/`);
}
function mostrarConector(error) {
  ventana.loadFile(join(__dirname, 'conectar.html'), { query: { error: error || '', actual: leerConfig().servidor || '' } });
}

ipcMain.handle('conectar', async (e, servidor) => {
  const url = normalizarUrl(servidor);
  if (!url) return { ok: false, error: 'Escribe la dirección del panel' };
  try {
    const r = await fetch(`${url}/api/v1/salud`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.hora) return { ok: false, error: `El servidor respondió ${r.status}` };
    guardarConfig({ ...leerConfig(), servidor: url });
    abrirPanel();
    return { ok: true };
  } catch (err) { return { ok: false, error: `No responde: ${err.message}` }; }
});
ipcMain.handle('config', () => leerConfig());

function menu() {
  const plantilla = [
    { label: 'CONTROL', submenu: [
      { label: 'Ir al panel', accelerator: 'CmdOrCtrl+H', click: () => abrirPanel() },
      { label: 'Recargar', accelerator: 'F5', click: () => ventana.webContents.reload() },
      { label: 'Cambiar servidor…', click: () => mostrarConector() },
      { type: 'separator' },
      { label: 'Pantalla completa', role: 'togglefullscreen' },
      { label: 'Acercar', role: 'zoomIn' }, { label: 'Alejar', role: 'zoomOut' }, { label: 'Tamaño normal', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Salir', role: 'quit' },
    ] },
    { label: 'Edición', submenu: [{ role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' }, { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }] },
    { label: 'Ayuda', submenu: [
      { label: 'Cómo funciona', click: () => { const u = normalizarUrl(leerConfig().servidor); if (u) ventana.loadURL(`${u}/guia`); } },
      { label: 'Acerca de', click: () => dialog.showMessageBox(ventana, { title: 'CONTROL', message: `CONTROL de escritorio ${app.getVersion()}`, detail: `Servidor: ${leerConfig().servidor || 'sin configurar'}` }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(plantilla));
}

app.whenReady().then(() => {
  // El panel usa cookie httpOnly de renovación: se conserva entre sesiones.
  session.defaultSession.setPermissionRequestHandler((wc, permiso, cb) => cb(['notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permiso)));
  menu(); crearVentana();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) crearVentana(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
