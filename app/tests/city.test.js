import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insideCoverage, searchPlaces, validateNetwork, planJourneys } from '../src/planner.js';
import { inServiceZone } from '../src/serviceZone.js';
const network = JSON.parse(readFileSync('public/data/network.demo.json', 'utf8'));
const catalog = JSON.parse(readFileSync('public/data/places.osm.json', 'utf8'));

test('eight distinct demo routes cover urban districts and keep the original opening view', () => {
  validateNetwork(network);
  assert.deepEqual(
    network.routes.map((route) => route.id),
    ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08']
  );
  assert.equal(new Set(network.routes.map((route) => route.color)).size, 8);
  assert.deepEqual(network.coverage.initialBounds, [
    [17.951, -102.214],
    [17.977, -102.186],
  ]);
  for (const id of ['orilla', 'guacamayas', 'palmas-colonia']) {
    const stop = network.stops.find((stop) => stop.id === id);
    assert.ok(insideCoverage(stop.point, network));
    assert.ok(
      inServiceZone(stop.point, {
        ...network,
        pilotZone: { lat: 17.954, lng: -102.192, radio_m: 200 },
      })
    );
  }
  assert.equal(insideCoverage([18.09, -102.35], network), false);
  const [a, b] = ['guacamayas', 'acapulco'].map((id) =>
    network.places.find((place) => place.id === id)
  );
  const journey = planJourneys(a, b, network)[0];
  assert.ok(journey);
  assert.ok(journey.legs.some((leg) => leg.routeId === 'R07'));
  assert.ok(
    journey.legs.every((leg) => leg.geometry.every((point) => insideCoverage(point, network)))
  );
});
test('city catalog finds homes, shops and neighbourhoods outside the former pilot rectangle', () => {
  const full = { ...network, places: [...network.places, ...catalog.places] };
  for (const query of ['Las Guacamayas', 'La Orilla', 'Walmart', 'Colonia Las Palmas']) {
    const matches = searchPlaces(query, full);
    assert.ok(matches.length, query);
    assert.ok(matches.every((place) => insideCoverage(place.point, full)));
  }
  assert.ok(catalog.places.some((place) => place.kind === 'street' && place.point[0] > 17.977));
  assert.equal(searchPlaces('Negocio desconocido qzqzqz', full).length, 0);
});
