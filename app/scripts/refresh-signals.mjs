import { writeFile } from 'node:fs/promises';
import network from '../public/data/network.demo.json' with { type: 'json' };
import { insideCoverage } from '../src/planner.js';
const bounds = network.coverage.bounds;
const bbox = [...bounds[0], ...bounds[1]].join(',');
const query = `[out:json][timeout:25];(node["highway"="traffic_signals"](${bbox});node["crossing"="traffic_signals"](${bbox}););out body;`;
const response = await fetch(
  'https://overpass-api.de/api/interpreter?' + new URLSearchParams({ data: query }),
  {
    headers: { 'User-Agent': 'OptiRouteLZC/1.8 (https://github.com/ManexG/Hackaton2.0)' },
    signal: AbortSignal.timeout(35000),
  }
);
if (!response.ok)
  throw new Error(`OpenStreetMap/Overpass: ${response.status}. Se conserva el catálogo anterior.`);
const raw = await response.json();
if (!Array.isArray(raw.elements) || raw.remark)
  throw new Error('Respuesta incompleta. Se conserva el catálogo anterior.');
const signals = raw.elements
  .filter((n) => n.type === 'node' && insideCoverage([n.lat, n.lon], network))
  .map((n) => ({
    id: `osm-node-${n.id}`,
    point: [n.lat, n.lon],
    name: n.tags?.name || 'Semáforo',
    osmUrl: `https://www.openstreetmap.org/node/${n.id}`,
  }));
await writeFile(
  new URL('../src/data/traffic-signals.osm.json', import.meta.url),
  JSON.stringify({
    source: 'OpenStreetMap',
    license: 'ODbL',
    sourceUrl: 'https://www.openstreetmap.org/copyright',
    bounds,
    snapshot: new Date().toISOString(),
    signals,
  })
);
console.log(`${signals.length} semáforos. Esta consulta la realiza el equipo, no cada teléfono.`);
