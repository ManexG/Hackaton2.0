import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import type { Journey, Network } from './types';
import type { LiveJourney } from './transit';
const stopName = (network: Network, id: string) => network.stops.find(stop => stop.id === id)!.name.replace(' · demo', '');
export function JourneyResults({ journeys, selected, network, onSelect, onSimulate }: { journeys: LiveJourney[]; selected: LiveJourney; network: Network; onSelect: (journey: Journey) => void; onSimulate: () => void }) {
  return <div id="results" aria-live="polite"><div className="section-heading"><div><h2>Tu mejor camino</h2><p className="destination-context">Hacia {selected.destination.name.replace(' · demo', '')}</p></div><span className="estimate-label">ESTIMADOS</span></div>
    <div className="journey-list">{journeys.map((journey, i) => <button className={`journey-card ${journey.id === selected.id ? 'selected' : ''}`} key={journey.id} onClick={() => onSelect(journey)} aria-pressed={journey.id === selected.id}>
      <div className="journey-top"><span className={`journey-tag ${i === 0 ? 'recommended' : ''}`}>{i === 0 ? <><Icon name="sparkles" />Recomendada para tu destino</> : journey.transfers ? 'Otra conexión' : 'Otra opción'}</span><span className="selection-circle">{journey.id === selected.id && <Icon name="check" />}</span></div>
      <div className="journey-main"><strong>{journey.totalMinutes}<small> min</small></strong><div className="journey-price">${journey.fare} <small>MXN</small><span>tarifa simulada</span></div></div>
      <div className="journey-lines">{journey.legs.map((leg, index) => { const route = network.routes.find(route => route.id === leg.routeId)!; return <span className="leg-chip-group" key={`${leg.routeId}-${leg.from}`}>{index > 0 && <Icon name="chevron-right" className="connection-chevron" />}<span className="route-pill" style={{ '--route-color': route.color } as CSSProperties}><Icon name="bus-front" />{leg.routeId}</span></span>; })}<span className="journey-kind">{journey.transfers ? `${journey.transfers} trasbordo${journey.transfers > 1 ? 's' : ''}` : 'Sin trasbordos'}</span></div>
      <div className="journey-meta"><span><Icon name="footprints" />{journey.walkMeters < 25 ? 'Paradas junto a tus puntos' : `${journey.walkMeters} m a pie`}</span><span><Icon name="radio" />{journey.arrivals[0].vehicle.unit} · {journey.arrivals[0].seconds < 30 ? 'llegando' : `llega en ~${Math.ceil(journey.arrivals[0].seconds / 60)} min`}</span></div>
    </button>)}</div>
    <div id="journey-detail"><details className="journey-steps" key={selected.id} open={selected.transfers > 0 ? true : undefined}><summary>Tu recorrido, paso a paso<Icon name="chevron-down" /></summary><ol>
      <li className="walk-step"><span className="step-symbol"><Icon name="map-pin" /></span><div><strong>{selected.origin.name.replace(' · demo', '')}</strong><span>Ve a {stopName(network, selected.legs[0].from)}</span></div></li>
      {selected.legs.map((leg, i) => { const route = network.routes.find(route => route.id === leg.routeId)!; const previousEnd = i ? selected.arrivals[i - 1].seconds + selected.legs[i - 1].rideMinutes * 60 + 30 : 0; return <LegSteps key={`${leg.routeId}-${leg.from}`} leg={leg} route={route} index={i} network={network} unit={selected.arrivals[i].vehicle.unit} wait={Math.ceil(Math.max(0, selected.arrivals[i].seconds - previousEnd) / 60)} />; })}
      <li className="walk-step"><span className="step-symbol"><Icon name="flag" /></span><div><strong>{selected.destination.name.replace(' · demo', '')}</strong><span>Baja en {stopName(network, selected.legs.at(-1)!.to)} y continúa al destino</span></div></li>
    </ol><p className="walking-note">Las caminatas se aproximan en línea recta; no son indicaciones peatonales verificadas.</p></details>
      <p className="walking-note">Recomendación según combis activas, sentido y señales GPS recientes. Llegadas y duración aproximadas; pueden cambiar por tráfico.</p><button className="simulate-button" onClick={onSimulate}><Icon name="navigation" />Vista previa del recorrido<span>ANIMACIÓN</span></button>
    </div>
  </div>;
}
function LegSteps({ leg, route, index, network, unit, wait }: { leg: Journey['legs'][number]; route: Network['routes'][number]; index: number; network: Network; unit: string; wait: number }) {
  return <>{index > 0 && <li className="transfer-step"><span className="step-symbol"><Icon name="arrow-right-left" /></span><div><strong>Haz tu trasbordo aquí</strong><span>{stopName(network, leg.from)} · espera estimada ~{wait} min</span></div></li>}<li style={{ '--route-color': route.color } as CSSProperties}><span className="step-symbol bus-step"><Icon name="bus-front" /></span><div><strong>Toma la {leg.routeId} · {route.name}</strong><span>{stopName(network, leg.from)} → {stopName(network, leg.to)}</span><small>Unidad {unit} · {leg.rideMinutes} min aprox. · ${route.fare} MXN simulados</small></div></li></>;
}
