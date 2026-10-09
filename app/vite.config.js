import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { offlinePlugin } from './offline-plugin.js';
export default defineConfig({
  base: './',
  plugins: [react(), offlinePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8787' },
    watch: { ignored: ['**/android/**', '**/test-results/**', '**/data/*.sqlite*'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 750 },
});
