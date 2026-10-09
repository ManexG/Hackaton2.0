import { openField, openSection } from '../support/travel.js';
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
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
});
test('passenger identity is explicit; driver login has a clearly labelled return', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: 'Soy un chofer', exact: true })).toBeVisible();
  await expect(page.locator('#driver-email')).toBeHidden();
  await expect(
    page.getByRole('img', { name: 'Las Palmas Rutas', exact: true }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Soy un chofer', exact: true }).click();
  await expect(page.locator('.sheet-title')).toContainText('Soy un chofer');
  await expect(page.locator('#driver-email')).toBeVisible();
  await page.getByRole('button', { name: 'Volver a viajar como pasajero' }).click();
  await openSection(page, 'Buscar viaje');
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
  await openSection(page, 'Rutas');
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
test('larger text persists and the sheet can be closed to see the whole map', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: /Letra más grande/ }).click();
  await openSection(page, 'Buscar viaje');
  expect(
    await page
      .locator('#origin')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThanOrEqual(22);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.getByRole('button', { name: /Letra normal/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect
    .poll(() => page.locator('#map').evaluate((element) => element.clientHeight))
    .toBeGreaterThan(400);
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar panel y ver el mapa' }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('sheet opens from the bottom bar, never covers more than half the screen and drags closed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Cerrar panel y ver el mapa' }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await openSection(page, 'Rutas');
  const sheet = page.locator('.sidebar');
  await expect(sheet).toBeVisible();
  const height = async () => (await sheet.boundingBox()).height;
  await expect.poll(height).toBeLessThanOrEqual(844 * 0.6 + 1);
  await page.getByRole('button', { name: /Arrastra para cambiar/ }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(height).toBeGreaterThan(844 * 0.55);
  await expect.poll(height).toBeLessThanOrEqual(844 * 0.6 + 1);
  await page.keyboard.press('ArrowDown');
  await expect(sheet).toBeHidden();
  await openSection(page, 'Rutas');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Rutas', exact: true }).click();
  await expect(sheet).toBeHidden();
});
test('the map opens on the whole municipality with every route drawn', async ({ page }) => {
  await expect(page.locator('.route-path')).toHaveCount(8);
  const inside = await page.evaluate(() => {
    const { map, network } = window.cercaDemo;
    const bounds = map.getBounds();
    return network.routes.every((route) =>
      route.segments.flat().every(([lat, lng]) => bounds.contains([lat, lng]))
    );
  });
  expect(inside).toBe(true);
});
test('mobile passenger can enlarge text again to 200 percent without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: 'html { font-size: 36px !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openSection(page, 'Rutas');
  await page.locator('.route-card').first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('missing model does not prevent local places, routes or stop browsing', async ({ page }) => {
  await page.route('**/data/eta-model.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.reload();
  await openSection(page, 'Buscar viaje');
  await expect(page.locator('#origin')).toBeVisible();
  await openField(page, 'destination');
  await page.locator('#destination').fill('Avenida Reforma 534');
  await expect(page.getByRole('option').first()).toContainText('#534');
  await openSection(page, 'Rutas');
  await expect(page.locator('.route-card')).toHaveCount(8);
});
test('one tap highlights a route on the map and a double tap opens its information', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Cerrar panel y ver el mapa' }).click();
  const legend = page.locator('.map-legend [data-route=R02]');
  await legend.click();
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.route-R02')).toHaveCSS('stroke-opacity', '1');
  await expect(page.locator('.route-R01')).not.toHaveCSS('stroke-opacity', '1');
  await page.waitForTimeout(500);
  await legend.dblclick();
  await expect(page.locator('#route-detail')).toBeVisible();
  await expect(page.locator('.sheet-title')).toContainText('Rutas');
  await expect(page.getByText('Elige la ruta que quieres conocer')).toHaveCount(0);
  const back = page.getByRole('button', { name: 'Volver a todas las rutas' });
  await expect(back).toBeVisible();
  const detail = await page.locator('#route-detail').boundingBox();
  const button = await back.boundingBox();
  expect(button.y).toBeGreaterThan(detail.y + detail.height / 2);
});
test('after opening a route, tapping another route on the map still highlights it', async ({
  page,
}) => {
  await openSection(page, 'Rutas');
  await page.locator('.route-card').first().click();
  await expect(page.locator('#route-detail')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar panel y ver el mapa' }).click();
  const legend = page.locator('.map-legend [data-route=R03]');
  await legend.click();
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.route-R03')).toHaveCSS('stroke-opacity', '1');
  await expect(page.locator('.route-R01')).not.toHaveCSS('stroke-opacity', '1');
  await page.waitForTimeout(500);
  await legend.dblclick();
  await expect(page.locator('#route-detail')).toContainText('R03');
});
