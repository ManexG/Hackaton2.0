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
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith(PREFIX));
    await Promise.all(keys.slice(0, -2).filter(key => key !== CACHE).map(key => caches.delete(key)));
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
      try {
        const response = await fetch(request, { cache: 'reload' });
        if (response.ok) await cache.put(request.url, response.clone()).catch(() => {});
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
    return await cache.match(url.pathname) || fetch(request);
  })());
});
`
      );
    },
  };
}
