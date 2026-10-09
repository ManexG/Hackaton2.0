import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distance,
  insideCoverage,
  makeLeg,
  planJourneys,
  searchPlaces,
  validateNetwork,
} from '../src/planner.js';
const network = JSON.parse(
  readFileSync(new URL('../public/data/network.demo.json', import.meta.url), 'utf8')
);
const place = (id) => network.places.find((place) => place.id === id);
test('preserves the exact user-provided endpoints', () => {
  assert.deepEqual(place('acapulco').point, [17.95424278298213, -102.19209866241583]);
  assert.deepEqual(place('entronque').point, [17.97270449633531, -102.20675286385264]);
  assert.equal(network.demo, true);
  validateNetwork(network);
});
test('offers the direct R01 ride between corridor endpoints', () => {
  const result = planJourneys(place('acapulco'), place('entronque'), network)[0];
  assert.deepEqual(
    result.legs.map((leg) => leg.routeId),
    ['R01']
  );
  assert.equal(result.transfers, 0);
  assert.equal(result.walkMeters, 0);
  assert.equal(result.fare, 12);
  assert.equal(result.legs[0].from, 'acapulco');
  assert.equal(result.legs[0].to, 'entronque');
});
test('connects to the cafe by transfer at the same stop and keeps both geometries', () => {
  const result = planJourneys(place('acapulco'), place('cafe'), network)[0];
  assert.deepEqual(
    result.legs.map((leg) => leg.routeId),
    ['R01', 'R03']
  );
  assert.equal(result.transfers, 1);
  assert.equal(result.legs[0].to, result.legs[1].from);
  assert.equal(result.fare, 24);
  assert.ok(result.legs.every((leg) => leg.geometry.length > 3));
  assert.ok(
    result.legs.flatMap((leg) => leg.geometry).every((point) => insideCoverage(point, network))
  );
});
test('supports reversing the ride without mutating source geometry', () => {
  const forward = makeLeg(network.routes[0], 0, 5);
  const backward = makeLeg(network.routes[0], 5, 0);
  assert.deepEqual(backward.geometry, [...forward.geometry].reverse());
  assert.deepEqual(backward.stopIds, [...forward.stopIds].reverse());
  assert.equal(
    planJourneys(place('entronque'), place('acapulco'), network)[0].legs[0].from,
    'entronque'
  );
});
test('rejects out-of-zone destinations and origins before planning', () => {
  const outside = { ...place('cafe'), point: [19.4326, -99.1332] };
  assert.equal(insideCoverage(outside.point, network), false);
  assert.deepEqual(planJourneys(place('acapulco'), outside, network), []);
  assert.deepEqual(planJourneys(outside, place('cafe'), network), []);
  assert.equal(insideCoverage([NaN, -102.2], network), false);
});
test('polygon exclusions are honored even within the bounding rectangle', () => {
  const polygonNetwork = structuredClone(network);
  polygonNetwork.coverage.polygon = [
    [17.951, -102.214],
    [17.977, -102.214],
    [17.951, -102.186],
  ];
  assert.equal(insideCoverage([17.975, -102.188], polygonNetwork), false);
  assert.equal(insideCoverage([17.952, -102.213], polygonNetwork), true);
});
test('search is accent insensitive and only returns the local catalog', () => {
  assert.equal(searchPlaces('cafe', network)[0].id, 'cafe');
  assert.equal(searchPlaces('pollo feliz', network)[0].id, 'acapulco');
  assert.deepEqual(searchPlaces('Morelia', network), []);
});
test('resolves supported demo street numbers and rejects unsupported numbers', () => {
  const results = searchPlaces('Calle Las Palmas #125', network);
  assert.equal(results[0].kind, 'street');
  assert.equal(results[0].demo, true);
  assert.ok(insideCoverage(results[0].point, network));
  assert.equal(searchPlaces('Reforma 9999', network).length, 0);
  assert.equal(searchPlaces('Calle desconocida 120', network).length, 0);
});
test('returns no bus ride when origin equals destination', () => {
  assert.deepEqual(planJourneys(place('acapulco'), place('acapulco'), network), []);
});
test('does not invent a connection for isolated map points', () => {
  const isolated = { ...place('cafe'), point: [18.03, -102.23] };
  assert.ok(insideCoverage(isolated.point, network));
  assert.deepEqual(planJourneys(place('acapulco'), isolated, network), []);
});
test('rejects routes that leave coverage or disconnected segment endpoints', () => {
  const outside = structuredClone(network);
  outside.routes[0].segments[0][2] = [20, -102];
  assert.throws(() => validateNetwork(outside), /fuera de cobertura/);
  const disconnected = structuredClone(network);
  disconnected.routes[0].segments[0][0] = place('entronque').point;
  assert.throws(() => validateNetwork(disconnected), /desconectado/);
});
test('honors one-way routes', () => {
  const oneWay = structuredClone(network);
  oneWay.routes = [{ ...oneWay.routes[0], bidirectional: false }];
  assert.ok(planJourneys(place('acapulco'), place('entronque'), oneWay).length);
  assert.deepEqual(planJourneys(place('entronque'), place('acapulco'), oneWay), []);
});
test('travel estimates and sample fares include all transfers', () => {
  for (const destination of network.places) {
    for (const result of planJourneys(place('acapulco'), destination, network)) {
      assert.equal(result.transfers, result.legs.length - 1);
      assert.ok(result.transfers <= 2);
      assert.equal(
        result.fare,
        result.legs.reduce(
          (sum, leg) => sum + network.routes.find((r) => r.id === leg.routeId).fare,
          0
        )
      );
      assert.ok(result.totalMinutes >= result.legs.reduce((sum, leg) => sum + leg.rideMinutes, 0));
      assert.ok(result.walkMeters <= 840);
      assert.ok(distance(result.origin.point, result.destination.point) >= 30);
    }
  }
});
