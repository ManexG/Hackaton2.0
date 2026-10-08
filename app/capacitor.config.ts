import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.cerca.combis.demo',
  appName: 'Cerca · Combis',
  webDir: 'dist',
  backgroundColor: '#f7f9f6',
  appendUserAgent: ' CercaDemo/1.2 (mx.cerca.combis.demo)',
  android: { backgroundColor: '#f7f9f6', allowMixedContent: false },
  plugins: { SystemBars: { style: 'LIGHT' } },
};

export default config;
