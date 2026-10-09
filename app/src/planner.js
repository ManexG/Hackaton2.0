export const normalize = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function insideCoverage(point, network) {
  if (!point.every(Number.isFinite)) return false;
  const [[south, west], [north, east]] = network.coverage.bounds;
  if (point[0] < south || point[0] > north || point[1] < west || point[1] > east) return false;
  const polygon = network.coverage.polygon;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i],
      [yj, xj] = polygon[j];
    const cross = (point[1] - xi) * (yj - yi) - (point[0] - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-10 &&
      point[0] >= Math.min(yi, yj) &&
      point[0] <= Math.max(yi, yj) &&
      point[1] >= Math.min(xi, xj) &&
      point[1] <= Math.max(xi, xj)
    )
      return true;
    if (
      yi > point[0] !== yj > point[0] &&
      point[1] < ((xj - xi) * (point[0] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
export function validateNetwork(network) {
  if (
    !network ||
    network.version !== 1 ||
    !network.coverage ||
    !Array.isArray(network.coverage.polygon) ||
    network.coverage.polygon.length < 3 ||
    !Array.isArray(network.stops) ||
    !Array.isArray(network.routes) ||
    !Array.isArray(network.places)
  )
    throw new Error('El archivo de rutas no tiene el formato esperado.');
  const ids = new Set(network.stops.map((stop) => stop.id));
  if (
    ids.size !== network.stops.length ||
    new Set(network.routes.map((route) => route.id)).size !== network.routes.length
  )
    throw new Error('Hay identificadores duplicados.');
  for (const stop of network.stops)
    if (!insideCoverage(stop.point, network))
      throw new Error(`Parada fuera de cobertura: ${stop.id}`);
  for (const place of network.places)
    if (!insideCoverage(place.point, network))
      throw new Error(`Destino fuera de cobertura: ${place.id}`);
  for (const route of network.routes) {
    if (
      !/^#[a-fA-F0-9]{6}$/.test(route.color) ||
      route.stops.length < 2 ||
      route.stops.some((id) => !ids.has(id)) ||
      !Number.isFinite(route.fare) ||
      route.fare < 0 ||
      !Number.isFinite(route.headway) ||
      route.headway < 0 ||
      route.segments.length !== route.stops.length - 1
    )
      throw new Error(`Ruta inválida: ${route.id}`);
    if (
      route.segments.some(
        (segment) => segment.length < 2 || segment.some((point) => !insideCoverage(point, network))
      )
    )
      throw new Error(`Recorrido fuera de cobertura: ${route.id}`);
    route.segments.forEach((segment, i) => {
      const start = network.stops.find((stop) => stop.id === route.stops[i]);
      const end = network.stops.find((stop) => stop.id === route.stops[i + 1]);
      if (distance(segment[0], start.point) > 15 || distance(segment.at(-1), end.point) > 15)
        throw new Error(`Tramo desconectado: ${route.id}`);
    });
  }
}
const searchText = (value) =>
  normalize(value)
    .replace(/\b(?:av|avda)\b/g, 'avenida')
    .replace(/\bblvd\b/g, 'boulevard')
    .replace(/\b(?:numero|num|no)\s+(?=\d)/g, '');
export const categoryLabels = {
  food: 'Comida y café restaurantes cafeterías tacos comida',
  health: 'Salud hospitales clínicas farmacias',
  shopping: 'Compras tiendas negocios mercados supermercado',
  interest: 'Lugares de interés parques plazas turismo deporte',
  education: 'Escuelas educación biblioteca universidad',
  services: 'Servicios bancos talleres',
  street: 'Calles avenidas direcciones',
};
export function searchPlaces(query, network, near, limit = 8) {
  const q = searchText(query);
  const tokens = q
    .split(' ')
    .filter(Boolean)
    .filter((word) => !['calle', 'avenida', 'boulevard', 'andador'].includes(word));
  const matches = network.places.filter((place) => {
    if (!insideCoverage(place.point, network)) return false;
    const haystack = searchText(
      [
        place.name,
        place.address ?? '',
        ...(place.aliases ?? []),
        categoryLabels[place.category ?? ''] ?? '',
      ].join(' ')
    );
    return (
      tokens.every((token) => haystack.includes(token)) &&
      (!q || tokens.length > 0 || place.kind === 'street')
    );
  });
  const score = (place) => {
    const name = searchText(place.name.replace(' · demo', ''));
    return (
      (name === q ? 100 : name.startsWith(q) && q ? 50 : name.includes(q) && q ? 25 : 0) +
      (place.demo ? 0 : 4) +
      (near ? Math.max(0, 4 - distance(place.point, near) / 600) : 0)
    );
  };
  const results = matches.sort(
    (a, b) =>
      score(b) - score(a) ||
      (near
        ? distance(a.point, near) - distance(b.point, near)
        : a.name.localeCompare(b.name, 'es'))
  );
  const address = q.match(/^(.*?)\s+(?:numero\s+|num\s+)?(\d+)$/);
  if (address) {
    const street = address[1].trim();
    const number = Number(address[2]);
    const range = network.addressRanges.find(
      (range) =>
        range.aliases.some((alias) => normalize(alias) === street) &&
        number >= range.first &&
        number <= range.last
    );
    if (range) {
      const ratio = (number - range.first) / (range.last - range.first);
      const point = [
        range.from[0] + (range.to[0] - range.from[0]) * ratio,
        range.from[1] + (range.to[1] - range.from[1]) * ratio,
      ];
      if (
        insideCoverage(point, network) &&
        !results.some((place) => normalize(place.name).includes(`${street} ${number}`))
      )
        results.unshift({
          id: `address-${normalize(range.street)}-${number}`,
          name: `${range.street} #${number} · demo`,
          description: 'Ubicación aproximada simulada; numeración no verificada',
          kind: 'street',
          point,
          demo: true,
        });
    }
  }
  return results.slice(0, limit);
}
export function nearbyPlaces(network, near, category = 'all', limit = 6) {
  return network.places
    .filter(
      (place) =>
        insideCoverage(place.point, network) &&
        place.source === 'osm' &&
        (category === 'all'
          ? place.kind === 'business'
          : category === 'street'
            ? place.kind === 'street'
            : place.category === category)
    )
    .sort((a, b) => distance(a.point, near) - distance(b.point, near))
    .slice(0, limit);
}
export function makeLeg(route, fromIndex, toIndex) {
  const backwards = fromIndex > toIndex;
  const start = Math.min(fromIndex, toIndex),
    end = Math.max(fromIndex, toIndex);
  let geometry = route.segments.slice(start, end).flatMap((segment) => segment);
  let stopIds = route.stops.slice(start, end + 1);
  if (backwards) {
    geometry = [...geometry].reverse();
    stopIds = [...stopIds].reverse();
  }
  const meters = geometry.slice(1).reduce((sum, point, i) => sum + distance(geometry[i], point), 0);
  return {
    routeId: route.id,
    from: stopIds[0],
    to: stopIds.at(-1),
    stopIds,
    geometry,
    rideMinutes: Math.max(2, Math.ceil(meters / 300 + (stopIds.length - 2) * 0.6)),
  };
}
export function planJourneys(origin, destination, network, maxWalk = 420, allCandidates = false) {
  if (
    !insideCoverage(origin.point, network) ||
    !insideCoverage(destination.point, network) ||
    distance(origin.point, destination.point) < 30
  )
    return [];
  const access = network.stops
    .map((stop) => ({ stop, meters: distance(origin.point, stop.point) }))
    .filter((s) => s.meters <= maxWalk)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 3);
  const exits = new Map(
    network.stops
      .map((stop) => [stop.id, distance(destination.point, stop.point)])
      .filter((entry) => Number(entry[1]) <= maxWalk)
  );
  const connections = new Map();
  for (const route of network.routes)
    route.stops.forEach((id, i) => {
      const legs = connections.get(id) ?? [];
      route.stops.forEach((_, j) => {
        if (i !== j && (route.bidirectional || j > i)) legs.push(makeLeg(route, i, j));
      });
      connections.set(id, legs);
    });
  const candidates = [];
  function visit(current, legs, walking, visited) {
    const exitWalk = exits.get(current);
    if (legs.length && exitWalk !== undefined) {
      const walkMeters = Math.round(walking + exitWalk);
      const wait = legs.reduce(
        (sum, leg) => sum + network.routes.find((route) => route.id === leg.routeId).headway / 2,
        0
      );
      candidates.push({
        id: legs.map((leg) => `${leg.routeId}:${leg.from}:${leg.to}`).join('|'),
        legs,
        origin,
        destination,
        walkMeters,
        totalMinutes: Math.ceil(
          legs.reduce((sum, leg) => sum + leg.rideMinutes, 0) +
            wait +
            walkMeters / 75 +
            (legs.length - 1) * 2
        ),
        fare: legs.reduce(
          (sum, leg) => sum + network.routes.find((route) => route.id === leg.routeId).fare,
          0
        ),
        fareKnown: legs.every(
          (leg) => network.routes.find((route) => route.id === leg.routeId).fareKnown !== false
        ),
        transfers: legs.length - 1,
      });
    }
    if (legs.length >= 3) return;
    for (const leg of connections.get(current) ?? []) {
      if (legs.some((previous) => previous.routeId === leg.routeId) || visited.has(leg.to))
        continue;
      visit(leg.to, [...legs, leg], walking, new Set([...visited, current, leg.to]));
    }
  }
  access.forEach(({ stop, meters }) => visit(stop.id, [], meters, new Set([stop.id])));
  candidates.sort(
    (a, b) =>
      a.totalMinutes + a.transfers * 4 - (b.totalMinutes + b.transfers * 4) || a.fare - b.fare
  );
  if (allCandidates) return candidates;
  const bestMinutes = candidates[0]?.totalMinutes ?? 0;
  const seen = new Set();
  return candidates
    .filter((journey) => {
      if (journey.totalMinutes > bestMinutes * 1.8 + 6) return false;
      const key = journey.legs.map((leg) => leg.routeId).join('>');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}
