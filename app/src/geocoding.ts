import { insideCoverage, normalize } from './planner';
import type { Network, Place } from './types';

interface GeocoderResult {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
}
const cache = new Map<string, Place[]>();
let lastRequest = 0;
let queue: Promise<unknown> = Promise.resolve();

// Called only by an explicit search action. Keystroke suggestions never call this service.
export function geocodeInCoverage(query: string, network: Network, signal?: AbortSignal): Promise<Place[]> {
  const key = `${network.coverage.bounds.flat().join(',')}:${normalize(query)}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const operation = queue.catch(() => {}).then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    signal?.throwIfAborted();
    if (cache.has(key)) return cache.get(key)!;
    lastRequest = Date.now();
    const [[south, west], [north, east]] = network.coverage.bounds;
    const params = new URLSearchParams({ q: `${query}, ${network.city}, Michoacán, México`, format: 'jsonv2', addressdetails: '1', limit: '6', countrycodes: 'mx', viewbox: `${west},${north},${east},${south}`, bounded: '1', 'accept-language': 'es' });
    let response: Response;
    try {
      response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('La búsqueda en línea tardó demasiado o no hay conexión. Usa los lugares guardados o elige el punto en el mapa.');
    }
    if (!response.ok) throw new Error('La búsqueda en línea no está disponible. Usa el catálogo o el mapa.');
    const data: GeocoderResult[] = await response.json();
    if (!Array.isArray(data)) throw new Error('El buscador devolvió una respuesta no válida.');
    const places = data.flatMap(result => {
      const point: [number, number] = [Number(result.lat), Number(result.lon)];
      if (!insideCoverage(point, network)) return [];
      const address = result.address ?? {};
      const street = address.road ?? address.pedestrian ?? address.residential;
      const label = [street, address.house_number ? `#${address.house_number}` : ''].filter(Boolean).join(' ');
      return [{ id: `geocoder-${result.place_id}`, name: result.name || label || result.display_name.split(',')[0], address: label || undefined, description: [label, 'Resultado en línea · OpenStreetMap'].filter(Boolean).join(' · '), kind: address.house_number ? 'street' : 'business', point, demo: false, source: 'geocoder' } as Place];
    });
    cache.set(key, places);
    return places;
  });
  queue = operation;
  return operation;
}
