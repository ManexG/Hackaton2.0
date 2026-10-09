import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError, TransitStoreCore, type LocationFix, type SyncDatabase } from '../server/store-core';
import networkData from '../public/data/network.demo.json';
import type { Network } from '../src/types';

interface Env {
  FLEET: DurableObjectNamespace<FleetService>;
  ASSETS: Fetcher;
  CERCA_ADMIN_TOKEN?: string;
  PUBLIC_APP_URL?: string;
  ALLOWED_ORIGINS?: string;
}
const network = networkData as unknown as Network;
const json = (status: number, data: unknown) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const allowed = new Set(['https://localhost', 'http://localhost', 'http://127.0.0.1:5173', 'http://localhost:5173', url.origin, ...(env.ALLOWED_ORIGINS ?? '').split(',').map(item => item.trim())]);
    if (env.PUBLIC_APP_URL) allowed.add(new URL(env.PUBLIC_APP_URL).origin);
    if (origin && !allowed.has(origin)) return json(403, { message: 'Origen no permitido.' });
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization'); headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    // Check the current deployment's secret at the gateway, before invoking the persistent object.
    if (url.pathname.startsWith('/api/admin/')) {
      const admin = env.CERCA_ADMIN_TOKEN, token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      if (!admin) return json(404, { message: 'Administración no configurada.' });
      const digest = (value: string) => createHash('sha256').update(value).digest();
      if (!token || token.length > 256 || !timingSafeEqual(digest(token), digest(admin))) return json(401, { message: 'Acceso de operador requerido.' });
    }
    const response = await env.FLEET.getByName('lazaro-cardenas').fetch(request);
    const result = new Response(response.body, response);
    headers.forEach((value, key) => result.headers.set(key, value));
    return result;
  },
} satisfies ExportedHandler<Env>;

export class FleetService extends DurableObject<Env> {
  private store: TransitStoreCore;
  private clients = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private encoder = new TextEncoder();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db: SyncDatabase = {
      exec: query => { ctx.storage.sql.exec(query); },
      prepare: query => ({
        get: (...values) => ctx.storage.sql.exec(query, ...values as SqlStorageValue[]).toArray()[0],
        all: (...values) => ctx.storage.sql.exec(query, ...values as SqlStorageValue[]).toArray(),
        run: (...values) => { const cursor = ctx.storage.sql.exec(query, ...values as SqlStorageValue[]); cursor.toArray(); return { changes: ctx.storage.sql.exec<{ count: number }>('SELECT changes() AS count').one().count }; },
      }),
      transaction: callback => ctx.storage.transactionSync(callback),
      close: () => {},
    };
    this.store = new TransitStoreCore(db, network, env.PUBLIC_APP_URL ?? '');
    // Eviction/redeployment must preserve driver availability; snapshot expires stale GPS.
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL)');
  }
  private snapshot(publicUrl: string) { return { ...this.store.snapshot(), publicAppUrl: this.env.PUBLIC_APP_URL || publicUrl }; }
  private broadcast() {
    for (const [client, publicUrl] of this.clients) {
      try { client.enqueue(this.encoder.encode(`event: fleet\ndata: ${JSON.stringify(this.snapshot(publicUrl))}\n\n`)); }
      catch { this.clients.delete(client); }
    }
    this.stopUnusedTimer();
  }
  private stopUnusedTimer() { if (!this.clients.size && this.timer) { clearInterval(this.timer); this.timer = undefined; } }
  private throttle(email: unknown, ip: string) {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM login_attempts WHERE reset<=?', now);
      for (const key of [`ip:${ip}`, `email:${typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : ''}`]) {
        const row = this.ctx.storage.sql.exec<{ count: number; reset: number }>('SELECT count,reset FROM login_attempts WHERE key=?', key).toArray()[0];
        if (row && row.count >= (key.startsWith('ip:') ? 100 : 8)) throw new ApiError(429, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');
        this.ctx.storage.sql.exec('INSERT INTO login_attempts (key,count,reset) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset=excluded.reset', key, (row?.count ?? 0) + 1, row?.reset ?? now + 900_000);
      }
    });
  }
  private async body(request: Request) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'Envía los datos en formato JSON.');
    if (Number(request.headers.get('Content-Length')) > 16_384) throw new ApiError(413, 'Solicitud demasiado grande.');
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'Faltan los datos de la solicitud.');
    const decoder = new TextDecoder(); let text = '', size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 16_384) { await reader.cancel(); throw new ApiError(413, 'Solicitud demasiado grande.'); } text += decoder.decode(value, { stream: true }); }
      text += decoder.decode();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data as Record<string, unknown>;
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'Los datos enviados no son válidos.'); }
    finally { reader.releaseLock(); }
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), publicUrl = url.origin + '/';
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: true, hosting: 'cloudflare' });
      if (request.method === 'GET' && url.pathname === '/api/fleet') return json(200, this.snapshot(publicUrl));
      if (request.method === 'GET' && url.pathname === '/api/events') {
        let controller: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start: target => { controller = target; this.clients.set(target, publicUrl); target.enqueue(this.encoder.encode('retry: 3000\n\n')); this.broadcast(); if (!this.timer) this.timer = setInterval(() => this.broadcast(), 10_000); },
          cancel: () => { this.clients.delete(controller); this.stopUnusedTimer(); },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/drivers') {
        // Only the gateway can reach this binding; it authenticates every /api/admin/ request.
        const data = await this.body(request);
        if (typeof data.name !== 'string' || typeof data.email !== 'string' || typeof data.unit !== 'string' || typeof data.routeId !== 'string' || typeof data.password !== 'string') throw new ApiError(400, 'Faltan los datos del chofer.');
        try { const driver = this.store.provision(data as unknown as Parameters<TransitStoreCore['provision']>[0]); this.broadcast(); return json(200, driver); }
        catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Asignación inválida.'); }
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const data = await this.body(request);
        this.throttle(data.email, request.headers.get('CF-Connecting-IP') ?? 'local');
        const session = await this.store.login(data.email, data.password); this.broadcast(); return json(200, session);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') { this.store.logout(token); this.broadcast(); return json(200, { ok: true }); }
      if (request.method === 'GET' && url.pathname === '/api/driver/profile') return json(200, this.store.authenticate(token));
      if (request.method === 'POST' && ['/api/driver/service', '/api/driver/location'].includes(url.pathname)) {
        const driver = this.store.authenticate(token), data = await this.body(request);
        if (url.pathname.endsWith('/service') && data.active === false) { const result = this.store.pause(driver.id); this.broadcast(); return json(200, result); }
        if (url.pathname.endsWith('/service') && data.active !== true) throw new ApiError(400, 'Indica si deseas activar o desactivar el servicio.');
        try { const result = this.store.update(driver.id, data as unknown as LocationFix, url.pathname.endsWith('/service')); return json(200, result); }
        finally { this.broadcast(); }
      }
      return json(404, { message: 'No encontramos esa operación.' });
    } catch (error) {
      return json(error instanceof ApiError ? error.status : 500, { message: error instanceof ApiError ? error.message : 'No pudimos completar la operación.' });
    }
  }
}
