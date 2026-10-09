import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import { addStreetMap } from './streetMap.js';
import { pilotZone } from './serviceZone.js';
import { distance, insideCoverage } from './planner.js';
const escape = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
function busIcon(route, mode) {
  return L.divIcon({
    className: `bus-marker ${mode}`,
    html: `<div class="bus-bubble" style="--route-color:${route.color}"><svg viewBox="0 0 30 30" fill="none" aria-hidden="true"><path d="M6 22V9a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v13H6Z" fill="white"/><rect x="8.5" y="8" width="13" height="7" rx="1.5" fill="${route.color}"/><path d="M15 8v7" stroke="white"/><circle cx="10" cy="19" r="1.5" fill="${route.color}"/><circle cx="20" cy="19" r="1.5" fill="${route.color}"/><path d="M9 22v3m12-3v3" stroke="white" stroke-width="3" stroke-linecap="round"/></svg><b>${route.id}</b></div>`,
    iconSize: [92, 48],
    iconAnchor: [46, 24],
  });
}
export const MapView = forwardRef(function MapView(props, ref) {
  const container = useRef(null);
  const map = useRef(null);
  const lines = useRef(new Map());
  const buses = useRef(new Map());
  const selection = useRef(null);
  const stops = useRef(null);
  const endpoints = useRef(null);
  const state = useRef(props);
  state.current = props;
  const [ready, setReady] = useState(0);
  const frame = useRef(0);
  const preview = useRef(null);
  const simulating = useRef(false);
  function fit(points) {
    const instance = map.current;
    if (!instance) return;
    const p = state.current;
    const target = points?.length
      ? points
      : p.selectedStop
        ? [p.selectedStop.point]
        : p.selectedRoute
          ? p.selectedRoute.segments.flat()
          : p.journey
            ? [
                ...p.journey.legs.flatMap((leg) => leg.geometry),
                p.journey.origin.point,
                p.journey.destination.point,
              ]
            : p.origin && p.destination
              ? [p.origin.point, p.destination.point]
              : pilotZone(p.network)
                ? [[p.network.pilotZone.lat, p.network.pilotZone.lng]]
                : p.network.routes.flatMap((route) => route.segments.flat());
    const mobile = window.innerWidth <= 760;
    instance.fitBounds(L.latLngBounds(target), {
      paddingTopLeft: mobile ? [40, 82] : [100, 125],
      paddingBottomRight: mobile ? [40, 55] : [100, 150],
      maxZoom: p.selectedStop ? 17 : p.journey || p.selectedRoute ? 16 : 15.5,
      animate: false,
    });
    instance.panInsideBounds(L.latLngBounds(p.network.coverage.bounds), { animate: false });
  }
  function stopSimulation() {
    cancelAnimationFrame(frame.current);
    preview.current?.remove();
    preview.current = null;
    if (simulating.current) {
      simulating.current = false;
      state.current.onSimulation(null);
      redraw();
    }
  }
  function simulate() {
    const journey = state.current.journey;
    if (!journey) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fit();
      state.current.onMessage('Tu recorrido ya está resaltado en el mapa.');
      return;
    }
    if (simulating.current) {
      stopSimulation();
      return;
    }
    simulating.current = true;
    preview.current = L.circleMarker(journey.legs[0].geometry[0], {
      radius: 9,
      color: '#ffffff',
      weight: 3,
      fillColor: '#173e31',
      fillOpacity: 1,
      interactive: false,
    }).addTo(map.current);
    const started = performance.now();
    function tick(now) {
      if (!simulating.current || !journey) return;
      const progress = Math.min((now - started) / 14000, 1),
        raw = progress * journey.legs.length;
      const index = Math.min(Math.floor(raw), journey.legs.length - 1),
        leg = journey.legs[index];
      const step = Math.min((raw - index) * (leg.geometry.length - 1), leg.geometry.length - 1);
      const at = Math.floor(step),
        next = Math.min(at + 1, leg.geometry.length - 1),
        ratio = step - at;
      preview.current?.setLatLng([
        leg.geometry[at][0] + (leg.geometry[next][0] - leg.geometry[at][0]) * ratio,
        leg.geometry[at][1] + (leg.geometry[next][1] - leg.geometry[at][1]) * ratio,
      ]);
      state.current.onSimulation(`Vista previa · ${leg.routeId}${index ? ' · trasbordo' : ''}`);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else {
        stopSimulation();
        state.current.onMessage(
          'Terminó la vista previa del recorrido. Este punto animado no representa a un chofer.'
        );
      }
    }
    frame.current = requestAnimationFrame(tick);
  }
  useImperativeHandle(ref, () => ({ fit, getMap: () => map.current, simulate, stopSimulation }));
  useEffect(() => {
    const { network } = state.current;
    const bounds = L.latLngBounds(network.coverage.bounds);
    const instance = L.map(container.current, {
      zoomControl: false,
      maxBounds: bounds,
      maxBoundsViscosity: 1,
      minZoom: 14,
      maxZoom: 18,
      zoomSnap: 0.25,
      fadeAnimation: false,
    });
    map.current = instance;
    instance.fitBounds(bounds, { animate: false });
    instance.attributionControl.setPrefix(false);
    for (const [name, z] of [
      ['localMap', 150],
      ['coverage', 300],
      ['routes', 410],
      ['selected', 420],
      ['mask', 450],
    ]) {
      instance.createPane(name);
      instance.getPane(name).style.zIndex = String(z);
    }
    instance.getPane('localMap').style.pointerEvents = 'none';
    addStreetMap(instance, network, { isPicking: () => Boolean(state.current.pinMode) });
    instance.getPane('mask').style.pointerEvents = 'none';
    L.polygon(network.coverage.polygon, {
      pane: 'coverage',
      color: '#8eaa91',
      weight: 1.5,
      dashArray: '5 7',
      fillColor: '#d8eddf',
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(instance);
    const zone = pilotZone(network);
    if (zone)
      L.circle([zone.lat, zone.lng], {
        pane: 'coverage',
        radius: zone.radio_m,
        color: '#24551f',
        weight: 2,
        dashArray: '6 6',
        fillOpacity: 0.035,
        interactive: false,
      }).addTo(instance);
    L.polygon(
      [
        [
          [85, -180],
          [85, 180],
          [-85, 180],
          [-85, -180],
        ],
        network.coverage.polygon,
      ],
      {
        pane: 'mask',
        stroke: false,
        fillColor: '#eaf0e9',
        fillOpacity: 1,
        fillRule: 'evenodd',
        interactive: false,
      }
    ).addTo(instance);
    selection.current = L.layerGroup().addTo(instance);
    stops.current = L.layerGroup().addTo(instance);
    endpoints.current = L.layerGroup().addTo(instance);
    for (const route of network.routes) {
      const geometry = route.segments.flat();
      const line = L.polyline(geometry, {
        pane: 'routes',
        color: route.color,
        weight: 4,
        opacity: 0.52,
        className: `route-path route-${route.id}`,
      }).addTo(instance);
      line.on('click', () => {
        if (!state.current.pinMode) state.current.onRoute(route.id);
      });
      line.bindTooltip(`${route.id} · ${escape(route.name)}`, { sticky: true, direction: 'top' });
      lines.current.set(route.id, line);
    }
    for (const stop of network.stops) {
      const marker = L.circleMarker(stop.point, {
        radius: 4,
        color: '#6e8576',
        weight: 1.5,
        fillColor: '#ffffff',
        fillOpacity: 0.95,
        className: 'network-stop',
      }).addTo(instance);
      marker.bindTooltip(escape(stop.name.replace(' · demo', '')));
      marker.on('click', () => {
        if (!state.current.pinMode) state.current.onStop(stop);
      });
    }
    instance.on('click', (event) => {
      if (!state.current.pinMode) return;
      const point = [event.latlng.lat, event.latlng.lng];
      if (insideCoverage(point, network)) state.current.onPick(point);
      else state.current.onMessage('Elige un punto dentro del perímetro de la demo.');
    });
    const observer = new ResizeObserver(() => {
      instance.invalidateSize({ animate: false });
      fit();
    });
    observer.observe(container.current);
    setReady((value) => value + 1);
    return () => {
      cancelAnimationFrame(frame.current);
      simulating.current = false;
      observer.disconnect();
      instance.remove();
      map.current = null;
      lines.current.clear();
      buses.current.clear();
    };
  }, [props.network]);
  function addEndpoint(place, letter) {
    const marker = L.marker(place.point, {
      icon: L.divIcon({
        className: `endpoint endpoint-${letter}`,
        html: `<span><b>${letter}</b></span>`,
        iconSize: [32, 40],
        iconAnchor: [16, 38],
      }),
      zIndexOffset: 900,
    }).addTo(endpoints.current);
    marker.bindTooltip(escape(place.name.replace(' · demo', '')), {
      permanent: window.innerWidth > 760,
      direction: letter === 'A' ? 'right' : 'left',
      offset: [letter === 'A' ? 16 : -16, -20],
      className: 'place-label',
    });
  }
  function drawStops(ids, color) {
    ids.forEach((id) => {
      const stop = props.network.stops.find((stop) => stop.id === id);
      L.circleMarker(stop.point, {
        pane: 'selected',
        radius: 4.5,
        color,
        weight: 2.5,
        fillColor: 'white',
        fillOpacity: 1,
      })
        .addTo(stops.current)
        .bindTooltip(escape(stop.name))
        .on('click', () => state.current.onStop(stop));
    });
  }
  function redraw() {
    if (!map.current || !selection.current || !stops.current || !endpoints.current) return;
    const { network, journey, selectedRoute, reversed, origin, destination } = state.current;
    selection.current.clearLayers();
    stops.current.clearLayers();
    endpoints.current.clearLayers();
    const active = new Set(
      selectedRoute ? [selectedRoute.id] : (journey?.legs.map((leg) => leg.routeId) ?? [])
    );
    for (const route of network.routes) {
      const selected = active.has(route.id);
      lines.current.get(route.id).setStyle({
        opacity: selected ? (selectedRoute ? 1 : 0.24) : active.size ? 0.18 : 0.5,
        weight: selected && selectedRoute ? 7 : 4,
      });
    }
    if (journey && !selectedRoute) {
      for (const leg of journey.legs) {
        const route = network.routes.find((route) => route.id === leg.routeId);
        L.polyline(leg.geometry, {
          pane: 'selected',
          color: 'white',
          weight: 10,
          opacity: 0.95,
          interactive: false,
        }).addTo(selection.current);
        L.polyline(leg.geometry, {
          pane: 'selected',
          color: route.color,
          weight: 6,
          opacity: 1,
          interactive: false,
          className: `selected-leg leg-${route.id}`,
        }).addTo(selection.current);
        drawStops(leg.stopIds, route.color);
      }
      const first = network.stops.find((stop) => stop.id === journey.legs[0].from),
        last = network.stops.find((stop) => stop.id === journey.legs.at(-1).to);
      [
        [journey.origin.point, first.point],
        [last.point, journey.destination.point],
      ].forEach((points) => {
        if (distance(points[0], points[1]) > 12)
          L.polyline(points, {
            pane: 'selected',
            color: '#59645c',
            weight: 3,
            dashArray: '3 7',
            opacity: 0.8,
            interactive: false,
          }).addTo(selection.current);
      });
      journey.legs.slice(1).forEach((leg) => {
        const stop = network.stops.find((stop) => stop.id === leg.from);
        L.marker(stop.point, {
          icon: L.divIcon({
            className: 'transfer-marker',
            html: '<span>↔</span>',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          zIndexOffset: 800,
        })
          .addTo(stops.current)
          .bindTooltip(`Trasbordo · ${escape(stop.name)}`, {
            permanent: window.innerWidth > 760,
            direction: 'right',
            className: 'transfer-label',
          });
      });
      addEndpoint(journey.origin, 'A');
      addEndpoint(journey.destination, 'B');
    } else if (selectedRoute) {
      const ids = reversed ? [...selectedRoute.stops].reverse() : selectedRoute.stops;
      drawStops(ids, selectedRoute.color);
      addEndpoint(
        {
          ...network.stops.find((stop) => stop.id === ids[0]),
          kind: 'stop',
          description: '',
          demo: true,
        },
        'A'
      );
      addEndpoint(
        {
          ...network.stops.find((stop) => stop.id === ids.at(-1)),
          kind: 'stop',
          description: '',
          demo: true,
        },
        'B'
      );
    } else {
      if (origin && origin.id !== state.current.selectedStop?.id) addEndpoint(origin, 'A');
      if (destination && destination.id !== state.current.selectedStop?.id)
        addEndpoint(destination, 'B');
    }
    if (state.current.selectedStop) {
      const stop = state.current.selectedStop;
      L.circleMarker(stop.point, {
        radius: 11,
        color: '#173e31',
        weight: 3,
        fillColor: '#dce8a8',
        fillOpacity: 1,
        className: 'focused-stop',
      })
        .addTo(stops.current)
        .bindTooltip(escape(stop.name.replace(' · demo', '')), {
          permanent: true,
          direction: 'top',
        });
    }
  }
  useEffect(() => {
    stopSimulation();
    redraw();
    fit();
  }, [
    ready,
    props.journey?.id,
    props.selectedRoute?.id,
    props.reversed,
    props.origin?.id,
    props.destination?.id,
    props.selectedStop?.id,
  ]);
  useEffect(() => {
    if (!map.current) return;
    const active = new Set(
      props.selectedRoute
        ? [props.selectedRoute.id]
        : (props.journey?.legs.map((leg) => leg.routeId) ?? [])
    );
    const ids = new Set(props.vehicles.map((vehicle) => vehicle.id));
    for (const [id, marker] of buses.current)
      if (!ids.has(id)) {
        marker.remove();
        buses.current.delete(id);
      }
    for (const vehicle of props.vehicles) {
      const route = props.network.routes.find((route) => route.id === vehicle.routeId);
      if (!route) continue;
      const selected = active.has(route.id),
        icon = busIcon(route, selected ? 'selected' : active.size ? 'muted' : 'idle');
      let marker = buses.current.get(vehicle.id);
      if (!marker) {
        marker = L.marker(vehicle.point, {
          icon,
          title: 'Unidad ' + vehicle.unit + ' · ' + route.id,
        }).addTo(map.current);
        marker.on('click', () => state.current.onRoute(route.id));
        buses.current.set(vehicle.id, marker);
      }
      marker
        .setLatLng(vehicle.point)
        .setIcon(icon)
        .setZIndexOffset(selected ? 700 : 100);
      marker
        .unbindTooltip()
        .bindTooltip(escape(vehicle.unit + ' · ' + route.id + ' · GPS'), { direction: 'top' });
    }
  }, [ready, props.vehicles, props.selectedRoute?.id, props.journey?.id]);
  return <div id="map" ref={container} className={props.pinMode ? 'pin-mode' : ''} />;
});
