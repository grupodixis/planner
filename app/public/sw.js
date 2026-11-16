// Service worker mínimo: hace la app instalable y enseña una página «sin conexión».
// No guarda datos ni pantallas en caché: siempre se usa la versión del servidor.
const CACHE = 's360-offline-1';
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icono-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;   // todo lo demás, directo a la red
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
