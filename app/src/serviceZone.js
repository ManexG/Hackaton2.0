import { distance, insideCoverage } from './planner.js';

// The operator's pilot area may narrow service, but never extends the original
// coverage polygon. Use this same decision on the server and on both clients.
export function pilotZone(network) {
  const zone = network.pilotZone;
  if (
    !zone ||
    !Number.isFinite(zone.lat) ||
    !Number.isFinite(zone.lng) ||
    !Number.isFinite(zone.radio_m) ||
    zone.radio_m <= 0 ||
    !insideCoverage([zone.lat, zone.lng], network)
  )
    return null;
  return zone;
}
export function serviceZoneStatus(point, network) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return null;
  const zone = pilotZone(network);
  const [southwest, northeast] = network.coverage.bounds;
  const center = zone
    ? [zone.lat, zone.lng]
    : [(southwest[0] + northeast[0]) / 2, (southwest[1] + northeast[1]) / 2];
  const meters = distance(point, center);
  const inCoverage = insideCoverage(point, network);
  return {
    inZone: inCoverage && (!zone || meters <= zone.radio_m),
    inCoverage,
    distanceMeters: Math.round(meters),
    name: zone?.nombre || network.coverage.name,
    center,
    radiusMeters: zone?.radio_m ?? null,
  };
}
export const inServiceZone = (point, network) => serviceZoneStatus(point, network)?.inZone === true;
export const shortDistance = (meters) =>
  meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`;
