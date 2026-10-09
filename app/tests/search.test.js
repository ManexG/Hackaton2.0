import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distance,
  insideCoverage,
  nearbyPlaces,
  planJourneys,
  searchPlaces,
  validateNetwork,
} from '../src/planner.js';
const routes = JSON.parse(
  readFileSync(new URL('../public/data/network.demo.json', import.meta.url), 'utf8')
);
const catalog = JSON.parse(
  readFileSync(new URL('../public/data/places.osm.json', import.meta.url), 'utf8')
);
const network = { ...routes, places: [...routes.places, ...catalog.places] };
const origin = network.places.find((p) => p.id === 'acapulco');
test('imports indexed businesses, streets, and addresses entirely inside coverage', () => {
  assert.ok(catalog.places.length > 900);
  assert.ok(catalog.places.filter((p) => p.kind === 'business').length > 400);
  assert.ok(catalog.places.filter((p) => p.kind === 'street').length > 400);
  assert.ok(
    catalog.places.every((p) => p.source === 'osm' && !p.demo && insideCoverage(p.point, network))
  );
  validateNetwork(network);
});
test('matches actual streets with abbreviated avenue prefixes and accents', () => {
  assert.ok(
    searchPlaces('Calle Reforma', network).some((p) => p.id === 'osm-street-avenidareforma')
  );
  assert.ok(
    searchPlaces('av lazaro cardenas', network).some(
      (p) => p.kind === 'street' && p.source === 'osm'
    )
  );
});
test('returns indexed house-number coordinates without fabricating them', () => {
  const result = searchPlaces('Avenida Reforma #534', network)[0];
  assert.equal(result.name, 'Avenida Reforma #534');
  assert.equal(result.source, 'osm');
  assert.deepEqual(result.point, [17.9583374, -102.190591]);
});
test('matches words in different order and Spanish category words', () => {
  assert.ok(searchPlaces('feliz pollo', network).length);
  assert.ok(searchPlaces('farmacias', network).some((p) => p.category === 'health'));
  assert.ok(searchPlaces('restaurantes', network).some((p) => p.category === 'food'));
});
test('nearby suggestions change with origin and category and sort by distance', () => {
  const results = nearbyPlaces(network, origin.point, 'food');
  assert.equal(results.length, 6);
  assert.ok(results.every((p) => p.category === 'food' && p.source === 'osm'));
  assert.ok(
    results.every(
      (p, i) =>
        i === 0 || distance(origin.point, p.point) >= distance(origin.point, results[i - 1].point)
    )
  );
  assert.notDeepEqual(
    nearbyPlaces(network, network.places.find((p) => p.id === 'entronque').point, 'food').map(
      (p) => p.id
    ),
    results.map((p) => p.id)
  );
});
test('same-named businesses sort by proximity to chosen origin', () => {
  const results = searchPlaces('Oxxo', network, origin.point).filter((p) => p.name === 'Oxxo');
  assert.ok(results.length > 1);
  assert.ok(
    results.every(
      (p, i) =>
        i === 0 || distance(origin.point, p.point) >= distance(origin.point, results[i - 1].point)
    )
  );
});
test('recommended lines and final stops depend on the actual selected destination', () => {
  const direct = planJourneys(
      origin,
      network.places.find((p) => p.id === 'entronque'),
      network
    )[0],
    market = planJourneys(
      origin,
      network.places.find((p) => p.id === 'mercado'),
      network
    )[0];
  assert.equal(direct.legs[0].routeId, 'R01');
  assert.equal(market.legs[0].routeId, 'R02');
  assert.notEqual(direct.legs.at(-1).to, market.legs.at(-1).to);
});
test('categories stay bounded and unknown addresses produce no invented match', () => {
  for (const category of ['all', 'food', 'shopping', 'health', 'interest', 'street'])
    assert.ok(
      nearbyPlaces(network, origin.point, category).every((p) => insideCoverage(p.point, network))
    );
  assert.equal(searchPlaces('Negocio inventado xyz 99000', network).length, 0);
});
