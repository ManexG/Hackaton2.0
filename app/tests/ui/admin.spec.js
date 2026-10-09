import { openField } from '../support/travel.js';
import { test, expect } from '@playwright/test';
import { createTransitServer } from '../../server/index.js';

const admin = {
  name: 'Admin UI',
  email: 'admin-ui@example.test',
  password: 'only-for-ui-admin-123',
};
let server, backend, browserErrors;

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const service = createTransitServer({
    releaseFetcher: async () => new Response(null, { status: 404 }),
    dbPath: ':memory:',
    publicAppUrl: 'http://127.0.0.1:5184/',
    allowedOrigins: ['http://127.0.0.1:5184'],
  });
  server = service.server;
  service.admin.createAdmin(admin);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  backend = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/events')) return route.abort();
    await route.fulfill({
      response: await route.fetch({ url: backend + url.pathname + url.search }),
    });
  });
  await page.goto('/#/gestion');
});
test.afterEach(async () => {
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  expect(browserErrors).toEqual([]);
});
const shell = (page) => page.locator('.admin-shell');
async function login(page) {
  await shell(page).getByLabel('Correo').fill(admin.email);
  await shell(page).getByLabel('Contraseña').fill(admin.password);
  await shell(page).getByRole('button', { name: 'Entrar' }).click();
  await expect(shell(page).getByRole('heading', { name: 'Rutas' })).toBeVisible();
}

test('admin logs in, lists demo routes, builds a route on the map, reorders and edits it', async ({
  page,
}) => {
  await shell(page).getByLabel('Correo').fill(admin.email);
  await shell(page).getByLabel('Contraseña').fill('contraseña-incorrecta');
  await shell(page).getByRole('button', { name: 'Entrar' }).click();
  await expect(shell(page).getByRole('alert')).toContainText('no coinciden');
  await login(page);
  const list = shell(page).locator('.admin-route-list li');
  await expect(list).toHaveCount(8);
  await expect(list.first()).toContainText('Corredor principal');

  await shell(page).getByRole('button', { name: 'Agregar' }).click();
  await shell(page).getByLabel('Nombre', { exact: true }).fill('Ruta de prueba');
  const map = page.locator('.admin-map');
  const box = await map.boundingBox();
  for (const [x, y] of [
    [0.3, 0.3],
    [0.5, 0.5],
    [0.7, 0.6],
  ])
    await map.click({ position: { x: box.width * x, y: box.height * y } });
  await expect(shell(page).locator('.admin-stops li')).toHaveCount(3);
  await expect(shell(page).locator('.admin-pin')).toHaveCount(3);
  // Orden: bajar la primera parada y comprobar que la lista cambia.
  const names = () =>
    shell(page)
      .locator('.admin-stops input')
      .evaluateAll((els) => els.map((el) => el.value));
  expect(await names()).toEqual(['Parada 1', 'Parada 2', 'Parada 3']);
  await shell(page).getByRole('button', { name: 'Bajar' }).first().click();
  expect(await names()).toEqual(['Parada 2', 'Parada 1', 'Parada 3']);
  // Arrastrar y soltar en la lista: la última pasa al inicio.
  await shell(page)
    .locator('.admin-stops li')
    .nth(2)
    .dragTo(shell(page).locator('.admin-stops li').nth(0));
  expect(await names()).toEqual(['Parada 3', 'Parada 2', 'Parada 1']);
  await shell(page).getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(list).toHaveCount(9);
  await expect(list.last()).toContainText('Ruta de prueba');
  await expect(list.last()).toContainText('3 paradas');
  // El pasajero ve la ruta nueva en la red pública.
  const network = await (await fetch(backend + '/api/network')).json();
  expect(network.routes.find((r) => r.name === 'Ruta de prueba').stops).toHaveLength(3);

  // Editar una ruta demo en la misma pestaña.
  await list
    .first()
    .getByRole('button', { name: /Editar/ })
    .click();
  await shell(page).getByLabel('Nombre', { exact: true }).fill('Corredor renombrado');
  await shell(page).getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(list.first()).toContainText('Corredor renombrado');
  await expect(list.first()).toContainText('demo editada');
  await shell(page).getByRole('button', { name: 'Restaurar original' }).click();
  await expect(list.first()).toContainText('Corredor principal');
  page.once('dialog', (dialog) => dialog.accept());
  await list
    .last()
    .getByRole('button', { name: /Borrar/ })
    .click();
  await expect(list).toHaveCount(8);
});

test('admin creates a driver (password shown once) and another administrator', async ({ page }) => {
  await login(page);
  await shell(page).getByRole('tab', { name: 'Choferes' }).click();
  await shell(page).getByRole('button', { name: 'Dar de alta' }).click();
  await shell(page).getByLabel('Nombre', { exact: true }).fill('Chofer UI');
  await shell(page).getByLabel('Correo').fill('chofer-ui@example.test');
  await shell(page).getByLabel('Unidad').fill('UI-01');
  await shell(page).getByRole('button', { name: 'Crear cuenta' }).click();
  const secret = shell(page).locator('.admin-secret code');
  await expect(secret).toBeVisible();
  const password = await secret.innerText();
  await expect(shell(page).locator('.admin-table')).toContainText('chofer-ui@example.test');
  const response = await fetch(backend + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'chofer-ui@example.test', password }),
  });
  expect(response.status).toBe(200);
  await shell(page).getByRole('tab', { name: 'Administradores' }).click();
  await shell(page).getByLabel('Nombre', { exact: true }).fill('Segundo Admin');
  await shell(page).getByLabel('Correo').fill('segundo@example.test');
  await shell(page)
    .getByLabel(/Contraseña inicial/)
    .fill('segunda-clave-larga-1');
  await shell(page).getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(shell(page).locator('.admin-people')).toContainText('Segundo Admin');
});
