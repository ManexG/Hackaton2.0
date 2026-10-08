import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import { makeLeg } from './planner';
import { scheduleLabel, stopArrivals } from './transit';
import type { Fleet } from './useFleet';
import type { Network, Route, Stop } from './types';

export function RouteExplorer({ network, selected, reversed, fleet, onSelect, onReverse, onStop }: { network: Network; selected: Route | null; reversed: boolean; fleet: Fleet; onSelect: (id: string) => void; onReverse: () => void; onStop: (stop: Stop) => void }) {
  const ids = selected ? reversed ? [...selected.stops].reverse() : selected.stops : [];
  const leg = selected ? makeLeg(selected, reversed ? selected.stops.length - 1 : 0, reversed ? 0 : selected.stops.length - 1) : null;
  const count = (id: string) => fleet.vehicles.filter(vehicle => vehicle.routeId === id).length;
  const service = fleet.snapshot?.services.find(service => service.routeId === selected?.id);
  return <><div className="section-heading"><div><h2>Una ciudad, cuatro caminos</h2><p>Trazados de prueba y disponibilidad de los choferes.</p></div></div><div id="route-list">{network.routes.map(route => <button className={`route-card ${selected?.id === route.id ? 'selected' : ''}`} style={{ '--route-color': route.color } as CSSProperties} key={route.id} onClick={() => onSelect(route.id)} aria-pressed={selected?.id === route.id}>
    <span className="route-card-icon"><Icon name="bus-front" /><b>{route.id}</b></span><span><strong>{route.name}</strong><small>{network.stops.find(s => s.id === route.stops[0])!.name.replace(' · demo', '')}<br />↳ {network.stops.find(s => s.id === route.stops.at(-1))!.name.replace(' · demo', '')}</small><span className={`route-availability ${count(route.id) ? 'available' : ''}`}>{fleet.status === 'connected' ? count(route.id) ? `${count(route.id)} en servicio` : 'Sin combis activas' : 'Disponibilidad sin conexión'}</span></span><Icon name="chevron-right" /></button>)}</div>
    {selected && <div id="route-detail" className="route-detail" style={{ '--route-color': selected.color } as CSSProperties}><div className="route-detail-title"><h3>De inicio a fin</h3><button className="direction-button" onClick={onReverse} disabled={!selected.bidirectional}><Icon name="arrow-right-left" />{reversed ? 'Regreso' : 'Ida'}</button></div><div className="route-facts"><span><Icon name="clock-3" />{leg!.rideMinutes} min aprox.</span><span>${selected.fare} MXN</span><span>{ids.length} paradas</span></div>
      <div className="route-hours"><strong>Horario de disponibilidad</strong><p>{scheduleLabel(service?.windows ?? [])}</p><small>Hora de Lázaro Cárdenas · sujeto a choferes conectados</small></div>
      <ol className="stop-list">{ids.map((id, i) => { const stop = network.stops.find(stop => stop.id === id)!; const next = stopArrivals(id, network, fleet.vehicles.filter(vehicle => vehicle.routeId === selected.id), fleet.now, reversed ? -1 : 1)[0]; return <li key={id}><span>{i === 0 ? 'A' : i === ids.length - 1 ? 'B' : ''}</span><button className="stop-item" onClick={() => onStop(stop)} aria-label={`Consultar parada ${stop.name.replace(' · demo', '')}`}><div>{stop.name.replace(' · demo', '')}{i === 0 ? <small>INICIO</small> : i === ids.length - 1 ? <small>TÉRMINO</small> : null}{next && <small className="stop-next">{next.vehicle.unit} · {next.seconds < 30 ? 'llegando' : `aprox. ${Math.ceil(next.seconds / 60)} min`}</small>}</div><Icon name="chevron-right" /></button></li>; })}</ol><p className="small-note">Elige una parada para consultar llegadas o generar su QR. Los trazados y las tarifas se sustituirán por datos reales.</p></div>}
  </>;
}
