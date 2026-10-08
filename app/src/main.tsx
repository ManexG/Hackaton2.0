import '@fontsource-variable/manrope';
import 'leaflet/dist/leaflet.css';
import './style.css';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CercaApp } from './App';
import { insideCoverage, validateNetwork } from './planner';
import type { Network, PlaceCatalog } from './types';

function Bootstrap() {
  const [network, setNetwork] = useState<Network | null>(null);
  const [catalog, setCatalog] = useState<PlaceCatalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('./data/network.demo.json', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('No se pudieron cargar las rutas.'); return r.json() as Promise<Network>; }),
      fetch('./data/places.osm.json', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('No se pudo cargar el catálogo de lugares.'); return r.json() as Promise<PlaceCatalog>; }),
    ]).then(([routes, places]) => {
      validateNetwork(routes);
      const combined = { ...routes, places: [...routes.places, ...places.places.filter(place => insideCoverage(place.point, routes))] };
      validateNetwork(combined); setNetwork(combined); setCatalog(places);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No pudimos iniciar la app.'); });
    return () => controller.abort();
  }, []);
  if (error) return <div className="fatal-error"><h1>No pudimos iniciar Cerca</h1><p>{error}</p><button onClick={() => location.reload()}>Volver a intentar</button></div>;
  if (!network || !catalog) return <div className="boot">Cargando lugares y rutas…</div>;
  return <CercaApp network={network} catalog={catalog} />;
}

createRoot(document.getElementById('app')!).render(<React.StrictMode><Bootstrap /></React.StrictMode>);
