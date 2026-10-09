import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError, TransitStoreCore } from '../server/store-core.js';
import { CommunityService } from '../server/community/service.js';
import { ReleaseService } from '../server/releases.js';
import { AdminCore } from '../server/admin-core.js';
import { createManageHandler } from '../server/admin.js';
import networkData from '../public/data/network.demo.json';
const network = networkData;
const json = (status, data) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      /^\/(reporte\/\d+|parada\/[A-Za-z0-9-]+|admin|perfil|mapa|estadisticas|campo|avenida|chofer)\/?$/.test(
        url.pathname
      )
    ) {
      const path = url.pathname.replace(/\/$/, '');
      return Response.redirect(
        new URL(path === '/chofer' ? '/?driver=1' : path === '/avenida' ? '/' : '/#' + path, url)
          .href,
        302
      );
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const allowed = new Set([
      'https://localhost',
      'http://localhost',
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      url.origin,
      ...(env.ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()),
    ]);
    if (env.PUBLIC_APP_URL) allowed.add(new URL(env.PUBLIC_APP_URL).origin);
    if (origin && !allowed.has(origin)) return json(403, { message: 'Origen no permitido.' });
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
      headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,X-Admin-Key,X-App-Version,X-App-Platform'
      );
      headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    // Check the current deployment's secret at the gateway, before invoking the persistent object.
    if (url.pathname.startsWith('/api/admin/')) {
      const admin = env.CERCA_ADMIN_TOKEN,
        token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      if (!admin) return json(404, { message: 'Administración no configurada.' });
      const digest = (value) => createHash('sha256').update(value).digest();
      if (!token || token.length > 256 || !timingSafeEqual(digest(token), digest(admin)))
        return json(401, { message: 'Acceso de operador requerido.' });
    }
    const response = await env.FLEET.getByName('lazaro-cardenas').fetch(request);
    const result = new Response(response.body, response);
    headers.forEach((value, key) => result.headers.set(key, value));
    return result;
  },
};
export class FleetService extends DurableObject {
  store;
  clients = new Map();
  lastEvents = new WeakMap();
  timer;
  encoder = new TextEncoder();
  constructor(ctx, env) {
    super(ctx, env);
    const db = {
      exec: (query) => {
        ctx.storage.sql.exec(query);
      },
      prepare: (query) => ({
        get: (...values) => ctx.storage.sql.exec(query, ...values).toArray()[0],
        all: (...values) => ctx.storage.sql.exec(query, ...values).toArray(),
        run: (...values) => {
          const cursor = ctx.storage.sql.exec(query, ...values);
          cursor.toArray();
          return { changes: ctx.storage.sql.exec('SELECT changes() AS count').one().count };
        },
      }),
      transaction: (callback) => ctx.storage.transactionSync(callback),
      close: () => {},
    };
    this.store = new TransitStoreCore(db, network, env.PUBLIC_APP_URL ?? '');
    this.community = new CommunityService(this.store, env.CERCA_ADMIN_TOKEN ?? '');
    this.releases = new ReleaseService({ db });
    this.admin = new AdminCore(db, network, this.store);
    this.community.transform = (base) => this.admin.applyTo(base);
    this.community.refreshNetwork();
    this.manage = createManageHandler({
      admin: this.admin,
      store: this.store,
      community: this.community,
      broadcast: () => this.broadcast(),
      readBody: (request) =>
        this.body(
          request,
          new URL(request.url).pathname.startsWith('/api/manage/routes') ? 512_000 : 16_384
        ),
      throttleLogin: (request, email) =>
        this.throttle(
          `admin:${String(email ?? '')}`,
          request.headers.get('CF-Connecting-IP') ?? 'local'
        ),
      getToken: (request) => request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '',
    });
    // Eviction/redeployment must preserve driver availability; snapshot expires stale GPS.
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL)'
    );
  }
  snapshot(publicUrl) {
    return { ...this.store.snapshot(), publicAppUrl: this.env.PUBLIC_APP_URL || publicUrl };
  }
  broadcast() {
    for (const [client, publicUrl] of this.clients) {
      try {
        const data = this.snapshot(publicUrl);
        const signature = JSON.stringify({
          vehicles: data.vehicles,
          services: data.services,
          pilotZone: data.pilotZone,
        });
        client.enqueue(
          this.encoder.encode(
            this.lastEvents.get(client) === signature
              ? ': keep-alive\n\n'
              : `event: fleet\ndata: ${JSON.stringify(data)}\n\n`
          )
        );
        this.lastEvents.set(client, signature);
      } catch {
        this.clients.delete(client);
      }
    }
    this.stopUnusedTimer();
  }
  stopUnusedTimer() {
    if (!this.clients.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  throttle(email, ip) {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM login_attempts WHERE reset<=?', now);
      for (const key of [
        `ip:${ip}`,
        `email:${typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : ''}`,
      ]) {
        const row = this.ctx.storage.sql
          .exec('SELECT count,reset FROM login_attempts WHERE key=?', key)
          .toArray()[0];
        if (row && row.count >= (key.startsWith('ip:') ? 100 : 8))
          throw new ApiError(429, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');
        this.ctx.storage.sql.exec(
          'INSERT INTO login_attempts (key,count,reset) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset=excluded.reset',
          key,
          (row?.count ?? 0) + 1,
          row?.reset ?? now + 900_000
        );
      }
    });
  }
  async body(request, maximum = 16_384) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      throw new ApiError(415, 'Envía los datos en formato JSON.');
    if (Number(request.headers.get('Content-Length')) > maximum)
      throw new ApiError(413, 'Solicitud demasiado grande.');
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'Faltan los datos de la solicitud.');
    const decoder = new TextDecoder();
    let text = '',
      size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum) {
          await reader.cancel();
          throw new ApiError(413, 'Solicitud demasiado grande.');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, 'Los datos enviados no son válidos.');
    } finally {
      reader.releaseLock();
    }
  }
  async fetch(request) {
    const url = new URL(request.url),
      publicUrl = url.origin + '/';
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    try {
      if (request.method === 'GET' && url.pathname === '/api/version')
        return json(200, await this.releases.current());
      if (request.method === 'POST' && url.pathname === '/api/admin/admins') {
        if (this.admin.listAdmins().length)
          throw new ApiError(
            409,
            'El primer administrador ya existe. Usa su panel para agregar otros.'
          );
        const input = await this.body(request);
        if (this.admin.listAdmins().length)
          throw new ApiError(409, 'El primer administrador ya existe.');
        return json(201, this.admin.createAdmin(input));
      }
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        ![
          '/api/auth/logout',
          '/api/manage/logout',
          '/api/community/vehiculos/detener',
          '/api/driver/service',
        ].includes(url.pathname)
      ) {
        const release = this.releases.required(
          request.headers.get('X-App-Version'),
          request.headers.get('X-App-Platform')
        );
        if (release)
          return json(426, { message: 'Actualiza OptiRouteLZC para continuar.', release });
      }
      if (url.pathname.startsWith('/api/manage/')) {
        let response;
        await this.manage(request, url, (status, value) => {
          response = json(status, value);
        });
        return response;
      }
      if (url.pathname.startsWith('/api/community/') || url.pathname === '/api/network') {
        if (['/api/community/auth/login', '/api/community/auth/registro'].includes(url.pathname)) {
          const data = await request
            .clone()
            .json()
            .catch(() => ({}));
          this.throttle(data.email, request.headers.get('CF-Connecting-IP') ?? 'local');
        }
        const response = await this.community.fetch(request);
        if (response.ok && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
          this.broadcast();
        return response;
      }
      if (request.method === 'GET' && url.pathname === '/api/health')
        return json(200, { ok: true, hosting: 'cloudflare' });
      if (request.method === 'GET' && url.pathname === '/api/fleet')
        return json(200, this.snapshot(publicUrl));
      if (request.method === 'GET' && url.pathname === '/api/events') {
        let controller;
        const stream = new ReadableStream({
          start: (target) => {
            controller = target;
            this.clients.set(target, publicUrl);
            target.enqueue(this.encoder.encode('retry: 3000\n\n'));
            this.broadcast();
            if (!this.timer) this.timer = setInterval(() => this.broadcast(), 10_000);
          },
          cancel: () => {
            this.clients.delete(controller);
            this.stopUnusedTimer();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no',
          },
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/drivers') {
        // Only the gateway can reach this binding; it authenticates every /api/admin/ request.
        const data = await this.body(request);
        if (
          typeof data.name !== 'string' ||
          typeof data.email !== 'string' ||
          typeof data.unit !== 'string' ||
          typeof data.routeId !== 'string' ||
          typeof data.password !== 'string'
        )
          throw new ApiError(400, 'Faltan los datos del chofer.');
        try {
          const driver = this.store.provision(data);
          this.broadcast();
          return json(200, driver);
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : 'Asignación inválida.');
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const data = await this.body(request);
        this.throttle(data.email, request.headers.get('CF-Connecting-IP') ?? 'local');
        const session = await this.store.login(data.email, data.password);
        this.broadcast();
        return json(200, session);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        this.store.logout(token);
        this.broadcast();
        return json(200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/driver/profile')
        return json(200, this.store.authenticate(token));
      if (request.method === 'POST' && url.pathname === '/api/driver/password') {
        const data = await this.body(request);
        await this.store.changePassword(token, data.current, data.next);
        return json(200, { ok: true });
      }
      if (
        request.method === 'POST' &&
        ['/api/driver/service', '/api/driver/location'].includes(url.pathname)
      ) {
        const driver = this.store.authenticate(token),
          data = await this.body(request);
        if (url.pathname.endsWith('/service') && data.active === false) {
          const result = this.store.pause(driver.id);
          this.broadcast();
          return json(200, result);
        }
        const release = this.releases.required(
          request.headers.get('X-App-Version'),
          request.headers.get('X-App-Platform')
        );
        if (release)
          return json(426, { message: 'Actualiza OptiRouteLZC para continuar.', release });
        if (url.pathname.endsWith('/service') && data.active !== true)
          throw new ApiError(400, 'Indica si deseas activar o desactivar el servicio.');
        try {
          const result = this.store.update(driver.id, data, url.pathname.endsWith('/service'));
          return json(200, result);
        } finally {
          this.broadcast();
        }
      }
      return json(404, { message: 'No encontramos esa operación.' });
    } catch (error) {
      return json(error instanceof ApiError ? error.status : 500, {
        message: error instanceof ApiError ? error.message : 'No pudimos completar la operación.',
      });
    }
  }
}
