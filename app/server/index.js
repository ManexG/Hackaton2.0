import { createServer } from 'node:http';
import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { TransitStore, ApiError } from './store.js';
import { validateNetwork } from '../src/planner.js';
const root = fileURLToPath(new URL('../', import.meta.url));
export function createTransitServer(options = {}) {
  const network =
    options.network ??
    JSON.parse(readFileSync(resolve(root, 'public/data/network.demo.json'), 'utf8'));
  validateNetwork(network);
  const publicAppUrl = options.publicAppUrl ?? process.env.PUBLIC_APP_URL ?? '';
  if (
    publicAppUrl &&
    new URL(publicAppUrl).protocol !== 'https:' &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(publicAppUrl)
  )
    throw new Error('PUBLIC_APP_URL debe usar HTTPS.');
  const allowed = new Set(
    options.allowedOrigins ??
      (
        process.env.ALLOWED_ORIGINS ??
        'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8787,http://localhost:8787,https://localhost,http://localhost'
      )
        .split(',')
        .map((origin) => origin.trim())
  );
  if (publicAppUrl) allowed.add(new URL(publicAppUrl).origin);
  const store = new TransitStore(
    options.dbPath ?? process.env.DATABASE_PATH ?? resolve(root, 'data/cerca.sqlite'),
    network,
    publicAppUrl
  );
  store.resetServices();
  const clients = new Set();
  const attempts = new Map();
  function broadcast() {
    const event = `event: fleet\ndata: ${JSON.stringify(store.snapshot())}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 256_000) client.destroy();
      else client.write(event);
    }
  }
  const interval = setInterval(() => {
    store.expire();
    broadcast();
    const now = Date.now();
    for (const [key, value] of attempts) if (value.reset < now) attempts.delete(key);
  }, 10_000);
  interval.unref();
  async function body(request) {
    if (!request.headers['content-type']?.startsWith('application/json'))
      throw new ApiError(415, 'Envía los datos en formato JSON.');
    let text = '';
    for await (const chunk of request) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > 16_384) throw new ApiError(413, 'Solicitud demasiado grande.');
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch {
      throw new ApiError(400, 'Los datos enviados no son válidos.');
    }
  }
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if (origin) {
      if (!allowed.has(origin)) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const send = (status, value) => {
      response
        .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (request.method === 'GET' && url.pathname === '/api/health') {
        send(200, { ok: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/fleet') {
        send(200, store.snapshot());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        response.write('retry: 3000\n\n');
        clients.add(response);
        broadcast();
        response.on('close', () => clients.delete(response));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const data = await body(request);
        // Do not trust forwarded IP headers from arbitrary clients. A reverse proxy can be configured separately.
        const keys = [
          `ip:${request.socket.remoteAddress ?? ''}`,
          `email:${typeof data.email === 'string' ? data.email.toLowerCase().slice(0, 254) : ''}`,
        ];
        for (const key of keys) {
          const attempt = attempts.get(key),
            now = Date.now();
          if (attempt && attempt.reset > now && attempt.count >= (key.startsWith('ip:') ? 100 : 8))
            throw new ApiError(429, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');
          attempts.set(key, {
            count: (attempt && attempt.reset > now ? attempt.count : 0) + 1,
            reset: attempt && attempt.reset > now ? attempt.reset : now + 900_000,
          });
        }
        const session = await store.login(data.email, data.password);
        broadcast();
        send(200, session);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        store.logout(token);
        broadcast();
        send(200, { ok: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/driver/profile') {
        send(200, store.authenticate(token));
        return;
      }
      if (
        request.method === 'POST' &&
        ['/api/driver/service', '/api/driver/location'].includes(url.pathname)
      ) {
        const driver = store.authenticate(token),
          data = await body(request);
        if (url.pathname.endsWith('/service') && data.active === false) {
          const profile = store.pause(driver.id);
          broadcast();
          send(200, profile);
          return;
        }
        if (url.pathname.endsWith('/service') && data.active !== true)
          throw new ApiError(400, 'Indica si deseas activar o desactivar el servicio.');
        try {
          const profile = store.update(driver.id, data, url.pathname.endsWith('/service'));
          broadcast();
          send(200, profile);
        } catch (error) {
          broadcast();
          throw error;
        }
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        send(404, { message: 'No encontramos esa operación.' });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(405, { message: 'Método no permitido.' });
        return;
      }
      const dist = resolve(options.distPath ?? resolve(root, 'dist'));
      let file = resolve(
        dist,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
      );
      if (!file.startsWith(dist + sep)) throw new ApiError(403, 'Archivo no disponible.');
      if (!existsSync(file)) {
        send(404, { message: 'Compila la interfaz con npm run build antes de abrir la web.' });
        return;
      }
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
      };
      response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      createReadStream(file)
        .on('error', () => response.destroy())
        .pipe(response);
    } catch (error) {
      send(error instanceof ApiError ? error.status : 500, {
        message: error instanceof ApiError ? error.message : 'No pudimos completar la operación.',
      });
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.on('close', () => {
    clearInterval(interval);
    for (const client of clients) client.end();
    store.close();
  });
  return { server, store };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createTransitServer();
  server.listen(Number(process.env.PORT ?? 8787), '0.0.0.0', () =>
    console.log('Cerca: servidor y web disponibles en el puerto ' + (process.env.PORT ?? 8787))
  );
  const stop = () => {
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
