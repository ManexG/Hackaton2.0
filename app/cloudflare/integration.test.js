import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { APP_VERSION } from '../src/version.js';
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
  const futureVersion = `${Number(APP_VERSION.split('.')[0]) + 1}.0.0`;
  let releaseRequests = 0;
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
          outboundService: async (request) => {
            releaseRequests++;
            if (request.url.startsWith('https://api.github.com/'))
              return new Response(null, { status: 403 });
            if (request.url.endsWith('/latest/download/release.json'))
              return Response.json({
                version: futureVersion,
                repository: 'ManexG/Hackaton2.0',
                assetName: 'Las-Palmas-Rutas.apk',
                notes: ['Actualización de prueba aislada'],
              });
            if (request.url.endsWith('/Las-Palmas-Rutas.apk') && request.method === 'HEAD')
              return new Response(null, {
                headers: {
                  'Content-Length': '33321729',
                  'Content-Type': 'application/octet-stream',
                },
              });
            return new Response(null, { status: 404 });
          },
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
    const releaseResponse = await call('/version');
    assert.equal(releaseResponse.status, 200);
    const release = await releaseResponse.json();
    assert.equal(release.minimumWebVersion, APP_VERSION);
    assert.equal(release.minimumVersion, futureVersion);
    assert.equal(release.discovery, 'manifest');
    assert.equal(releaseRequests, 3);
    const oldClient = await runtime.dispatchFetch('https://cerca-test.workers.dev/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': '1.0.0',
        'X-App-Platform': 'native',
      },
      body: '{}',
    });
    assert.equal(oldClient.status, 426);

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
    const administrator = {
      name: 'Admin CF',
      email: 'admin-cf@example.test',
      password: 'isolated-admin-cloudflare-123',
    };
    assert.equal((await call('/admin/admins', administrator)).status, 401);
    assert.equal((await call('/admin/admins', administrator, admin)).status, 201);
    assert.equal((await call('/admin/admins', administrator, admin)).status, 409);
    assert.equal((await call('/manage/routes', undefined, session.token)).status, 401);
    assert.equal(
      (await call('/manage/login', { email: administrator.email, password: 'incorrect' })).status,
      401
    );
    const adminLogin = await call('/manage/login', administrator);
    assert.equal(adminLogin.status, 200);
    const adminSession = await adminLogin.json();
    const manage = async (method, path, body) =>
      runtime.dispatchFetch('https://cerca-test.workers.dev/api/manage' + path, {
        method,
        headers: {
          Authorization: `Bearer ${adminSession.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const routes = await (await manage('GET', '/routes')).json();
    assert.equal(routes.routes.length, 4);
    const custom = {
      ...routes.routes[0],
      name: 'Ruta administrada CF',
      stops: routes.routes[0].stops.slice(0, 2),
      segments: routes.routes[0].segments.slice(0, 1),
    };
    const customResponse = await manage('POST', '/routes', custom);
    assert.equal(customResponse.status, 201);
    const customRoute = await customResponse.json();
    const createdDriver = await manage('POST', '/drivers', {
      name: 'Chofer gestionado',
      email: 'managed-cf@example.test',
      unit: 'CF-MANAGED',
      routeId: customRoute.id,
      windows: account.windows,
    });
    assert.equal(createdDriver.status, 201);
    const managedDriver = await createdDriver.json();
    assert.equal(typeof managedDriver.password, 'string');
    assert.equal((await manage('DELETE', '/routes/' + customRoute.id)).status, 409);
    assert.equal(
      (await manage('PATCH', '/drivers/' + managedDriver.driver.id, { routeId: 'R01' })).status,
      200
    );
    assert.equal((await manage('DELETE', '/drivers/' + managedDriver.driver.id)).status, 200);
    assert.equal(
      (
        await manage('PUT', '/routes/' + customRoute.id, {
          ...customRoute,
          name: 'Ruta CF editada',
        })
      ).status,
      200
    );
    assert.ok((await (await call('/network')).json()).routes.some((r) => r.id === customRoute.id));
    const community = (path, options = {}) =>
      runtime.dispatchFetch('https://cerca-test.workers.dev/api/community' + path, options);
    const communityDriver = await (
      await community('/auth/me', { headers: { Authorization: `Bearer ${session.token}` } })
    ).json();
    assert.equal(communityDriver.rol, 'chofer');
    assert.equal(communityDriver.email, account.email);
    const neighbor = await community('/auth/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Vecina CF',
        email: 'neighbor-cf@example.test',
        password: 'isolated-neighbor-cloudflare-password',
        rol: 'admin',
      }),
    });
    assert.equal(neighbor.status, 201);
    const neighborSession = await neighbor.json();
    assert.equal(neighborSession.rol, 'vecino');
    const photoBytes = new Uint8Array(280000).fill(42);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      categoria: 'bache',
      descripcion: 'Reporte persistente CF',
      lat: network.stops[0].point[0],
      lng: network.stops[0].point[1],
      client_id: 'isolated-cloudflare-report',
    }))
      form.set(key, value);
    form.set('foto', new Blob([photoBytes], { type: 'image/png' }), 'photo.png');
    const upload = new Request('https://isolated.test/', { method: 'POST', body: form });
    const created = await community('/reportes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${neighborSession.token}`,
        'Content-Type': upload.headers.get('Content-Type'),
      },
      body: new Uint8Array(await upload.arrayBuffer()),
    });
    assert.equal(created.status, 201);
    const reportId = (await created.json()).id;
    assert.equal(
      (
        await community(`/reportes/${reportId}/votar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fingerprint: 'cloudflare-device' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await community(`/reportes/${reportId}/estado`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': admin },
          body: JSON.stringify({ estado: 'recibido', nota: 'En revisión por el equipo' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await runtime.dispatchFetch('https://cerca-test.workers.dev/parada/LC-001', {
          redirect: 'manual',
        })
      ).headers.get('Location'),
      'https://cerca-test.workers.dev/#/parada/LC-001'
    );
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
    const point = network.stops.find((stop) => stop.id === network.routes[0].stops[0]).point;
    assert.equal(
      (
        await community('/admin/zona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': admin },
          body: JSON.stringify({
            nombre: 'Piloto runtime',
            lat: point[0],
            lng: point[1],
            radio_m: 500,
          }),
        })
      ).status,
      201
    );
    const events = await call('/events');
    assert.equal(events.headers.get('Content-Type'), 'text/event-stream');
    reader = events.body.getReader();
    const decoder = new TextDecoder();
    let eventText = '';
    while (!eventText.includes('event: fleet'))
      eventText += decoder.decode((await reader.read()).value);
    assert.match(eventText, /"vehicles":\[\]/);
    const fix = { point, accuracy: 5, speed: 0, timestamp: Date.now(), direction: 1 };
    assert.equal(
      (await call('/driver/service', { active: true, ...fix, routeId: 'R04' }, session.token))
        .status,
      200
    );
    const fleet = await (await call('/fleet')).json();
    assert.equal(fleet.vehicles.length, 1);
    assert.equal(fleet.vehicles[0].routeId, 'R01');
    const communityFleet = await (await community('/vehiculos/activos')).json();
    assert.equal(communityFleet.length, 1);
    assert.equal(communityFleet[0].nombre, account.unit);
    assert.equal(communityFleet[0].lat, point[0]);
    assert.equal(communityFleet[0].en_zona, true);
    assert.equal(communityFleet[0].en_vivo, true);
    assert.equal(communityFleet[0].zona.nombre, 'Piloto runtime');
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
    assert.equal((await (await call('/version')).json()).minimumVersion, futureVersion);
    assert.equal(releaseRequests, 3);
    assert.equal((await manage('GET', '/me')).status, 200);
    assert.ok(
      (await (await call('/network')).json()).routes.some((r) => r.name === 'Ruta CF editada')
    );
    assert.equal((await manage('DELETE', '/routes/' + customRoute.id)).status, 200);
    const restoredReport = await (await community(`/reportes/${reportId}`)).json();
    assert.equal(restoredReport.votos, 1);
    assert.equal(restoredReport.estado, 'recibido');
    assert.deepEqual(
      new Uint8Array(await (await community('/foto/' + restoredReport.foto_key)).arrayBuffer()),
      photoBytes
    );
    assert.equal(
      (
        await community('/auth/me', {
          headers: { Authorization: `Bearer ${neighborSession.token}` },
        })
      ).status,
      200
    );
    assert.equal((await call('/driver/profile', undefined, session.token)).status, 200);
    assert.equal((await (await call('/fleet')).json()).vehicles.length, 1);
    assert.equal((await (await call('/fleet')).json()).pilotZone.nombre, 'Piloto runtime');
    reader = (await call('/events')).body.getReader();
    let firstEvent = '';
    while (!firstEvent.includes('event: fleet'))
      firstEvent += decoder.decode((await reader.read()).value);
    assert.equal(
      (
        await community('/vehiculos/detener', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` },
        })
      ).status,
      200
    );
    let stoppedEvent = '';
    while (!stoppedEvent.includes('event: fleet')) {
      let timeout;
      try {
        const event = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Stop did not broadcast to passengers')),
              5000
            );
          }),
        ]);
        stoppedEvent += decoder.decode(event.value);
      } finally {
        clearTimeout(timeout);
      }
    }
    assert.match(stoppedEvent, /"vehicles":\[\]/);
    assert.equal((await (await call('/fleet')).json()).vehicles.length, 0);
    await reader.cancel();
    reader = undefined;
    assert.equal(
      (
        await call(
          '/driver/service',
          { active: true, ...fix, point: [19.43, -99.13], timestamp: Date.now() },
          session.token
        )
      ).status,
      403
    );
    assert.equal((await (await call('/fleet')).json()).vehicles.length, 0);
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
