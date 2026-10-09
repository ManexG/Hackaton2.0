import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createTransitServer } from '../../server/index';
import type { TransitStore } from '../../server/store';
import type { Network } from '../../src/types';
const network = JSON.parse(readFileSync(new URL('../../public/data/network.demo.json', import.meta.url), 'utf8')) as Network;
const firstStop = network.stops.find(stop => stop.id === network.routes[0].stops[0])!;
const account = { name: 'Chofer de prueba', email: 'ui-driver@example.test', password: 'only-for-ui-test-12345', unit: 'TEST-UI-01', routeId: 'R01', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '12:00' }, { days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '00:00' }] };
let server: Server, store: TransitStore, backend: string;
async function connect(page: Page) {
  await page.addInitScript(url => {
    const Original = window.EventSource;
    class RoutedEvents extends Original { constructor(path: string | URL, options?: EventSourceInit) { super(String(path).startsWith('/api/') ? url + path : path, options); } }
    Object.assign(window, { EventSource: RoutedEvents });
  }, backend);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/events')) { await route.continue(); return; }
    const response = await route.fetch({ url: backend + url.pathname + url.search });
    await route.fulfill({ response });
  });
}
async function choose(page: Page, field: string, query: string) { await page.locator(`#${field}`).fill(query); await page.locator('#suggestions [role=option]').first().click(); }
test.beforeEach(async ({ page }) => {
  const service = createTransitServer({ dbPath: ':memory:', publicAppUrl: 'http://127.0.0.1:5184/', allowedOrigins: ['http://127.0.0.1:5184'] });
  server = service.server; store = service.store;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  backend = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await connect(page); await page.goto('/'); await expect(page.locator('.fleet-status')).toContainText('0 combis en servicio');
});
test.afterEach(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });

test('guest needs no account, sees no invented drivers or default recommendations, and can explore routes', async ({ page }) => {
  await expect(page.locator('.bus-marker')).toHaveCount(0);
  await choose(page, 'origin', 'Jugos Acapulco'); await choose(page, 'destination', 'Entronque av');
  await expect(page.locator('.journey-card')).toHaveCount(0); await expect(page.locator('.empty-state')).toContainText('No hay un viaje disponible ahora');
  await page.locator('.map-legend [data-route=R01]').click(); await expect(page.locator('.route-hours')).toContainText('Horario pendiente de asignación');
  await expect(page.locator('#route-detail .stop-list')).toContainText('Jugos Acapulco');
  await page.screenshot({ path: '../cerca-servicio-sin-choferes.png' });
});
test('authenticated driver shares GPS through the real server and a guest immediately sees and loses the vehicle', async ({ page, context }) => {
  store.provision(account);
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: firstStop.point[0], longitude: firstStop.point[1], accuracy: 5 });
  const guest = await context.newPage(); await connect(guest); await guest.goto('/');
  await page.getByRole('button', { name: 'Soy chofer', exact: true }).click();
  await page.locator('#driver-email').fill(account.email); await page.locator('#driver-password').fill(account.password);
  await page.getByRole('button', { name: 'Ingresar como chofer', exact: true }).click();
  await expect(page.locator('.driver-assignment')).toContainText('R01'); await expect(page.locator('.driver-assignment')).toContainText(account.unit);
  await page.getByRole('button', { name: 'Activar mi servicio', exact: true }).click();
  await expect(page.locator('.driver-service-state')).toContainText('Tu combi está en servicio');
  await expect(guest.locator('.fleet-status')).toContainText('1 combi en servicio'); await expect(guest.locator('.bus-marker')).toHaveCount(1);
  await choose(guest, 'origin', 'Jugos Acapulco'); await choose(guest, 'destination', 'Entronque av'); await expect(guest.locator('.journey-card.selected')).toContainText('R01');
  await page.screenshot({ path: '../cerca-chofer-gps.png' });
  await page.waitForTimeout(5100);
  const moved = network.routes[0].segments[0][Math.min(12, network.routes[0].segments[0].length - 1)];
  await context.setGeolocation({ latitude: moved[0], longitude: moved[1], accuracy: 5 });
  await expect.poll(() => store.snapshot().vehicles[0]?.point[0]).toBe(moved[0]);
  await page.getByRole('button', { name: 'Desactivar servicio', exact: true }).click();
  await expect(guest.locator('.fleet-status')).toContainText('0 combis en servicio'); await expect(guest.locator('.bus-marker')).toHaveCount(0); await expect(guest.locator('.journey-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click(); await expect(page.locator('#driver-email')).toBeVisible();
  await guest.close();
});
test('QR web link centers a known stop, selects it as origin and creates a downloadable code', async ({ page }) => {
  await page.goto(`/?stop=${firstStop.id}`); await expect(page.locator('#stops-panel')).toBeVisible();
  await expect(page.locator('#stop-select')).toHaveValue(firstStop.id); await expect(page.locator('#origin')).toHaveValue(firstStop.name);
  await expect(page.locator('.focused-stop')).toHaveCount(1); await expect(page.locator('.service-empty')).toContainText('No hay una combi activa');
  await page.locator('.stop-qr summary').click(); await expect(page.locator('.stop-qr img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('.stop-link')).toHaveAttribute('href', new RegExp(`stop=${firstStop.id}`));
  await page.screenshot({ path: '../cerca-parada-qr.png' });
});
test('voice text uses the same street and address search without selecting an arbitrary destination', async ({ page }) => {
  await page.evaluate(() => {
    class TestVoice { onresult: ((event: unknown) => void) | null = null; onend: (() => void) | null = null; start() { this.onresult?.({ results: { 0: { 0: { transcript: 'Avenida Reforma 534' } } } }); this.onend?.(); } abort() {} }
    Object.assign(window, { SpeechRecognition: TestVoice });
  });
  await page.getByRole('button', { name: 'Dictar destino', exact: true }).click();
  await expect(page.locator('#destination')).toHaveValue('Avenida Reforma 534'); await expect(page.locator('#suggestions')).toContainText('Avenida Reforma #534');
  await expect(page.locator('.journey-card')).toHaveCount(0);
});
test('mobile guest can enter and leave driver access without mandatory registration or horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Abrir buscador lateral' }).click();
  await page.getByRole('button', { name: 'Soy chofer', exact: true }).click(); await expect(page.locator('#driver-email')).toBeVisible();
  await page.screenshot({ path: '../cerca-android-acceso.png' });
  await page.getByRole('button', { name: 'Soy pasajero', exact: true }).click(); await expect(page.locator('.plan-welcome')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
