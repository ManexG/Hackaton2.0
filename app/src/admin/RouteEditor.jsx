import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MapPin,
  Plus,
  RotateCcw,
  Route as RouteIcon,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { addStreetMap } from '../streetMap.js';
import { insideCoverage, searchPlaces } from '../planner.js';
import { geocodeInCoverage } from '../geocoding.js';
import { manage } from './adminApi.js';

const blank = {
  id: null,
  name: '',
  color: '#238361',
  fare: 12,
  headway: 10,
  bidirectional: true,
  stops: [],
  segments: [],
};
let counter = 0;
const newKey = () => 'k' + ++counter;
const pairKey = (a, b) => a + '>' + b;

/** Lista de rutas + editor en la misma pestaña, con mapa interactivo. */
export function RoutesTab({ network, token, notify, onChanged }) {
  const [data, setData] = useState({ routes: [], hiddenDemoRoutes: [] });
  const [editing, setEditing] = useState(null); // null = solo lista
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setData(await manage('/routes', { token }));
    } catch (error) {
      notify(error.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function afterChange(message, next) {
    if (next) setData(next);
    else await load();
    await onChanged?.();
    if (message) notify(message);
  }
  async function remove(route) {
    if (
      !confirm(
        `¿Borrar la ruta "${route.name}"?${route.demo ? ' Podrás restaurarla después.' : ''}`
      )
    )
      return;
    try {
      await manage('/routes/' + route.id, { method: 'DELETE', token });
      if (editing?.id === route.id) setEditing(null);
      await afterChange('Ruta eliminada.');
    } catch (error) {
      notify(error.message, true);
    }
  }
  async function restore(id) {
    try {
      const next = await manage(id ? `/routes/${id}/restore` : '/routes/restore-demo', {
        body: {},
        token,
      });
      setEditing(null);
      await afterChange(id ? 'Ruta demo restaurada.' : 'Rutas demo restauradas.', next);
    } catch (error) {
      notify(error.message, true);
    }
  }

  return (
    <div className="admin-routes">
      <aside className="admin-route-list" aria-label="Rutas disponibles">
        <div className="admin-row">
          <h2>Rutas</h2>
          <button className="admin-btn primary" onClick={() => setEditing({ ...blank })}>
            <Plus size={16} /> Agregar
          </button>
        </div>
        {loading && <p className="admin-muted">Cargando rutas…</p>}
        <ul>
          {data.routes.map((route) => (
            <li key={route.id} className={editing?.id === route.id ? 'selected' : ''}>
              <span className="admin-swatch" style={{ background: route.color }} />
              <button className="admin-link" onClick={() => setEditing(route)}>
                <strong>{route.name}</strong>
                <small>
                  {route.id} · {route.stops.length} paradas · {route.assignedDrivers} chofer(es)
                  {route.demo && (route.edited ? ' · demo editada' : ' · demo')}
                </small>
              </button>
              <button
                className="admin-icon"
                aria-label={`Editar ${route.name}`}
                onClick={() => setEditing(route)}
              >
                <RouteIcon size={16} />
              </button>
              <button
                className="admin-icon danger"
                aria-label={`Borrar ${route.name}`}
                onClick={() => remove(route)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
        {data.hiddenDemoRoutes.length > 0 && (
          <div className="admin-hidden">
            <p className="admin-muted">Rutas demo ocultas:</p>
            {data.hiddenDemoRoutes.map((route) => (
              <button key={route.id} className="admin-btn" onClick={() => restore(route.id)}>
                <RotateCcw size={14} /> Restaurar {route.name}
              </button>
            ))}
          </div>
        )}
        {data.routes.some((route) => route.demo && route.edited) && (
          <button className="admin-btn" onClick={() => restore(null)}>
            <RotateCcw size={14} /> Restaurar todas las demo
          </button>
        )}
      </aside>
      <RouteMapEditor
        key={editing ? (editing.id ?? 'nueva') + ':' + (editing.edited ?? '') : 'lista'}
        network={network}
        routes={data.routes}
        route={editing}
        token={token}
        notify={notify}
        onCancel={() => setEditing(null)}
        onRestore={() => editing?.demo && restore(editing.id)}
        onSaved={async (saved) => {
          setEditing(saved);
          await afterChange('Ruta guardada.');
        }}
      />
    </div>
  );
}

function RouteMapEditor({ network, routes, route, token, notify, onCancel, onSaved, onRestore }) {
  const container = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [form, setForm] = useState(() => (route ? toForm(route) : null));
  const [adding, setAdding] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState('');
  const dragFrom = useRef(null);
  const latest = useRef({});
  latest.current = { form, adding };

  const editing = Boolean(form);
  const update = (patch) => setForm((current) => ({ ...current, ...patch }));
  const updateStops = (stops, dropSegments = []) =>
    setForm((current) => {
      const segments = new Map(current.segments);
      for (const key of dropSegments) segments.delete(key);
      return { ...current, stops, segments };
    });

  // Mapa: se crea una sola vez.
  useEffect(() => {
    const bounds = L.latLngBounds(network.coverage.bounds);
    const instance = L.map(container.current, {
      maxBounds: bounds,
      maxBoundsViscosity: 1,
      minZoom: 13,
      maxZoom: 18,
      zoomSnap: 0.25,
      fadeAnimation: false,
    });
    instance.fitBounds(bounds, { animate: false });
    instance.attributionControl.setPrefix(false);
    L.polygon(network.coverage.polygon, {
      color: '#173e31',
      weight: 1.5,
      dashArray: '6 6',
      fill: false,
      interactive: false,
    }).addTo(instance);
    addStreetMap(instance, network, { interactiveSignals: false });
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    instance.on('click', (event) => {
      const { form: f, adding: on } = latest.current;
      if (!f || !on) return;
      const point = [Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))];
      addStop(point, `Parada ${f.stops.length + 1}`);
    });
    const resizeTimer = setTimeout(() => instance.invalidateSize(), 50);
    return () => {
      clearTimeout(resizeTimer);
      instance.remove();
    };
  }, []);

  function addStop(point, name) {
    if (!insideCoverage(point, network)) {
      notify('Ese punto está fuera de la zona de cobertura.', true);
      return;
    }
    setForm((current) => ({
      ...current,
      stops: [...current.stops, { key: newKey(), id: null, name, point }],
    }));
  }

  // Dibujo de rutas, línea en edición y paradas arrastrables.
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    for (const other of routes) {
      if (other.id === form?.id) continue;
      for (const segment of other.segments)
        L.polyline(segment, {
          color: other.color,
          weight: 4,
          opacity: form ? 0.25 : 0.8,
          interactive: false,
        }).addTo(group);
    }
    if (!form) return;
    form.stops.forEach((stop, i) => {
      const next = form.stops[i + 1];
      if (!next) return;
      const line = form.segments.get(pairKey(stop.key, next.key)) ?? [stop.point, next.point];
      L.polyline(line, {
        color: form.color,
        weight: 6,
        opacity: 0.95,
        dashArray: form.segments.has(pairKey(stop.key, next.key)) ? undefined : '2 8',
        interactive: false,
      }).addTo(group);
    });
    form.stops.forEach((stop, i) => {
      const marker = L.marker(stop.point, {
        draggable: true,
        title: stop.name,
        icon: L.divIcon({
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          html: `<span class="admin-pin" style="--c:${form.color}">${i + 1}</span>`,
        }),
      }).addTo(group);
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        const point = [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
        if (!insideCoverage(point, network)) {
          notify('Ese punto está fuera de la zona de cobertura.', true);
          marker.setLatLng(stop.point);
          return;
        }
        setForm((current) => {
          const index = current.stops.findIndex((s) => s.key === stop.key);
          const stops = current.stops.map((s) => (s.key === stop.key ? { ...s, point } : s));
          const segments = new Map(current.segments);
          if (index > 0) segments.delete(pairKey(current.stops[index - 1].key, stop.key));
          if (index < current.stops.length - 1)
            segments.delete(pairKey(stop.key, current.stops[index + 1].key));
          return { ...current, stops, segments };
        });
      });
    });
  }, [form, routes]);

  // Al abrir una ruta, enfocarla.
  useEffect(() => {
    if (form?.stops.length && map.current)
      map.current.fitBounds(L.latLngBounds(form.stops.map((s) => s.point)).pad(0.3), {
        animate: false,
        maxZoom: 17,
      });
  }, []);

  const localResults = useMemo(
    () => (query.trim().length >= 2 ? searchPlaces(query, network, null, 5) : []),
    [query, network]
  );

  async function onlineSearch() {
    setBusy('search');
    try {
      setResults(await geocodeInCoverage(query, network));
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy('');
    }
  }

  async function trace() {
    if (form.stops.length < 2) return;
    setBusy('trace');
    try {
      const result = await manage('/routes/trace', {
        body: { points: form.stops.map((s) => s.point) },
        token,
      });
      setForm((current) => {
        const segments = new Map(current.segments);
        result.segments.forEach((segment, i) =>
          segments.set(pairKey(current.stops[i].key, current.stops[i + 1].key), segment)
        );
        return { ...current, segments };
      });
      notify('Recorrido trazado por calles. Revísalo y guarda.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy('');
    }
  }

  async function save(event) {
    event.preventDefault();
    if (form.stops.length < 2) {
      notify('Agrega al menos dos paradas en el mapa o por dirección.', true);
      return;
    }
    setBusy('save');
    try {
      const body = {
        name: form.name,
        color: form.color,
        fare: Number(form.fare),
        headway: Number(form.headway),
        bidirectional: form.bidirectional,
        stops: form.stops.map((s) => ({ id: s.id ?? undefined, name: s.name, point: s.point })),
        segments: form.stops
          .slice(1)
          .map((s, i) => form.segments.get(pairKey(form.stops[i].key, s.key)) ?? null),
      };
      const saved = await manage(form.id ? '/routes/' + form.id : '/routes', {
        method: form.id ? 'PUT' : 'POST',
        body,
        token,
      });
      await onSaved(saved);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy('');
    }
  }

  function move(from, to) {
    if (to < 0 || to >= form.stops.length || from === to) return;
    const stops = [...form.stops];
    stops.splice(to, 0, stops.splice(from, 1)[0]);
    updateStops(stops);
  }
  function removeStop(index) {
    const stop = form.stops[index];
    updateStops(
      form.stops.filter((_, i) => i !== index),
      [...form.segments.keys()].filter((k) => k.split('>').includes(stop.key))
    );
  }

  return (
    <section className="admin-editor">
      <div
        className="admin-map"
        ref={container}
        role="application"
        aria-label="Mapa de edición de rutas"
      />
      {!editing ? (
        <p className="admin-hint">
          Elige una ruta para editarla o pulsa <strong>Agregar</strong> para crear una nueva.
        </p>
      ) : (
        <form className="admin-form" onSubmit={save}>
          <div className="admin-row">
            <h3>{form.id ? `Editar ${form.id}` : 'Nueva ruta'}</h3>
            <button
              type="button"
              className="admin-icon"
              aria-label="Cerrar editor"
              onClick={onCancel}
            >
              <X size={18} />
            </button>
          </div>
          <div className="admin-grid">
            <label>
              Nombre
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={form.color}
                onChange={(e) => update({ color: e.target.value })}
              />
            </label>
            <label>
              Tarifa (MXN)
              <input
                type="number"
                min="0"
                max="500"
                step="0.5"
                value={form.fare}
                onChange={(e) => update({ fare: e.target.value })}
              />
            </label>
            <label>
              Cada (min)
              <input
                type="number"
                min="0"
                max="240"
                value={form.headway}
                onChange={(e) => update({ headway: e.target.value })}
              />
            </label>
          </div>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={form.bidirectional}
              onChange={(e) => update({ bidirectional: e.target.checked })}
            />
            Ida y vuelta
          </label>

          <div className="admin-row">
            <h4>Paradas ({form.stops.length})</h4>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={adding}
                onChange={(e) => setAdding(e.target.checked)}
              />
              <MapPin size={14} /> Agregar con clic en el mapa
            </label>
          </div>

          <div className="admin-search">
            <input
              type="search"
              placeholder="Agregar por dirección o lugar…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setResults([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (query.trim().length >= 2) onlineSearch();
                }
              }}
            />
            <button
              type="button"
              className="admin-btn"
              disabled={busy === 'search' || query.trim().length < 2}
              onClick={onlineSearch}
            >
              <Search size={14} /> Buscar en línea
            </button>
          </div>
          {[...localResults, ...results].length > 0 && (
            <ul className="admin-results">
              {[...localResults, ...results].map((place) => (
                <li key={place.id + place.name}>
                  <button
                    type="button"
                    className="admin-link"
                    onClick={() => {
                      addStop(place.point, String(place.name).slice(0, 80));
                      setQuery('');
                      setResults([]);
                    }}
                  >
                    <strong>{place.name}</strong>
                    {place.description && <small>{place.description}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <ol className="admin-stops">
            {form.stops.map((stop, i) => (
              <li
                key={stop.key}
                draggable
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom.current !== null) move(dragFrom.current, i);
                  dragFrom.current = null;
                }}
              >
                <span className="admin-grip" aria-hidden="true">
                  <GripVertical size={16} />
                </span>
                <b>{i + 1}</b>
                <input
                  aria-label={`Nombre de la parada ${i + 1}`}
                  required
                  maxLength={80}
                  value={stop.name}
                  onChange={(e) =>
                    updateStops(
                      form.stops.map((s) =>
                        s.key === stop.key ? { ...s, name: e.target.value } : s
                      )
                    )
                  }
                />
                <button
                  type="button"
                  className="admin-icon"
                  aria-label="Subir"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="admin-icon"
                  aria-label="Bajar"
                  disabled={i === form.stops.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="admin-icon danger"
                  aria-label={`Quitar parada ${i + 1}`}
                  onClick={() => removeStop(i)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
          {form.stops.length === 0 && (
            <p className="admin-muted">
              Haz clic en el mapa o busca una dirección para añadir la primera parada.
            </p>
          )}
          <p className="admin-muted">
            Arrastra las paradas por el mapa o por la lista para cambiar su posición y su orden. Las
            líneas punteadas son rectas hasta que las trazas por calles.
          </p>
          <div className="admin-actions">
            <button
              type="button"
              className="admin-btn"
              disabled={form.stops.length < 2 || busy === 'trace'}
              onClick={trace}
            >
              <RouteIcon size={14} /> {busy === 'trace' ? 'Trazando…' : 'Trazar por calles'}
            </button>
            {route?.demo && route.edited && (
              <button type="button" className="admin-btn" onClick={onRestore}>
                <RotateCcw size={14} /> Restaurar original
              </button>
            )}
            <button className="admin-btn primary" disabled={busy === 'save'}>
              <Save size={14} /> {busy === 'save' ? 'Guardando…' : 'Guardar ruta'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function toForm(route) {
  const stops = route.stops.map((s) => ({ key: newKey(), id: s.id, name: s.name, point: s.point }));
  const segments = new Map();
  (route.segments ?? []).forEach((segment, i) => {
    if (stops[i + 1]) segments.set(pairKey(stops[i].key, stops[i + 1].key), segment);
  });
  return {
    id: route.id,
    name: route.name,
    color: route.color,
    fare: route.fare,
    headway: route.headway,
    bidirectional: route.bidirectional,
    stops,
    segments,
  };
}
