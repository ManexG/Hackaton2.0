import { useState } from 'react';
import { distance, searchPlaces } from './planner';
import { Icon } from './Icon';
import type { Network, Place } from './types';
export type FieldName = 'origin' | 'destination';
interface Props {
  network: Network;
  origin: Place | null;
  text: Record<FieldName, string>;
  active: FieldName | null;
  online: { field: FieldName; query: string; places: Place[] } | null;
  loading: boolean;
  onFocus: (field: FieldName) => void;
  onChange: (field: FieldName, value: string) => void;
  onSelect: (field: FieldName, place: Place) => void;
  onClose: () => void;
  onOnline: (field: FieldName) => void;
  onSwap: () => void;
}
export function SearchFields(props: Props) {
  const [index, setIndex] = useState(-1);
  const { active, text, network, origin } = props;
  const query = active ? text[active] : '';
  const local = active ? searchPlaces(query, network, origin?.point, 10) : [];
  const remote = props.online?.field === active && props.online.query === query ? props.online.places : [];
  const results = [...remote, ...local.filter(p => !remote.some(r => r.id === p.id))].slice(0, 10);
  const selectedIndex = Math.max(0, Math.min(index, results.length - 1));
  function keyDown(event: React.KeyboardEvent<HTMLInputElement>, field: FieldName) {
    if (event.key === 'Escape') props.onClose();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); props.onFocus(field); setIndex(Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
    if (event.key === 'Enter' && active && results.length) { event.preventDefault(); props.onSelect(field, results[selectedIndex]); event.currentTarget.blur(); }
  }
  return <div className="search-box">
    <div className="field-icons"><span className="origin-dot" /><span className="vertical-dots" /><Icon name="map-pin" /></div>
    <div className="fields">{(['origin', 'destination'] as FieldName[]).map(field => <div className="field" key={field}>
      <label htmlFor={field}>{field === 'origin' ? 'TU PUNTO DE PARTIDA' : '¿A DÓNDE VAMOS?'}</label>
      <input id={field} autoComplete="off" spellCheck={false} role="combobox" aria-autocomplete="list" aria-expanded={active === field} aria-controls="suggestions" aria-activedescendant={active === field && index >= 0 ? `suggestion-${selectedIndex}` : undefined} value={text[field]} placeholder={field === 'origin' ? 'Elige tu origen o usa tu ubicación' : 'Negocio, lugar, calle o número…'} onFocus={() => { setIndex(-1); props.onFocus(field); }} onChange={event => { setIndex(-1); props.onChange(field, event.target.value); }} onKeyDown={event => keyDown(event, field)} />
    </div>)}</div>
    <button className="swap-button" type="button" aria-label="Intercambiar origen y destino" onClick={props.onSwap}><Icon name="arrow-up-down" /></button>
    {active && <div id="suggestions" role="listbox" aria-label="Lugares dentro de la zona"><div className="suggestion-heading">{query ? `${results.length} COINCIDENCIAS EN LA ZONA` : origin ? 'CERCA DE TU ORIGEN' : 'LUGARES Y CALLES DE LA ZONA'}</div>
      {results.map((place, i) => <button type="button" role="option" id={`suggestion-${i}`} aria-selected={i === index} key={place.id} onMouseDown={event => event.preventDefault()} onClick={() => props.onSelect(active, place)}>
        <span className="suggestion-icon"><Icon name={place.kind === 'street' ? 'map-pin' : place.kind === 'business' ? 'store' : 'bus-front'} /></span><span><strong>{place.name}</strong><small>{place.description}{origin ? ` · ${formatDistance(distance(origin.point, place.point))}` : ''}</small></span><Icon name="arrow-right" />
      </button>)}
      {!results.length && <div className="no-suggestions">No aparece en el catálogo guardado.<small>Busca la dirección en línea o elige su ubicación en el mapa. Las consultas se limitan a esta zona.</small></div>}
      {query.trim().length >= 3 && <button type="button" className="online-search" disabled={props.loading} onClick={() => props.onOnline(active)}><Icon name={props.loading ? 'loading' : 'search'} />{props.loading ? 'Buscando dentro de la zona…' : 'Buscar dirección o negocio en línea'}</button>}
    </div>}
  </div>;
}
export function formatDistance(meters: number) { return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`; }
