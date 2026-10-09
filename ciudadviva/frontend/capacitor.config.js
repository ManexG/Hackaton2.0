/**
 * capacitor.config.js — para el empaquetado nativo (FASE 2, no ahora).
 *
 * Ahora la app funciona como PWA y ya se puede instalar desde el navegador.
 * Cuando decidamos el build nativo, se ejecuta:
 *
 *   npm i -D @capacitor/cli
 *   npx cap init
 *   npm run build && npx cap add android && npx cap sync && npx cap open android
 *
 * Importante: `webDir` apunta a dist/, que es el build de Vite. No hay que
 * cambiar nada del código de la app: es el mismo.
 */

export default {
  appId: 'mx.lazaro.cardenas.lcalerta',
  appName: 'LCAlerta',
  webDir: 'dist',
  server: {
    // En desarrollo se puede apuntar al servidor local:
    // url: 'http://192.168.0.10:5173',
    // cleartext: true,
  },
};