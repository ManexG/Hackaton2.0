import { lazy, Suspense, useEffect, useState } from 'react';
import { CercaApp } from './App.jsx';
import { api } from './community/api.js';
const CommunityPanel = lazy(() => import('./community/CommunityPanel.jsx'));
const AdminPanel = lazy(() => import('./admin/AdminPanel.jsx'));
export function AppRoot({ network, catalog, refreshNetwork }) {
  const [route, setRoute] = useState(location.hash.replace(/^#/, ''));
  const [qrError, setQrError] = useState('');
  useEffect(() => {
    const code = route.match(/^\/parada\/([A-Za-z0-9-]+)$/)?.[1];
    if (!code) return;
    let canceled = false;
    setQrError('');
    api('/paradas/qr/' + encodeURIComponent(code))
      .then((stop) => {
        if (!canceled) location.replace('/?stop=' + encodeURIComponent(stop.stopId));
      })
      .catch((error) => {
        if (!canceled) setQrError(error.message);
      });
    return () => {
      canceled = true;
    };
  }, [route]);
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.replace(/^#/, ''));
      setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return (
    <>
      <div hidden={Boolean(route)}>
        <CercaApp network={network} catalog={catalog} />
      </div>
      {route.startsWith('/parada/') ? (
        <div className="boot">
          <p>{qrError || 'Buscando la parada del QR…'}</p>
          {qrError && (
            <button
              onClick={() => {
                location.hash = '';
              }}
            >
              Volver al mapa
            </button>
          )}
        </div>
      ) : route.startsWith('/gestion') ? (
        <Suspense fallback={<div className="boot">Cargando administración…</div>}>
          <AdminPanel network={network} refreshNetwork={refreshNetwork} />
        </Suspense>
      ) : (
        route && (
          <Suspense fallback={<div className="boot">Cargando comunidad…</div>}>
            <CommunityPanel network={network} route={route} refreshNetwork={refreshNetwork} />
          </Suspense>
        )
      )}
    </>
  );
}
