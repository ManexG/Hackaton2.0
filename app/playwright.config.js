import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5184',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: { channel: process.env.CI ? undefined : 'msedge' },
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
