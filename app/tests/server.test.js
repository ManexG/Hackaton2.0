import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTransitServer } from '../server/index.js';
import { TransitStore } from '../server/store.js';
const network = JSON.parse(
  readFileSync(new URL('../public/data/network.demo.json', import.meta.url), 'utf8')
);
const windows = [
  { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '12:00' },
  { days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '00:00' },
];
const account = {
  name: 'Chofer de prueba automatizada',
  email: 'driver@example.test',
  unit: 'TEST-01',
  routeId: 'R01',
  windows,
  password: 'only-for-automated-tests-123',
};
const fix = (extra = {}) => ({
  point: network.stops.find((stop) => stop.id === network.routes[0].stops[0]).point,
  accuracy: 5,
  speed: 0,
  timestamp: Date.now(),
  direction: 1,
  ...extra,
});
test('real HTTP login, activation, GPS, public availability and logout without passenger registration', async () => {
  const { server, store } = createTransitServer({ dbPath: ':memory:' });
  store.provision(account);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`;
  const call = (path, body, token, origin) =>
    fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const guest = await call('/fleet');
    assert.equal(guest.status, 200);
    assert.equal((await guest.json()).vehicles.length, 0);
    assert.equal((await call('/driver/service', { active: true, ...fix() })).status, 401);
    assert.equal(
      (await call('/auth/login', { email: account.email, password: 'wrong-password' })).status,
      401
    );
    const login = await call('/auth/login', { email: account.email, password: account.password });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.equal(session.driver.routeId, 'R01');
    const active = await call(
      '/driver/service',
      { ...fix(), active: true, routeId: 'R04' },
      session.token
    );
    assert.equal(active.status, 200);
    const publicData = await (await call('/fleet')).json();
    assert.equal(publicData.vehicles.length, 1);
    assert.equal(publicData.vehicles[0].routeId, 'R01');
    assert.ok(!JSON.stringify(publicData).includes(account.email));
    assert.ok(!JSON.stringify(publicData).includes(account.name));
    assert.ok(!JSON.stringify(publicData).includes('password'));
    assert.equal(
      (await call('/driver/location', fix({ timestamp: Date.now() - 60_000 }), session.token))
        .status,
      422
    );
    assert.equal(
      (await call('/driver/location', fix({ accuracy: 500 }), session.token)).status,
      422
    );
    assert.equal((await call('/driver/service', { active: false }, session.token)).status, 200);
    assert.equal((await call('/driver/location', fix(), session.token)).status, 409);
    assert.equal((await call('/auth/logout', {}, session.token)).status, 200);
    assert.equal((await call('/driver/profile', undefined, session.token)).status, 401);
    assert.equal(
      (await call('/fleet', undefined, undefined, 'https://untrusted.example')).status,
      403
    );
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});
test('server enforces assigned hours, coverage, signal expiration and session replacement', async () => {
  const store = new TransitStore(':memory:', network);
  const now = Date.parse('2026-10-08T21:15:00Z');
  try {
    const driver = store.provision(account);
    const first = await store.login(account.email, account.password, now);
    const second = await store.login(account.email, account.password, now);
    assert.throws(() => store.authenticate(first.token, now));
    assert.equal(store.authenticate(second.token, now).id, driver.id);
    store.update(driver.id, fix({ timestamp: now }), true, now);
    assert.equal(store.snapshot(now).vehicles.length, 1);
    assert.equal(store.snapshot(now + 46_000).vehicles.length, 0);
    assert.throws(() =>
      store.update(driver.id, fix({ timestamp: now + 46_001 }), false, now + 46_001)
    );
    store.update(driver.id, fix({ timestamp: now }), true, now);
    assert.throws(() =>
      store.update(
        driver.id,
        fix({ point: [19.43, -99.13], timestamp: now + 1000 }),
        false,
        now + 1000
      )
    );
    assert.equal(store.snapshot(now + 1000).vehicles.length, 0);
    store.provision({ ...account, windows: [{ days: [4], start: '06:00', end: '07:00' }] });
    assert.throws(() => store.update(driver.id, fix({ timestamp: now }), true, now), /horario/);
    assert.throws(() => store.authenticate(second.token, now));
  } finally {
    store.close();
  }
});
test('SSE delivers public fleet updates without login', async () => {
  const { server, store } = createTransitServer({ dbPath: ':memory:' });
  store.provision(account);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();
  try {
    const response = await fetch(base + '/api/events', { signal: controller.signal });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: fleet/);
    assert.match(first, /"vehicles":\[\]/);
    await reader.cancel();
  } finally {
    controller.abort();
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});
