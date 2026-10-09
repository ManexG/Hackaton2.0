import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    watch: { ignored: ['**/android/**', '**/test-results/**', '**/data/*.sqlite*'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 750 },
});
