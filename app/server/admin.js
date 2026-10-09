import { ApiError } from './store-core.js';
import { distance, insideCoverage } from '../src/planner.js';

/* Controlador compartido de /api/manage.
 * Cloudflare inyecta lectura limitada del cuerpo, token y control de intentos.
 * Node conserva adaptadores HTTP propios; la lógica y los permisos son iguales.
 */

const OSRM = 'https://router.project-osrm.org';
const OSRM_HEADERS = { 'User-Agent': 'CercaCombis/1.3 (administracion de rutas)' };
const MAX_BODY = 512_000;

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new ApiError(415, 'Envía los datos en formato JSON.');
  let text = '';
  for await (const chunk of request) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > MAX_BODY) throw new ApiError(413, 'Solicitud demasiado grande.');
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, 'Los datos enviados no son válidos.');
  }
}

/** Recorrido por calles entre paradas consecutivas (un tramo por par). Falla con honestidad. */
export async function traceByStreets(points, network, fetcher = fetch) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 25)
    throw new ApiError(422, 'Indica entre 2 y 25 puntos para trazar.');
  if (!points.every((p) => Array.isArray(p) && p.length === 2 && insideCoverage(p, network)))
    throw new ApiError(422, 'Hay puntos fuera de la zona de cobertura.');
  const coordinates = points.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  let data;
  try {
    const response = await fetcher(
      `${OSRM}/route/v1/driving/${coordinates}?overview=false&steps=true&geometries=geojson`,
      { headers: OSRM_HEADERS, signal: AbortSignal.timeout(15_000) }
    );
    if (!response.ok) throw new Error('estado ' + response.status);
    data = await response.json();
  } catch (error) {
    throw new ApiError(502, `No se pudo trazar por calles (${error.message}). Intenta de nuevo.`);
  }
  const legs = data?.routes?.[0]?.legs;
  if (data?.code !== 'Ok' || legs?.length !== points.length - 1)
    throw new ApiError(502, 'El servicio de calles no encontró un recorrido entre esos puntos.');
  if (
    legs.some(
      (leg) =>
        !Array.isArray(leg?.steps) ||
        !leg.steps.length ||
        leg.steps.some(
          (step) =>
            !Array.isArray(step?.geometry?.coordinates) ||
            step.geometry.coordinates.some(
              (point) =>
                !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
            )
        )
    )
  )
    throw new ApiError(
      502,
      'El servicio de calles devolvió un recorrido incompleto. Intenta de nuevo.'
    );
  const segments = legs.map((leg, i) => {
    const line = leg.steps
      .flatMap((step) => step.geometry.coordinates)
      .map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
    // Los extremos se fijan en las paradas: la calle puede quedar a unos metros y el planificador
    // exige que el tramo empiece y termine en la parada.
    return [points[i], ...line.slice(1, -1), points[i + 1]];
  });
  if (segments.some((segment) => segment.some((p) => !insideCoverage(p, network))))
    throw new ApiError(422, 'El recorrido calculado sale de la zona permitida.');
  return { segments };
}

export function createManageHandler({
  admin,
  store,
  community,
  broadcast,
  fetcher,
  readBody = readJson,
  throttleLogin,
  getToken = (request) => request.headers.authorization?.replace(/^Bearer /, '') ?? '',
}) {
  const attempts = new Map();
  const changed = () => {
    community.refreshNetwork();
    broadcast();
  };
  const throttle = (request, email) => {
    const now = Date.now();
    for (const [key, limit] of [
      [`ip:${request.socket.remoteAddress ?? ''}`, 100],
      [
        `email:${String(email ?? '')
          .toLowerCase()
          .slice(0, 254)}`,
        8,
      ],
    ]) {
      const attempt = attempts.get(key);
      if (attempt && attempt.reset > now && attempt.count >= limit)
        throw new ApiError(429, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');
      attempts.set(key, {
        count: (attempt && attempt.reset > now ? attempt.count : 0) + 1,
        reset: attempt && attempt.reset > now ? attempt.reset : now + 900_000,
      });
    }
    for (const [key, value] of attempts) if (value.reset < now) attempts.delete(key);
  };
  /** Devuelve true si la petición era de /api/manage/ y ya se respondió. */
  return async function handle(request, url, send) {
    if (!url.pathname.startsWith('/api/manage/')) return false;
    const path = url.pathname.slice('/api/manage'.length).replace(/\/$/, '');
    const method = request.method;
    const token = getToken(request);
    if (method === 'POST' && path === '/login') {
      const data = await readBody(request);
      (throttleLogin || throttle)(request, data.email);
      send(200, await admin.login(data.email, data.password));
      return true;
    }
    const me = admin.authenticate(token); // todo lo demás exige sesión de administrador
    let match;
    if (method === 'POST' && path === '/logout') {
      admin.logout(token);
      send(200, { ok: true });
    } else if (method === 'GET' && path === '/me') send(200, me);
    else if (method === 'GET' && path === '/admins') send(200, admin.listAdmins());
    else if (method === 'POST' && path === '/admins')
      send(201, admin.createAdmin(await readBody(request)));
    else if (method === 'POST' && path === '/admins/me/password') {
      admin.changeAdminPassword(me.id, (await readBody(request)).password);
      send(200, { ok: true });
    } else if (method === 'DELETE' && (match = path.match(/^\/admins\/([\w-]+)$/))) {
      admin.deleteAdmin(match[1], me.id);
      send(200, { ok: true });
    } else if (method === 'GET' && path === '/drivers') send(200, admin.listDrivers());
    else if (method === 'POST' && path === '/drivers') {
      const result = admin.createDriver(await readBody(request));
      broadcast();
      send(201, result);
    } else if (method === 'PATCH' && (match = path.match(/^\/drivers\/([\w-]+)$/))) {
      const driver = admin.updateDriver(match[1], await readBody(request));
      broadcast();
      send(200, driver);
    } else if (method === 'DELETE' && (match = path.match(/^\/drivers\/([\w-]+)$/))) {
      admin.deleteDriver(match[1]);
      broadcast();
      send(200, { ok: true });
    } else if (method === 'POST' && (match = path.match(/^\/drivers\/([\w-]+)\/reset-password$/))) {
      const result = admin.resetDriverPassword(match[1]);
      broadcast();
      send(200, result);
    } else if (method === 'GET' && path === '/routes') send(200, admin.listRoutes());
    else if (method === 'POST' && path === '/routes') {
      const route = admin.saveRoute(null, await readBody(request));
      changed();
      send(201, route);
    } else if (method === 'POST' && path === '/routes/restore-demo') {
      admin.restoreDemo();
      changed();
      send(200, admin.listRoutes());
    } else if (method === 'POST' && path === '/routes/trace') {
      const { points } = await readBody(request);
      send(200, await traceByStreets(points, store.network, fetcher));
    } else if (method === 'PUT' && (match = path.match(/^\/routes\/([\w-]+)$/))) {
      const route = admin.saveRoute(match[1], await readBody(request));
      changed();
      send(200, route);
    } else if (method === 'DELETE' && (match = path.match(/^\/routes\/([\w-]+)$/))) {
      admin.deleteRoute(match[1]);
      changed();
      send(200, { ok: true });
    } else if (method === 'POST' && (match = path.match(/^\/routes\/([\w-]+)\/restore$/))) {
      admin.restoreRoute(match[1]);
      changed();
      send(200, admin.listRoutes());
    } else throw new ApiError(404, 'No encontramos esa operación.');
    return true;
  };
}
