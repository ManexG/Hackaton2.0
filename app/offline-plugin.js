import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Cache only our bundled assets and explicitly public community data. GPS,
// sessions, operator actions and uploads always require a live connection.
export function offlinePlugin() {
  let output;
  return {
    name: 'las-palmas-offline',
    apply: 'build',
    configResolved(config) {
      output = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      async function files(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        const groups = await Promise.all(
          entries.map((entry) =>
            entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
          )
        );
        return groups.flat();
      }
      const paths = (await files(output)).filter((path) => !path.endsWith('sw.js')).sort();
      const hash = createHash('sha256');
      hash.update(await readFile(fileURLToPath(import.meta.url)));
      for (const path of paths) hash.update(await readFile(path));
      const assets = paths.map((path) => '/' + relative(output, path).replaceAll('\\', '/'));
      const version = hash.digest('hex').slice(0, 16);
      await writeFile(
        join(output, 'sw.js'),
        `
const PREFIX = 'las-palmas-';
const CACHE = PREFIX + '${version}';
const ASSETS = ${JSON.stringify(assets)};
const PRECACHE = ASSETS.filter(path => !path.includes('/esm-') && !path.includes('/AdminPanel-') && path !== '/data/eta-model.json' && !['/brand/las-palmas-logo.png', '/brand/las-palmas-icon.png', '/brand/las-palmas-icon.webp'].includes(path));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async path => {
      // Browser HTTP cache avoids downloading the initial page assets twice.
      const response = await fetch(path, {cache: path.startsWith('/assets/') ? 'force-cache' : 'no-cache'});
      if (!response.ok) throw new Error('Incomplete offline resources');
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith(PREFIX));
    await Promise.all(keys.filter(key => key !== CACHE).slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!/^\\/api\\/(network$|community\\/(reportes(?:\\/\\d+(?:\\/(comentarios|historial))?)?$|categorias$|colonias$|estadisticas$|foto\\/|rutas(?:\\/\\d+\\/paradas)?$))/.test(url.pathname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(request.url);
      const ttl = url.pathname.includes('/foto/') ? 86400000 : /network$|colonias$|categorias$/.test(url.pathname) ? 300000 : 0;
      if (saved && request.cache !== 'reload' && ttl && Date.now() - Number(saved.headers.get('X-Saved-At') || 0) < ttl) return saved;
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.ok && Number(response.headers.get('Content-Length') || 0) < 350000) {
          const copy = response.clone();
          const headers = new Headers(copy.headers); headers.set('X-Saved-At', String(Date.now()));
          await cache.put(request.url, new Response(copy.body, {status:copy.status,headers})).catch(() => {});
          const entries = (await cache.keys()).filter(entry => new URL(entry.url).pathname.startsWith('/api/'));
          await Promise.all(entries.slice(0,-60).map(entry => cache.delete(entry)));
        }
        return response;
      } catch {
        return await cache.match(request.url) || Response.json({error:'Sin señal. Este contenido aún no está guardado.'}, {status:503});
      }
    })());
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'reload' }).catch(async () => {
      const saved = await (await caches.open(CACHE)).match('/index.html');
      // Cloudflare redirects /index.html to /. Navigation requests can reject
      // that cached redirected response, so return a fresh response with its body.
      return saved ? new Response(saved.body, { status: 200, headers: saved.headers })
        : new Response('Sin conexión. Abre la app con internet para guardar sus recursos.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }));
    return;
  }
  if (ASSETS.includes(url.pathname)) event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(url.pathname);
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok) await cache.put(url.pathname, response.clone()).catch(() => {});
    return response;
  })());
});
`
      );
    },
  };
}
