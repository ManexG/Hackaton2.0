import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const network = JSON.parse(
  readFileSync(new URL('../../public/data/network.demo.json', import.meta.url), 'utf8')
);
const errors = new WeakMap();
async function choose(page, field, query) {
  await page.locator(`#${field}`).fill(query);
  await expect(page.locator('#suggestions [role=option]').first()).toBeVisible();
  await page.locator('#suggestions [role=option]').first().click();
  // Complete the explicit third step when both places have been chosen.
  if (
    (await page.locator('#origin').inputValue()) &&
    (await page.locator('#destination').inputValue())
  )
    await page.getByRole('button', { name: /Ver cómo llegar/ }).click();
}
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  // Fixed GPS fixtures exist only in this isolated UI suite, never in the running server.
  await page.addInitScript(() => {
    class TestEvents extends EventTarget {
      static OPEN = 1;
      readyState = 0;
      onerror = null;
      constructor(_url) {
        super();
      }
      close() {
        this.readyState = 2;
      }
    }
    Object.assign(window, { EventSource: TestEvents });
  });
  await page.route('**/api/fleet', (route) =>
    route.fulfill({
      json: {
        serverTime: Date.now(),
        publicAppUrl: '',
        services: [],
        vehicles: network.routes.map((item) => ({
          id: `test-${item.id}`,
          unit: `TEST-${item.id}`,
          routeId: item.id,
          point: item.segments[0][0],
          direction: 1,
          speed: 5,
          accuracy: 5,
          updatedAt: Date.now(),
          serviceEndAt: Date.now() + 3_600_000,
        })),
      },
    })
  );
  await page.goto('/');
  await expect(page.locator('.search-status')).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
test('starts without a default origin, destination, or recommended route', async ({ page }) => {
  await expect(page.locator('#origin')).toHaveValue('');
  await expect(page.locator('#destination')).toHaveValue('');
  await expect(page.locator('.journey-card')).toHaveCount(0);
  await expect(page.locator('.selected-leg')).toHaveCount(0);
  await expect(page.locator('.bus-marker.selected')).toHaveCount(0);
  await expect(page.locator('.nearby-place')).toHaveCount(5);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '../cerca-react-inicio.png' });
});
test('calculates direct journey only after choosing both endpoints', async ({ page }) => {
  await choose(page, 'origin', 'Jugos Acapulco');
  await expect(page.locator('.journey-card')).toHaveCount(0);
  await choose(page, 'destination', 'Entronque av');
  await expect(page.locator('.journey-card.selected')).toContainText('Sin trasbordos');
  await expect(page.locator('.bus-marker.selected')).toHaveCount(1);
  await expect(page.locator('.bus-marker.muted')).toHaveCount(3);
});
test('selected cafe needs transfer and highlights both combis', async ({ page }) => {
  await choose(page, 'origin', 'Jugos Acapulco');
  await choose(page, 'destination', 'Café del Puerto');
  await expect(page.locator('.journey-card.selected')).toContainText('1 trasbordo');
  await expect(page.locator('.destination-context')).toContainText('Café del Puerto');
  await expect(page.locator('.bus-marker.selected')).toHaveCount(2);
  await expect(page.locator('.selected-leg')).toHaveCount(2);
  await expect(page.locator('.transfer-marker')).toHaveCount(1);
  await expect(page.locator('.journey-steps')).toContainText('Haz tu trasbordo aquí');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '../cerca-react-trasbordo.png' });
});
test('editing destination clears stale recommendations and recalculates new route', async ({
  page,
}) => {
  await choose(page, 'origin', 'Jugos Acapulco');
  await choose(page, 'destination', 'Entronque av');
  await expect(page.locator('.journey-card.selected')).toContainText('R01');
  await page.locator('#destination').fill('Mercado');
  await expect(page.locator('.journey-card')).toHaveCount(0);
  await expect(page.locator('.selected-leg')).toHaveCount(0);
  await page.locator('#suggestions [role=option]').first().click();
  await page.getByRole('button', { name: /Ver cómo llegar/ }).click();
  await expect(page.locator('.journey-card.selected')).toContainText('R02');
  await expect(page.locator('.destination-context')).toContainText('Mercado del Sol');
  expect(
    await page.evaluate(() => window.cercaDemo.getState().selectedJourney.legs.at(-1).to)
  ).toBe('mercado');
});
test('finds actual indexed street names and numbered addresses', async ({ page }) => {
  await page.locator('#destination').fill('Reforma');
  await expect(page.locator('#suggestions')).toContainText('Avenida Reforma');
  await page.locator('#destination').fill('Avenida Reforma 534');
  await expect(page.locator('#suggestions [role=option]').first()).toContainText('#534');
  await page.locator('#destination').press('ArrowDown');
  await page.locator('#destination').press('Enter');
  await expect(page.locator('#destination')).toHaveValue('Avenida Reforma #534');
  await expect(page.locator('.journey-card')).toHaveCount(0);
});
test('finds indexed businesses and Spanish category words', async ({ page }) => {
  await choose(page, 'origin', 'Jugos Acapulco');
  await page.locator('#destination').fill('Pollo Feliz');
  await expect(page.locator('#suggestions')).toContainText('Pollo Feliz');
  await page.locator('#destination').fill('farmacias');
  await expect(page.locator('#suggestions [role=option]')).not.toHaveCount(0);
  await page.locator('#destination').fill('Oxxo');
  await expect(page.locator('#suggestions [role=option]')).not.toHaveCount(0);
  await page.locator('#suggestions [role=option]').first().click();
  await expect(page.locator('#destination')).toHaveValue('Oxxo');
  await page.getByRole('button', { name: /Ver cómo llegar/ }).click();
  await expect(page.locator('#results')).toBeVisible();
});
test('nearby category cards choose a destination and its own journey', async ({ page }) => {
  await choose(page, 'origin', 'Jugos Acapulco');
  await page.getByRole('button', { name: 'Comer', exact: true }).click();
  await expect(page.locator('.nearby-place')).toHaveCount(5);
  const name = await page.locator('.nearby-place strong').first().textContent();
  await page.locator('.nearby-place').first().click();
  await expect(page.locator('#destination')).toHaveValue(name);
  const state = await page.evaluate(() => window.cercaDemo.getState());
  expect(state.destination.name).toBe(name);
  expect(state.destination.source).toBe('osm');
  if (state.journeys.length) expect(state.selectedJourney.destination.name).toBe(name);
});
test('online lookup runs only on explicit action and filters out-of-zone results', async ({
  page,
}) => {
  let requests = 0;
  await page.route('https://nominatim.openstreetmap.org/search?**', async (route) => {
    requests++;
    const url = new URL(route.request().url());
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('viewbox')).toBe('-102.214,17.977,-102.186,17.951');
    await route.fulfill({
      json: [
        {
          place_id: 9001,
          name: 'Negocio exacto de prueba',
          lat: '17.9593',
          lon: '-102.2022',
          display_name: 'Negocio exacto de prueba, Lázaro Cárdenas',
          address: { road: 'Reforma', house_number: '777' },
        },
        {
          place_id: 9002,
          name: 'Resultado fuera de zona',
          lat: '19.43',
          lon: '-99.13',
          display_name: 'Fuera de zona',
        },
      ],
    });
  });
  await choose(page, 'origin', 'Jugos Acapulco');
  await page.locator('#destination').fill('Dirección no indexada 777');
  await expect(page.locator('.no-suggestions')).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Buscar dirección o negocio en línea' }).click();
  await expect(page.locator('#suggestions')).toContainText('Negocio exacto de prueba');
  await expect(page.locator('#suggestions')).not.toContainText('Resultado fuera de zona');
  await page.locator('#suggestions [role=option]').first().click();
  await page.getByRole('button', { name: /Ver cómo llegar/ }).click();
  await expect(page.locator('.journey-card.selected')).toContainText('R02');
  expect(requests).toBe(1);
});
test('stale remote search cannot overwrite an edited destination', async ({ page }) => {
  await page.route('https://nominatim.openstreetmap.org/search?**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route
      .fulfill({
        json: [
          {
            place_id: 9003,
            name: 'Resultado antiguo',
            lat: '17.9593',
            lon: '-102.2022',
            display_name: 'Resultado antiguo',
          },
        ],
      })
      .catch(() => {});
  });
  await page.locator('#destination').fill('Busqueda antigua 888');
  await page.getByRole('button', { name: 'Buscar dirección o negocio en línea' }).click();
  await page.locator('#destination').fill('Reforma');
  await expect(page.locator('#suggestions')).toContainText('Avenida Reforma');
  await page.waitForTimeout(1000);
  await expect(page.locator('#suggestions')).not.toContainText('Resultado antiguo');
  await expect(page.locator('#destination')).toHaveValue('Reforma');
});
test('explorer displays route endpoints and reverse direction', async ({ page }) => {
  await page.locator('.map-legend [data-route=R02]').click();
  await expect(page.locator('#routes-panel')).toBeVisible();
  await expect(page.locator('.stop-list li').first()).toContainText('Jugos Acapulco');
  await expect(page.locator('.stop-list li').last()).toContainText('Plaza del Encuentro');
  await page.locator('.direction-button').click();
  await expect(page.locator('.stop-list li').first()).toContainText('Plaza del Encuentro');
  await expect(page.locator('.bus-marker.selected')).toHaveCount(1);
});
test('outside GPS is rejected and map stays in coverage', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 19.4326, longitude: -99.1332 });
  await page.getByRole('button', { name: 'Mi ubicación', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('fuera de la zona');
  await expect(page.locator('#origin')).toHaveValue('');
  await page.evaluate(() => window.cercaDemo.map.panTo([19.4326, -99.1332], { animate: false }));
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => {
      const { map, network } = window.cercaDemo;
      const p = map.getCenter();
      const [sw, ne] = network.coverage.bounds;
      return p.lat >= sw[0] && p.lat <= ne[0] && p.lng >= sw[1] && p.lng <= ne[1];
    })
  ).toBe(true);
});
test('mobile instructions and destination-specific transfer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#origin')).toBeVisible();
  await choose(page, 'origin', 'Jugos Acapulco');
  await choose(page, 'destination', 'Café del Puerto');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile-view', 'instructions');
  await expect(page.locator('.bus-marker.selected')).toHaveCount(2);
  await page.evaluate(() => {
    const panel = document.querySelector('.panel-scroll');
    const results = document.querySelector('#results');
    panel.scrollTop = results.offsetTop - 40;
  });
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '../cerca-react-android.png' });
});
test('swap recalculates return journey for chosen endpoints', async ({ page }) => {
  await choose(page, 'origin', 'Jugos Acapulco');
  await choose(page, 'destination', 'Entronque av');
  await page.getByRole('button', { name: 'Intercambiar origen y destino' }).click();
  await page.getByRole('button', { name: /Ver cómo llegar/ }).click();
  await expect(page.locator('#origin')).toHaveValue('Entronque av. Lázaro Cárdenas');
  await expect(page.locator('.journey-card.selected')).toContainText('Sin trasbordos');
  expect(await page.evaluate(() => window.cercaDemo.getState().selectedJourney.legs[0].from)).toBe(
    'entronque'
  );
});
test('bundled streets and catalog work when internet map tiles fail', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.reload();
  await expect(page.locator('.search-status')).toBeVisible();
  await expect(page.locator('.leaflet-localMap-pane path')).toHaveCount(412);
  await page.locator('#destination').fill('Avenida Reforma 534');
  await expect(page.locator('#suggestions [role=option]').first()).toContainText('#534');
});
test('missing remote addresses show a helpful message without inventing a route', async ({
  page,
}) => {
  await page.route('https://nominatim.openstreetmap.org/search?**', (route) =>
    route.fulfill({ json: [] })
  );
  await choose(page, 'origin', 'Jugos Acapulco');
  await page.locator('#destination').fill('Calle inexistente 99999');
  await page.getByRole('button', { name: 'Buscar dirección o negocio en línea' }).click();
  await expect(page.locator('#toast')).toContainText('No encontramos esa dirección');
  await expect(page.locator('.journey-card')).toHaveCount(0);
});
test('online failure gives a Spanish fallback and local search still works', async ({ page }) => {
  await page.route('https://nominatim.openstreetmap.org/search?**', (route) => route.abort());
  await page.locator('#destination').fill('Dirección sin conexión 88888');
  await page.getByRole('button', { name: 'Buscar dirección o negocio en línea' }).click();
  await expect(page.locator('#toast')).toContainText('Usa los lugares guardados');
  await page.locator('#destination').fill('Avenida Reforma 534');
  await expect(page.locator('#suggestions [role=option]').first()).toContainText('#534');
});
