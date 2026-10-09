import { openCommunity, openField, openSection } from '../support/travel.js';
import { test, expect } from '@playwright/test';
import { createTransitServer } from '../../server/index.js';
import { readFileSync } from 'node:fs';
let service, backend;
const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  service = createTransitServer({
    releaseFetcher: async () => new Response(null, { status: 404 }),
    dbPath: ':memory:',
    adminToken: 'isolated-ui-community-admin',
    allowedOrigins: ['http://127.0.0.1:5184'],
  });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  service.admin.createAdmin({
    name: 'Community admin UI',
    email: 'community-admin-ui@example.test',
    password: 'isolated-ui-community-admin',
  });
  backend = `http://127.0.0.1:${service.server.address().port}`;
  await page.addInitScript(() => {
    class Events extends EventTarget {
      close() {}
    }
    window.EventSource = Events;
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/events')) return route.abort();
    const response = await route.fetch({ url: backend + url.pathname + url.search });
    try {
      await route.fulfill({ response });
    } catch (error) {
      // Reload can cancel an intercepted request before the backend returns.
      if (!error.message.includes('Route is already handled')) throw error;
    }
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await openCommunity(page);
  await expect(page.getByRole('heading', { name: 'Tu comunidad', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.close();
  await new Promise((resolve) => {
    service.server.close(resolve);
    service.server.closeAllConnections();
  });
  expect(errors).toEqual([]);
});
async function signup(page) {
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click();
  await page.getByRole('button', { name: 'Crear una cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Vecina UI');
  await page.getByLabel('Correo electrónico').fill('community-ui@example.test');
  await page
    .locator('.community-root')
    .getByLabel('Contraseña', { exact: true })
    .fill('community-ui-password-123');
  await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vecina UI', exact: true })).toBeVisible();
}
test('guest community is optional, navigation returns to transport, and mobile layout stays bounded', async ({
  page,
}) => {
  await expect(page.getByText('Aún no hay reportes aquí.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo reporte', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('necesitas una cuenta');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Mapa', exact: true }).click();
  await expect(page.locator('.community-map .flat-street-name').first()).toBeVisible();
  const streetLayer = page.locator('.community-map .leaflet-localMap-pane > svg');
  await expect(streetLayer).toHaveCount(1);
  expect(
    await streetLayer.evaluate(
      (svg) => svg.getBoundingClientRect().width >= svg.closest('.community-map').clientWidth
    )
  ).toBe(true);
  await expect(page.locator('.community-map .leaflet-tile')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      streetLayer.evaluate(
        (svg) => svg.getBoundingClientRect().width >= svg.closest('.community-map').clientWidth
      )
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Volver a transporte', exact: true }).click();
  await expect(page.locator('#origin')).toBeVisible();
});
test('neighbor can submit an actual report, support once, comment, and see it in their profile', async ({
  page,
  context,
}) => {
  await signup(page);
  await page.getByRole('button', { name: 'Reportes', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo reporte', exact: true }).click();
  await page.getByLabel('Tipo de problema').selectOption('bache');
  await page.getByLabel('¿Qué está pasando?').fill('Bache visible junto a la parada de prueba');
  await page.getByLabel('Colonia o referencia').fill('Centro');
  await page
    .getByLabel('Foto del problema (opcional)')
    .setInputFiles('public/brand/las-palmas-icon.png');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 17.96, longitude: -102.197 });
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: { features: [] } })
  );
  await page.getByRole('button', { name: 'Usar mi ubicación', exact: true }).click();
  await expect(page.getByText('Ubicación elegida', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar reporte', exact: true }).click();
  await expect(page.getByAltText('Foto que enviarás')).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByLabel('¿Qué está pasando?')).toHaveValue(
    'Bache visible junto a la parada de prueba'
  );
  await expect(page.getByLabel('Tipo de problema')).toHaveValue('bache');
  await page.getByRole('button', { name: 'Revisar reporte', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar y enviar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('community-report')).toContainText('Bache visible');
  await page.getByRole('button', { name: 'Apoyar (0)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apoyar (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apoyar (1)', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ya apoyaste' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver detalle', exact: true }).click();
  await page.getByLabel('Escribe un comentario').fill('Yo también lo vi en esa calle.');
  await page.getByRole('button', { name: 'Publicar comentario', exact: true }).click();
  await expect(page.locator('.community-comment')).toContainText('Yo también lo vi');
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mis reportes', exact: true })).toBeVisible();
  await expect(page.getByTestId('community-report')).toHaveCount(2);
});

test('operator imports a bounded route into the travel map and generates its QR', async ({
  page,
}) => {
  await page.evaluate(() => {
    location.hash = '/admin';
  });
  await expect(
    page.getByRole('heading', { name: 'Acceso de administración', exact: true })
  ).toBeVisible();
  await page.locator('.admin-login').getByLabel('Correo').fill('community-admin-ui@example.test');
  await page.locator('.admin-login').getByLabel('Contraseña').fill('isolated-ui-community-admin');
  await page.locator('.admin-login').getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reportes y paradas', exact: true })
  ).toBeVisible();
  const network = JSON.parse(readFileSync('public/data/network.demo.json', 'utf8'));
  const source = network.routes[0];
  const data = {
    rutas: [
      {
        nombre: 'Ruta importada UI',
        color: '#2266bb',
        fuente: 'Prueba aislada',
        trazo: source.segments.flat(),
        paradas: source.stops.map((id, orden) => {
          const stop = network.stops.find((s) => s.id === id);
          return {
            nombre: stop.name,
            lat: stop.point[0],
            lng: stop.point[1],
            orden,
            qr: `UI-QR-${orden}`,
          };
        }),
      },
    ],
  };
  await page.getByLabel('Archivo JSON del equipo').setInputFiles({
    name: 'ruta.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole('button', { name: 'Cargar datos', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Datos cargados' })).toBeVisible();
  await expect(
    page.locator('.community-root').getByText('Ruta importada UI', { exact: true })
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Parada', exact: true }).selectOption('AXS1');
  await expect(page.locator('.community-qr img')).toBeVisible();
  await expect(page.locator('.community-qr')).toContainText('?stop=AXS1');
  await page.locator('.admin-top').getByRole('button', { name: 'Mapa', exact: true }).click();
  await openSection(page, 'Rutas');
  await expect(page.getByText('Ruta importada UI', { exact: true })).toBeVisible();
  await page.goto('/#/parada/UI-QR-0');
  await expect(page).toHaveURL(/\?stop=AXS1/);
  await expect(page.getByRole('heading', { name: 'Jugos Acapulco', exact: true })).toBeVisible();
});

test('fieldwork saves points, accessibility observations and timed counts', async ({ page }) => {
  await signup(page);
  await page.evaluate(() => {
    location.hash = '/campo';
  });
  await expect(page.getByRole('heading', { name: 'Trabajo de campo', exact: true })).toBeVisible();
  await page.locator('.community-map').click();
  const pointForm = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Guardar punto', exact: true }) });
  await pointForm.getByLabel('Nombre', { exact: true }).fill('Cruce observado UI');
  await pointForm.getByLabel('Fuente', { exact: true }).fill('Visita de campo de prueba');
  await page.getByRole('button', { name: 'Guardar punto', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Punto', exact: true }).locator('option')
  ).toHaveCount(2);
  await page
    .getByRole('combobox', { name: 'Punto', exact: true })
    .selectOption({ label: 'Cruce observado UI' });
  await page.getByRole('combobox', { name: 'Condición', exact: true }).selectOption('rampa');
  await page.getByLabel('Detalle', { exact: true }).fill('Falta rampa junto al cruce');
  await page.getByRole('button', { name: 'Guardar observación', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Observaciones registradas (1)', exact: true })
  ).toBeVisible();
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-08');
  await page.getByLabel('Hora', { exact: true }).fill('10:00');
  await page.getByLabel('Cantidad', { exact: true }).fill('12');
  await page.getByLabel('Duración en minutos', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Guardar conteo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Conteos registrados (1)', exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Conteos registrados (1)', exact: true })
  ).toBeVisible();
});
test('offline drafts survive reload and are sent once when connection returns', async ({
  page,
}) => {
  await signup(page);
  await page.route('**/api/community/**', (route) => route.abort());
  await page.evaluate(async () => {
    const { enqueue } = await import('/src/community/queue.js');
    await enqueue({
      categoria: 'basura',
      descripcion: 'Borrador offline de prueba',
      colonia: 'Centro',
      lat: 17.96,
      lng: -102.197,
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vecina UI', exact: true })).toBeVisible();
  expect((await (await fetch(backend + '/api/community/reportes')).json()).length).toBe(0);
  await page.unroute('**/api/community/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await (await fetch(backend + '/api/community/reportes')).json()).length)
    .toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vecina UI', exact: true })).toBeVisible();
  expect((await (await fetch(backend + '/api/community/reportes')).json()).length).toBe(1);
});
