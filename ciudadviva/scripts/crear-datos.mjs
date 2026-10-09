// scripts/crear-datos.mjs
// Carga la zona piloto, las rutas y sus paradas al backend usando la clave de admin.
//   ADMIN_KEY=... npm run datos
// Los datos salen de los .json en scripts/datos/ (ver LEEME.md ahí).
// Los archivos que empiezan con EJEMPLO se saltan.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL || 'http://localhost:8787';
const KEY = process.env.ADMIN_KEY;
const CARPETA = join(dirname(fileURLToPath(import.meta.url)), 'datos');

if (!KEY) {
  console.error('Falta ADMIN_KEY. Ejemplo: ADMIN_KEY=dev123 npm run datos');
  process.exit(1);
}

async function pedir(ruta) {
  const res = await fetch(API + ruta);
  if (!res.ok) throw new Error(`GET ${ruta} -> ${res.status}`);
  return res.json();
}

async function enviar(ruta, cuerpo) {
  const res = await fetch(API + ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
    body: JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${ruta} -> ${res.status}: ${texto}`);
  return JSON.parse(texto);
}

async function principal() {
  const archivos = (await readdir(CARPETA))
    .filter((f) => f.endsWith('.json') && !f.startsWith('EJEMPLO'))
    .sort();

  for (const archivo of archivos) {
    const datos = JSON.parse(await readFile(join(CARPETA, archivo), 'utf8'));

    // Formato esperado: ver LEEME.md en esta carpeta.

    // Evita duplicados si se corre el script dos veces con el mismo archivo.
    const existentes = await pedir('/api/rutas');
    const nombresYaCargados = new Set(existentes.map((r) => r.nombre.toLowerCase()));

    if (datos.zona && !(await pedir('/api/zona'))) {
      const z = await enviar('/api/admin/zona', datos.zona);
      console.log(`zona "${datos.zona.nombre}" -> id ${z.id}`);
    }

    for (const ruta of datos.rutas ?? []) {
      if (nombresYaCargados.has(ruta.nombre.toLowerCase())) {
        console.log(`ruta "${ruta.nombre}" ya existe: se omite`);
        continue;
      }
      const { paradas, ...rutaSinParadas } = ruta;
      const creada = await enviar('/api/admin/rutas', rutaSinParadas);
      console.log(`ruta "${ruta.nombre}" -> id ${creada.id}`);

      if (Array.isArray(paradas) && paradas.length) {
        const r = await enviar('/api/admin/paradas', { ruta_id: creada.id, paradas });
        console.log(`  ${r.guardadas} paradas`);
        // Trazado por calles reales: las paradas ordenadas son la fuente de verdad
        // y el backend calcula el recorrido con OSRM. Si falla, la ruta se queda
        // sin trazo en vez de dibujar una línea recta que atraviesa manzanas.
        console.log('  ajustando el trazo a las calles...');
        try {
          const t = await enviar(`/api/admin/rutas/${creada.id}/trazar`, {});
          console.log(`  trazo: ${t.puntos} puntos, ${t.distancia_m.toLocaleString('es-MX')} m por calles`);
          for (const a of t.ajustes) {
            console.log(`    parada ${a.nombre}: movida ${a.ajuste_m} m al asfalto`);
          }
          if (t.advertencia) console.log(`  AVISO: ${t.advertencia}`);
        } catch (e) {
          console.warn(`  NO SE PUDO TRAZAR: ${e.message}`);
          console.warn('  La ruta quedó sin trazo: el mapa no dibujará su línea.');
        }
      }
    }
  }

  console.log('Listo.');
}

principal().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});