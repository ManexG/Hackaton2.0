import { useMemo, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { distance, nearbyPlaces, planJourneys } from './planner';
import { formatDistance } from './SearchFields';
import type { Network, Place, Point } from './types';
const categories: { id: string; label: string; icon: IconName }[] = [{ id: 'all', label: 'Cerca', icon: 'locate-fixed' }, { id: 'food', label: 'Comer', icon: 'coffee' }, { id: 'shopping', label: 'Compras', icon: 'shopping' }, { id: 'health', label: 'Salud', icon: 'health' }, { id: 'interest', label: 'Interés', icon: 'trees' }, { id: 'street', label: 'Calles', icon: 'map-pin' }];
export function ExplorePlaces({ network, origin, onSelect }: { network: Network; origin: Place | null; onSelect: (place: Place) => void }) {
  const [category, setCategory] = useState('all');
  const near: Point = origin?.point ?? [(network.coverage.bounds[0][0] + network.coverage.bounds[1][0]) / 2, (network.coverage.bounds[0][1] + network.coverage.bounds[1][1]) / 2];
  const places = useMemo(() => nearbyPlaces(network, near, category, 5), [network, near[0], near[1], category]);
  return <section className="explore-places" aria-label="Lugares cercanos y de interés"><div className="section-heading"><div><h2>{origin ? 'Descubre cerca de ti' : '¿A dónde te gustaría ir?'}</h2><p>{origin ? `Cerca de ${origin.name.replace(' · demo', '')}` : 'Lugares y calles dentro de la zona'}</p></div><Icon name="sparkles" /></div>
    <div className="category-chips" aria-label="Categorías de lugares">{categories.map(item => <button key={item.id} aria-pressed={category === item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}><Icon name={item.icon} />{item.label}</button>)}</div>
    <div className="nearby-list">{places.map(place => { const journey = origin ? planJourneys(origin, place, network)[0] : null; return <button className="nearby-place" key={place.id} onClick={() => onSelect(place)}><span className="nearby-icon"><Icon name={place.kind === 'street' ? 'map-pin' : place.category === 'food' ? 'coffee' : place.category === 'health' ? 'health' : 'store'} /></span><span><strong>{place.name}</strong><small>{place.address || place.description.split(' · ')[0]}{origin ? ` · ${formatDistance(distance(origin.point, place.point))}` : ''}</small>{journey && <span className="nearby-route">{journey.legs.map(leg => leg.routeId).join(' → ')} · {journey.totalMinutes} min · {journey.transfers ? `${journey.transfers} trasbordo` : 'directa'}</span>}</span><Icon name="chevron-right" /></button>; })}</div>
    {!places.length && <p className="walking-note">No hay lugares guardados en esta categoría. Prueba otra categoría o busca en línea.</p>}
    {!origin && <p className="explore-hint">Elige primero tu origen para ver qué combis te acercan a cada lugar.</p>}
  </section>;
}
