import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  currentVehicles,
  localTime,
  predictJourneys,
  projectOnRoute,
  routeMetrics,
  serviceEnd,
  stopArrivals,
  validateWindows,
} from '../src/transit.js';
import { stopFromLink, stopWebLink } from '../src/stopLinks.js';
const network = JSON.parse(
  readFileSync(new URL('../public/data/network.demo.json', import.meta.url), 'utf8')
);
const now = Date.parse('2026-10-08T21:15:00Z');
const vehicle = (routeId, extra = {}) => ({
  id: routeId,
  unit: `TEST-${routeId}`,
  routeId,
  point: network.routes.find((route) => route.id === routeId).segments[0][0],
  direction: 1,
  speed: 5,
  accuracy: 5,
  updatedAt: now,
  serviceEndAt: now + 3_600_000,
  ...extra,
});
test('service hours use Mexico City time and honor overnight windows and exclusive closing', () => {
  assert.deepEqual(localTime(now), { day: 4, seconds: 15 * 3600 + 15 * 60 });
  assert.equal(serviceEnd([{ days: [4], start: '15:00', end: '16:00' }], now), now + 45 * 60_000);
  assert.equal(serviceEnd([{ days: [4], start: '16:00', end: '18:00' }], now), null);
  const overnight = [{ days: [3], start: '22:00', end: '02:00' }];
  assert.ok(serviceEnd(overnight, Date.parse('2026-10-08T07:00:00Z')));
  assert.equal(serviceEnd(overnight, Date.parse('2026-10-08T08:00:00Z')), null);
  assert.throws(() => validateWindows([{ days: [8], start: '25:00', end: '12:00' }]));
});
test('availability removes stale, expired and out-of-zone vehicles', () => {
  const valid = vehicle('R01');
  const vehicles = [
    valid,
    vehicle('R02', { updatedAt: now - 46_000 }),
    vehicle('R03', { serviceEndAt: now }),
    vehicle('R04', { point: [19.43, -99.13] }),
  ];
  assert.deepEqual(
    currentVehicles({ serverTime: now, vehicles, services: [], publicAppUrl: '' }, network, now),
    [valid]
  );
});
test('GPS projects onto the actual route and estimates are based on distance along its geometry', () => {
  const route = network.routes[0],
    metrics = routeMetrics(route),
    first = route.segments[0][0];
  assert.ok(projectOnRoute(first, route).away < 1);
  assert.ok(
    Math.abs(projectOnRoute(route.segments.at(-1).at(-1), route).along - metrics.length) < 1
  );
  const arrivals = stopArrivals(route.stops.at(-1), network, [vehicle(route.id)], now, 1);
  assert.equal(arrivals.length, 1);
  assert.ok(arrivals[0].seconds >= metrics.length / 5);
  const faster = stopArrivals(
    route.stops.at(-1),
    network,
    [vehicle(route.id, { speed: 10 })],
    now,
    1
  );
  assert.ok(faster[0].seconds < arrivals[0].seconds);
});
test('return estimates include a turnaround and cannot extend past service closing', () => {
  const route = network.routes[0],
    bus = vehicle(route.id);
  const forward = stopArrivals(route.stops[1], network, [bus], now, 1)[0];
  const returning = stopArrivals(route.stops[1], network, [bus], now, -1)[0];
  assert.ok(returning.seconds > forward.seconds);
  assert.equal(returning.direction, -1);
  assert.equal(
    stopArrivals(
      route.stops.at(-1),
      network,
      [vehicle(route.id, { serviceEndAt: now + 1000 })],
      now
    ).length,
    0
  );
  assert.equal(
    stopArrivals(route.stops[1], network, [vehicle(route.id, { updatedAt: now - 46_000 })], now)
      .length,
    0
  );
});
test('recommendations require active vehicles on every leg and change for the actual destination', () => {
  const origin =
    network.places.find((place) => place.id === 'jugos') ??
    network.places.find((place) => place.name.startsWith('Jugos Acapulco'));
  const destination = network.places.find((place) => place.name.startsWith('Entronque'));
  const cafe = network.places.find((place) => place.name.startsWith('Café del Puerto'));
  assert.deepEqual(predictJourneys(origin, destination, network, [], now), []);
  const direct = predictJourneys(origin, destination, network, [vehicle('R01')], now);
  assert.ok(direct.length);
  assert.equal(direct[0].legs[0].routeId, 'R01');
  assert.deepEqual(predictJourneys(origin, cafe, network, [vehicle('R01')], now), []);
  const transfer = predictJourneys(origin, cafe, network, [vehicle('R01'), vehicle('R03')], now);
  assert.ok(transfer.length);
  assert.equal(transfer[0].transfers, 1);
  assert.equal(transfer[0].arrivals.length, 2);
  assert.equal(transfer[0].destination.id, cafe.id);
  assert.ok(transfer[0].arrivals[1].seconds > transfer[0].arrivals[0].seconds);
});
test('QR links open known stops and reject foreign URLs, scripts and unknown stops', () => {
  const id = network.stops[0].id;
  assert.equal(
    stopFromLink(stopWebLink('https://cerca.example/app/', id), network, 'https://cerca.example')
      ?.id,
    id
  );
  assert.equal(stopFromLink(`cerca://stop/${id}`, network, 'https://cerca.example')?.id, id);
  assert.equal(
    stopFromLink(`https://evil.example/?stop=${id}`, network, 'https://cerca.example'),
    null
  );
  assert.equal(stopFromLink('javascript:alert(1)', network, 'https://cerca.example'), null);
  assert.equal(
    stopFromLink('https://cerca.example/?stop=missing', network, 'https://cerca.example'),
    null
  );
  assert.throws(() => stopWebLink('javascript:alert(1)', id));
});
