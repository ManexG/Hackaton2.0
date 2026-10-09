import '@fontsource-variable/manrope';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './live.css';
import './accessible.css';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CercaApp } from './App.jsx';
import { insideCoverage, validateNetwork } from './planner.js';
import { installEtaModel } from './etaModel.js';
function Bootstrap() {
  const [network, setNetwork] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const modelController = new AbortController();
    const modelTimeout = setTimeout(() => modelController.abort(), 4000);
    const modelPromise = fetch('./data/eta-model.json', { signal: modelController.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(installEtaModel)
      .catch(() => false)
      .finally(() => clearTimeout(modelTimeout));
    Promise.all([
      fetch('./data/network.demo.json', { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error('No se pudieron cargar las rutas.');
        return r.json();
      }),
      fetch('./data/places.osm.json', { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar el catálogo de lugares.');
        return r.json();
      }),
      modelPromise,
    ])
      .then(([routes, places]) => {
        validateNetwork(routes);
        const combined = {
          ...routes,
          places: [
            ...routes.places,
            ...places.places.filter((place) => insideCoverage(place.point, routes)),
          ],
        };
        validateNetwork(combined);
        setNetwork(combined);
        setCatalog(places);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'No pudimos iniciar la app.');
      });
    return () => {
      controller.abort();
      modelController.abort();
      clearTimeout(modelTimeout);
    };
  }, []);
  if (error)
    return (
      <div className="fatal-error">
        <h1>No pudimos iniciar Las Palmas Rutas</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>Volver a intentar</button>
      </div>
    );
  if (!network || !catalog) return <div className="boot">Cargando lugares y rutas…</div>;
  return <CercaApp network={network} catalog={catalog} />;
}
createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>
);
