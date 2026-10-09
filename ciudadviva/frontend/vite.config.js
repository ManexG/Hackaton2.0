import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// La API la sirve el Worker de Cloudflare (wrangler dev en el puerto 8787).
// En desarrollo hacemos proxy para que el navegador nunca haga peticiones cross-origin:
// todo queda en el mismo origen (localhost:5173) y el código es idéntico al de producción.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Solo la API se proxea. Las rutas (/, /perfil, /reporte/:id, /admin) las
    // resuelve React Router en el cliente; Vite devuelve index.html al pedir
    // cualquier ruta desconocida, así que recargar una URL profunda funciona.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});