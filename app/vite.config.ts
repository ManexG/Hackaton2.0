import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/android/**', '**/test-results/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 750 },
});
