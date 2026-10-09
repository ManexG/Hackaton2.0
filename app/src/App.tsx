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
  const [largeText, setLargeText] = useState(() => { try { return localStorage.getItem('las-palmas-large-text') === 'true'; } catch { return false; } });
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
  const activeRoutes = new Set(selectedRoute ? [selectedRoute.id] : tab === 'plan' ? journey?.legs.map(leg => leg.routeId) ?? [] : []);

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', largeText);
    try { localStorage.setItem('las-palmas-large-text', String(largeText)); } catch { /* Private browsing still supports the current setting. */ }
  }, [largeText]);
  useEffect(() => {
    const timer = setTimeout(() => { map.current?.getMap()?.invalidateSize(); map.current?.fit(); }, 100);
    return () => clearTimeout(timer);
  }, [drawer]);
  useEffect(() => {
    if (!trip) return;
    const frame = requestAnimationFrame(() => {
      const results = document.getElementById('results');
      results?.setAttribute('tabindex', '-1'); results?.focus({ preventScroll: true }); results?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [trip]);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (showInfo && !dialog.current?.open) { dialog.current?.showModal(); document.getElementById('help-title')?.focus({ preventScroll: true }); if (dialog.current) dialog.current.scrollTop = 0; }
    if (!showInfo && dialog.current?.open) dialog.current.close();
  }, [showInfo]);
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
    setTrip(null); setDrawer('normal');
    setToast(nextOrigin && nextDestination ? 'Origen y destino elegidos. Pulsa «Ver cómo llegar».' : field === 'origin' ? 'Origen elegido. Ahora indica a dónde quieres ir.' : 'Destino elegido. Ahora indica desde dónde sales.');
    requestAnimationFrame(() => {
      if (latest.current.tab !== 'plan') return;
      const next = nextOrigin && nextDestination ? document.querySelector('.find-journey') : document.getElementById(nextOrigin ? 'destination' : 'origin')?.closest('.field');
      next?.scrollIntoView({ block: 'center' });
    });
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
    setTrip(null); setToast('Intercambiaste los lugares. Pulsa «Ver cómo llegar» para buscar de nuevo.');
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
    if (origin && destination) { setTrip({ origin, destination }); setSelectedId(null); setSelectedRoute(null); setActive(null); setDrawer('normal'); setToast('Estos son los viajes disponibles para tu destino.'); return; }
    const field: FieldName = !origin ? 'origin' : 'destination';
    if (!text[field].trim()) { setToast(field === 'origin' ? 'Elige tu punto de partida.' : 'Elige a dónde quieres ir.'); document.getElementById(field)?.focus(); return; }
    const matches = searchPlaces(text[field], network, origin?.point);
    const exact = matches.find(place => normalize(place.name.replace(' · demo', '')) === normalize(text[field]));
    if (exact || matches.length === 1) choosePlace(field, exact ?? matches[0]);
    else if (matches.length) { setActive(field); setToast('Selecciona la calle o el negocio que buscas entre las coincidencias.'); }
    else void searchOnline(field);
  }
  function changeTab(next: 'plan' | 'routes' | 'stops') { map.current?.stopSimulation(); setRole('passenger'); setTab(next); setActive(null); setDrawer('normal'); if (next !== 'routes') setSelectedRoute(null); }
  function selectRoute(id: string) { map.current?.stopSimulation(); setRole('passenger'); setSelectedRoute(network.routes.find(route => route.id === id)!); setReversed(false); setTab('routes'); setActive(null); setDrawer('normal'); setToast(`Ruta ${id} seleccionada. Aquí ves dónde empieza, dónde termina y sus paradas.`); }
  const stopPlace = (stop: Stop): Place => ({ ...stop, kind: 'stop', source: 'demo', description: 'Parada de la red de prueba', demo: true });
  function selectStop(stop: Stop) { setSelectedStop(stop); setSelectedRoute(null); setRole('passenger'); setTab('stops'); setActive(null); setDrawer('normal'); }
  function openStopLink(value: string) {
    const base = fleet.snapshot?.publicAppUrl || (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || location.origin;
    const stop = stopFromLink(value, network, base);
    if (!stop) { setToast('Ese QR no corresponde a una parada de Las Palmas Rutas dentro de la zona.'); return; }
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
  const debugState = useRef({ origin, destination, journeys, selectedJourney: journey, selectedRoute }); debugState.current = { origin, destination, journeys, selectedJourney: journey, selectedRoute };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(window, { cercaDemo: { network, get map() { return map.current?.getMap(); }, getState: () => debugState.current } });
    return () => { delete (window as unknown as Record<string, unknown>).cercaDemo; };
  }, [network]);

  return <><main className="app-shell" data-mobile-view={drawer === 'collapsed' ? 'map' : 'instructions'}>
    <header className="app-header">
      <button className="brand-home" aria-label="Las Palmas Rutas, ir al inicio" onClick={() => changeTab('plan')}><img src="./brand/las-palmas-logo.png" alt="Las Palmas Rutas" /></button>
      <div className="header-actions"><button className="text-size-button" aria-pressed={largeText} onClick={() => setLargeText(value => !value)}><span aria-hidden="true">A+</span>{largeText ? 'Letra normal' : 'Letra más grande'}</button><button className="help-button" onClick={() => setShowInfo(true)}><Icon name="info" />Ayuda</button></div>
    </header>
    <aside className="sidebar" aria-label="Planeador de rutas">
      <div className="panel-scroll" ref={panel}>
        <div className="current-mode" role="status"><Icon name={role === 'passenger' ? 'user' : 'bus-front'} /><div><strong>{role === 'passenger' ? 'Estás en: Pasajero' : 'Acceso para choferes'}</strong><span>{role === 'passenger' ? 'Puedes viajar sin crear una cuenta.' : 'Inicia sesión con tu cuenta de chofer.'}</span></div></div>
        <div className="passenger-content" hidden={role !== 'passenger'}>
          <h1 className="passenger-title">¿Qué necesitas hacer?</h1>
          <div className="tabs" role="tablist" aria-label="Modo de consulta">{([
            ['plan', 'Buscar viaje', 'search'], ['routes', 'Ver rutas', 'bus-front'], ['stops', 'Paradas', 'map-pin'],
          ] as const).map(([id, label, icon]) => <button key={id} id={`${id}-tab`} role="tab" aria-selected={tab === id} aria-controls={`${id}-panel`} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => changeTab(id)}><Icon name={icon} />{label}</button>)}</div>
          <section id="plan-panel" role="tabpanel" aria-labelledby="plan-tab" hidden={tab !== 'plan'}>
            <div className="task-intro"><h2>¿A dónde quieres ir?</h2><p>Sigue estos tres pasos para encontrar tu combi.</p></div>
            <form id="search-form" onSubmit={submit}>
              <SearchFields network={network} origin={origin} destination={destination} text={text} active={active} online={online} loading={loadingSearch} onFocus={focusField} onChange={editField} onSelect={choosePlace} onClose={() => setActive(null)} onOnline={field => { void searchOnline(field); }} onSwap={swap} onMessage={setToast} onLocation={() => { void useLocation(); }} loadingLocation={loadingLocation} />
              <button className="map-pick-button" type="button" onPointerDown={event => event.stopPropagation()} onClick={pickOnMap}><Icon name="map-pin" />O elegir un punto en el mapa</button>
              <button className="primary-button find-journey" type="submit" disabled={loadingSearch}><span className="step-number">3</span>{loadingSearch ? 'Buscando tu destino…' : 'Ver cómo llegar'}<Icon name={loadingSearch ? 'loading' : 'arrow-right'} /></button>
            </form>
            {journey ? <JourneyResults network={network} journeys={journeys} selected={journey} onSelect={item => { map.current?.stopSimulation(); setSelectedId(item.id); setSelectedRoute(null); setToast('Viaje seleccionado. Sigue las instrucciones que aparecen debajo.'); document.getElementById('journey-detail')?.scrollIntoView({ block: 'start' }); }} onSimulate={() => { setDrawer('collapsed'); map.current?.simulate(); }} /> : trip ? <div id="results" className="empty-state" aria-live="polite"><Icon name="route" /><h2>{distance(trip.origin.point, trip.destination.point) < 30 ? 'Ya estás en tu destino' : 'No hay un viaje disponible ahora'}</h2><p>{distance(trip.origin.point, trip.destination.point) < 30 ? 'Elige otro destino para buscar un viaje.' : fleet.status !== 'connected' ? 'Estamos intentando conectar con las combis. Mientras tanto, puedes consultar por dónde pasan las rutas.' : `No encontramos combis en servicio para llegar a ${trip.destination.name.replace(' · demo', '')}. Puedes revisar las rutas y sus horarios.`}</p><button className="secondary-button" onClick={() => changeTab('routes')}>Ver por dónde pasan las rutas<Icon name="arrow-right" /></button></div> : <div className="plan-welcome" aria-live="polite"><Icon name={origin && destination ? 'check' : 'info'} /><div><strong>{origin && destination ? 'Todo listo para buscar' : origin ? 'Paso 2: elige tu destino' : destination ? 'Paso 1: elige desde dónde sales' : 'Empieza en el paso 1'}</strong><p>{origin && destination ? 'Pulsa el botón verde «Ver cómo llegar».' : origin ? 'Escribe un lugar o elígelo en las sugerencias de abajo.' : 'Puedes usar tu ubicación o escribir una calle, negocio o parada.'}</p></div></div>}
            <ExplorePlaces network={network} fleet={fleet} origin={origin} onSelect={place => choosePlace('destination', place)} />
          </section>
          <section id="routes-panel" role="tabpanel" aria-labelledby="routes-tab" hidden={tab !== 'routes'}><RouteExplorer network={network} selected={selectedRoute} reversed={reversed} onSelect={selectRoute} onReverse={() => { setReversed(value => !value); setToast('Cambiaste el sentido. Las paradas aparecen en el nuevo orden.'); }} fleet={fleet} onStop={selectStop} onBack={() => setSelectedRoute(null)} onMap={() => setDrawer('collapsed')} /></section>
          <section id="stops-panel" role="tabpanel" aria-labelledby="stops-tab" hidden={tab !== 'stops'}><StopPanel network={network} selected={selectedStop} fleet={fleet} onStop={selectStop} onOrigin={stop => { choosePlace('origin', stopPlace(stop)); setDrawer('normal'); }} onScan={openStopLink} onMessage={setToast} /></section>
          <FleetStatus fleet={fleet} />
          <div className="driver-entry"><p>¿Trabajas como chofer?</p><button className="secondary-button" onClick={() => { setRole('driver'); setActive(null); setDrawer('normal'); panel.current?.scrollTo({ top: 0 }); }}>Entrar como chofer<Icon name="arrow-right" /></button></div>
        </div>
        <div className="driver-content" hidden={role !== 'driver'}><button className="secondary-button passenger-return" onClick={() => { setRole('passenger'); setDrawer('normal'); }}><Icon name="arrow-right-left" />Volver a viajar como pasajero</button><DriverPanel network={network} fleet={fleet} onMessage={setToast} /></div>
        <div className="demo-note"><Icon name="info" /><p>Demo: rutas, paradas y tarifas de ejemplo. Las ubicaciones corresponden a choferes conectados con GPS real.</p></div>
        <footer className="panel-footer"><button className="catalog-info" onClick={() => setShowInfo(true)}>Ayuda e información de la demo</button><span>© OpenStreetMap</span></footer>
      </div>
    </aside>
    <section className="map-section" aria-label="Mapa de rutas dentro de la cobertura"><MapView ref={map} network={network} journey={tab === 'plan' ? journey : null} selectedRoute={selectedRoute} reversed={reversed} origin={origin} destination={destination} pinMode={pinMode} onPick={chooseMapPoint} onRoute={selectRoute} onMessage={setToast} onSimulation={setSimulation} vehicles={fleet.vehicles} selectedStop={tab === 'stops' ? selectedStop : null} onStop={selectStop} />
      <div className="map-action-bar"><strong><Icon name="map-pin" />Lázaro Cárdenas</strong><button onClick={showCoverage}>Ver zona disponible</button></div>
      <div className="map-controls"><button aria-label="Acercar mapa" onClick={() => map.current?.getMap()?.zoomIn()}><Icon name="plus" /><span>Acercar</span></button><button aria-label="Alejar mapa" onClick={() => map.current?.getMap()?.zoomOut()}><Icon name="minus" /><span>Alejar</span></button><button aria-label="Ver recorrido completo" onClick={() => map.current?.fit()}><Icon name="locate-fixed" /><span>Centrar</span></button></div>
      {(simulation || pinMode) && <div className="map-notice"><span>{simulation ?? `Toca el mapa para elegir tu ${pinMode === 'origin' ? 'origen' : 'destino'}`}</span><button onClick={() => { map.current?.stopSimulation(); setPinMode(null); setDrawer('normal'); }}>Cancelar</button></div>}
      <div id="map-summary" className="map-summary">{selectedRoute ? <><div className="summary-icon" style={{ '--route-color': selectedRoute.color } as CSSProperties}><Icon name="check" /></div><div><span className="summary-eyebrow">RUTA SELECCIONADA</span><strong>{selectedRoute.id} · {selectedRoute.name}</strong><span>{reversed ? 'Sentido de regreso' : 'Sentido de ida'} · {selectedRoute.stops.length} paradas de ejemplo</span></div></> : tab === 'plan' && journey ? <><div className="summary-icon"><Icon name="bus-front" /></div><div><span className="summary-eyebrow">TU VIAJE SELECCIONADO</span><strong>{journey.destination.name.replace(' · demo', '')}</strong><span>{journey.legs.map(leg => leg.routeId).join(' → ')} · {journey.totalMinutes} min aprox.</span></div></> : <><div className="summary-icon"><Icon name="bus-front" /></div><div><strong>Estas son las rutas de ejemplo</strong><span>Toca una línea de color para ver sus paradas.</span></div></>}</div>
      <div className="map-bottom"><div className="map-legend" aria-label="Rutas en el mapa"><span className="legend-label">Ver ruta:</span>{network.routes.map(route => <button key={route.id} onClick={() => selectRoute(route.id)} aria-label={`Ver ruta ${route.id}`} aria-pressed={activeRoutes.has(route.id)} className={activeRoutes.has(route.id) ? 'active' : ''} data-route={route.id}><i style={{ background: route.color }} />{route.id}{activeRoutes.has(route.id) && <Icon name="check" />}</button>)}</div></div>
    </section>
    <button className="mobile-map-toggle" onClick={() => { if (drawer === 'collapsed') { setPinMode(null); map.current?.stopSimulation(); } setDrawer(drawer === 'collapsed' ? 'normal' : 'collapsed'); setActive(null); }}><Icon name={drawer === 'collapsed' ? 'arrow-right-left' : 'map'} />{drawer === 'collapsed' ? 'Volver a las instrucciones' : 'Ver mapa de las rutas'}</button>
  </main>
    {toast && <div id="toast" className="toast" role="status"><Icon name="info" /><span>{toast}</span><button aria-label="Cerrar mensaje" onClick={() => setToast('')}><Icon name="x" /></button></div>}
    <dialog id="info-dialog" ref={dialog} aria-labelledby="help-title" onClose={() => { setShowInfo(false); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }}><img className="help-logo" src="./brand/las-palmas-logo.png" alt="Las Palmas Rutas" /><h2 id="help-title" tabIndex={-1}>Te ayudamos a encontrar tu combi</h2><ol className="help-steps"><li><strong>Elige desde dónde sales.</strong><p>Pulsa «Mi ubicación» o escribe el nombre de una calle, negocio o parada. Toca el resultado que buscas.</p></li><li><strong>Elige a dónde vas.</strong><p>Escribe tu destino o toca un lugar sugerido. Revisa que los dos lugares sean correctos.</p></li><li><strong>Pulsa «Ver cómo llegar».</strong><p>Verás qué combi tomar, dónde bajar y si debes cambiar de combi. Las rutas de tu viaje se resaltan en el mapa.</p></li></ol><p><strong>¿Solo quieres conocer una ruta?</strong> Toca «Ver rutas» y elige una. Se abrirán su inicio, su término y todas sus paradas.</p>{'speechSynthesis' in window && <button className="secondary-button" onClick={() => { window.speechSynthesis.cancel(); const speech = new SpeechSynthesisUtterance('Para buscar tu combi, primero elige desde dónde sales. Puedes pulsar Mi ubicación o escribir una calle. Segundo, escribe a dónde quieres ir y toca una sugerencia. Tercero, pulsa Ver cómo llegar. Lee las instrucciones para saber qué combi tomar y dónde bajar.'); speech.lang = 'es-MX'; speech.rate = 0.85; window.speechSynthesis.speak(speech); }}>Escuchar las instrucciones<Icon name="radio" /></button>}<button className="primary-button" onClick={() => setShowInfo(false)}>Entendido, quiero viajar<Icon name="check" /></button><details className="demo-information"><summary>Sobre esta demo y sus datos</summary><p>Rutas, paradas intermedias y tarifas de ejemplo. GPS real de choferes con cuenta y servicio activo. Sin señal reciente, la combi deja de mostrarse.</p><p>Las predicciones del modelo de tu equipo son experimentales: se entrenó con viajes ficticios. No conocemos la lluvia ni los semáforos reales. Las llegadas pueden cambiar.</p><p>La zona disponible rodea el corredor de Jugos Acapulco al entronque de la avenida Lázaro Cárdenas; no es el límite oficial de la ciudad.</p><p>{catalog.places.length} lugares y calles guardados. Datos © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL.</p></details></dialog>
  </>;
}
