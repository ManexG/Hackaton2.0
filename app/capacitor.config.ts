import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.cerca.combis.demo',
  appName: 'Las Palmas Rutas',
  webDir: 'dist',
  backgroundColor: '#f7f9f6',
  appendUserAgent: ' LasPalmasRutas/1.4 (mx.cerca.combis.demo)',
  android: { backgroundColor: '#f7f9f6', allowMixedContent: false },
  plugins: { SystemBars: { style: 'LIGHT' } },
};

export default config;
