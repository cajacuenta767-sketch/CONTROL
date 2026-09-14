/* Service worker de CONTROL: cachea la carcasa del panel para abrir rápido y funcionar sin señal.
   La API nunca se cachea (siempre red); si no hay red, el panel avisa. */
const VERSION = 'control-v1';
const CARCASA = ['/', '/index.html', '/manifest.webmanifest', '/icono.svg', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CARCASA)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // la API siempre va a la red
  // Recursos compilados (con hash): caché primero. Navegación: red primero con respaldo en caché.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => { const copia = resp.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); return resp; })));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((resp) => { const copia = resp.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copia)); return resp; }).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
