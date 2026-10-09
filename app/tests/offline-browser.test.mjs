import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { build } from 'vite';
import { createTransitServer } from '../server/index.js';
// The map fills the screen; sections open as a bottom sheet from the bottom navigation.
async function openSection(page, name) {
  const nav = page.locator('.bottom-nav').getByRole('button', { name, exact: true });
  if ((await nav.getAttribute('aria-pressed')) !== 'true') await nav.click();
  await page.locator('.sidebar').waitFor({ state: 'visible' });
}
test(
  'production PWA: cold load, bounded offline cache, offline maps and reports, reconnect and mandatory upgrade',
  { timeout: 120000 },
  async () => {
    process.env.VITE_PUBLIC_API_URL = '/api';
    process.env.VITE_PUBLIC_APP_URL = '';
    const dist = resolve('.wrangler/offline-build');
    await build({ build: { outDir: dist } });
    const { server, store } = createTransitServer({
      dbPath: ':memory:',
      distPath: dist,
      releaseFetcher: async () => new Response(null, { status: 404 }),
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    store.publicAppUrl = base + '/';
    const browser = await chromium.launch({
      channel: process.env.CI ? undefined : 'msedge',
      headless: true,
    });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const errors = [],
        requests = [];
      page.on('pageerror', (e) => errors.push(e.message));
      context.on('request', (r) => requests.push(r.url()));
      await page.goto(base);
      await openSection(page, 'Buscar viaje');
      await expect(page.locator('#origin')).toBeVisible();
      await expect(page.locator('#map .traffic-signal-marker')).toHaveCount(33);
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      assert.equal(
        requests.filter((u) => u.includes('/esm-')).length,
        0,
        'Camera decoder is not downloaded at startup'
      );
      assert.equal(
        requests.filter((u) => u.includes('eta-model.json')).length,
        0,
        'No prediction download with an empty fleet'
      );
      await page.getByRole('button', { name: 'Comunidad', exact: true }).click();
      await expect(page.getByText('Aún no hay reportes aquí.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click();
      await page.getByRole('button', { name: 'Crear una cuenta', exact: true }).click();
      await page.getByLabel('Tu nombre', { exact: true }).fill('Prueba sin señal');
      await page.getByLabel('Correo electrónico').fill('offline-isolated@example.test');
      await page
        .locator('.community-root')
        .getByLabel('Contraseña', { exact: true })
        .fill('isolated-offline-password-123');
      await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Prueba sin señal', exact: true })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Reportes', exact: true }).click();
      await expect(page.getByText('Aún no hay reportes aquí.', { exact: false })).toBeVisible();
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Tu comunidad', exact: true })).toBeVisible();
      await expect(page.getByText('Sin señal', { exact: false }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Nuevo reporte', exact: true }).click();
      await page.getByLabel('Tipo de problema').selectOption('bache');
      await page.getByLabel('¿Qué está pasando?').fill('Reporte offline en base de datos aislada');
      await page.getByLabel('Colonia o referencia').fill('Centro');
      await page.getByRole('button', { name: 'Elegir en el mapa', exact: true }).click();
      await page.locator('dialog .community-map').click({ position: { x: 65, y: 100 } });
      await page.getByRole('button', { name: 'Revisar reporte', exact: true }).click();
      await page.getByRole('button', { name: 'Confirmar y enviar', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM reportes').get().n, 0);
      const drafts = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('las-palmas-community', 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise((resolve) => {
            const r = db.transaction('reports').objectStore('reports').getAll();
            r.onsuccess = () => resolve(r.result.length);
          });
        } finally {
          db.close();
        }
      });
      assert.equal(drafts, 1);
      await page.getByRole('button', { name: 'Volver a transporte', exact: true }).click();
      await openSection(page, 'Buscar viaje');
      await expect(page.locator('#origin')).toBeVisible();
      await expect(page.locator('.passenger-content .offline-notice')).toBeVisible();
      await openSection(page, 'Rutas');
      await expect(page.locator('.route-card')).toHaveCount(8);
      await expect(page.locator('#map .traffic-signal-marker')).toHaveCount(33);
      await page.getByRole('button', { name: 'Soy un chofer', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Ingresar como chofer', exact: true })
      ).toBeDisabled();
      const keys = await page.evaluate(async () => {
        const names = await caches.keys();
        return (
          await Promise.all(
            names
              .filter((n) => n.startsWith('las-palmas-'))
              .map(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url))
          )
        ).flat();
      });
      assert.ok(
        !keys.some((u) =>
          /\/api\/(auth|driver|fleet|events|admin)|community\/(auth|admin|mis-)/.test(u)
        )
      );
      await context.setOffline(false);
      await page.getByRole('button', { name: 'Volver a viajar como pasajero' }).click();
      await page.getByRole('button', { name: 'Comunidad', exact: true }).click();
      await expect
        .poll(() => store.db.prepare('SELECT count(*) AS n FROM reportes').get().n)
        .toBe(1);
      await page.reload();
      await expect(page.getByTestId('community-report')).toContainText('Reporte offline');
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM reportes').get().n, 1);
      await page.evaluate(() => {
        const version = '9.9.0';
        localStorage.setItem(
          'las-palmas.latest-release',
          JSON.stringify({
            version,
            minimumVersion: version,
            minimumWebVersion: version,
            notes: ['Actualización obligatoria de prueba aislada'],
            releaseUrl: `https://github.com/ManexG/Hackaton2.0/releases/tag/v${version}`,
            downloadUrl: `https://github.com/ManexG/Hackaton2.0/releases/download/v${version}/Las-Palmas-Rutas.apk`,
          })
        );
      });
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Actualiza para continuar' })).toBeVisible();
      await expect(page.locator('#origin')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Actualizar ahora', exact: true })
      ).toBeDisabled();
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          offlineMapAndSignals: true,
          offlineReportSyncedOnce: true,
          privateApiNeverCached: true,
          mandatoryUpdateSurvivesOffline: true,
          noModelOrCameraStartupDownload: true,
        })
      );
      await context.close();
    } finally {
      await browser.close();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
  }
);
