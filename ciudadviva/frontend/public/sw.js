/**
 * sw.js — Service Worker de la SPA (offline-first).
 *
 * Estrategias:
 * - Código propio: red primero, caché como respaldo. Así nunca se ve una versión vieja.
 * - Tiles del mapa y CDN: caché primero (son archivos grandes y no cambian).
 * - API GET: red primero; si no hay señal, se sirve la última respuesta conocida
 *   para que el feed siga siendo legible en la calle.
 */

const CACHE = 'lcalerta-react-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/img/icon.svg'];

const CDNS = ['unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function redPrimero(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copia));
    }
    return res;
  } catch {
    const hit = await caches.match(req);
    return hit || new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
  }
}

async function cachePrimero(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    const copia = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copia));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // los envíos los hace la app directamente

  const u = new URL(req.url);
  const esApi = u.pathname.startsWith('/api/');
  const esTile = u.hostname.endsWith('tile.openstreetmap.org');
  const esCdn = CDNS.some((h) => u.hostname.endsWith(h));

  // Navegación: siempre red primero para traer el index.html actualizado
  if (req.mode === 'navigate') {
    e.respondWith(redPrimero(req));
    return;
  }
  if (esApi) {
    e.respondWith(redPrimero(req));
    return;
  }
  if (esTile || esCdn) {
    e.respondWith(cachePrimero(req));
    return;
  }
  // Recursos con hash en el nombre (bundle de Vite): caché primero
  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(cachePrimero(req));
    return;
  }
  e.respondWith(redPrimero(req));
});