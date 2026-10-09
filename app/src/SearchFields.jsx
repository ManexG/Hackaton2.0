import { useState } from 'react';
import { distance, searchPlaces } from './planner.js';
import { Icon } from './Icon.jsx';
import { VoiceButton } from './VoiceButton.jsx';
export function SearchFields(props) {
  const [index, setIndex] = useState(-1);
  const { active, text, network, origin } = props;
  const query = active ? text[active] : '';
  const local = active ? searchPlaces(query, network, origin?.point, 10) : [];
  const remote =
    props.online?.field === active && props.online.query === query ? props.online.places : [];
  const results = [...remote, ...local.filter((p) => !remote.some((r) => r.id === p.id))].slice(
    0,
    10
  );
  const selectedIndex = Math.max(0, Math.min(index, results.length - 1));
  function keyDown(event, field) {
    if (event.key === 'Escape') props.onClose();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      props.onFocus(field);
      setIndex(
        Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      );
    }
    if (event.key === 'Enter' && active && results.length) {
      event.preventDefault();
      props.onSelect(field, results[selectedIndex]);
      event.currentTarget.blur();
    }
  }
  function suggestions(field) {
    if (active !== field) return null;
    return (
      <div id="suggestions" role="listbox" aria-label="Lugares dentro de la zona">
        <div className="suggestion-heading">
          {query
            ? `${results.length} resultados. Toca el lugar que buscas:`
            : 'Toca un lugar o escribe para buscar:'}
        </div>
        {results.map((place, i) => (
          <button
            type="button"
            role="option"
            id={`suggestion-${i}`}
            aria-selected={i === selectedIndex}
            key={place.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onSelect(field, place)}
          >
            <span className="suggestion-icon">
              <Icon
                name={
                  place.kind === 'street'
                    ? 'map-pin'
                    : place.kind === 'business'
                      ? 'store'
                      : 'bus-front'
                }
              />
            </span>
            <span>
              <strong>{place.name}</strong>
              <small>
                {place.description}
                {origin ? ` · ${formatDistance(distance(origin.point, place.point))}` : ''}
              </small>
            </span>
            <Icon name="arrow-right" />
          </button>
        ))}
        {!results.length && (
          <div className="no-suggestions">
            No encontramos ese lugar guardado.
            <small>Prueba la búsqueda en línea o elige su punto en el mapa.</small>
          </div>
        )}
        {query.trim().length >= 3 && (
          <button
            type="button"
            className="online-search"
            disabled={props.loading}
            onClick={() => props.onOnline(field)}
          >
            <Icon name={props.loading ? 'loading' : 'search'} />
            {props.loading ? 'Buscando dentro de la zona…' : 'Buscar dirección o negocio en línea'}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="search-box">
      <div className="fields">
        {['origin', 'destination'].map((field, i) => (
          <div className={`field ${props[field] ? 'field-chosen' : ''}`} key={field}>
            <label htmlFor={field}>
              {field === 'origin' ? '¿Desde dónde sales?' : '¿A dónde vas?'}
            </label>
            {field === 'origin' && (
              <button
                type="button"
                className="location-button secondary-button"
                disabled={props.loadingLocation}
                onClick={props.onLocation}
              >
                <Icon name={props.loadingLocation ? 'loading' : 'locate-fixed'} />
                {props.loadingLocation ? 'Obteniendo ubicación…' : 'Mi ubicación'}
              </button>
            )}
            <div className="field-input">
              <input
                id={field}
                autoComplete="off"
                spellCheck={false}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={active === field}
                aria-controls={active === field ? 'suggestions' : undefined}
                aria-activedescendant={
                  active === field && results.length ? `suggestion-${selectedIndex}` : undefined
                }
                value={text[field]}
                placeholder={
                  field === 'origin'
                    ? 'O escribe una calle o un lugar'
                    : 'Escribe un negocio, calle o número'
                }
                onFocus={() => {
                  setIndex(-1);
                  props.onFocus(field);
                }}
                onChange={(event) => {
                  setIndex(-1);
                  props.onChange(field, event.target.value);
                }}
                onKeyDown={(event) => keyDown(event, field)}
              />
            </div>
            <div className="field-utilities">
              <VoiceButton
                label={field === 'origin' ? 'origen' : 'destino'}
                onText={(value) => {
                  setIndex(-1);
                  props.onChange(field, value);
                  props.onFocus(field);
                }}
                onMessage={props.onMessage}
              />
              {props[field] && (
                <span className="field-confirmation">
                  <Icon name="check" />
                  {field === 'origin' ? 'Origen elegido' : 'Destino elegido'}
                </span>
              )}
            </div>
            {suggestions(field)}
          </div>
        ))}
      </div>
      {origin && props.destination && (
        <button className="swap-button" type="button" onClick={props.onSwap}>
          <Icon name="arrow-up-down" />
          Intercambiar origen y destino
        </button>
      )}
    </div>
  );
}
export function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}
