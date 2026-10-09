import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
test('Cloudflare runtime: persistent SQLite, private accounts, real GPS API, SSE and CORS', async () => {
  const bundle = await build({
    entryPoints: ['cloudflare/index.js'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers', 'node:*'],
  });
  const admin = Buffer.from(randomBytes(32)).toString('base64url');
  const stateRoot = resolve('.wrangler');
  mkdirSync(stateRoot, { recursive: true });
  const statePath = mkdtempSync(resolve(stateRoot, 'runtime-test-'));
  const options = {
    ...convertV4MiniflareOptions({
      workers: [
        {
          name: 'cerca-test',
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: '2026-10-08',
          compatibilityFlags: ['nodejs_compat'],
          durableObjects: { FLEET: { className: 'FleetService', useSQLite: true } },
          bindings: { CERCA_ADMIN_TOKEN: admin },
          serviceBindings: {
            ASSETS: () =>
              new Response('<html>Cerca</html>', { headers: { 'Content-Type': 'text/html' } }),
          },
        },
      ],
      host: '127.0.0.1',
      port: 0,
    }),
    resourcePersistencePath: statePath,
  };
  let runtime = new Miniflare(options);
  const network = JSON.parse(readFileSync('public/data/network.demo.json', 'utf8'));
  const account = {
    name: 'Prueba privada de runtime',
    email: 'cloudflare@example.test',
    unit: 'TEST-CF',
    routeId: 'R01',
    password: 'only-for-isolated-cloudflare-tests-123',
    windows: [
      { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '12:00' },
      { days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '00:00' },
    ],
  };
  const call = (path, body, token, origin) =>
    runtime.dispatchFetch('https://cerca-test.workers.dev/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let reader;
  try {
    assert.equal((await call('/health')).status, 200);
    assert.equal((await runtime.dispatchFetch('https://cerca-test.workers.dev/')).status, 200);
    assert.equal((await call('/admin/drivers', account)).status, 401);
    assert.equal((await call('/admin/drivers', account, 'wrong-token')).status, 401);
    assert.equal((await call('/admin/drivers', account, admin)).status, 200);
    assert.equal(
      (await call('/auth/login', { email: account.email, password: 'incorrect' })).status,
      401
    );
    const login = await call('/auth/login', { email: account.email, password: account.password });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.equal((await call('/driver/profile', undefined, session.token)).status, 200);
    assert.equal(
      (await call('/fleet', undefined, undefined, 'https://foreign.example')).status,
      403
    );
    const native = await call('/fleet', undefined, undefined, 'https://localhost');
    assert.equal(native.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
    assert.equal(
      (
        await runtime.dispatchFetch('https://cerca-test.workers.dev/api/driver/location', {
          method: 'OPTIONS',
          headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' },
        })
      ).status,
      204
    );
    const initial = await (await call('/fleet')).json();
    assert.equal(initial.publicAppUrl, 'https://cerca-test.workers.dev/');
    assert.equal(initial.vehicles.length, 0);
    const events = await call('/events');
    assert.equal(events.headers.get('Content-Type'), 'text/event-stream');
    reader = events.body.getReader();
    const decoder = new TextDecoder();
    let eventText = '';
    while (!eventText.includes('event: fleet'))
      eventText += decoder.decode((await reader.read()).value);
    assert.match(eventText, /"vehicles":\[\]/);
    const point = network.stops.find((stop) => stop.id === network.routes[0].stops[0]).point;
    const fix = { point, accuracy: 5, speed: 0, timestamp: Date.now(), direction: 1 };
    assert.equal(
      (await call('/driver/service', { active: true, ...fix, routeId: 'R04' }, session.token))
        .status,
      200
    );
    const fleet = await (await call('/fleet')).json();
    assert.equal(fleet.vehicles.length, 1);
    assert.equal(fleet.vehicles[0].routeId, 'R01');
    assert.ok(!JSON.stringify(fleet).includes(account.email));
    assert.ok(!JSON.stringify(fleet).includes(account.password));
    const updated = decoder.decode((await reader.read()).value);
    assert.match(updated, /TEST-CF/);
    assert.equal(
      (await call('/driver/location', { ...fix, accuracy: 500 }, session.token)).status,
      422
    );
    await reader.cancel();
    reader = undefined;
    await runtime.dispose();
    runtime = new Miniflare(options);
    assert.equal((await call('/driver/profile', undefined, session.token)).status, 200);
    assert.equal((await (await call('/fleet')).json()).vehicles.length, 1);
    assert.equal((await call('/driver/service', { active: false }, session.token)).status, 200);
    assert.equal((await call('/auth/logout', {}, session.token)).status, 200);
    assert.equal((await call('/driver/profile', undefined, session.token)).status, 401);
    const restored = await call('/auth/login', {
      email: account.email,
      password: account.password,
    });
    assert.equal(restored.status, 200);
    for (let attempt = 0; attempt < 8; attempt++)
      await call('/auth/login', { email: 'blocked@example.test', password: 'incorrect' });
    assert.equal(
      (await call('/auth/login', { email: 'blocked@example.test', password: 'incorrect' })).status,
      429
    );
  } finally {
    if (reader) await reader.cancel();
    await runtime.dispose();
    if (!resolve(statePath).startsWith(stateRoot + sep + 'runtime-test-'))
      throw new Error('Test storage is outside its workspace.');
    rmSync(statePath, { recursive: true, force: true });
  }
});
