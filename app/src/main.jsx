import './font.css';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './live.css';
import './accessible.css';
import './community/community.css';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot.jsx';
import { insideCoverage, validateNetwork } from './planner.js';
import { installEtaModel } from './etaModel.js';
import { Capacitor } from '@capacitor/core';
import { ConnectivityProvider } from './connectivity.jsx';
import { UpdateGate } from './UpdateGate.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import './reliability.css';
import './layout.css';
// Accept the URLs shared by the original Axel app and use one root shell.
if (
  /^\/(reporte\/\d+|parada\/[A-Za-z0-9-]+|admin|perfil|mapa|estadisticas|campo|avenida|chofer)\/?$/.test(
    location.pathname
  )
) {
  const path = location.pathname.replace(/\/$/, '');
  location.replace(path === '/chofer' ? '/?driver=1' : path === '/avenida' ? '/' : '/#' + path);
}
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
function Bootstrap() {
  const [network, setNetwork] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  async function refreshNetwork() {
    const base = (import.meta.env.VITE_PUBLIC_API_URL || '/api').replace(/\/$/, '');
    const response = await fetch(base + '/network', {
      cache: 'reload',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return;
    const routes = await response.json();
    validateNetwork(routes);
    setNetwork((current) => ({
      ...routes,
      places: [
        ...routes.places,
        ...current.places.filter(
          (p) => p.kind !== 'stop' && !routes.places.some((r) => r.id === p.id)
        ),
      ],
    }));
  }
  useEffect(() => {
    const controller = new AbortController();
    const modelController = new AbortController();
    let modelStarted = false;
    const loadModel = () => {
      if (modelStarted) return;
      modelStarted = true;
      fetch('./data/eta-model.json', { signal: modelController.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then(installEtaModel)
        .catch(() => false);
    };
    window.addEventListener('las-palmas-fleet-active', loadModel);
    Promise.all([
      fetch('./data/network.demo.json', { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error('No se pudieron cargar las rutas.');
        return r.json();
      }),
      fetch('./data/places.osm.json', { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar el catálogo de lugares.');
        return r.json();
      }),
      fetch((import.meta.env.VITE_PUBLIC_API_URL || '/api').replace(/\/$/, '') + '/network', {
        signal: AbortSignal.timeout(4000),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) validateNetwork(data);
          return data;
        })
        .catch(() => null),
    ])
      .then(([bundled, places, remote]) => {
        const routes = remote || bundled;
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
      window.removeEventListener('las-palmas-fleet-active', loadModel);
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
  return <AppRoot network={network} catalog={catalog} refreshNetwork={refreshNetwork} />;
}
createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConnectivityProvider>
        <UpdateGate>
          <Bootstrap />
        </UpdateGate>
      </ConnectivityProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
