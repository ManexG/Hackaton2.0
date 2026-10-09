import L from 'leaflet';
import traffic from './data/traffic-signals.osm.json' with { type: 'json' };
import { insideCoverage } from './planner.js';

export const trafficSignalSvg =
  '<svg viewBox="0 0 24 36" aria-hidden="true"><rect x="4" y="1" width="16" height="29" rx="5" fill="#26382c" stroke="white" stroke-width="2"/><circle cx="12" cy="8" r="3" fill="#ef6d59"/><circle cx="12" cy="15" r="3" fill="#f4cf54"/><circle cx="12" cy="22" r="3" fill="#7fbc74"/><path d="M12 30v5" stroke="#26382c" stroke-width="3"/></svg>';

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// The bundled OSM street geometry is rendered as a flat map, without raster tiles,
// building footprints or tile boundaries. Street names remain available offline.
export function addStreetMap(map, network, options = {}) {
  let disposed = false;
  if (!map.getPane('localMap')) map.createPane('localMap');
  map.getPane('localMap').style.zIndex = '150';
  map.getPane('localMap').style.pointerEvents = 'none';
  if (!map.getPane('streetNames')) map.createPane('streetNames');
  map.getPane('streetNames').style.zIndex = '260';
  map.getPane('streetNames').style.pointerEvents = 'none';
  const streets = network.places.filter((p) => p.streetSegments?.length);
  const labels = L.layerGroup().addTo(map);
  const signals = L.layerGroup().addTo(map);
  if (!map.getPane('trafficSignals')) map.createPane('trafficSignals');
  map.getPane('trafficSignals').style.zIndex = '460';
  for (const signal of traffic.signals) {
    if (!insideCoverage(signal.point, network)) continue;
    L.marker(signal.point, {
      pane: 'trafficSignals',
      bubblingMouseEvents: true,
      interactive: options.interactiveSignals !== false,
      keyboard: options.interactiveSignals !== false,
      title: 'Semáforo · OpenStreetMap',
      icon: L.divIcon({
        className: 'traffic-signal-marker',
        html: trafficSignalSvg,
        iconSize: [24, 36],
        iconAnchor: [12, 28],
      }),
    })
      .addTo(signals)
      .on('click', () => {
        if (options.isPicking?.()) return;
        L.popup()
          .setLatLng(signal.point)
          .setContent(
            '<strong>Semáforo</strong><p>Ubicación de OpenStreetMap. No indica el color actual ni tráfico en vivo.</p><a target="_blank" rel="noopener" href="' +
              signal.osmUrl +
              '">Ver en OpenStreetMap</a>'
          )
          .openOn(map);
      });
  }
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const element = L.DomUtil.create('div', 'traffic-signal-legend');
    element.innerHTML = trafficSignalSvg + '<span>Semáforos · OpenStreetMap</span>';
    L.DomEvent.disableClickPropagation(element);
    return element;
  };
  legend.addTo(map);
  for (const street of streets) {
    L.polyline(street.streetSegments, {
      pane: 'localMap',
      color: '#fff',
      weight: /Avenida|Boulevard/.test(street.name) ? 9 : 5,
      opacity: 1,
      interactive: false,
    }).addTo(map);
  }
  map.attributionControl?.setPrefix(false);
  map.attributionControl?.addAttribution(
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  );
  function redrawNames() {
    if (disposed) return;
    labels.clearLayers();
    const zoom = map.getZoom();
    const boxes = [];
    const names = new Set();
    const bounds = map.getBounds();
    const candidates = [...streets].sort(
      (a, b) => Number(/Avenida|Boulevard/.test(b.name)) - Number(/Avenida|Boulevard/.test(a.name))
    );
    for (const street of candidates) {
      if (zoom < 15.5 && !/Avenida|Boulevard/.test(street.name)) continue;
      if (!bounds.contains(street.point) || names.has(street.name)) continue;
      const p = map.latLngToContainerPoint(street.point);
      const width = Math.min(250, Math.max(65, street.name.length * 6.2));
      const box = [p.x - width / 2 - 6, p.y - 12, p.x + width / 2 + 6, p.y + 12];
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]))
        continue;
      boxes.push(box);
      names.add(street.name);
      L.marker(street.point, {
        pane: 'streetNames',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'flat-street-name',
          html: escape(street.name),
          iconSize: [width, 20],
          iconAnchor: [width / 2, 10],
        }),
      }).addTo(labels);
    }
  }
  map.on('zoomend moveend resize', redrawNames);
  redrawNames();
  return () => {
    if (disposed) return;
    disposed = true;
    map.off('zoomend moveend resize', redrawNames);
    labels.remove();
    signals.remove();
    legend.remove();
  };
}
