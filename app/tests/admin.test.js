import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransitServer } from '../server/index.js';

const windows = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', end: '22:00' }];
const first = { name: 'Admin Uno', email: 'uno@example.test', password: 'clave-de-prueba-123' };

async function start(fetcher) {
  const { server, admin } = createTransitServer({ dbPath: ':memory:', fetcher });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  admin.createAdmin(first);
  const login = await call('POST', '/api/manage/login', {
    email: first.email,
    password: first.password,
  });
  return { server, admin, call, token: login.data.token };
}

test('admin endpoints require an administrator session and login is validated', async () => {
  const { server, call, token } = await start();
  assert.equal((await call('GET', '/api/manage/routes')).status, 401);
  assert.equal((await call('GET', '/api/manage/drivers', undefined, 'x'.repeat(40))).status, 401);
  assert.equal(
    (await call('POST', '/api/manage/login', { email: first.email, password: 'mala-clave-xxxx' }))
      .status,
    401
  );
  assert.equal((await call('GET', '/api/manage/me', undefined, token)).data.email, first.email);
  await call('POST', '/api/manage/logout', {}, token);
  assert.equal((await call('GET', '/api/manage/me', undefined, token)).status, 401);
  server.close();
});

test('administrators can add admins but not delete themselves or the last one', async () => {
  const { server, admin, call, token: t } = await start();
  const me = admin.listAdmins()[0];
  const extra = { name: 'Dos', email: 'dos@example.test', password: 'otra-clave-larga-1' };
  assert.equal((await call('POST', '/api/manage/admins', { ...extra, password: 'corta' }, t)).status, 422);
  const two = await call('POST', '/api/manage/admins', extra, t);
  assert.equal(two.status, 201);
  assert.equal(two.data.password, undefined);
  assert.equal(
    (await call('POST', '/api/manage/admins', { ...extra, email: 'DOS@example.test' }, t)).status,
    409
  );
  assert.equal((await call('DELETE', '/api/manage/admins/' + me.id, undefined, t)).status, 409);
  assert.equal((await call('DELETE', '/api/manage/admins/' + two.data.id, undefined, t)).status, 200);
  assert.equal((await call('GET', '/api/manage/admins', undefined, t)).data.length, 1);
  server.close();
});

test('driver CRUD: one-time password works for the driver; update, reset and delete', async () => {
  const { server, call, token: t } = await start();
  const body = { name: 'Chofer Uno', email: 'chofer@example.test', unit: 'C-01', routeId: 'R01', windows };
  assert.equal((await call('POST', '/api/manage/drivers', { ...body, routeId: 'NOPE' }, t)).status, 422);
  const created = await call('POST', '/api/manage/drivers', body, t);
  assert.equal(created.status, 201);
  assert.ok(created.data.password.length >= 12);
  assert.equal(created.data.driver.password, undefined);
  assert.equal((await call('POST', '/api/manage/drivers', { ...body, unit: 'C-02' }, t)).status, 409);
  const driverLogin = (password) =>
    call('POST', '/api/auth/login', { email: body.email, password });
  assert.equal((await driverLogin(created.data.password)).status, 200);
  const id = created.data.driver.id;
  assert.equal((await call('PATCH', '/api/manage/drivers/' + id, { routeId: 'R02' }, t)).data.routeId, 'R02');
  const reset = await call('POST', `/api/manage/drivers/${id}/reset-password`, {}, t);
  assert.equal((await driverLogin(created.data.password)).status, 401);
  assert.equal((await driverLogin(reset.data.password)).status, 200);
  assert.equal((await call('DELETE', '/api/manage/drivers/' + id, undefined, t)).status, 200);
  assert.equal((await call('GET', '/api/manage/drivers', undefined, t)).data.length, 0);
  server.close();
});

test('route CRUD: demo routes are editable, hideable and restorable; new routes reach the public network', async () => {
  const { server, call, token: t } = await start();
  const list = await call('GET', '/api/manage/routes', undefined, t);
  assert.deepEqual(list.data.routes.map((r) => r.id), ['R01', 'R02', 'R03', 'R04']);
  assert.ok(list.data.routes.every((r) => r.demo && !r.edited));
  const r01 = list.data.routes[0];
  const renamed = await call('PUT', '/api/manage/routes/R01', { ...r01, name: 'Corredor editado' }, t);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.edited, true);
  assert.equal(renamed.data.segments.length, r01.stops.length - 1);
  assert.equal(
    (await call('GET', '/api/network')).data.routes.find((r) => r.id === 'R01').name,
    'Corredor editado'
  );
  const a = r01.stops[0].point,
    b = [a[0] + 0.004, a[1] - 0.004],
    c = [a[0] + 0.008, a[1] - 0.006];
  const created = await call(
    'POST',
    '/api/manage/routes',
    {
      name: 'Ruta nueva',
      color: '#336699',
      fare: 12,
      headway: 10,
      bidirectional: true,
      stops: [
        { name: 'A', point: a },
        { name: 'B', point: b },
        { name: 'C', point: c },
      ],
    },
    t
  );
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 'R05');
  assert.equal(created.data.demo, false);
  const reversed = await call(
    'PUT',
    '/api/manage/routes/R05',
    { ...created.data, segments: null, stops: [...created.data.stops].reverse() },
    t
  );
  assert.equal(reversed.data.stops[0].name, 'C');
  const bad = (stops, color = '#336699') =>
    call('POST', '/api/manage/routes', { name: 'x', color, stops }, t);
  assert.equal((await bad([{ name: 'a', point: a }])).status, 422);
  assert.equal((await bad([{ name: 'a', point: a }, { name: 'f', point: [10, 10] }])).status, 422);
  assert.equal((await bad([{ name: 'a', point: a }, { name: 'b', point: b }], 'rojo')).status, 422);
  const driver = await call(
    'POST',
    '/api/manage/drivers',
    { name: 'Ch', email: 'c@example.test', unit: 'U1', routeId: 'R05', windows },
    t
  );
  assert.equal((await call('DELETE', '/api/manage/routes/R05', undefined, t)).status, 409);
  await call('PATCH', '/api/manage/drivers/' + driver.data.driver.id, { routeId: 'R01' }, t);
  assert.equal((await call('DELETE', '/api/manage/routes/R05', undefined, t)).status, 200);
  assert.equal((await call('DELETE', '/api/manage/routes/R01', undefined, t)).status, 409);
  assert.equal((await call('DELETE', '/api/manage/routes/R04', undefined, t)).status, 200);
  assert.equal((await call('GET', '/api/network')).data.routes.some((r) => r.id === 'R04'), false);
  const restored = await call('POST', '/api/manage/routes/restore-demo', {}, t);
  assert.deepEqual(restored.data.routes.map((r) => r.id), ['R01', 'R02', 'R03', 'R04']);
  assert.equal(restored.data.routes[0].name, 'Corredor principal');
  server.close();
});

test('moving a stop shared with another route creates a new stop', async () => {
  const { server, call, token: t } = await start();
  const routes = (await call('GET', '/api/manage/routes', undefined, t)).data.routes;
  const shared = routes[0].stops.find((s) =>
    routes.slice(1).some((r) => r.stops.some((o) => o.id === s.id))
  );
  assert.ok(shared, 'el demo tiene al menos una parada de trasbordo');
  const moved = routes[0].stops.map((s) =>
    s.id === shared.id ? { ...s, point: [s.point[0] + 0.0005, s.point[1]] } : s
  );
  const saved = await call('PUT', '/api/manage/routes/R01', { ...routes[0], segments: null, stops: moved }, t);
  assert.equal(saved.status, 200);
  assert.notEqual(saved.data.stops.find((s) => s.name === shared.name).id, shared.id);
  const after = (await call('GET', '/api/manage/routes', undefined, t)).data.routes;
  assert.ok(after.some((r) => r.id !== 'R01' && r.stops.some((s) => s.id === shared.id)));
  server.close();
});

test('street tracing anchors each segment on the stops and fails honestly', async () => {
  const osrm = {
    code: 'Ok',
    routes: [
      {
        legs: [
          {
            steps: [
              { geometry: { coordinates: [[-102.192, 17.9542], [-102.1925, 17.955], [-102.193, 17.9556]] } },
            ],
          },
        ],
      },
    ],
  };
  const a = [17.9542, -102.192],
    b = [17.9556, -102.193];
  const ok = await start(async () => new Response(JSON.stringify(osrm)));
  const result = await ok.call('POST', '/api/manage/routes/trace', { points: [a, b] }, ok.token);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.segments[0][0], a);
  assert.deepEqual(result.data.segments[0].at(-1), b);
  assert.equal(
    (await ok.call('POST', '/api/manage/routes/trace', { points: [a, [1, 1]] }, ok.token)).status,
    422
  );
  ok.server.close();
  const failing = await start(async () => new Response('x', { status: 500 }));
  assert.equal(
    (await failing.call('POST', '/api/manage/routes/trace', { points: [a, b] }, failing.token)).status,
    502
  );
  failing.server.close();
});
