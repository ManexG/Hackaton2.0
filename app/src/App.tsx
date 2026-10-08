import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { Icon } from './Icon';
import { MapView, type MapHandle } from './MapView';
import { SearchFields, type FieldName } from './SearchFields';
import { JourneyResults } from './Journeys';
import { ExplorePlaces } from './ExplorePlaces';
import { RouteExplorer } from './RouteExplorer';
import { DriverPanel } from './DriverPanel';
import { FleetStatus, StopPanel } from './StopPanel';
import { useFleet } from './useFleet';
import { predictJourneys } from './transit';
import { stopFromLink } from './stopLinks';
import { distance, insideCoverage, normalize, searchPlaces } from './planner';
import { geocodeInCoverage } from './geocoding';
import type { Network, Place, PlaceCatalog, Point, Route, Stop } from './types';

type Drawer = 'normal' | 'expanded' | 'collapsed' | 'lateral';
interface Trip { origin: Place; destination: Place }
export function CercaApp({ network, catalog }: { network: Network; catalog: PlaceCatalog }) {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [text, setText] = useState<Record<FieldName, string>>({ origin: '', destination: '' });
  const [active, setActive] = useState<FieldName | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [reversed, setReversed] = useState(false);
  const [tab, setTab] = useState<'plan' | 'routes' | 'stops'>('plan');
  const [role, setRole] = useState<'passenger' | 'driver'>('passenger');
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const fleet = useFleet(network);
  const [drawer, setDrawer] = useState<Drawer>('normal');
  const [pinMode, setPinMode] = useState<FieldName | null>(null);
  const [toast, setToast] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [simulation, setSimulation] = useState<string | null>(null);
  const [online, setOnline] = useState<{ field: FieldName; query: string; places: Place[] } | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const map = useRef<MapHandle>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const latest = useRef({ text, active, drawer, tab, pinMode, showInfo, simulation, role });
  latest.current = { text, active, drawer, tab, pinMode, showInfo, simulation, role };
  const journeys = useMemo(() => trip ? predictJourneys(trip.origin, trip.destination, network, fleet.vehicles, fleet.now) : [], [trip, network, fleet.snapshot, fleet.now]);
  const journey = journeys.find(item => item.id === selectedId) ?? journeys[0] ?? null;
  const activeRoutes = new Set(selectedRoute ? [selectedRoute.id] : journey?.legs.map(leg => leg.routeId) ?? []);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (showInfo && !dialog.current?.open) dialog.current?.showModal(); if (!showInfo && dialog.current?.open) dialog.current.close(); }, [showInfo]);
  useEffect(() => {
    function dismiss(event: PointerEvent) { if (!(event.target as HTMLElement).closest('.search-box')) setActive(null); }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const registration = NativeApp.addListener('backButton', () => {
      const ui = latest.current;
      if (ui.showInfo) setShowInfo(false);
      else if (ui.active) setActive(null);
      else if (ui.simulation) { map.current?.stopSimulation(); setDrawer('normal'); }
      else if (ui.pinMode) { setPinMode(null); setDrawer('normal'); }
      else if (ui.drawer !== 'normal') setDrawer('normal');
      else if (ui.role === 'driver') setRole('passenger');
      else if (ui.tab !== 'plan') changeTab('plan');
      else void NativeApp.minimizeApp();
    });
    return () => { void registration.then(listener => listener.remove()); };
  }, []);

  function resetTrip() { map.current?.stopSimulation(); setTrip(null); setSelectedId(null); setSelectedRoute(null); }
  function cancelSearch() { controller.current?.abort(); setLoadingSearch(false); setOnline(null); }
  function choosePlace(field: FieldName, place: Place) {
    if (!insideCoverage(place.point, network)) { setToast('Ese lugar está fuera de la zona de la demo.'); return; }
    cancelSearch(); map.current?.stopSimulation();
    const nextOrigin = field === 'origin' ? place : origin, nextDestination = field === 'destination' ? place : destination;
    if (field === 'origin') setOrigin(place); else setDestination(place);
    setText(current => ({ ...current, [field]: place.name })); setActive(null); setSelectedId(null); setSelectedRoute(null); setTab('plan');
    if (nextOrigin && nextDestination) { setTrip({ origin: nextOrigin, destination: nextDestination }); setDrawer('normal'); }
    else { setTrip(null); if (field === 'destination') setToast('Destino elegido. Selecciona tu punto de partida para ver las rutas.'); }
  }
  function editField(field: FieldName, value: string) {
    cancelSearch(); resetTrip(); setText(current => ({ ...current, [field]: value }));
    if (field === 'origin') setOrigin(null); else setDestination(null);
    setActive(field);
  }
  function focusField(field: FieldName) { setActive(field); if (drawer !== 'lateral') setDrawer('expanded'); }
  function swap() {
    cancelSearch(); map.current?.stopSimulation();
    setOrigin(destination); setDestination(origin); setText({ origin: text.destination, destination: text.origin }); setActive(null); setSelectedId(null); setSelectedRoute(null);
    setTrip(origin && destination ? { origin: destination, destination: origin } : null);
  }
  async function searchOnline(field: FieldName) {
    const query = text[field].trim();
    if (query.length < 3) { setToast('Escribe el nombre o una dirección para buscar.'); return; }
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoadingSearch(true); setActive(field);
    try {
      const places = await geocodeInCoverage(query, network, request.signal);
      if (request.signal.aborted || latest.current.text[field].trim() !== query) return;
      setOnline({ field, query: text[field], places });
      if (!places.length) setToast('No encontramos esa dirección dentro de la zona. Puedes elegir su punto en el mapa.');
    } catch (error) { if (!request.signal.aborted) setToast(error instanceof Error ? error.message : 'La búsqueda en línea no está disponible.'); }
    finally { if (!request.signal.aborted) setLoadingSearch(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (origin && destination) { setTrip({ origin, destination }); setSelectedId(null); setSelectedRoute(null); setActive(null); setDrawer('normal'); return; }
    const field: FieldName = !origin ? 'origin' : 'destination';
    if (!text[field].trim()) { setToast(field === 'origin' ? 'Elige tu punto de partida.' : 'Elige a dónde quieres ir.'); document.getElementById(field)?.focus(); return; }
    const matches = searchPlaces(text[field], network, origin?.point);
    const exact = matches.find(place => normalize(place.name.replace(' · demo', '')) === normalize(text[field]));
    if (exact || matches.length === 1) choosePlace(field, exact ?? matches[0]);
    else if (matches.length) { setActive(field); setToast('Selecciona la calle o el negocio que buscas entre las coincidencias.'); }
    else void searchOnline(field);
  }
  function changeTab(next: 'plan' | 'routes' | 'stops') { map.current?.stopSimulation(); setRole('passenger'); setTab(next); setActive(null); if (next !== 'routes') setSelectedRoute(null); }
  function selectRoute(id: string) { map.current?.stopSimulation(); setRole('passenger'); setSelectedRoute(network.routes.find(route => route.id === id)!); setReversed(false); setTab('routes'); setActive(null); setDrawer('normal'); }
  const stopPlace = (stop: Stop): Place => ({ ...stop, kind: 'stop', source: 'demo', description: 'Parada de la red de prueba', demo: true });
  function selectStop(stop: Stop) { setSelectedStop(stop); setSelectedRoute(null); setRole('passenger'); setTab('stops'); setActive(null); setDrawer('normal'); }
  function openStopLink(value: string) {
    const base = fleet.snapshot?.publicAppUrl || (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || location.origin;
    const stop = stopFromLink(value, network, base);
    if (!stop) { setToast('Ese QR no corresponde a una parada de Cerca dentro de la zona.'); return; }
    choosePlace('origin', stopPlace(stop)); selectStop(stop); setToast(`Parada ${stop.name.replace(' · demo', '')}. Aquí puedes ver las próximas llegadas.`);
  }
  const stopLinkHandler = useRef(openStopLink); stopLinkHandler.current = openStopLink;
  useEffect(() => {
    if (new URLSearchParams(location.search).has('stop')) stopLinkHandler.current(location.href);
    const pop = () => { if (new URLSearchParams(location.search).has('stop')) stopLinkHandler.current(location.href); };
    window.addEventListener('popstate', pop);
    if (!Capacitor.isNativePlatform()) return () => window.removeEventListener('popstate', pop);
    const listener = NativeApp.addListener('appUrlOpen', event => stopLinkHandler.current(event.url));
    void NativeApp.getLaunchUrl().then(value => { if (value) stopLinkHandler.current(value.url); });
    return () => { window.removeEventListener('popstate', pop); void listener.then(value => value.remove()); };
  }, []);
  function chooseMapPoint(point: Point) {
    if (!pinMode || !insideCoverage(point, network)) return;
    choosePlace(pinMode, { id: `pin-${point.join(',')}`, name: pinMode === 'origin' ? 'Origen elegido en el mapa' : 'Destino elegido en el mapa', description: 'Punto elegido dentro de la cobertura', kind: 'pin', source: 'user', point, demo: false });
    setPinMode(null); setDrawer('normal');
  }
  function pickOnMap() { const target = active ?? (origin ? 'destination' : 'origin'); setPinMode(target); setDrawer('collapsed'); setActive(null); setToast(`Toca el mapa dentro de la zona para elegir tu ${target === 'origin' ? 'origen' : 'destino'}.`); }
  async function useLocation() {
    setLoadingLocation(true);
    try {
      const position = Capacitor.isNativePlatform() ? await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 }) : await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 }) : reject(new Error('Sin ubicación')));
      const point: Point = [position.coords.latitude, position.coords.longitude];
      if (!insideCoverage(point, network)) { setToast('Tu ubicación está fuera de la zona. Elige un origen dentro de la demo.'); return; }
      choosePlace('origin', { id: 'my-location', name: 'Mi ubicación', description: 'Ubicación del dispositivo', kind: 'pin', point, source: 'user', demo: false });
    } catch { setToast('No pudimos obtener tu ubicación. Permite el acceso o busca tu origen.'); }
    finally { setLoadingLocation(false); }
  }
  function showCoverage() { map.current?.fit(network.coverage.polygon); setToast('Cobertura de prueba alrededor de tus dos puntos. El buscador y los viajes permanecen dentro de esta zona.'); }
  function openDrawer() { setDrawer('lateral'); panel.current?.scrollTo({ top: 0 }); }
  const touchStart = useRef(0);
  const debugState = useRef({ origin, destination, journeys, selectedJourney: journey, selectedRoute }); debugState.current = { origin, destination, journeys, selectedJourney: journey, selectedRoute };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(window, { cercaDemo: { network, get map() { return map.current?.getMap(); }, getState: () => debugState.current } });
    return () => { delete (window as unknown as Record<string, unknown>).cercaDemo; };
  }, [network]);

  return <><main className="app-shell">
    <nav className="rail" aria-label="Navegación principal"><button className="rail-logo" aria-label="Cerca, inicio" onClick={() => changeTab('plan')}><img src="./icon.svg" alt="" /></button><div className="rail-items"><button className={`rail-button ${tab === 'plan' ? 'active' : ''}`} aria-label="Planear viaje" onClick={() => changeTab('plan')}><Icon name="map" /></button><button className={`rail-button ${tab === 'routes' ? 'active' : ''}`} aria-label="Ver todas las rutas" onClick={() => changeTab('routes')}><Icon name="bus-front" /></button></div><button className="rail-button rail-info" aria-label="Acerca de la demo" onClick={() => setShowInfo(true)}><Icon name="info" /></button><span className="rail-bottom">LC</span></nav>
    <aside className={`sidebar ${drawer === 'normal' ? '' : drawer}`} aria-label="Planeador de rutas"><button className="drawer-handle" aria-label="Expandir o contraer panel" aria-expanded={drawer === 'expanded'} onClick={() => setDrawer(drawer === 'expanded' ? 'normal' : 'expanded')} onTouchStart={event => { touchStart.current = event.touches[0].clientY; }} onTouchEnd={event => { const delta = event.changedTouches[0].clientY - touchStart.current; if (Math.abs(delta) > 35) setDrawer(delta < 0 ? 'expanded' : 'collapsed'); }}><span /></button>
      <header className="brandbar"><a className="wordmark" href="#" onClick={event => { event.preventDefault(); changeTab('plan'); }}>cerca<span>.</span></a><span className="demo-badge">DEMO</span><button className="drawer-close" aria-label="Cerrar buscador lateral" onClick={() => { setDrawer('normal'); setActive(null); }}><Icon name="x" /></button></header>
      <div className="panel-scroll" ref={panel}><div className="role-switch"><span><Icon name={role === 'driver' ? 'user' : 'navigation'} />{role === 'driver' ? 'Modo chofer' : 'Viaja sin registrarte'}</span><button onClick={() => { setRole(role === 'driver' ? 'passenger' : 'driver'); setActive(null); setDrawer('expanded'); }}>{role === 'driver' ? 'Soy pasajero' : 'Soy chofer'}</button></div><FleetStatus fleet={fleet} /><div className="intro" hidden={role !== 'passenger'}><div className="eyebrow"><span className="tiny-dot" />HECHO PARA MOVERTE</div><h1>Tu próxima parada,<br /><span>más cerca.</span></h1><p>Busca tu destino. Nosotros conectamos el camino.</p></div>
        <div className="passenger-content" hidden={role !== 'passenger'}><div className="tabs" role="tablist" aria-label="Modo de consulta"><button id="plan-tab" role="tab" aria-selected={tab === 'plan'} aria-controls="plan-panel" className={`tab ${tab === 'plan' ? 'active' : ''}`} onClick={() => changeTab('plan')}><Icon name="route" />Planear viaje</button><button id="routes-tab" role="tab" aria-selected={tab === 'routes'} aria-controls="routes-panel" className={`tab ${tab === 'routes' ? 'active' : ''}`} onClick={() => changeTab('routes')}><Icon name="bus-front" />Ver rutas<span>{network.routes.length}</span></button><button id="stops-tab" role="tab" aria-selected={tab === 'stops'} aria-controls="stops-panel" className={`tab ${tab === 'stops' ? 'active' : ''}`} onClick={() => changeTab('stops')}><Icon name="map-pin" />Paradas</button></div>
        <section id="plan-panel" role="tabpanel" aria-labelledby="plan-tab" hidden={tab !== 'plan'}><form id="search-form" onSubmit={submit}><SearchFields network={network} origin={origin} text={text} active={active} online={online} loading={loadingSearch} onFocus={focusField} onChange={editField} onSelect={choosePlace} onClose={() => setActive(null)} onOnline={field => { void searchOnline(field); }} onSwap={swap} onMessage={setToast} /><div className="search-tools"><button type="button" onClick={() => { void useLocation(); }} disabled={loadingLocation}><Icon name={loadingLocation ? 'loading' : 'locate-fixed'} />{loadingLocation ? 'Obteniendo ubicación…' : 'Mi ubicación'}</button><button type="button" onPointerDown={event => event.stopPropagation()} onClick={pickOnMap}><Icon name="map-pin" />Elegir en mapa</button></div><button className="primary-button" type="submit" disabled={loadingSearch}>{loadingSearch ? 'Buscando tu destino…' : 'Encontrar mi ruta'}<Icon name={loadingSearch ? 'loading' : 'arrow-right'} /></button></form>
          {journey ? <JourneyResults network={network} journeys={journeys} selected={journey} onSelect={item => { map.current?.stopSimulation(); setSelectedId(item.id); setSelectedRoute(null); }} onSimulate={() => { setDrawer('collapsed'); map.current?.simulate(); }} /> : trip ? <div id="results" className="empty-state" aria-live="polite"><Icon name="route" /><h2>{distance(trip.origin.point, trip.destination.point) < 30 ? 'Ya estás en tu destino' : 'No hay un viaje disponible ahora'}</h2><p>{distance(trip.origin.point, trip.destination.point) < 30 ? 'Elige otro lugar para explorar.' : fleet.status !== 'connected' ? 'Necesitamos conectar con las combis para recomendar un viaje disponible. Puedes consultar el trazado en Ver rutas.' : `No hay combis activas con las que puedas llegar a ${trip.destination.name} en este momento. Revisamos el sentido, las llegadas, hasta dos trasbordos y paradas a menos de 420 m.`}</p></div> : <div className="plan-welcome" aria-live="polite"><span className="welcome-symbol"><Icon name="route" /></span><div><strong>{destination ? `Vamos a ${destination.name.replace(' · demo', '')}` : origin ? 'Ahora elige a dónde quieres ir' : 'Tu viaje empieza contigo'}</strong><p>{destination ? 'Elige tu origen para calcular el mejor camino.' : origin ? 'Busca un negocio, una calle o elige un lugar cercano.' : 'Indica tu origen y destino para ver rutas hechas para tu viaje.'}</p></div></div>}
          <ExplorePlaces network={network} fleet={fleet} origin={origin} onSelect={place => choosePlace('destination', place)} />
        </section>
        <section id="routes-panel" role="tabpanel" aria-labelledby="routes-tab" hidden={tab !== 'routes'}><RouteExplorer network={network} selected={selectedRoute} reversed={reversed} onSelect={selectRoute} onReverse={() => setReversed(value => !value)} fleet={fleet} onStop={selectStop} /></section><section id="stops-panel" role="tabpanel" aria-labelledby="stops-tab" hidden={tab !== 'stops'}><StopPanel network={network} selected={selectedStop} fleet={fleet} onStop={selectStop} onOrigin={stop => { choosePlace('origin', stopPlace(stop)); setDrawer('expanded'); }} onScan={openStopLink} onMessage={setToast} /></section></div><div hidden={role !== 'driver'}><DriverPanel network={network} fleet={fleet} onMessage={setToast} /></div>
        <div className="demo-note"><Icon name="info" /><p>Trazados, paradas y tarifas de prueba. Las combis en servicio corresponden a choferes conectados con GPS; las llegadas son estimaciones.</p></div><footer className="panel-footer"><button className="catalog-info" onClick={() => setShowInfo(true)}>{catalog.places.length} lugares y calles · © OpenStreetMap</button><span className="footer-dots"><i /><i /><i /><i /></span></footer>
      </div>
    </aside>
    <section className="map-section" aria-label="Mapa de rutas dentro de la cobertura"><MapView ref={map} network={network} journey={journey} selectedRoute={selectedRoute} reversed={reversed} origin={origin} destination={destination} pinMode={pinMode} onPick={chooseMapPoint} onRoute={selectRoute} onMessage={setToast} onSimulation={setSimulation} vehicles={fleet.vehicles} selectedStop={tab === 'stops' ? selectedStop : null} onStop={selectStop} />
      <header className="map-header"><div><div className="map-eyebrow">LÁZARO CÁRDENAS, MICHOACÁN</div><h2>Tu ciudad, conectada<span>.</span></h2></div><button className="coverage-pill" onClick={showCoverage}><Icon name="map-pin" />Zona de la demo<span className="tiny-dot" /></button></header>
      <header className="mobile-header"><div className="mobile-brand"><button className="mobile-menu" aria-label="Abrir buscador lateral" onClick={openDrawer}><Icon name="menu" /></button><span className="wordmark">cerca<span>.</span></span></div><button className="coverage-pill" onClick={showCoverage}><Icon name="map-pin" />Lázaro Cárdenas<span className="demo-badge">DEMO</span></button></header>
      <div className="map-controls"><button aria-label="Acercar mapa" onClick={() => map.current?.getMap()?.zoomIn()}><Icon name="plus" /></button><button aria-label="Alejar mapa" onClick={() => map.current?.getMap()?.zoomOut()}><Icon name="minus" /></button><span /><button aria-label="Ver recorrido completo" onClick={() => map.current?.fit()}><Icon name="locate-fixed" /></button></div><button className="layer-button" aria-label="Ver límite de cobertura" onClick={showCoverage}><Icon name="layers" /></button>
      {(simulation || pinMode) && <div className="map-notice"><span className="tiny-dot" />{simulation ?? `Elige tu ${pinMode === 'origin' ? 'origen' : 'destino'} en el mapa`}<button aria-label="Cancelar" onClick={() => { map.current?.stopSimulation(); setPinMode(null); setDrawer('normal'); }}>×</button></div>}
      <div id="map-summary" className="map-summary">{selectedRoute ? <><div className="summary-icon" style={{ '--route-color': selectedRoute.color } as CSSProperties}><Icon name="bus-front" /></div><div><span className="summary-eyebrow">ESTÁS EXPLORANDO</span><strong>{selectedRoute.id} · {selectedRoute.name}</strong><span>{selectedRoute.stops.length} paradas · {reversed ? 'Regreso' : 'Ida'} · Ficticia</span></div></> : journey ? <><div className="summary-icon"><Icon name={journey.transfers ? 'arrow-right-left' : 'bus-front'} /></div><div><span className="summary-eyebrow">HACIA TU DESTINO</span><strong>{journey.destination.name.replace(' · demo', '')}</strong><span>{journey.legs.map(leg => leg.routeId).join(' → ')} · {journey.totalMinutes} min · ${journey.fare} MXN</span></div></> : <><div className="summary-icon"><Icon name="search" /></div><div><span className="summary-eyebrow">TÚ ELIGES EL DESTINO</span><strong>Un camino para cada plan</strong><span>Busca calles, negocios y lugares de la zona.</span></div></>}</div>
      <div className="map-bottom"><div className="map-legend" aria-label="Rutas en el mapa"><span className="legend-label">RUTAS DEMO</span>{network.routes.map(route => <button key={route.id} onClick={() => selectRoute(route.id)} aria-label={`Ver ruta ${route.id}`} aria-pressed={activeRoutes.has(route.id)} className={activeRoutes.has(route.id) ? 'active' : ''} data-route={route.id}><i style={{ background: route.color }} />{route.id}</button>)}</div><div className="map-demo-label"><span className="tiny-dot" />RUTAS DE PRUEBA · GPS REAL</div></div>
    </section>
  </main>
    {drawer === 'lateral' && <button className="drawer-backdrop" aria-label="Cerrar panel lateral" onClick={() => { setDrawer('normal'); setActive(null); }} />}
    {toast && <div id="toast" className="toast" role="status">{toast}</div>}
    <dialog id="info-dialog" ref={dialog} onClose={() => setShowInfo(false)}><button className="dialog-close" aria-label="Cerrar" onClick={() => setShowInfo(false)}><Icon name="x" /></button><img src="./icon.svg" alt="" width="56" height="56" /><div className="eyebrow">CERCA · TU CIUDAD, A TU RITMO</div><h2>Elige tu destino.<br />Encuentra tu camino.</h2><p>Explora <strong>{catalog.places.length} lugares y calles</strong> guardados de OpenStreetMap. La búsqueda en línea se hace cuando la solicitas y se limita a la cobertura.</p><p>Las rutas, paradas intermedias y tarifas siguen siendo de prueba. El seguimiento usa GPS de choferes que inician sesión y activan el servicio dentro de su horario. Sin señal reciente, la combi deja de mostrarse. Las llegadas son estimaciones y pueden cambiar por tráfico.</p><p>La cobertura de prueba rodea el corredor entre Jugos Acapulco, frente al Pollo Feliz, y el entronque de av. Lázaro Cárdenas; no es el límite oficial de la ciudad. El mapa base y la búsqueda en línea necesitan internet.</p><p className="small-note">Lugares © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL · catálogo importado el {new Date(catalog.importedAt).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })}.</p><button className="primary-button" onClick={() => setShowInfo(false)}>Vamos a explorar<Icon name="arrow-right" /></button></dialog>
  </>;
}
