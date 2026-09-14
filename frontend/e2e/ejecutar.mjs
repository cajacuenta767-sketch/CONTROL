/**
 * Pruebas de extremo a extremo con Playwright.
 *
 *   npm run e2e            (desde la raíz o desde frontend/)
 *
 * Levanta el backend con una base de datos temporal sembrada, sirve el panel
 * compilado (frontend/dist) y recorre los flujos principales en Chromium.
 * Requiere `npm run build` previo y el paquete `playwright-core` con un
 * Chromium disponible (variable CHROMIUM o PLAYWRIGHT_BROWSERS_PATH).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const puerto = Number(process.env.E2E_PUERTO || 4177);
const base = `http://127.0.0.1:${puerto}`;
const dir = mkdtempSync(join(tmpdir(), 'control-e2e-'));
const env = { ...process.env, BASE_DATOS: join(dir, 'e2e.db'), JWT_SECRETO: 'secreto-e2e', PUERTO: String(puerto), NODE_ENV: 'test', PLANIFICADOR: '0' };

const correr = (cmd, args, opts = {}) => new Promise((ok, mal) => {
  const p = spawn(cmd, args, { cwd: join(raiz, 'backend'), env, stdio: 'inherit', ...opts });
  p.on('exit', (c) => (c === 0 ? ok() : mal(new Error(`${cmd} ${args.join(' ')} salió con ${c}`))));
});

async function esperarServidor(ms = 15000) {
  const fin = Date.now() + ms; let ultimo = null;
  while (Date.now() < fin) {
    try { const r = await fetch(`${base}/api/v1/salud`); if (r.ok) return; } catch (e) { ultimo = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`El servidor no respondió a tiempo: ${ultimo?.cause?.message || ultimo?.message || ''}`);
}

let servidor;
let fallos = 0;
const paso = async (nombre, fn) => {
  try { await fn(); console.log(`  ✔ ${nombre}`); }
  catch (e) { fallos++; console.log(`  ✘ ${nombre}\n    ${e.message.split('\n')[0]}`); }
};

try {
  if (!existsSync(join(raiz, 'frontend/dist/index.html'))) throw new Error('Falta frontend/dist: ejecuta `npm run build` primero');
  await correr('node', ['scripts/seed.js']);
  servidor = spawn('node', ['src/index.js'], { cwd: join(raiz, 'backend'), env, stdio: process.env.E2E_VERBOSO ? 'inherit' : 'ignore' });
  await esperarServidor();

  const { chromium } = await import('playwright-core');
  const executablePath = process.env.CHROMIUM || undefined;
  const navegador = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const pagina = await navegador.newPage({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });

  const entrar = async (email) => {
    await pagina.goto(`${base}/login`);
    await pagina.fill('input[type=email]', email);
    await pagina.fill('input[autocomplete=current-password]', 'Control2026!');
    await pagina.click('button[type=submit]');
    await pagina.waitForURL(`${base}/`);
    await pagina.waitForSelector('.indicadores');
  };

  console.log('Flujos del panel');
  await paso('login como superadmin y panel con indicadores', () => entrar('dueno@agencia.test'));
  await paso('búsqueda global Ctrl+K abre y navega', async () => {
    await pagina.keyboard.press('Control+k');
    await pagina.waitForSelector('.buscador input');
    await pagina.fill('.buscador input', 'Patricia');
    await pagina.waitForSelector('.buscador-grupo:has-text("Clientes")');
    await pagina.keyboard.press('Enter');
    await pagina.waitForURL(/\/clientes\/\d+$/);
    await pagina.waitForSelector('.linea-tiempo, .vacio-estado');
  });
  await paso('ventas con paginación en servidor', async () => {
    await pagina.goto(`${base}/ventas`);
    await pagina.waitForSelector('table[aria-label="Ventas"] tbody tr');
    const texto = await pagina.textContent('header p');
    if (!/venta\(s\)/.test(texto || '')) throw new Error(`Cabecera inesperada: ${texto}`);
  });
  await paso('licencias con conteo por estado', async () => {
    await pagina.goto(`${base}/licencias`);
    await pagina.waitForSelector('.chips .chip b');
    await pagina.click('.chips .chip:has-text("Activa")');
    await pagina.waitForURL(/estado=activa/);
    await pagina.waitForSelector('table[aria-label="Licencias"] tbody tr');
  });
  await paso('reportes con gráfico SVG', async () => {
    await pagina.goto(`${base}/reportes`);
    await pagina.waitForSelector('.grafico-svg, .vacio-estado');
    await pagina.click('.chip:has-text("12 meses")');
    await pagina.waitForSelector('.indicadores');
  });
  await paso('modo oscuro conmuta y persiste', async () => {
    await pagina.click('.tema-btn');
    const tema = await pagina.evaluate(() => document.documentElement.dataset.tema);
    if (tema !== 'oscuro') throw new Error(`tema=${tema}`);
    await pagina.reload();
    await pagina.waitForSelector('.tema-btn');
    const tema2 = await pagina.evaluate(() => document.documentElement.dataset.tema);
    if (tema2 !== 'oscuro') throw new Error(`tras recargar tema=${tema2}`);
    await pagina.click('.tema-btn');
  });
  await paso('modal atrapa el foco y cierra con Escape', async () => {
    await pagina.goto(`${base}/clientes`);
    await pagina.click('button:has-text("Nuevo cliente")');
    await pagina.waitForSelector('[role=dialog]');
    const dentro = await pagina.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
    if (!dentro) throw new Error('El foco no entró al modal');
    await pagina.keyboard.press('Escape');
    await pagina.waitForSelector('[role=dialog]', { state: 'detached' });
  });
  await paso('código de emergencia desde la licencia', async () => {
    await pagina.goto(`${base}/licencias?estado=activa`);
    await pagina.click('table[aria-label="Licencias"] tbody tr');
    await pagina.waitForSelector('button:has-text("Código de emergencia")');
    await pagina.click('button:has-text("Código de emergencia")');
    await pagina.fill('[role=dialog] input[placeholder^="…o escribe"]', 'pc-caja-principal');
    await pagina.fill('[role=dialog] input[required]', 'Cliente sin internet');
    await pagina.click('[role=dialog] button[type=submit]');
    await pagina.waitForSelector('[role=dialog] textarea[readonly]');
    const codigo = await pagina.inputValue('[role=dialog] textarea[readonly]');
    if (!codigo.includes('.')) throw new Error('código sin firma');
    await pagina.keyboard.press('Escape');
    await pagina.waitForSelector('table[aria-label="Códigos de emergencia"] tbody tr');
  });
  await paso('el dueño edita un precio y el vendedor lo ve en su lista y en la venta', async () => {
    await pagina.goto(`${base}/precios`);
    await pagina.waitForSelector('table[aria-label="Lista de precios"] tbody tr');
    await pagina.click('button:has-text("Editar precios")');
    const celda = pagina.locator('input[aria-label="BARBER-PRO Mensual"]');
    await celda.fill('17');
    await pagina.fill('input[placeholder="Motivo (opcional)"]', 'Prueba e2e');
    await pagina.click('button:has-text("Guardar cambios")');
    await pagina.waitForSelector('.toast');
    await pagina.waitForSelector('table[aria-label="Lista de precios"] td:has-text("17,00")');
    await pagina.click('button:has-text("Historial")');
    await pagina.waitForSelector('[role=dialog] td:has-text("Prueba e2e")');
    await pagina.keyboard.press('Escape');
    // el vendedor
    await pagina.click('nav >> text=Cerrar sesión');
    await entrar('carlos@agencia.test');
    await pagina.goto(`${base}/precios`);
    await pagina.waitForSelector('table[aria-label="Lista de precios"] td:has-text("17,00")');
    if (await pagina.locator('button:has-text("Editar precios")').count()) throw new Error('el vendedor no debe poder editar');
    await pagina.waitForSelector('text=Simulador de venta');
    await pagina.goto(`${base}/ventas/nueva`);
    await pagina.selectOption('select >> nth=1', { label: 'BARBER-PRO' });
    const texto = await pagina.textContent('form');
    if (!texto?.includes('17,00')) throw new Error('el precio nuevo no aparece en la venta');
  });
  await paso('el admin no ve lo del dueño: catálogo, auditoría ni comisiones ajenas', async () => {
    await pagina.click('nav >> text=Cerrar sesión');
    await entrar('admin@agencia.test');
    for (const t of ['Catálogo', 'Auditoría', 'Ajustes']) if (await pagina.locator(`nav a:has-text("${t}")`).count()) throw new Error(`${t} visible para admin`);
    await pagina.goto(`${base}/equipo`);
    await pagina.waitForSelector('table');
    const cab = await pagina.textContent('table thead');
    if (/Comisión pendiente|Vendido/.test(cab || '')) throw new Error('el admin ve columnas de dinero');
    await pagina.goto(`${base}/auditoria`);
    await pagina.waitForURL(`${base}/`);
    await pagina.goto(`${base}/guia`);
    await pagina.waitForSelector('table[aria-label="Permisos por rol"] th.guia-yo:has-text("Admin")');
    await pagina.click('nav >> text=Cerrar sesión');
    await entrar('dueno@agencia.test');
  });
  await paso('prospecto: crear, avanzar y convertir en cliente', async () => {
    await pagina.goto(`${base}/prospectos`);
    await pagina.waitForSelector('.tablero-kanban');
    await pagina.click('button:has-text("+ Prospecto")');
    await pagina.fill('[role=dialog] input >> nth=0', 'Luis Barbero');
    await pagina.fill('[role=dialog] input >> nth=1', 'Barbería Luis');
    await pagina.click('[role=dialog] button[type=submit]');
    await pagina.waitForSelector('.kanban-tarjeta:has-text("Luis Barbero")');
    await pagina.click('.kanban-tarjeta:has-text("Luis Barbero")');
    await pagina.selectOption('[role=dialog] select', 'demo');
    await pagina.waitForSelector('.kanban-col:has-text("Demo instalada") .kanban-tarjeta:has-text("Luis Barbero")');
    await pagina.click('.kanban-tarjeta:has-text("Luis Barbero")');
    await pagina.click('button:has-text("Convertir en cliente y vender")');
    await pagina.waitForURL(/\/ventas\/nueva\?cliente_id=\d+/);
  });
  await paso('renovaciones, tablero y contabilidad cargan para el dueño', async () => {
    await pagina.goto(`${base}/renovaciones`);
    await pagina.waitForSelector('table[aria-label="Renovaciones"]');
    await pagina.click('.chip:has-text("60 días")');
    await pagina.waitForSelector('table[aria-label="Renovaciones"] tbody tr');
    await pagina.goto(`${base}/tablero`);
    await pagina.waitForSelector('.ranking-fila');
    await pagina.goto(`${base}/contabilidad`);
    await pagina.waitForSelector('dd:has-text("USD")');
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.click('button:has-text("Descargar Excel del mes")')]);
    if (!/contabilidad-\d{4}-\d{2}\.xlsx/.test(descarga.suggestedFilename())) throw new Error(`descarga inesperada: ${descarga.suggestedFilename()}`);
  });
  await paso('demo autoservicio desde la web de compra', async () => {
    const publica = await navegador.newPage({ viewport: { width: 1200, height: 900 } });
    publica.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
    await publica.goto(`${base}/comprar`);
    await publica.waitForSelector('.producto-publico');
    await publica.click('.chip:has-text("Probar gratis")');
    await publica.fill('form input >> nth=0', 'Rosa Demo');
    await publica.fill('input[type=email]', 'rosa.demo@prueba.test');
    await publica.click('button:has-text("Activar mi demo gratis")');
    await publica.waitForSelector('text=Tu demo está lista');
    const clave = await publica.textContent('code.clave');
    if (!/^CTL-/.test(clave || '')) throw new Error('sin clave de demo');
    await publica.close();
  });
  await paso('página de tickets del panel', async () => {
    await pagina.goto(`${base}/tickets`);
    await pagina.waitForSelector('table[aria-label="Tickets"]');
  });
  await paso('mi seguridad accesible a cualquier rol', async () => {
    await pagina.click('nav >> text=Cerrar sesión');
    await pagina.waitForURL(`${base}/login`);
    await entrar('carlos@agencia.test');
    await pagina.goto(`${base}/seguridad`);
    await pagina.waitForSelector('h1:has-text("Mi seguridad")');
  });

  console.log('Portal del cliente');
  let clave = null;
  await paso('el vendedor ve una clave de licencia de su cliente', async () => {
    await pagina.goto(`${base}/clientes`);
    await pagina.click('table tbody tr:has-text("Patricia")');
    await pagina.waitForSelector('code.clave');
    clave = (await pagina.textContent('code.clave'))?.trim();
    if (!clave) throw new Error('sin clave');
    await pagina.click('nav >> text=Cerrar sesión');
  });
  await paso('acceso al portal con clave + correo', async () => {
    await pagina.goto(`${base}/portal`);
    await pagina.fill('input[autocomplete=off]', clave);
    await pagina.fill('input[autocomplete=email]', 'patricia@sonrisa.test');
    await pagina.click('button[type=submit]');
    await pagina.waitForURL(`${base}/portal/inicio`);
    await pagina.waitForSelector('.portal-lic');
  });
  await paso('abrir un ticket desde el portal', async () => {
    await pagina.click('button:has-text("+ Nuevo ticket")');
    await pagina.fill('[role=dialog] input', 'No abre el sistema');
    await pagina.fill('[role=dialog] textarea', 'Al iniciar muestra una pantalla en blanco.');
    await pagina.click('[role=dialog] button[type=submit]');
    await pagina.waitForSelector('[role=dialog]', { state: 'detached' });
    await pagina.waitForSelector('.lista-simple li:has-text("No abre el sistema")');
  });
  await paso('la agencia responde el ticket', async () => {
    await pagina.click('button:has-text("Salir")');
    await entrar('dueno@agencia.test');
    await pagina.goto(`${base}/tickets`);
    await pagina.click('table tbody tr:has-text("No abre el sistema")');
    await pagina.waitForSelector('.conversacion .mensaje');
    await pagina.fill('textarea', 'Reinstala desde el enlace que te enviamos y avísanos.');
    await pagina.click('button:has-text("Enviar respuesta")');
    await pagina.waitForSelector('.mensaje.agencia');
  });

  if (process.env.E2E_CAPTURAS) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(process.env.E2E_CAPTURAS, { recursive: true });
    for (const [ruta, nombre] of [['/reportes', 'reportes'], ['/tickets', 'tickets'], ['/clientes/1', 'cliente-historial'], ['/precios', 'precios'], ['/guia', 'guia']]) {
      await pagina.goto(`${base}${ruta}`); await pagina.waitForTimeout(600);
      await pagina.screenshot({ path: `${process.env.E2E_CAPTURAS}/${nombre}.png`, fullPage: true });
    }
    await pagina.click('.tema-btn'); await pagina.goto(`${base}/`); await pagina.waitForSelector('.indicadores'); await pagina.waitForTimeout(400);
    await pagina.screenshot({ path: `${process.env.E2E_CAPTURAS}/panel-oscuro.png`, fullPage: true });
    await pagina.keyboard.press('Control+k'); await pagina.fill('.buscador input', 'Pat'); await pagina.waitForTimeout(500);
    await pagina.screenshot({ path: `${process.env.E2E_CAPTURAS}/buscador-oscuro.png` });
    await pagina.keyboard.press('Escape'); await pagina.click('.tema-btn');
    await pagina.goto(`${base}/portal`); await pagina.waitForTimeout(400);
    await pagina.screenshot({ path: `${process.env.E2E_CAPTURAS}/portal-acceso.png` });
  }
  await navegador.close();
  if (errores.length) { fallos++; console.log('Errores del navegador:\n  ' + errores.join('\n  ')); }
  console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodas las pruebas e2e pasaron');
} catch (e) {
  fallos++;
  console.error(e.message);
} finally {
  servidor?.kill();
  rmSync(dir, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
}
