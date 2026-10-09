import { defineConfig } from '@playwright/test';

// Navegador de las pruebas. Por defecto se usa el Chromium que trae Playwright,
// que funciona igual en Windows, macOS y Linux. Antes estaba fijado a `msedge`
// fuera de CI, así que en Linux y macOS las seis pruebas de UI no se podían
// ejecutar en absoluto. Para usar Microsoft Edge:
//   PLAYWRIGHT_CHANNEL=msedge npm run test:ui
// Para ver la prueba en pantalla (no headless): PWDEBUG=1 npm run test:ui
const canal = process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {};

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5184',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: canal,
  },
  reporter: 'list',
  webServer: [
    {
      command: 'node tests/support/ui-server.mjs',
      url: 'http://127.0.0.1:5185/api/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5184',
      url: 'http://127.0.0.1:5184',
      reuseExistingServer: false,
      env: {
        VITE_PUBLIC_API_URL: '/api',
        VITE_PUBLIC_APP_URL: 'http://127.0.0.1:5184/',
        VITE_DEV_API_PROXY: 'http://127.0.0.1:5185',
      },
    },
  ],
});
