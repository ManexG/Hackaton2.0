import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { Icon } from './Icon.jsx';
import { MapView } from './MapView.jsx';
import { SearchFields } from './SearchFields.jsx';
import { JourneyResults } from './Journeys.jsx';
import { ExplorePlaces } from './ExplorePlaces.jsx';
import { RouteExplorer } from './RouteExplorer.jsx';
import { DriverPanel } from './DriverPanel.jsx';
import { FleetStatus, StopPanel } from './StopPanel.jsx';
import { useFleet } from './useFleet.js';
import { predictJourneys } from './transit.js';
import { stopFromLink } from './stopLinks.js';
import { distance, insideCoverage, normalize, searchPlaces } from './planner.js';
import { geocodeInCoverage } from './geocoding.js';
import { OfflineNotice, useConnectivity } from './connectivity.jsx';
export function CercaApp({ network: originalNetwork, catalog }) {
  const connectivity = useConnectivity();
  const fleet = useFleet(originalNetwork);
  const network = fleet.network;
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [text, setText] = useState({ origin: '', destination: '' });
  const [active, setActive] = useState(null);
  const [trip, setTrip] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [reversed, setReversed] = useState(false);
  const [tab, setTab] = useState('plan');
  const [role, setRole] = useState(() =>
    new URLSearchParams(location.search).get('driver') === '1' ? 'driver' : 'passenger'
  );
  const [selectedStop, setSelectedStop] = useState(null);
  const [drawer, setDrawer] = useState('normal');
  const [pinMode, setPinMode] = useState(null);
  const [toast, setToast] = useState('');
  const [largeText, setLargeText] = useState(() => {
    try {
      return localStorage.getItem('las-palmas-large-text') === 'true';
    } catch {
      return false;
    }
  });
  const [simulation, setSimulation] = useState(null);
  const [online, setOnline] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const controller = useRef(null);
  const map = useRef(null);
  const panel = useRef(null);
  const latest = useRef({ text, active, drawer, tab, pinMode, simulation, role });
  latest.current = { text, active, drawer, tab, pinMode, simulation, role };
  const journeys = useMemo(
    () =>
      trip && connectivity.online && fleet.status === 'connected'
        ? predictJourneys(trip.origin, trip.destination, network, fleet.vehicles, fleet.now)
        : [],
    [trip, network, fleet.snapshot, fleet.now, fleet.status, connectivity.online]
  );
  const journey = journeys.find((item) => item.id === selectedId) ?? journeys[0] ?? null;
  const activeRoutes = new Set(
    selectedRoute
      ? [selectedRoute.id]
      : tab === 'plan'
        ? (journey?.legs.map((leg) => leg.routeId) ?? [])
        : []
  );
  useEffect(() => {
    document.documentElement.classList.toggle('large-text', largeText);
    try {
      localStorage.setItem('las-palmas-large-text', String(largeText));
    } catch {
      /* Private browsing still supports the current setting. */
    }
  }, [largeText]);
  useEffect(() => {
    const timer = setTimeout(() => {
      map.current?.getMap()?.invalidateSize();
      map.current?.fit();
    }, 100);
    return () => clearTimeout(timer);
  }, [drawer]);
  useEffect(() => {
    if (!trip) return;
    const frame = requestAnimationFrame(() => {
      const results = document.getElementById('results');
      results?.setAttribute('tabindex', '-1');
      results?.focus({ preventScroll: true });
      results?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [trip]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function dismiss(event) {
      if (!event.target.closest('.search-box')) setActive(null);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const registration = NativeApp.addListener('backButton', () => {
      const ui = latest.current;
      if (location.hash) {
        location.hash = location.hash.startsWith('#/reporte/') ? '/comunidad' : '';
      } else if (ui.active) setActive(null);
      else if (ui.simulation) {
        map.current?.stopSimulation();
        setDrawer('normal');
      } else if (ui.pinMode) {
        setPinMode(null);
        setDrawer('normal');
      } else if (ui.drawer !== 'normal') setDrawer('normal');
      else if (ui.role === 'driver') setRole('passenger');
      else if (ui.tab !== 'plan') changeTab('plan');
      else void NativeApp.minimizeApp();
    });
    return () => {
      void registration.then((listener) => listener.remove());
    };
  }, []);
  function resetTrip() {
    map.current?.stopSimulation();
    setTrip(null);
    setSelectedId(null);
    setSelectedRoute(null);
  }
  function cancelSearch() {
    controller.current?.abort();
    setLoadingSearch(false);
    setOnline(null);
  }
  function choosePlace(field, place) {
    if (!insideCoverage(place.point, network)) {
      setToast('Ese lugar está fuera de la zona de la demo.');
      return;
    }
    cancelSearch();
    map.current?.stopSimulation();
    const nextOrigin = field === 'origin' ? place : origin,
      nextDestination = field === 'destination' ? place : destination;
    if (field === 'origin') setOrigin(place);
    else setDestination(place);
    setText((current) => ({ ...current, [field]: place.name }));
    setActive(null);
    setSelectedId(null);
    setSelectedRoute(null);
    setTab('plan');
    setTrip(null);
    setDrawer('normal');
    setToast(
      nextOrigin && nextDestination
        ? 'Origen y destino elegidos. Pulsa «Ver cómo llegar».'
        : field === 'origin'
          ? 'Origen elegido. Ahora indica a dónde quieres ir.'
          : 'Destino elegido. Ahora indica desde dónde sales.'
    );
    requestAnimationFrame(() => {
      if (latest.current.tab !== 'plan') return;
      const next =
        nextOrigin && nextDestination
          ? document.querySelector('.find-journey')
          : document.getElementById(nextOrigin ? 'destination' : 'origin')?.closest('.field');
      next?.scrollIntoView({ block: 'center' });
    });
  }
  function editField(field, value) {
    cancelSearch();
    resetTrip();
    setText((current) => ({ ...current, [field]: value }));
    if (field === 'origin') setOrigin(null);
    else setDestination(null);
    setActive(field);
  }
  function focusField(field) {
    setActive(field);
    if (drawer !== 'lateral') setDrawer('expanded');
  }
  function swap() {
    cancelSearch();
    map.current?.stopSimulation();
    setOrigin(destination);
    setDestination(origin);
    setText({ origin: text.destination, destination: text.origin });
    setActive(null);
    setSelectedId(null);
    setSelectedRoute(null);
    setTrip(null);
    setToast('Intercambiaste los lugares. Pulsa «Ver cómo llegar» para buscar de nuevo.');
  }
  async function searchOnline(field) {
    if (!connectivity.online) {
      setToast('Sin internet. Busca entre los lugares guardados o elige un punto en el mapa.');
      return;
    }
    const query = text[field].trim();
    if (query.length < 3) {
      setToast('Escribe el nombre o una dirección para buscar.');
      return;
    }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoadingSearch(true);
    setActive(field);
    try {
      const places = await geocodeInCoverage(query, network, request.signal);
      if (request.signal.aborted || latest.current.text[field].trim() !== query) return;
      setOnline({ field, query: text[field], places });
      if (!places.length)
        setToast(
          'No encontramos esa dirección dentro de la zona. Puedes elegir su punto en el mapa.'
        );
    } catch (error) {
      if (!request.signal.aborted)
        setToast(
          error instanceof Error ? error.message : 'La búsqueda en línea no está disponible.'
        );
    } finally {
      if (!request.signal.aborted) setLoadingSearch(false);
    }
  }
  function submit(event) {
    event.preventDefault();
    if (origin && destination) {
      setTrip({ origin, destination });
      setSelectedId(null);
      setSelectedRoute(null);
      setActive(null);
      setDrawer('normal');
      setToast('Estos son los viajes disponibles para tu destino.');
      return;
    }
    const field = !origin ? 'origin' : 'destination';
    if (!text[field].trim()) {
      setToast(field === 'origin' ? 'Elige tu punto de partida.' : 'Elige a dónde quieres ir.');
      document.getElementById(field)?.focus();
      return;
    }
    const matches = searchPlaces(text[field], network, origin?.point);
    const exact = matches.find(
      (place) => normalize(place.name.replace(' · demo', '')) === normalize(text[field])
    );
    if (exact || matches.length === 1) choosePlace(field, exact ?? matches[0]);
    else if (matches.length) {
      setActive(field);
      setToast('Selecciona la calle o el negocio que buscas entre las coincidencias.');
    } else void searchOnline(field);
  }
  function changeTab(next) {
    map.current?.stopSimulation();
    setRole('passenger');
    setTab(next);
    setActive(null);
    setDrawer('normal');
    if (next !== 'routes') setSelectedRoute(null);
  }
  function selectRoute(id) {
    map.current?.stopSimulation();
    setRole('passenger');
    setSelectedRoute(network.routes.find((route) => route.id === id));
    setReversed(false);
    setTab('routes');
    setActive(null);
    setDrawer('normal');
    setToast(`Ruta ${id} seleccionada. Aquí ves dónde empieza, dónde termina y sus paradas.`);
  }
  const stopPlace = (stop) => ({
    ...stop,
    kind: 'stop',
    source: 'demo',
    description: 'Parada de la red de prueba',
    demo: true,
  });
  function selectStop(stop) {
    setSelectedStop(stop);
    setSelectedRoute(null);
    setRole('passenger');
    setTab('stops');
    setActive(null);
    setDrawer('normal');
  }
  function openStopLink(value) {
    const base =
      fleet.snapshot?.publicAppUrl || import.meta.env.VITE_PUBLIC_APP_URL || location.origin;
    const stop = stopFromLink(value, network, base);
    if (!stop) {
      setToast('Ese QR no corresponde a una parada de Las Palmas Rutas dentro de la zona.');
      return;
    }
    choosePlace('origin', stopPlace(stop));
    selectStop(stop);
    setToast(`Parada ${stop.name.replace(' · demo', '')}. Aquí puedes ver las próximas llegadas.`);
  }
  const stopLinkHandler = useRef(openStopLink);
  stopLinkHandler.current = openStopLink;
  useEffect(() => {
    if (new URLSearchParams(location.search).has('stop')) stopLinkHandler.current(location.href);
    const pop = () => {
      if (new URLSearchParams(location.search).has('stop')) stopLinkHandler.current(location.href);
    };
    window.addEventListener('popstate', pop);
    if (!Capacitor.isNativePlatform()) return () => window.removeEventListener('popstate', pop);
    const listener = NativeApp.addListener('appUrlOpen', (event) =>
      stopLinkHandler.current(event.url)
    );
    void NativeApp.getLaunchUrl().then((value) => {
      if (value) stopLinkHandler.current(value.url);
    });
    return () => {
      window.removeEventListener('popstate', pop);
      void listener.then((value) => value.remove());
    };
  }, []);
  function chooseMapPoint(point) {
    if (!pinMode || !insideCoverage(point, network)) return;
    choosePlace(pinMode, {
      id: `pin-${point.join(',')}`,
      name: pinMode === 'origin' ? 'Origen elegido en el mapa' : 'Destino elegido en el mapa',
      description: 'Punto elegido dentro de la cobertura',
      kind: 'pin',
      source: 'user',
      point,
      demo: false,
    });
    setPinMode(null);
    setDrawer('normal');
  }
  function pickOnMap() {
    const target = active ?? (origin ? 'destination' : 'origin');
    setPinMode(target);
    setDrawer('collapsed');
    setActive(null);
    setToast(
      `Toca el mapa dentro de la zona para elegir tu ${target === 'origin' ? 'origen' : 'destino'}.`
    );
  }
  async function useLocation() {
    setLoadingLocation(true);
    try {
      const position = Capacitor.isNativePlatform()
        ? await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 })
        : await new Promise((resolve, reject) =>
            navigator.geolocation
              ? navigator.geolocation.getCurrentPosition(resolve, reject, {
                  enableHighAccuracy: true,
                  timeout: 12000,
                })
              : reject(new Error('Sin ubicación'))
          );
      const point = [position.coords.latitude, position.coords.longitude];
      if (!insideCoverage(point, network)) {
        setToast('Tu ubicación está fuera de la zona. Elige un origen dentro de la demo.');
        return;
      }
      choosePlace('origin', {
        id: 'my-location',
        name: 'Mi ubicación',
        description: 'Ubicación del dispositivo',
        kind: 'pin',
        point,
        source: 'user',
        demo: false,
      });
    } catch {
      setToast('No pudimos obtener tu ubicación. Permite el acceso o busca tu origen.');
    } finally {
      setLoadingLocation(false);
    }
  }
  function showCoverage() {
    map.current?.fit(network.coverage.polygon);
    setToast(
      'Cobertura de prueba alrededor de tus dos puntos. El buscador y los viajes permanecen dentro de esta zona.'
    );
  }
  const debugState = useRef({
    origin,
    destination,
    journeys,
    selectedJourney: journey,
    selectedRoute,
  });
  debugState.current = { origin, destination, journeys, selectedJourney: journey, selectedRoute };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(window, {
      cercaDemo: {
        network,
        get map() {
          return map.current?.getMap();
        },
        getState: () => debugState.current,
      },
    });
    return () => {
      delete window.cercaDemo;
    };
  }, [network]);
  return (
    <>
      <main
        className="app-shell"
        data-mobile-view={drawer === 'collapsed' ? 'map' : 'instructions'}
      >
        <header className="app-header">
          <button
            className="brand-home"
            aria-label="Las Palmas Rutas, ir al inicio"
            onClick={() => changeTab('plan')}
          >
            <img src="./brand/las-palmas-logo.webp" alt="Las Palmas Rutas" />
          </button>
          <div className="header-actions">
            <button
              className="text-size-button"
              aria-pressed={largeText}
              onClick={() => setLargeText((value) => !value)}
            >
              <span aria-hidden="true">A+</span>
              {largeText ? 'Letra normal' : 'Letra más grande'}
            </button>
            <button
              onClick={() => {
                location.hash = '/comunidad';
              }}
            >
              <Icon name="users" />
              Comunidad
            </button>
          </div>
        </header>
        <aside className="sidebar" aria-label="Planeador de rutas">
          <div className="panel-scroll" ref={panel}>
            <div className="current-mode" role="status">
              <Icon name={role === 'passenger' ? 'user' : 'bus-front'} />
              <div>
                <strong>
                  {role === 'passenger' ? 'Estás en: Pasajero' : 'Acceso para choferes'}
                </strong>
                <span>
                  {role === 'passenger'
                    ? 'Puedes viajar sin crear una cuenta.'
                    : 'Inicia sesión con tu cuenta de chofer.'}
                </span>
              </div>
            </div>
            <div className="passenger-content" hidden={role !== 'passenger'}>
              <OfflineNotice />
              <h1 className="passenger-title">¿Qué necesitas hacer?</h1>
              <div className="tabs" role="tablist" aria-label="Modo de consulta">
                {[
                  ['plan', 'Buscar viaje', 'search'],
                  ['routes', 'Ver rutas', 'bus-front'],
                  ['stops', 'Paradas', 'map-pin'],
                ].map(([id, label, icon]) => (
                  <button
                    key={id}
                    id={`${id}-tab`}
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls={`${id}-panel`}
                    className={`tab ${tab === id ? 'active' : ''}`}
                    onClick={() => changeTab(id)}
                  >
                    <Icon name={icon} />
                    {label}
                  </button>
                ))}
              </div>
              <section
                id="plan-panel"
                role="tabpanel"
                aria-labelledby="plan-tab"
                hidden={tab !== 'plan'}
              >
                <div className="task-intro">
                  <h2>¿A dónde quieres ir?</h2>
                  <p>Elige tu origen y tu destino.</p>
                </div>
                <form id="search-form" onSubmit={submit}>
                  <SearchFields
                    network={network}
                    origin={origin}
                    destination={destination}
                    text={text}
                    active={active}
                    online={online}
                    loading={loadingSearch}
                    connected={connectivity.online}
                    onFocus={focusField}
                    onChange={editField}
                    onSelect={choosePlace}
                    onClose={() => setActive(null)}
                    onOnline={(field) => {
                      void searchOnline(field);
                    }}
                    onSwap={swap}
                    onMessage={setToast}
                    onLocation={() => {
                      void useLocation();
                    }}
                    loadingLocation={loadingLocation}
                  />
                  <button
                    className="map-pick-button"
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={pickOnMap}
                  >
                    <Icon name="map-pin" />O elegir un punto en el mapa
                  </button>
                  <button
                    className="primary-button find-journey"
                    type="submit"
                    disabled={loadingSearch}
                  >
                    {loadingSearch ? 'Buscando tu destino…' : 'Ver cómo llegar'}
                    <Icon name={loadingSearch ? 'loading' : 'arrow-right'} />
                  </button>
                </form>
                {journey ? (
                  <JourneyResults
                    network={network}
                    journeys={journeys}
                    selected={journey}
                    onSelect={(item) => {
                      map.current?.stopSimulation();
                      setSelectedId(item.id);
                      setSelectedRoute(null);
                      setToast('Viaje seleccionado. Sigue las instrucciones que aparecen debajo.');
                      document.getElementById('journey-detail')?.scrollIntoView({ block: 'start' });
                    }}
                    onSimulate={() => {
                      setDrawer('collapsed');
                      map.current?.simulate();
                    }}
                  />
                ) : trip ? (
                  <div id="results" className="empty-state" aria-live="polite">
                    <Icon name="route" />
                    <h2>
                      {distance(trip.origin.point, trip.destination.point) < 30
                        ? 'Ya estás en tu destino'
                        : 'No hay un viaje disponible ahora'}
                    </h2>
                    <p>
                      {distance(trip.origin.point, trip.destination.point) < 30
                        ? 'Elige otro destino para buscar un viaje.'
                        : fleet.status !== 'connected'
                          ? 'Estamos intentando conectar con las combis. Mientras tanto, puedes consultar por dónde pasan las rutas.'
                          : `No encontramos combis en servicio para llegar a ${trip.destination.name.replace(' · demo', '')}. Puedes revisar las rutas y sus horarios.`}
                    </p>
                    <button className="secondary-button" onClick={() => changeTab('routes')}>
                      Ver por dónde pasan las rutas
                      <Icon name="arrow-right" />
                    </button>
                  </div>
                ) : (
                  <p className="search-status" aria-live="polite">
                    {origin && destination
                      ? 'Todo listo. Pulsa «Ver cómo llegar».'
                      : 'Busca una calle, negocio o parada dentro de la zona.'}
                  </p>
                )}
                <ExplorePlaces
                  network={network}
                  fleet={fleet}
                  origin={origin}
                  onSelect={(place) => choosePlace('destination', place)}
                />
              </section>
              <section
                id="routes-panel"
                role="tabpanel"
                aria-labelledby="routes-tab"
                hidden={tab !== 'routes'}
              >
                <RouteExplorer
                  network={network}
                  selected={selectedRoute}
                  reversed={reversed}
                  onSelect={selectRoute}
                  onReverse={() => {
                    setReversed((value) => !value);
                    setToast('Cambiaste el sentido. Las paradas aparecen en el nuevo orden.');
                  }}
                  fleet={fleet}
                  onStop={selectStop}
                  onBack={() => setSelectedRoute(null)}
                  onMap={() => setDrawer('collapsed')}
                />
              </section>
              <section
                id="stops-panel"
                role="tabpanel"
                aria-labelledby="stops-tab"
                hidden={tab !== 'stops'}
              >
                <StopPanel
                  network={network}
                  selected={selectedStop}
                  fleet={fleet}
                  onStop={selectStop}
                  onOrigin={(stop) => {
                    choosePlace('origin', stopPlace(stop));
                    setDrawer('normal');
                  }}
                  onScan={openStopLink}
                  onMessage={setToast}
                />
              </section>
              <FleetStatus fleet={fleet} network={network} />
              <div className="driver-entry">
                <p>¿Trabajas como chofer?</p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setRole('driver');
                    setActive(null);
                    setDrawer('normal');
                    panel.current?.scrollTo({ top: 0 });
                  }}
                >
                  Entrar como chofer
                  <Icon name="arrow-right" />
                </button>
              </div>
            </div>
            <div className="driver-content" hidden={role !== 'driver'}>
              <button
                className="secondary-button passenger-return"
                onClick={() => {
                  setRole('passenger');
                  setDrawer('normal');
                }}
              >
                <Icon name="arrow-right-left" />
                Volver a viajar como pasajero
              </button>
              <DriverPanel network={network} fleet={fleet} onMessage={setToast} />
            </div>
            <div className="demo-note">
              <Icon name="info" />
              <p>
                Demo: rutas, paradas y tarifas de ejemplo. Las ubicaciones corresponden a choferes
                conectados con GPS real.
              </p>
            </div>
          </div>
        </aside>
        <section className="map-section" aria-label="Mapa de rutas dentro de la cobertura">
          <MapView
            ref={map}
            network={network}
            journey={tab === 'plan' ? journey : null}
            selectedRoute={selectedRoute}
            reversed={reversed}
            origin={origin}
            destination={destination}
            pinMode={pinMode}
            onPick={chooseMapPoint}
            onRoute={selectRoute}
            onMessage={setToast}
            onSimulation={setSimulation}
            vehicles={fleet.vehicles}
            selectedStop={tab === 'stops' ? selectedStop : null}
            onStop={selectStop}
          />
          <div className="map-action-bar">
            <strong>
              <Icon name="map-pin" />
              Lázaro Cárdenas
            </strong>
            <button onClick={showCoverage}>Ver zona disponible</button>
          </div>
          <div className="map-controls">
            <button aria-label="Acercar mapa" onClick={() => map.current?.getMap()?.zoomIn()}>
              <Icon name="plus" />
              <span>Acercar</span>
            </button>
            <button aria-label="Alejar mapa" onClick={() => map.current?.getMap()?.zoomOut()}>
              <Icon name="minus" />
              <span>Alejar</span>
            </button>
            <button aria-label="Ver recorrido completo" onClick={() => map.current?.fit()}>
              <Icon name="locate-fixed" />
              <span>Centrar</span>
            </button>
          </div>
          {(simulation || pinMode) && (
            <div className="map-notice">
              <span>
                {simulation ??
                  `Toca el mapa para elegir tu ${pinMode === 'origin' ? 'origen' : 'destino'}`}
              </span>
              <button
                onClick={() => {
                  map.current?.stopSimulation();
                  setPinMode(null);
                  setDrawer('normal');
                }}
              >
                Cancelar
              </button>
            </div>
          )}
          <div id="map-summary" className="map-summary">
            {selectedRoute ? (
              <>
                <div className="summary-icon" style={{ '--route-color': selectedRoute.color }}>
                  <Icon name="check" />
                </div>
                <div>
                  <span className="summary-eyebrow">RUTA SELECCIONADA</span>
                  <strong>
                    {selectedRoute.id} · {selectedRoute.name}
                  </strong>
                  <span>
                    {reversed ? 'Sentido de regreso' : 'Sentido de ida'} ·{' '}
                    {selectedRoute.stops.length} paradas de ejemplo
                  </span>
                </div>
              </>
            ) : tab === 'plan' && journey ? (
              <>
                <div className="summary-icon">
                  <Icon name="bus-front" />
                </div>
                <div>
                  <span className="summary-eyebrow">TU VIAJE SELECCIONADO</span>
                  <strong>{journey.destination.name.replace(' · demo', '')}</strong>
                  <span>
                    {journey.legs.map((leg) => leg.routeId).join(' → ')} · {journey.totalMinutes}{' '}
                    min aprox.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="summary-icon">
                  <Icon name="bus-front" />
                </div>
                <div>
                  <strong>Estas son las rutas de ejemplo</strong>
                  <span>Toca una línea de color para ver sus paradas.</span>
                </div>
              </>
            )}
          </div>
          <div className="map-bottom">
            <div className="map-legend" aria-label="Rutas en el mapa">
              <span className="legend-label">Ver ruta:</span>
              {network.routes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => selectRoute(route.id)}
                  aria-label={`Ver ruta ${route.id}`}
                  aria-pressed={activeRoutes.has(route.id)}
                  className={activeRoutes.has(route.id) ? 'active' : ''}
                  data-route={route.id}
                >
                  <i style={{ background: route.color }} />
                  {route.id}
                  {activeRoutes.has(route.id) && <Icon name="check" />}
                </button>
              ))}
            </div>
          </div>
        </section>
        <button
          className="mobile-map-toggle"
          onClick={() => {
            if (drawer === 'collapsed') {
              setPinMode(null);
              map.current?.stopSimulation();
            }
            setDrawer(drawer === 'collapsed' ? 'normal' : 'collapsed');
            setActive(null);
          }}
        >
          <Icon name={drawer === 'collapsed' ? 'arrow-right-left' : 'map'} />
          {drawer === 'collapsed' ? 'Volver a las instrucciones' : 'Ver mapa de las rutas'}
        </button>
      </main>
      {toast && (
        <div id="toast" className="toast" role="status">
          <Icon name="info" />
          <span>{toast}</span>
          <button aria-label="Cerrar mensaje" onClick={() => setToast('')}>
            <Icon name="x" />
          </button>
        </div>
      )}
    </>
  );
}
