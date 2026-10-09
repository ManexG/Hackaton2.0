const CACHE = 'lcalerta-v5';
const SHELL = ['/', '/index.html', '/admin.html', '/estadisticas.html', '/reporte.html',
  '/css/app.css', '/js/app.js', '/js/auth.js', '/js/admin.js', '/js/reporte.js', '/img/icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

/* Rutas donde vive la SPA de React (frontend/dist). El backend sirve el mismo
   index.html para que /parada/LC-XXX funcione al recargar o escanear el QR. */
const SPA_ROUTES = ['/chofer', '/avenida', '/parada'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);

  // Tiles OSM: cache-first, luego red + guardar (offline-first en la colonia)
  if (u.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    })));
    return;
  }
  // API GET: red, fallback caché
  if (u.pathname.startsWith('/api/') && e.request.method === 'GET') {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Código propio (html/css/js/imagenes del mismo origen): red primero para no quedarse con diseño viejo;
  // si no hay señal, se sirve la última copia guardada (sigue funcionando offline)
  if (u.origin === self.location.origin && e.request.method === 'GET') {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Librerías CDN (URLs versionadas): caché primero
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
