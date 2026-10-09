import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TransitStore } from './store.js';
import { AdminCore } from './admin-core.js';
// Crea el PRIMER administrador (los siguientes se dan de alta desde el panel).
// CLOUDFLARE: pendiente un equivalente remoto; ver CLOUDFLARE-ADMIN.md (bootstrap del primer admin).
const { values } = parseArgs({
  options: { name: { type: 'string' }, email: { type: 'string' } },
});
if (!values.name || !values.email) {
  console.error('Uso: npm run admin:create -- --name "Nombre" --email correo@dominio.mx');
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const network = JSON.parse(readFileSync(resolve(root, 'public/data/network.demo.json'), 'utf8'));
const store = new TransitStore(
  process.env.DATABASE_PATH ?? resolve(root, 'data/cerca.sqlite'),
  network
);
try {
  const admin = new AdminCore(store.db, network, store);
  const password = randomBytes(18).toString('base64url');
  const created = admin.createAdmin({ name: values.name, email: values.email, password });
  console.log(
    `Administrador creado: ${created.email}\nContraseña inicial: ${password}\nCámbiala al entrar. No la guardes en Git.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo crear el administrador.');
  process.exitCode = 1;
} finally {
  store.close();
}
