import { test, expect } from '@playwright/test';
import { openField } from '../support/travel.js';
for (const width of [1440, 390]) {
  test(`travel cards collapse selections and keep a single editable field (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('#origin')).toBeVisible();
    await expect(page.locator('#destination')).toBeHidden();
    await page.locator('#origin').fill('Jugos Acapulco');
    await page.getByRole('option').first().click();
    await expect(page.locator('#origin')).toBeHidden();
    await expect(page.locator('#destination')).toBeVisible();
    await page.locator('#destination').fill('Las Guacamayas');
    await page.getByRole('option').first().click();
    await expect(page.locator('.field-summary[aria-controls="destination-editor"]')).toContainText(
      'Guacamayas'
    );
    await expect(page.locator('.field-editor:visible')).toHaveCount(0);
    await openField(page, 'destination');
    await expect(page.locator('#destination')).toBeVisible();
    await openField(page, 'origin');
    await expect(page.locator('#destination')).toBeHidden();
    await page.locator('#origin').fill('La Orilla');
    await page.getByRole('option').first().click();
    await expect(page.locator('.field-summary[aria-controls="origin-editor"]')).toContainText(
      'Orilla'
    );
    await expect(page.locator('.field-summary[aria-controls="destination-editor"]')).toContainText(
      'Guacamayas'
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.locator('.panel-scroll').evaluate((panel) => {
      panel.scrollTop = 0;
    });
    await page.locator('#toast button').click();
    await page.screenshot({ path: `../../outputs/Las-Palmas-viaje-${width}.png`, fullPage: true });
    await openField(page, 'origin');
    await page.getByRole('button', { name: 'O elegir un punto en el mapa' }).click();
    await expect(page.locator('.map-notice')).toContainText('origen');
  });
}
test('stops are grouped by zone, collapse after selection and reopen for another stop', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Paradas', exact: true }).click();
  await expect(page.locator('.stop-explanation')).toContainText('subes, bajas');
  await page.locator('.zone-heading').filter({ hasText: 'Las Guacamayas' }).click();
  await page.locator('.stop-choice').filter({ hasText: 'Las Guacamayas' }).click();
  await expect(page.locator('#stop-zones')).toBeHidden();
  await expect(page.locator('.stop-picker-summary')).toContainText('Las Guacamayas');
  await expect(page.locator('.stop-route-tags')).toContainText('R07');
  await page.locator('.stop-picker-summary').click();
  await page.locator('.zone-heading').filter({ hasText: 'Corredor principal' }).click();
  await page.locator('.stop-choice').filter({ hasText: 'Jugos Acapulco' }).click();
  await expect(page.locator('.stop-picker-summary')).toContainText('Jugos Acapulco');
  await page.getByRole('button', { name: 'Salir desde esta parada' }).click();
  await expect(page.locator('.field-summary[aria-controls="origin-editor"]')).toContainText(
    'Jugos Acapulco'
  );
  await expect(page.locator('#destination')).toBeVisible();
});
test('a forged or expired local admin session cannot display the management panels', async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'cerca.admin',
      JSON.stringify({
        token: 'fake-admin-token',
        expiresAt: Date.now() + 3600000,
        admin: { id: 'fake', name: 'fake' },
      })
    )
  );
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Acceso de administración' })).toBeVisible();
  await expect(page.locator('.admin-tabs')).toHaveCount(0);
  await expect(page.getByLabel('Archivo JSON del equipo')).toHaveCount(0);
  await expect(page.getByLabel('Clave de administración')).toHaveCount(0);
});
