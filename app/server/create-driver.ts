import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TransitStore } from './store';
import type { Network } from '../src/types';

const { values } = parseArgs({ options: { name: { type: 'string' }, email: { type: 'string' }, unit: { type: 'string' }, route: { type: 'string' }, days: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, cloudflare: { type: 'boolean' } } });
if (!values.name || !values.email || !values.unit || !values.route || !values.days || !values.start || !values.end) {
  console.error('Uso: npm run driver:create -- --name "Nombre" --email correo --unit C-01 --route R01 --days 1,2,3,4,5 --start 06:00 --end 22:00\nDías: 0 domingo, 1 lunes, …, 6 sábado. Esta operación crea o actualiza la cuenta y asignación.'); process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const network = JSON.parse(readFileSync(resolve(root, 'public/data/network.demo.json'), 'utf8')) as Network;
const store = values.cloudflare ? null : new TransitStore(process.env.DATABASE_PATH ?? resolve(root, 'data/cerca.sqlite'), network);
try {
  const password = randomBytes(18).toString('base64url');
  const assignment = { name: values.name, email: values.email, unit: values.unit, routeId: values.route, windows: [{ days: values.days.split(',').map(Number), start: values.start, end: values.end }], password };
  let driver;
  if (values.cloudflare) {
    const base = process.env.VITE_PUBLIC_API_URL?.replace(/\/$/, ''), admin = process.env.CERCA_ADMIN_TOKEN;
    if (!base || new URL(base).protocol !== 'https:' || !admin) throw new Error('Configura VITE_PUBLIC_API_URL y CERCA_ADMIN_TOKEN en tu .env privado.');
    const response = await fetch(base + '/admin/drivers', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` }, body: JSON.stringify(assignment), signal: AbortSignal.timeout(20_000) });
    const result = await response.json() as { email: string; routeId: string; unit: string; message?: string };
    if (!response.ok) throw new Error(result.message ?? 'No se pudo crear la cuenta en Cloudflare.');
    driver = result;
  } else driver = store!.provision(assignment);
  console.log(`Cuenta preparada: ${driver.email}\nRuta: ${driver.routeId} · unidad: ${driver.unit}\nContraseña inicial: ${password}\nEntrega esta contraseña únicamente al chofer. No la guardes en Git.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'No se pudo crear la cuenta.'); process.exitCode = 1; }
finally { store?.close(); }
