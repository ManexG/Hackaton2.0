import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransitServer } from '../server/index.js';
import { readFileSync } from 'node:fs';
import { stopFromLink } from '../src/stopLinks.js';
import { stopArrivals } from '../src/transit.js';

const network = JSON.parse(
  readFileSync(new URL('../public/data/network.demo.json', import.meta.url))
);
const point = network.stops[0].point;
const secret = 'isolated-community-admin-test-secret';
test('city coverage ignores an old pilot circle, preserves live metadata and rejects GPS outside the city', async () =>
  withService(async (call, store, base) => {
    const headers = { 'X-Admin-Key': secret };
    const zone = { nombre: 'Piloto de prueba aislado', lat: point[0], lng: point[1], radio_m: 350 };
    assert.equal((await call('/admin/zona', { ...zone, radio_m: 0 }, { headers })).status, 400);
    assert.equal((await call('/admin/zona', { ...zone, lat: 0, lng: 0 }, { headers })).status, 400);
    assert.equal((await call('/admin/zona', zone, { headers })).status, 201);
    assert.equal((await (await fetch(base + '/api/network')).json()).pilotZone, null);
    store.provision({
      name: 'Chofer Axel aislado',
      email: 'zone-driver@example.test',
      password: 'isolated-zone-driver-password',
      unit: 'ZONE-01',
      routeId: 'R01',
      windows: [
        { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '12:00' },
        { days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '00:00' },
      ],
    });
    const session = await store.login('zone-driver@example.test', 'isolated-zone-driver-password');
    const driverHeaders = { Authorization: `Bearer ${session.token}` };
    const fix = { point, accuracy: 5, speed: 0, timestamp: Date.now(), direction: 1 };
    store.update(session.driver.id, fix, true);
    const vehicles = await (await call('/vehiculos/activos')).json();
    assert.equal(vehicles.length, 1);
    assert.equal(vehicles[0].en_zona, true);
    assert.equal(vehicles[0].en_vivo, true);
    assert.equal(vehicles[0].lat, point[0]);
    assert.equal(vehicles[0].lng, point[1]);
    assert.ok(vehicles[0].edad_s < 5);
    assert.ok(vehicles[0].distancia_zona_m >= 0);
    assert.equal(vehicles[0].zona, null);
    const snapshot = store.snapshot();
    assert.equal(
      stopArrivals(
        network.routes[0].stops.at(-1),
        store.network,
        snapshot.vehicles,
        snapshot.serverTime
      ).length,
      1
    );
    assert.equal((await call('/vehiculos/detener', {})).status, 401);
    const stopped = await call('/vehiculos/detener', {}, { headers: driverHeaders });
    assert.equal(stopped.status, 200);
    assert.equal((await stopped.json()).desactivadas, 1);
    assert.deepEqual(await (await call('/vehiculos/activos')).json(), []);
    assert.equal(store.authenticate(session.token).active, false);
    const remote = network.stops.find((stop) => stop.id === network.routes[0].stops.at(-1)).point;
    store.update(session.driver.id, { ...fix, point: remote, timestamp: Date.now() }, true);
    assert.equal(store.snapshot().vehicles.length, 1);
    // Legacy pilot settings no longer narrow the urban network.
    store.update(session.driver.id, { ...fix, timestamp: Date.now() }, true);
    assert.equal(
      (await call('/admin/zona', { ...zone, lat: remote[0], lng: remote[1] }, { headers })).status,
      201
    );
    assert.equal(store.snapshot().vehicles.length, 1);
    assert.equal(store.authenticate(session.token).active, true);
    assert.throws(
      () =>
        store.update(
          session.driver.id,
          { ...fix, point: [19.43, -99.13], timestamp: Date.now() },
          true
        ),
      /fuera de la zona/
    );
    assert.deepEqual(store.snapshot().vehicles, []);
  }));
async function withService(callback) {
  const service = createTransitServer({ dbPath: ':memory:', adminToken: secret });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const call = (path, body, options = {}) =>
    fetch(base + '/api/community' + path, {
      method: body ? 'POST' : 'GET',
      ...options,
      headers: {
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
  try {
    await callback(call, service.store, base);
  } finally {
    await new Promise((resolve) => {
      service.server.close(resolve);
      service.server.closeAllConnections();
    });
  }
}
async function register(call) {
  const result = await call('/auth/registro', {
    nombre: 'Vecina de prueba',
    email: 'neighbor@example.test',
    password: 'isolated-neighbor-password',
    rol: 'chofer',
  });
  assert.equal(result.status, 201);
  const session = await result.json();
  assert.equal(session.rol, 'vecino');
  return { Authorization: `Bearer ${session.token}` };
}
function report(coords = point) {
  const form = new FormData();
  form.set('categoria', 'bache');
  form.set('descripcion', 'Bache en la avenida');
  form.set('colonia', 'Centro');
  form.set('lat', coords[0]);
  form.set('lng', coords[1]);
  form.set('client_id', 'isolated-report-id');
  return form;
}
test('Axel integration: real registration, bounded reports, photo storage, idempotency, supports, comments and moderation', async () =>
  withService(async (call) => {
    assert.equal((await call('/reportes', report())).status, 401);
    assert.equal(
      (await call('/auth/registro', { nombre: 'x', email: 'x@y.test', password: 'short' })).status,
      400
    );
    const headers = await register(call);
    assert.equal((await call('/reportes', report([0, 0]), { headers })).status, 400);
    const form = report();
    const bytes = new Uint8Array(280000).fill(42);
    form.set('foto', new Blob([bytes], { type: 'image/png' }), 'prueba.png');
    const created = await call('/reportes', form, { headers });
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.equal((await call('/reportes', report(), { headers })).status, 200);
    const rows = await (await call('/reportes')).json();
    assert.equal(rows.length, 1);
    assert.deepEqual(
      new Uint8Array(await (await call('/foto/' + rows[0].foto_key)).arrayBuffer()),
      bytes
    );
    assert.equal(
      (await call(`/reportes/${result.id}/votar`, { fingerprint: 'isolated-device-id' })).status,
      200
    );
    assert.equal(
      (await call(`/reportes/${result.id}/votar`, { fingerprint: 'isolated-device-id' })).status,
      409
    );
    assert.equal((await (await call(`/reportes/${result.id}`)).json()).votos, 1);
    assert.equal(
      (
        await call(`/reportes/${result.id}/comentarios`, {
          nombre: 'Vecino',
          texto: 'También lo vi.',
        })
      ).status,
      201
    );
    assert.equal((await (await call(`/reportes/${result.id}/comentarios`)).json()).length, 1);
    assert.equal(
      (
        await call(
          `/reportes/${result.id}/estado`,
          { estado: 'recibido', nota: 'Revisando' },
          { method: 'PATCH' }
        )
      ).status,
      401
    );
    assert.equal(
      (
        await call(
          `/reportes/${result.id}/estado`,
          { estado: 'recibido', nota: 'Revisando' },
          { method: 'PATCH', headers: { 'X-Admin-Key': secret } }
        )
      ).status,
      200
    );
    assert.equal(
      (await (await call(`/reportes/${result.id}/historial`)).json())[0].nota,
      'Revisando'
    );
    assert.equal((await call('/export?format=csv')).status, 401);
    assert.match(
      await (
        await call('/export?format=csv', undefined, { headers: { 'X-Admin-Key': secret } })
      ).text(),
      /Bache en la avenida/
    );
    assert.equal((await (await call('/estadisticas')).json()).porCat[0].n, 1);
    assert.equal((await (await call('/mis-reportes', undefined, { headers })).json()).length, 1);
    assert.equal(
      (
        await call(
          '/auth/perfil',
          { nombre: 'Nuevo nombre', colonia_ref: 'Centro' },
          { method: 'PATCH', headers }
        )
      ).status,
      200
    );
    assert.equal(
      (await (await call('/auth/me', undefined, { headers })).json()).nombre,
      'Nuevo nombre'
    );
    assert.equal((await call('/auth/logout', {}, { headers })).status, 200);
    assert.equal((await call('/auth/me', undefined, { headers })).status, 401);
  }));
test('Axel mobility imports enter the same bounded planner and preserve assigned driver roles', async () =>
  withService(async (call, store, base) => {
    const headers = { 'X-Admin-Key': secret };
    assert.equal((await call('/admin/rutas', { nombre: 'Ruta falsa' })).status, 401);
    assert.equal(
      (
        await call(
          '/admin/rutas',
          {
            nombre: 'Fuera',
            color: '#24551f',
            trazo: [
              [0, 0],
              [1, 1],
            ],
          },
          { headers }
        )
      ).status,
      400
    );
    const source = network.routes[0];
    const create = await call(
      '/admin/rutas',
      {
        nombre: 'Ruta importada',
        color: '#24551f',
        trazo: source.segments.flat(),
        fuente: 'Datos de prueba aislados',
      },
      { headers }
    );
    assert.equal(create.status, 201);
    const { id } = await create.json();
    assert.equal(
      (
        await call(
          '/admin/paradas',
          {
            ruta_id: id,
            paradas: source.stops.map((stopId, i) => {
              const s = network.stops.find((s) => s.id === stopId);
              return {
                nombre: s.name,
                lat: s.point[0],
                lng: s.point[1],
                orden: i,
                qr: `TEST-AX-${i}`,
              };
            }),
          },
          { headers }
        )
      ).status,
      201
    );
    const combined = await (await fetch(base + '/api/network')).json();
    assert.equal(combined.routes.length, network.routes.length + 1);
    assert.ok(combined.routes.some((r) => r.id === `AX${id}`));
    const userHeaders = await register(call);
    assert.equal(
      (await call('/vehiculos', { nombre: 'No autorizado', ruta_id: id }, { headers: userHeaders }))
        .status,
      403
    );
    assert.deepEqual(await (await call('/vehiculos/activos')).json(), []);
    const stop = (await (await call(`/rutas/${id}/paradas`)).json())[0];
    const resolved = await (await call('/paradas/qr/TEST-AX-0')).json();
    assert.equal(resolved.stopId, `AXS${stop.id}`);
    assert.equal(
      stopFromLink('https://routes.test/parada/TEST-AX-0', combined, 'https://routes.test').id,
      resolved.stopId
    );
    assert.equal(
      stopFromLink('https://routes.test/#/parada/TEST-AX-0', combined, 'https://routes.test').id,
      resolved.stopId
    );
    assert.equal(
      stopFromLink('https://foreign.test/parada/TEST-AX-0', combined, 'https://routes.test'),
      null
    );
    assert.equal((await (await call(`/paradas/${stop.id}/llegada`)).json()).estimado_min, null);
    assert.equal(
      (
        await call(
          '/puntos',
          { tipo: 'cruce', nombre: 'Punto', lat: point[0], lng: point[1] },
          { headers: userHeaders }
        )
      ).status,
      201
    );
    assert.equal(
      (await call('/puntos', { tipo: 'cruce', lat: 0, lng: 0 }, { headers: userHeaders })).status,
      400
    );
    const points = await (await call('/puntos')).json();
    assert.equal(
      (
        await call(
          '/observaciones',
          { punto_id: points[0].id, tipo: 'rampa', detalle: 'Observación aislada' },
          { headers: userHeaders }
        )
      ).status,
      201
    );
    assert.equal(
      (
        await call(
          '/conteos',
          { fecha: '2026-10-08', hora: '12:30', tipo: 'peatones', cantidad: -1, minutos: 10 },
          { headers: userHeaders }
        )
      ).status,
      400
    );
    assert.equal(
      (
        await call(
          '/conteos',
          { fecha: '2026-10-08', hora: '12:30', tipo: 'peatones', cantidad: 12, minutos: 10 },
          { headers: userHeaders }
        )
      ).status,
      201
    );
    assert.equal((await (await call('/conteos')).json()).length, 1);
  }));
