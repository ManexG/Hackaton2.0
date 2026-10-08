import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TransitStore } from './store';
import type { Network } from '../src/types';

const { values } = parseArgs({ options: { name: { type: 'string' }, email: { type: 'string' }, unit: { type: 'string' }, route: { type: 'string' }, days: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } } });
if (!values.name || !values.email || !values.unit || !values.route || !values.days || !values.start || !values.end) {
  console.error('Uso: npm run driver:create -- --name "Nombre" --email correo --unit C-01 --route R01 --days 1,2,3,4,5 --start 06:00 --end 22:00\nDías: 0 domingo, 1 lunes, …, 6 sábado. Esta operación crea o actualiza la cuenta y asignación.'); process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const network = JSON.parse(readFileSync(resolve(root, 'public/data/network.demo.json'), 'utf8')) as Network;
const store = new TransitStore(process.env.DATABASE_PATH ?? resolve(root, 'data/cerca.sqlite'), network);
try {
  const password = randomBytes(18).toString('base64url');
  const driver = store.provision({ name: values.name, email: values.email, unit: values.unit, routeId: values.route, windows: [{ days: values.days.split(',').map(Number), start: values.start, end: values.end }], password });
  console.log(`Cuenta preparada: ${driver.email}\nRuta: ${driver.routeId} · unidad: ${driver.unit}\nContraseña inicial: ${password}\nEntrega esta contraseña únicamente al chofer. No la guardes en Git.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'No se pudo crear la cuenta.'); process.exitCode = 1; }
finally { store.close(); }
