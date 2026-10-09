import { test, expect } from '@playwright/test';
import { APP_VERSION } from '../../src/version.js';
import { bundledRelease } from '../../server/releases.js';
const release = {
  ...bundledRelease(),
  version: '9.0.0',
  minimumVersion: '9.0.0',
  notes: ['Actualización nativa de prueba'],
  releaseUrl: 'https://github.com/ManexG/Hackaton2.0/releases/tag/v9.0.0',
  downloadUrl:
    'https://github.com/ManexG/Hackaton2.0/releases/download/v9.0.0/Las-Palmas-Rutas.apk',
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/version', (route) => route.fulfill({ json: release }));
  await page.addInitScript(
    ({ version }) => {
      window.androidBridge = {};
      window.nativeCalls = [];
      const methods = (names) =>
        names.map((name) => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' }));
      window.Capacitor = {
        PluginHeaders: [
          {
            name: 'NativeUpdate',
            methods: methods([
              'status',
              'download',
              'install',
              'cancel',
              'addListener',
              'removeListener',
            ]),
          },
          { name: 'App', methods: methods(['getInfo', 'addListener', 'removeListener']) },
        ],
        nativeCallback(plugin, method, _options, callback) {
          if (plugin === 'NativeUpdate' && method === 'addListener')
            window.nativeProgress = callback;
          return Promise.resolve('test-listener');
        },
        async nativePromise(plugin, method, options) {
          window.nativeCalls.push({ plugin, method, options });
          if (plugin === 'App') return { version };
          if (method === 'status') return { ready: false };
          if (method === 'download')
            return new Promise((resolve, reject) => {
              window.finishNativeDownload = () => resolve({ ready: true });
              window.rejectNativeDownload = () => reject(new Error('Descarga cancelada.'));
            });
          if (method === 'cancel') {
            window.rejectNativeDownload?.();
            return {};
          }
          if (method === 'install')
            throw new Error('Instalación cancelada. El archivo ya está descargado.');
          return {};
        },
      };
    },
    { version: APP_VERSION }
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Actualiza para continuar' })).toBeVisible();
});
test('Android downloads through the native bridge, shows progress and opens its installer without a browser', async ({
  page,
}) => {
  let popups = 0;
  page.on('popup', () => popups++);
  await expect(page.locator('a')).toHaveCount(0);
  await page.getByRole('button', { name: 'Actualizar ahora', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.nativeCalls.filter((call) => call.method === 'download').length)
    )
    .toBe(1);
  await page.evaluate(() =>
    window.nativeProgress({ stage: 'downloading', percent: 37, bytes: 370, total: 1000 })
  );
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '37');
  await expect(page.getByRole('button', { name: 'Actualizando…' })).toBeDisabled();
  await page.evaluate(() => window.finishNativeDownload());
  await expect(
    page.getByRole('button', { name: 'Instalar actualización', exact: true })
  ).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    window.dispatchEvent(new Event('offline'));
  });
  await page.getByRole('button', { name: 'Instalar actualización', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.nativeCalls.filter((call) => call.method === 'install').length)
    )
    .toBe(2);
  expect(
    await page.evaluate(
      () => window.nativeCalls.filter((call) => call.method === 'download').length
    )
  ).toBe(1);
  expect(popups).toBe(0);
  await expect(page.locator('#origin')).toHaveCount(0);
});
test('a canceled native download retains the update gate and can be retried', async ({ page }) => {
  await page.getByRole('button', { name: 'Actualizar ahora', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.nativeCalls.some((call) => call.method === 'download')))
    .toBe(true);
  await page.evaluate(() =>
    window.nativeProgress({ stage: 'downloading', percent: 20, bytes: 200, total: 1000 })
  );
  await page.getByRole('button', { name: 'Cancelar descarga' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Descarga cancelada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar ahora', exact: true })).toBeEnabled();
  await expect(page.locator('#origin')).toHaveCount(0);
});
