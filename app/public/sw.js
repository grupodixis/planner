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

// Avisos (push): se enseñan aunque la app esté cerrada
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Planéalo', {
    body: d.cuerpo || '', icon: '/icono-192.png', badge: '/icono-192.png', tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || '/inicio.html' }, lang: 'es',
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/inicio.html', self.location.origin).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const misma = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
    if (misma) { await misma.focus(); return misma.navigate(url).catch(() => self.clients.openWindow(url)); }
    return self.clients.openWindow(url);
  })());
});
