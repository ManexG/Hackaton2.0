import { openCommunity, openField, openSection } from '../support/travel.js';
import { test, expect } from '@playwright/test';
import { APP_VERSION } from '../../src/version.js';
import { bundledRelease } from '../../server/releases.js';
import { readFileSync } from 'node:fs';
const network = JSON.parse(readFileSync('public/data/network.demo.json', 'utf8'));
const newer = {
  ...bundledRelease(),
  version: '9.0.0',
  minimumVersion: '9.0.0',
  minimumWebVersion: '9.0.0',
  notes: ['Nueva versión de prueba', 'GPS más preciso'],
  releaseUrl: 'https://github.com/ManexG/Hackaton2.0/releases/tag/v9.0.0',
  downloadUrl:
    'https://github.com/ManexG/Hackaton2.0/releases/download/v9.0.0/Las-Palmas-Rutas.apk',
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/version', (route) => route.fulfill({ json: bundledRelease() }));
  await page.route('**/api/network', (route) => route.fulfill({ json: network }));
  await page.addInitScript(() => {
    window.testStreams = { created: 0, closed: 0 };
    class Events extends EventTarget {
      constructor() {
        super();
        window.testStreams.created++;
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent('fleet', {
              data: JSON.stringify({ serverTime: Date.now(), services: [], vehicles: [] }),
            })
          )
        );
      }
      close() {
        window.testStreams.closed++;
      }
    }
    window.EventSource = Events;
  });
});
test('mandatory update blocks all navigation, shows notes and survives an offline reload', async ({
  page,
}) => {
  await page.route('**/api/version', (route) => route.fulfill({ json: newer }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Actualiza para continuar' })).toBeVisible();
  await expect(page.getByText('GPS más preciso', { exact: true })).toBeVisible();
  await expect(page.locator('#origin')).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.getByRole('button', { name: 'Actualizar ahora', exact: true })).toBeDisabled();
  await page.route('**/api/version', (route) => route.abort());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Actualiza para continuar' })).toBeVisible();
  await expect(page.locator('#origin')).toHaveCount(0);
});
test('an Android release ahead of the deployed web does not block the current website', async ({
  page,
}) => {
  await page.route('**/api/version', (route) =>
    route.fulfill({ json: { ...newer, minimumWebVersion: APP_VERSION } })
  );
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
});
test('invalid release download URLs cannot lock the app or direct users to another site', async ({
  page,
}) => {
  await page.route('**/api/version', (route) =>
    route.fulfill({ json: { ...newer, downloadUrl: 'https://bad.test/app.apk' } })
  );
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  await expect(page.locator('.update-required')).toHaveCount(0);
});
test('traffic signal icons are visible with OSM source and do not invent a live red or green state', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#map .traffic-signal-marker')).toHaveCount(33);
  await expect(page.locator('#map .traffic-signal-legend')).toContainText('OpenStreetMap');
  await page
    .locator('#map .traffic-signal-marker')
    .filter({ visible: true })
    .first()
    .click({ force: true });
  await expect(page.locator('.leaflet-popup-content')).toContainText('No indica el color actual');
});
test('loss of connectivity stops the live stream and disables online search while local places work', async ({
  page,
}) => {
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.testStreams.created - window.testStreams.closed))
    .toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.locator('.passenger-content .offline-notice')).toContainText('Sin internet');
  await expect
    .poll(() => page.evaluate(() => window.testStreams.created - window.testStreams.closed))
    .toBe(0);
  await openField(page, 'destination');
  await page.locator('#destination').fill('Reforma');
  await expect(page.getByRole('option').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Búsqueda en línea · requiere internet' })
  ).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    window.dispatchEvent(new Event('online'));
  });
  await expect
    .poll(() => page.evaluate(() => window.testStreams.created - window.testStreams.closed))
    .toBe(1);
});
test('the initial passenger screen avoids fleet polling and model download when SSE supplies an empty fleet', async ({
  page,
}) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  await page.waitForTimeout(2800);
  expect(requests.filter((u) => u.endsWith('/api/fleet'))).toHaveLength(0);
  expect(requests.filter((u) => u.includes('eta-model.json'))).toHaveLength(0);
});
test('public cached reports remain available offline without storing authentication responses', async ({
  page,
}) => {
  await page.route('**/api/community/reportes?*', (route) =>
    route.fulfill({ json: [{ id: 7, descripcion: 'Reporte guardado de prueba' }] })
  );
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { api } = await import('/src/community/api.js');
    await api('/reportes?q=prueba');
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    const data = await api('/reportes?q=prueba');
    let privateBlocked = false;
    try {
      await api('/auth/me');
    } catch {
      privateBlocked = true;
    }
    return { data, privateBlocked };
  });
  expect(result.data[0].id).toBe(7);
  expect(result.privateBlocked).toBe(true);
});
test('damaged saved sessions do not crash passenger, driver or community access', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'cerca.driver',
      JSON.stringify({ token: 'bad', expiresAt: Date.now() + 999999, driver: {} })
    );
    localStorage.setItem(
      'las-palmas.community',
      JSON.stringify({ token: 'bad', email: 'bad@example.test' })
    );
  });
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  await page.getByRole('button', { name: 'Soy un chofer', exact: true }).click();
  await expect(page.locator('#driver-email')).toBeVisible();
  await openCommunity(page);
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crear una cuenta', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('malformed live GPS payloads are rejected before reaching the map', async ({ page }) => {
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  const values = await page.evaluate(async () => {
    const { isSnapshot } = await import('/src/liveApi.js');
    return [
      isSnapshot({ serverTime: Date.now(), vehicles: [null], services: [] }),
      isSnapshot({ serverTime: NaN, vehicles: [], services: [] }),
      isSnapshot({ serverTime: Date.now(), vehicles: [], services: [null] }),
      isSnapshot({ serverTime: Date.now(), vehicles: [], services: [] }),
    ];
  });
  expect(values).toEqual([false, false, false, true]);
});
test('changing accounts during report synchronization never uploads the next draft under the new author', async ({
  page,
}) => {
  await page.goto('/');
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  const tokens = [];
  await page.route('**/api/community/reportes', async (route) => {
    tokens.push(route.request().headers().authorization);
    await page.evaluate(async () => {
      const { saveSession } = await import('/src/community/api.js');
      saveSession({
        token: 'second-test-token',
        nombre: 'Segunda persona',
        email: 'second@example.test',
      });
    });
    await route.fulfill({ json: { id: 1 } });
  });
  const result = await page.evaluate(async () => {
    const { saveSession } = await import('/src/community/api.js');
    const { enqueue, syncDrafts, drafts } = await import('/src/community/queue.js');
    saveSession({
      token: 'first-test-token',
      nombre: 'Primera persona',
      email: 'first@example.test',
    });
    for (const [index, descripcion] of ['Reporte uno', 'Reporte dos'].entries())
      await enqueue({
        id: `queued-${index}`,
        categoria: 'bache',
        descripcion,
        lat: 17.96,
        lng: -102.197,
      });
    await syncDrafts();
    return (await drafts()).map((d) => ({ owner: d.owner, descripcion: d.descripcion }));
  });
  expect(tokens).toEqual(['Bearer first-test-token']);
  expect(result).toEqual([{ owner: 'first@example.test', descripcion: 'Reporte dos' }]);
});
