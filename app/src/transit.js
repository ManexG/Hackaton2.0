import { distance, planJourneys } from './planner.js';
import { modelTravel } from './etaModel.js';
import { inServiceZone } from './serviceZone.js';
export const GPS_MAX_AGE = 45_000;
// All service windows use the city's timezone, including on phones in another timezone.
export function localTime(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}
export function validateWindows(windows) {
  if (!Array.isArray(windows) || !windows.length || windows.length > 14)
    throw new Error('Define al menos un horario.');
  for (const window of windows) {
    if (
      !Array.isArray(window.days) ||
      !window.days.length ||
      window.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end) ||
      window.start === window.end
    )
      throw new Error('Horario inválido: usa días de 0 a 6 y horas HH:MM diferentes.');
  }
}
const toSeconds = (value) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 3600 + minute * 60;
};
export function serviceEnd(windows, now) {
  const { day, seconds } = localTime(now);
  const remaining = windows.flatMap((window) => {
    const start = toSeconds(window.start),
      end = toSeconds(window.end);
    if (end > start)
      return window.days.includes(day) && seconds >= start && seconds < end ? [end - seconds] : [];
    if (window.days.includes(day) && seconds >= start) return [86400 - seconds + end];
    if (window.days.includes((day + 6) % 7) && seconds < end) return [end - seconds];
    return [];
  });
  return remaining.length ? Math.max(...remaining) * 1000 + now : null;
}
export function scheduleLabel(windows) {
  if (!windows.length) return 'Horario pendiente de asignación';
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return windows
    .map(
      (window) =>
        `${window.days.length === 7 ? 'Todos los días' : window.days.map((day) => days[day]).join(', ')} · ${window.start}–${window.end}`
    )
    .join(' / ');
}
export function routeMetrics(route) {
  const points = [],
    meters = [],
    stopMeters = [0];
  let length = 0;
  for (const segment of route.segments) {
    for (const point of segment) {
      if (points.length) length += distance(points.at(-1), point);
      points.push(point);
      meters.push(length);
    }
    stopMeters.push(length);
  }
  return { points, meters, stopMeters, length };
}
export function projectOnRoute(point, route) {
  const metrics = routeMetrics(route);
  let best = { along: 0, away: Infinity, point: metrics.points[0] };
  const scale = Math.cos((point[0] * Math.PI) / 180);
  for (let i = 1; i < metrics.points.length; i++) {
    const a = metrics.points[i - 1],
      b = metrics.points[i];
    const x = (b[1] - a[1]) * scale,
      y = b[0] - a[0];
    const ratio = Math.max(
      0,
      Math.min(1, ((point[1] - a[1]) * scale * x + (point[0] - a[0]) * y) / (x * x + y * y || 1))
    );
    const projected = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    const away = distance(point, projected);
    if (away < best.away)
      best = {
        point: projected,
        away,
        along: metrics.meters[i - 1] + (metrics.meters[i] - metrics.meters[i - 1]) * ratio,
      };
  }
  return best;
}
export function currentVehicles(snapshot, network, now) {
  return (
    snapshot?.vehicles.filter(
      (vehicle) =>
        network.routes.some((route) => route.id === vehicle.routeId) &&
        inServiceZone(vehicle.point, network) &&
        now - vehicle.updatedAt <= GPS_MAX_AGE &&
        vehicle.updatedAt <= now + 15_000 &&
        vehicle.serviceEndAt > now
    ) ?? []
  );
}
export function stopArrivals(stopId, network, vehicles, now, direction, notBeforeSeconds = 0) {
  const stop = network.stops.find((item) => item.id === stopId);
  if (!stop || !inServiceZone(stop.point, network)) return [];
  return vehicles
    .flatMap((vehicle) => {
      const route = network.routes.find((route) => route.id === vehicle.routeId);
      if (
        !route ||
        !route.stops.includes(stopId) ||
        !inServiceZone(vehicle.point, network) ||
        now - vehicle.updatedAt > GPS_MAX_AGE ||
        vehicle.updatedAt > now + 15_000 ||
        (!route.bidirectional && vehicle.direction === -1)
      )
        return [];
      const metrics = routeMetrics(route),
        projected = projectOnRoute(vehicle.point, route);
      if (projected.away > 200) return [];
      const target = metrics.stopMeters[route.stops.indexOf(stopId)];
      const pathInZone = (a, b) =>
        metrics.points.every(
          (point, index) =>
            metrics.meters[index] < Math.min(a, b) ||
            metrics.meters[index] > Math.max(a, b) ||
            inServiceZone(point, network)
        );
      const speed =
        vehicle.speed != null && vehicle.speed >= 1.5
          ? Math.max(2, Math.min(vehicle.speed, 12))
          : 5;
      const city = localTime(now);
      const travel = (a, b) => {
        const experimental = modelTravel(Math.abs(b - a), speed * 3.6, city.day, city.seconds);
        if (experimental) return experimental;
        const seconds =
          Math.abs(b - a) / speed +
          metrics.stopMeters.filter(
            (meter) => meter > Math.min(a, b) + 25 && meter < Math.max(a, b) - 25
          ).length *
            15;
        return { seconds, minSeconds: seconds, maxSeconds: seconds, experimental: false };
      };
      const add = (...parts) =>
        parts.reduce(
          (sum, part) =>
            typeof part === 'number'
              ? {
                  ...sum,
                  seconds: sum.seconds + part,
                  minSeconds: sum.minSeconds + part,
                  maxSeconds: sum.maxSeconds + part,
                }
              : {
                  seconds: sum.seconds + part.seconds,
                  minSeconds: sum.minSeconds + part.minSeconds,
                  maxSeconds: sum.maxSeconds + part.maxSeconds,
                  experimental: sum.experimental || part.experimental,
                },
          { seconds: 0, minSeconds: 0, maxSeconds: 0, experimental: false }
        );
      const cycle = add(travel(0, metrics.length), travel(0, metrics.length), 60);
      const candidates = (direction ? [direction] : route.bidirectional ? [1, -1] : [1])
        .flatMap((wanted) => {
          const ahead = (target - projected.along) * vehicle.direction;
          let prediction;
          if (wanted === vehicle.direction && ahead >= -25) {
            if (!pathInZone(projected.along, target)) return [];
            prediction =
              Math.abs(target - projected.along) < 25
                ? { seconds: 0, minSeconds: 0, maxSeconds: 0, experimental: false }
                : travel(projected.along, target);
          } else if (!route.bidirectional) return [];
          else if (wanted !== vehicle.direction) {
            const turn = vehicle.direction === 1 ? metrics.length : 0;
            if (!pathInZone(projected.along, turn) || !pathInZone(turn, target)) return [];
            prediction = add(travel(projected.along, turn), 30, travel(turn, target));
          } else {
            const turn = vehicle.direction === 1 ? metrics.length : 0,
              other = vehicle.direction === 1 ? 0 : metrics.length;
            if (
              !pathInZone(projected.along, turn) ||
              !pathInZone(turn, other) ||
              !pathInZone(other, target)
            )
              return [];
            prediction = add(
              travel(projected.along, turn),
              30,
              travel(turn, other),
              30,
              travel(other, target)
            );
          }
          const age = Math.max(0, now - vehicle.updatedAt) / 1000;
          prediction = {
            ...prediction,
            seconds: Math.max(0, prediction.seconds - age),
            minSeconds: Math.max(0, prediction.minSeconds - age),
            maxSeconds: Math.max(0, prediction.maxSeconds - age),
          };
          if (prediction.seconds + 10 < notBeforeSeconds) {
            if (!route.bidirectional) return [];
            if (!pathInZone(0, metrics.length)) return [];
            const turns = Math.ceil((notBeforeSeconds - 10 - prediction.seconds) / cycle.seconds);
            prediction = add(prediction, {
              ...cycle,
              seconds: cycle.seconds * turns,
              minSeconds: cycle.minSeconds * turns,
              maxSeconds: cycle.maxSeconds * turns,
            });
          }
          if (now + prediction.seconds * 1000 >= vehicle.serviceEndAt) return [];
          return [
            {
              vehicle,
              ...prediction,
              direction: wanted,
              destination: route.stops[wanted === 1 ? route.stops.length - 1 : 0],
            },
          ];
        })
        .sort((a, b) => a.seconds - b.seconds);
      return candidates.slice(0, 1);
    })
    .sort((a, b) => a.seconds - b.seconds);
}
export function predictJourneys(origin, destination, network, vehicles, now) {
  const activeIds = new Set(vehicles.map((vehicle) => vehicle.routeId));
  const available = {
    ...network,
    routes: network.routes.filter((route) => activeIds.has(route.id)),
  };
  const journeys = planJourneys(origin, destination, available, 420, true);
  const predictions = [];
  for (const journey of journeys) {
    if (journey.legs.some((leg) => leg.geometry.some((point) => !inServiceZone(point, network))))
      continue;
    const first = network.stops.find((stop) => stop.id === journey.legs[0].from);
    let elapsed = distance(origin.point, first.point) / 1.25;
    const arrivals = [];
    let reachable = true;
    let experimental = false;
    const legs = [];
    for (const leg of journey.legs) {
      const route = network.routes.find((route) => route.id === leg.routeId);
      const direction = route.stops.indexOf(leg.to) > route.stops.indexOf(leg.from) ? 1 : -1;
      const metrics = routeMetrics(route);
      const meters = Math.abs(
        metrics.stopMeters[route.stops.indexOf(leg.to)] -
          metrics.stopMeters[route.stops.indexOf(leg.from)]
      );
      const ride = (arrival) => {
        const city = localTime(now + arrival.seconds * 1000);
        const speed =
          arrival.vehicle.speed != null && arrival.vehicle.speed >= 1.5
            ? Math.max(2, Math.min(arrival.vehicle.speed, 12))
            : 5;
        return (
          modelTravel(meters, speed * 3.6, city.day, city.seconds) ?? {
            seconds: leg.rideMinutes * 60,
            minSeconds: leg.rideMinutes * 60,
            maxSeconds: leg.rideMinutes * 60,
            experimental: false,
          }
        );
      };
      const arrival = stopArrivals(leg.from, network, vehicles, now, direction, elapsed).find(
        (item) => now + (item.seconds + ride(item).seconds) * 1000 < item.vehicle.serviceEndAt
      );
      if (!arrival) {
        reachable = false;
        break;
      }
      const ridePrediction = ride(arrival),
        rideSeconds = ridePrediction.seconds;
      experimental ||= arrival.experimental || ridePrediction.experimental;
      legs.push({ ...leg, rideMinutes: Math.max(1, Math.ceil(rideSeconds / 60)) });
      arrivals.push(arrival);
      elapsed = Math.max(elapsed, arrival.seconds) + rideSeconds + 30;
    }
    if (!reachable) continue;
    const last = network.stops.find((stop) => stop.id === journey.legs.at(-1).to);
    elapsed += distance(last.point, destination.point) / 1.25;
    predictions.push({
      ...journey,
      legs,
      totalMinutes: Math.max(1, Math.ceil(elapsed / 60)),
      arrivals,
      predictedAt: now,
      experimental,
    });
  }
  predictions.sort((a, b) => a.totalMinutes + a.transfers * 4 - b.totalMinutes - b.transfers * 4);
  const seen = new Set();
  return predictions
    .filter((journey) => {
      const key = journey.legs.map((leg) => leg.routeId).join('>');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}
