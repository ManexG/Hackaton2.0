import L from 'leaflet';

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// The bundled OSM street geometry is rendered as a flat map, without raster tiles,
// building footprints or tile boundaries. Street names remain available offline.
export function addStreetMap(map, network) {
  if (!map.getPane('localMap')) map.createPane('localMap');
  map.getPane('localMap').style.zIndex = '150';
  map.getPane('localMap').style.pointerEvents = 'none';
  if (!map.getPane('streetNames')) map.createPane('streetNames');
  map.getPane('streetNames').style.zIndex = '260';
  map.getPane('streetNames').style.pointerEvents = 'none';
  const streets = network.places.filter((p) => p.streetSegments?.length);
  const labels = L.layerGroup().addTo(map);
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
    map.off('zoomend moveend resize', redrawNames);
    labels.remove();
  };
}
