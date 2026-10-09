import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installEtaModel, etaModelReady, predictEtaRaw, modelTravel } from '../src/etaModel.js';
import { stopArrivals, routeMetrics, predictJourneys } from '../src/transit.js';
const model = JSON.parse(
  readFileSync(new URL('../public/data/eta-model.json', import.meta.url), 'utf8')
);
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/eta-parity.json', import.meta.url), 'utf8')
);
const network = JSON.parse(
  readFileSync(new URL('../public/data/network.demo.json', import.meta.url), 'utf8')
);
const now = Date.parse('2026-10-08T14:00:00Z'); // Thursday, 08:00 in the city.
const bus = {
  id: 'test-model',
  unit: 'TEST',
  routeId: 'R01',
  point: network.routes[0].segments[0][0],
  direction: 1,
  speed: 5,
  accuracy: 5,
  updatedAt: now,
  serviceEndAt: now + 3_600_000,
};
afterEach(() => {
  installEtaModel(null);
});
test('web inference matches all 260 original sklearn predictions, including both quantiles', () => {
  assert.equal(installEtaModel(model), true);
  assert.equal(
    model.provenance.sha256,
    'e5f11fed02e5d5f58ff7c5741ffafc66c15c37a6cdfdd6614184600726255593'
  );
  for (const fixture of fixtures)
    predictEtaRaw(model, fixture.input).forEach((value, i) =>
      assert.ok(
        Math.abs(value - fixture.expected[i]) < 1e-9,
        `Parity failed for ${fixture.input} output ${i}`
      )
    );
});
test('model uses Monday-based weekday, city time, measured speed and ordered nonnegative bounds', () => {
  installEtaModel(model);
  const prediction = modelTravel(1200, 18, 4, 8 * 3600);
  const [mean, lo, hi] = predictEtaRaw(model, [1200, 18, 0, 8, 3, 0]);
  assert.equal(prediction.seconds, Math.max(0, mean * 60));
  assert.equal(prediction.minSeconds, Math.max(0, Math.min(lo, mean) * 60));
  assert.equal(prediction.maxSeconds, Math.max(hi, mean) * 60);
  assert.ok(
    prediction.minSeconds <= prediction.seconds && prediction.seconds <= prediction.maxSeconds
  );
});
test('missing, corrupt or out-of-domain model safely falls back rather than preventing travel search', () => {
  assert.equal(etaModelReady(), false);
  assert.equal(modelTravel(1200, 18, 4, 8 * 3600), null);
  const corrupt = structuredClone(model);
  corrupt.mean.trees[0][0][4] = 0;
  assert.equal(installEtaModel(corrupt), false);
  installEtaModel(model);
  for (const args of [
    [20, 18, 4, 8 * 3600],
    [9000, 18, 4, 8 * 3600],
    [1200, 0, 4, 8 * 3600],
    [1200, 18, 4, 2 * 3600],
  ])
    assert.equal(modelTravel(...args), null);
});
test('stop ETA uses along-route GPS distance and carries uncertainty while excluding stale or expired signals', () => {
  installEtaModel(model);
  const route = network.routes[0],
    metrics = routeMetrics(route);
  const arrival = stopArrivals(route.stops.at(-1), network, [bus], now, 1)[0];
  const expected = modelTravel(metrics.length, 18, 4, 8 * 3600);
  assert.ok(Math.abs(arrival.seconds - expected.seconds) < 1e-8);
  assert.equal(arrival.experimental, true);
  assert.ok(arrival.maxSeconds >= arrival.seconds);
  assert.equal(stopArrivals(route.stops[0], network, [bus], now, 1)[0].seconds, 0);
  assert.equal(
    stopArrivals(route.stops.at(-1), network, [{ ...bus, updatedAt: now - 46_000 }], now).length,
    0
  );
  assert.equal(
    stopArrivals(route.stops.at(-1), network, [{ ...bus, serviceEndAt: now + 1000 }], now).length,
    0
  );
});
test('experimental ride predictions change destination recommendations without inventing active drivers', () => {
  const origin = network.places.find((place) => place.name.startsWith('Jugos Acapulco'));
  const destination = network.places.find((place) => place.name.startsWith('Entronque'));
  const fallback = predictJourneys(origin, destination, network, [bus], now)[0];
  installEtaModel(model);
  const predicted = predictJourneys(origin, destination, network, [bus], now)[0];
  assert.equal(predicted.experimental, true);
  assert.notEqual(predicted.totalMinutes, fallback.totalMinutes);
  assert.equal(predicted.destination.id, destination.id);
  assert.deepEqual(predictJourneys(origin, destination, network, [], now), []);
});
