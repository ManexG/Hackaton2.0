import { openField } from '../support/travel.js';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class NoEvents extends EventTarget {
      static OPEN = 1;
      readyState = 0;
      onerror = null;
      close() {}
    }
    Object.assign(window, { EventSource: NoEvents });
  });
  await page.route('**/api/fleet', (route) =>
    route.fulfill({
      json: { serverTime: Date.now(), publicAppUrl: '', services: [], vehicles: [] },
    })
  );
  await page.goto('/');
  await expect(page.locator('.search-status')).toBeVisible();
});
test('passenger identity is explicit; driver login has a clearly labelled return', async ({
  page,
}) => {
  await expect(page.locator('.current-mode')).toContainText('Estás en: Pasajero');
  await expect(page.locator('#driver-email')).toBeHidden();
  await expect(
    page.getByRole('img', { name: 'Las Palmas Rutas', exact: true }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Entrar como chofer', exact: true }).click();
  await expect(page.locator('.current-mode')).toContainText('Acceso para choferes');
  await expect(page.locator('#driver-email')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a viajar como pasajero' }).click();
  await expect(page.locator('.current-mode')).toContainText('Estás en: Pasajero');
  await expect(page.locator('#origin')).toBeVisible();
});
test('choosing places confirms them and requires the explicit how-to-get-there action', async ({
  page,
}) => {
  for (const [field, query] of [
    ['origin', 'Jugos Acapulco'],
    ['destination', 'Entronque av'],
  ]) {
    await openField(page, field);
    await page.locator(`#${field}`).fill(query);
    await page.getByRole('option').first().click();
  }
  await expect(page.locator('.field-confirmation')).toHaveCount(2);
  await expect(page.locator('.search-status')).toContainText('Todo listo');
  await expect(page.locator('#results')).toHaveCount(0);
  await page.getByRole('button', { name: /Ver cómo llegar/ }).click();
  await expect(page.locator('#results')).toContainText('No hay un viaje disponible ahora');
  await page.getByRole('button', { name: 'Ver por dónde pasan las rutas' }).click();
  await expect(page.locator('.route-card')).toHaveCount(8);
});
test('route tap opens its endpoints and selected confirmation instead of an unexplained toggle', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Ver rutas', exact: true }).click();
  await page.locator('.route-card').first().click();
  await expect(page.locator('#route-detail')).toContainText('Ruta seleccionada');
  await expect(page.getByRole('heading', { name: 'Estás viendo la R01' })).toBeFocused();
  await expect(page.locator('.route-endpoints')).toContainText('Sale de: Jugos Acapulco');
  await expect(page.locator('.route-endpoints')).toContainText('Llega a: Entronque');
  await page.getByRole('button', { name: 'Volver a todas las rutas' }).click();
  await expect(page.locator('.route-card')).toHaveCount(8);
});
test('clean interface removes help and numbered onboarding while keeping a readable street map', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: 'Ayuda', exact: true })).toHaveCount(0);
  await expect(
    page.locator('.plan-welcome, .step-number, #info-dialog, .panel-footer')
  ).toHaveCount(0);
  await expect(page.locator('.leaflet-tile')).toHaveCount(0);
  await expect.poll(() => page.locator('.flat-street-name').count()).toBeGreaterThan(0);
  await expect(page.locator('.leaflet-control-attribution')).toContainText(
    'OpenStreetMap contributors'
  );
  await expect(page.getByRole('button', { name: 'Comunidad', exact: true })).toBeVisible();
});
test('larger text persists and mobile map has an explicit way back to instructions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: /Letra más grande/ }).click();
  expect(
    await page
      .locator('#origin')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThanOrEqual(22);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.search-status')).toBeVisible();
  await expect(page.getByRole('button', { name: /Letra normal/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: 'Ver mapa de las rutas' }).click();
  await expect(page.locator('.map-section')).toBeVisible();
  await expect
    .poll(() => page.locator('#map').evaluate((element) => element.clientHeight))
    .toBeGreaterThan(400);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await page.getByRole('button', { name: 'Volver a las instrucciones' }).click();
  await expect(page.locator('#origin')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('mobile passenger can enlarge text again to 200 percent without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: 'html { font-size: 36px !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Ver rutas', exact: true }).click();
  await page.locator('.route-card').first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('missing model does not prevent local places, routes or stop browsing', async ({ page }) => {
  await page.route('**/data/eta-model.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.reload();
  await expect(page.locator('.search-status')).toBeVisible();
  await openField(page, 'destination');
  await page.locator('#destination').fill('Avenida Reforma 534');
  await expect(page.getByRole('option').first()).toContainText('#534');
  await page.getByRole('tab', { name: 'Ver rutas', exact: true }).click();
  await expect(page.locator('.route-card')).toHaveCount(8);
});
