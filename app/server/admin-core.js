import { createHash, randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { ApiError } from './store-core.js';
import { distance, insideCoverage, validateNetwork } from '../src/planner.js';
import { validateWindows } from '../src/transit.js';

/*
 * Administración: cuentas de administrador, alta de choferes y gestión de rutas.
 *
 * CLOUDFLARE (para quien porte esto): este archivo NO depende de Node HTTP ni de node:sqlite.
 * Solo usa la interfaz `db` { exec, prepare().get/all/run, transaction } que ya implementa el
 * adaptador del Durable Object en cloudflare/index.js, y node:crypto (disponible con
 * nodejs_compat, igual que store-core.js). Lo pendiente en Cloudflare está en CLOUDFLARE-ADMIN.md:
 *   1. Instanciar `new AdminCore(db, network, this.store)` en FleetService.
 *   2. Enrutar /api/manage/* (ver server/admin.js, que contiene el ruteo HTTP de Node).
 *   3. Aplicar `admin.applyTo(network)` dentro de CommunityService.refreshNetwork (ver el gancho
 *      `transform` en server/community/service.js).
 * No usar el prefijo /api/admin/: el gateway lo reserva para CERCA_ADMIN_TOKEN.
 */

const deriveKey = promisify(scrypt);
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const ADMIN_SESSION_MS = 2 * 3600_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const round = (n) => Number(Number(n).toFixed(6));

function hashPassword(password) {
  const salt = Buffer.from(randomBytes(16)).toString('hex');
  return `${salt}:${Buffer.from(scryptSync(password, salt, 64)).toString('hex')}`;
}
const newPassword = () => randomBytes(18).toString('base64url');
const clean = (value, max, message) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new ApiError(422, message);
  return value.trim();
};

export class AdminCore {
  db;
  base;
  store;
  constructor(db, baseNetwork, store) {
    this.db = db;
    this.base = baseNetwork;
    this.store = store;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      -- Rutas editadas (mismo id que una demo) o creadas por un administrador. 'data' es JSON del editor.
      CREATE TABLE IF NOT EXISTS managed_routes (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      -- Rutas demo ocultadas; se pueden restaurar sin perder el archivo original.
      CREATE TABLE IF NOT EXISTS deleted_routes (id TEXT PRIMARY KEY);`);
  }

  /* ---------------------------- administradores ---------------------------- */
  adminView = (row) => ({ id: row.id, name: row.name, email: row.email, createdAt: row.created_at });
  validateAdmin(input) {
    const name = clean(input.name, 80, 'Escribe el nombre del administrador.');
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new ApiError(422, 'Correo inválido.');
    if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 256)
      throw new ApiError(422, 'La contraseña necesita al menos 12 caracteres.');
    return { name, email };
  }
  createAdmin(input) {
    const { name, email } = this.validateAdmin(input);
    if (this.db.prepare('SELECT id FROM admins WHERE email=?').get(email))
      throw new ApiError(409, 'Ya existe un administrador con ese correo.');
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO admins (id,name,email,password,created_at) VALUES (?,?,?,?,?)')
      .run(id, name, email, hashPassword(input.password), Date.now());
    return this.adminView(this.db.prepare('SELECT * FROM admins WHERE id=?').get(id));
  }
  listAdmins() {
    return this.db.prepare('SELECT * FROM admins ORDER BY created_at').all().map(this.adminView);
  }
  deleteAdmin(id, actingId) {
    if (id === actingId) throw new ApiError(409, 'No puedes eliminar tu propia cuenta.');
    if (!this.db.prepare('SELECT id FROM admins WHERE id=?').get(id))
      throw new ApiError(404, 'Administrador no encontrado.');
    if (this.db.prepare('SELECT COUNT(*) AS n FROM admins').get().n <= 1)
      throw new ApiError(409, 'Debe quedar al menos un administrador.');
    this.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(id);
    this.db.prepare('DELETE FROM admins WHERE id=?').run(id);
  }
  changeAdminPassword(id, password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 256)
      throw new ApiError(422, 'La contraseña necesita al menos 12 caracteres.');
    this.db.prepare('UPDATE admins SET password=? WHERE id=?').run(hashPassword(password), id);
  }
  async login(email, password, now = Date.now()) {
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 256)
      throw new ApiError(400, 'Escribe tu correo y contraseña.');
    const row = this.db.prepare('SELECT * FROM admins WHERE email=?').get(email.trim().toLowerCase());
    // Se calcula el hash aunque la cuenta no exista para no revelar qué correos son válidos.
    const [salt, saved] = (row?.password ?? '0'.repeat(32) + ':' + '00'.repeat(64)).split(':');
    const key = await deriveKey(password, salt, 64);
    if (!row || !timingSafeEqual(key, Buffer.from(saved, 'hex')))
      throw new ApiError(401, 'El correo o la contraseña no coinciden.');
    const token = Buffer.from(randomBytes(48)).toString('base64url');
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(now);
    this.db
      .prepare('INSERT INTO admin_sessions VALUES (?,?,?)')
      .run(hashToken(token), row.id, now + ADMIN_SESSION_MS);
    return { token, expiresAt: now + ADMIN_SESSION_MS, admin: this.adminView(row) };
  }
  authenticate(token, now = Date.now()) {
    if (!token || token.length > 128) throw new ApiError(401, 'Inicia sesión como administrador.');
    const row = this.db
      .prepare(
        'SELECT a.* FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>?'
      )
      .get(hashToken(token), now);
    if (!row) throw new ApiError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
    return this.adminView(row);
  }
  logout(token) {
    this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashToken(token));
  }

  /* -------------------------------- choferes -------------------------------- */
  driverFields(input, existing) {
    const name = clean(input.name ?? existing?.name, 80, 'Escribe el nombre del chofer.');
    const email = String(input.email ?? existing?.email ?? '').trim().toLowerCase();
    const unit = String(input.unit ?? existing?.unit ?? '').trim();
    const routeId = input.routeId ?? existing?.route_id;
    const windows = input.windows ?? (existing ? JSON.parse(existing.windows) : undefined);
    if (!EMAIL.test(email) || email.length > 254) throw new ApiError(422, 'Correo inválido.');
    if (!/^[a-zA-Z0-9 -]{1,24}$/.test(unit))
      throw new ApiError(422, 'La unidad admite letras, números, espacios y guiones (máx. 24).');
    if (!this.store.network.routes.some((route) => route.id === routeId))
      throw new ApiError(422, 'La ruta elegida no existe.');
    try {
      validateWindows(windows);
    } catch (error) {
      throw new ApiError(422, error.message);
    }
    return { name, email, unit, routeId, windows };
  }
  assertUnique(fields, exceptId = '') {
    if (this.db.prepare('SELECT id FROM drivers WHERE email=? AND id<>?').get(fields.email, exceptId))
      throw new ApiError(409, 'Ya existe un chofer con ese correo.');
    if (this.db.prepare('SELECT id FROM drivers WHERE unit=? AND id<>?').get(fields.unit, exceptId))
      throw new ApiError(409, 'Esa unidad ya está asignada a otro chofer.');
  }
  listDrivers() {
    return this.db
      .prepare('SELECT * FROM drivers ORDER BY name')
      .all()
      .map((row) => this.store.profile(row));
  }
  createDriver(input) {
    const fields = this.driverFields(input);
    this.assertUnique(fields);
    const password = newPassword();
    const driver = this.store.provision({ ...fields, password });
    // La contraseña inicial se devuelve una sola vez; no se guarda en claro.
    return { driver, password };
  }
  updateDriver(id, input) {
    const existing = this.store.row(id);
    if (!existing) throw new ApiError(404, 'Chofer no encontrado.');
    const fields = this.driverFields(input, existing);
    this.assertUnique(fields, id);
    // Cualquier cambio de asignación detiene el servicio activo: el chofer lo vuelve a activar.
    this.db
      .prepare(
        'UPDATE drivers SET name=?,email=?,unit=?,route_id=?,windows=?,active=0 WHERE id=?'
      )
      .run(fields.name, fields.email, fields.unit, fields.routeId, JSON.stringify(fields.windows), id);
    return this.store.profile(this.store.row(id));
  }
  deleteDriver(id) {
    if (!this.store.row(id)) throw new ApiError(404, 'Chofer no encontrado.');
    this.db.prepare('DELETE FROM sessions WHERE driver_id=?').run(id);
    this.db.prepare('DELETE FROM drivers WHERE id=?').run(id);
  }
  resetDriverPassword(id) {
    if (!this.store.row(id)) throw new ApiError(404, 'Chofer no encontrado.');
    const password = newPassword();
    this.db.prepare('UPDATE drivers SET password=?,active=0 WHERE id=?').run(hashPassword(password), id);
    this.db.prepare('DELETE FROM sessions WHERE driver_id=?').run(id);
    return { driver: this.store.profile(this.store.row(id)), password };
  }

  /* --------------------------------- rutas ---------------------------------- */
  managedRows() {
    return this.db.prepare('SELECT * FROM managed_routes ORDER BY position,id').all();
  }
  /**
   * Devuelve la red con los cambios del administrador: las rutas demo del JSON son la semilla y
   * pueden editarse (override con el mismo id), ocultarse o restaurarse. No modifica `base`.
   * CLOUDFLARE: llamar desde CommunityService.refreshNetwork mediante `transform`.
   */
  applyTo(base = this.base) {
    const baseIds = new Set(base.routes.map((route) => route.id));
    const deleted = new Set(this.db.prepare('SELECT id FROM deleted_routes').all().map((r) => r.id));
    const rows = this.managedRows();
    const overrides = new Map(rows.map((row) => [row.id, JSON.parse(row.data)]));
    const stops = new Map(base.stops.map((stop) => [stop.id, stop]));
    const build = (data) => {
      for (const stop of data.stops)
        stops.set(stop.id, { ...(stops.get(stop.id) ?? {}), id: stop.id, name: stop.name, point: stop.point });
      return {
        id: data.id,
        name: data.name,
        color: data.color,
        fare: data.fare,
        headway: data.headway,
        bidirectional: data.bidirectional,
        stops: data.stops.map((stop) => stop.id),
        segments: data.segments,
      };
    };
    const routes = [];
    for (const route of base.routes) {
      if (deleted.has(route.id)) continue;
      routes.push(overrides.has(route.id) ? build(overrides.get(route.id)) : route);
    }
    for (const row of rows) if (!baseIds.has(row.id)) routes.push(build(overrides.get(row.id)));
    const used = new Set(routes.flatMap((route) => route.stops));
    const finalStops = [...stops.values()].filter((stop) => used.has(stop.id));
    const known = new Set(base.places.map((place) => place.id));
    const places = base.places
      .filter((place) => place.kind !== 'stop' || used.has(place.id))
      .map((place) =>
        place.kind === 'stop' && stops.has(place.id)
          ? { ...place, name: stops.get(place.id).name, point: stops.get(place.id).point }
          : place
      );
    for (const stop of finalStops)
      if (!known.has(stop.id))
        places.push({
          id: stop.id,
          name: stop.name,
          point: stop.point,
          description: 'Parada creada desde administración',
          kind: 'stop',
          aliases: [],
        });
    return { ...base, routes, stops: finalStops, places };
  }
  editorRoute(route, network, baseIds, overrides) {
    const byId = new Map(network.stops.map((stop) => [stop.id, stop]));
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM drivers WHERE route_id=?').get(route.id).n;
    return {
      id: route.id,
      name: route.name,
      color: route.color,
      fare: route.fare,
      headway: route.headway,
      bidirectional: Boolean(route.bidirectional),
      stops: route.stops.map((id) => ({ id, name: byId.get(id).name, point: byId.get(id).point })),
      segments: route.segments,
      demo: baseIds.has(route.id),
      edited: overrides.has(route.id),
      assignedDrivers: Number(count),
    };
  }
  listRoutes() {
    const network = this.applyTo();
    const baseIds = new Set(this.base.routes.map((route) => route.id));
    const overrides = new Set(this.managedRows().map((row) => row.id));
    const deleted = this.db
      .prepare('SELECT id FROM deleted_routes')
      .all()
      .map((row) => ({ id: row.id, name: this.base.routes.find((r) => r.id === row.id)?.name ?? row.id }));
    return {
      routes: network.routes
        .filter((route) => !route.id.startsWith('AX'))
        .map((route) => this.editorRoute(route, network, baseIds, overrides)),
      hiddenDemoRoutes: deleted,
    };
  }
  nextRouteId() {
    const taken = new Set([
      ...this.base.routes.map((r) => r.id),
      ...this.managedRows().map((r) => r.id),
    ]);
    for (let n = 1; n < 1000; n++) {
      const id = 'R' + String(n).padStart(2, '0');
      if (!taken.has(id)) return id;
    }
    throw new ApiError(409, 'Se alcanzó el máximo de rutas.');
  }
  saveRoute(id, input) {
    const current = this.applyTo();
    const previous = id ? current.routes.find((route) => route.id === id) : null;
    if (id && !previous) throw new ApiError(404, 'Ruta no encontrada.');
    const name = clean(input.name, 80, 'Escribe el nombre de la ruta.');
    if (!COLOR.test(input.color ?? '')) throw new ApiError(422, 'Elige un color válido (#RRGGBB).');
    const fare = Number(input.fare ?? 0),
      headway = Number(input.headway ?? 0);
    if (!Number.isFinite(fare) || fare < 0 || fare > 500) throw new ApiError(422, 'Tarifa inválida.');
    if (!Number.isFinite(headway) || headway < 0 || headway > 240)
      throw new ApiError(422, 'La frecuencia debe estar entre 0 y 240 minutos.');
    if (!Array.isArray(input.stops) || input.stops.length < 2 || input.stops.length > 40)
      throw new ApiError(422, 'Una ruta necesita entre 2 y 40 paradas.');
    const routeId = id ?? this.nextRouteId();
    const existingStops = new Map(current.stops.map((stop) => [stop.id, stop]));
    const usedElsewhere = (stopId) =>
      current.routes.some((route) => route.id !== routeId && route.stops.includes(stopId));
    const stops = input.stops.map((raw) => {
      const point = Array.isArray(raw?.point) ? [round(raw.point[0]), round(raw.point[1])] : null;
      if (!point || !point.every(Number.isFinite) || !insideCoverage(point, this.base))
        throw new ApiError(422, 'Una parada está fuera de la zona de cobertura.');
      const stopName = clean(raw.name, 80, 'Cada parada necesita un nombre.');
      const known = typeof raw.id === 'string' ? existingStops.get(raw.id) : null;
      // Mover una parada compartida con otra ruta no debe romper el trazado de esa ruta: se crea otra.
      if (known && (distance(known.point, point) < 1 || !usedElsewhere(known.id)))
        return { id: known.id, name: stopName, point: distance(known.point, point) < 1 ? known.point : point };
      return { id: 'M-' + Buffer.from(randomBytes(4)).toString('hex'), name: stopName, point };
    });
    if (new Set(stops.map((stop) => stop.id)).size !== stops.length)
      throw new ApiError(422, 'Una parada no puede repetirse dentro de la misma ruta.');
    const prior = new Map();
    previous?.segments.forEach((segment, i) => prior.set(previous.stops[i] + '>' + previous.stops[i + 1], segment));
    const fits = (segment, a, b) =>
      Array.isArray(segment) &&
      segment.length >= 2 &&
      segment.length <= 4000 &&
      segment.every((p) => Array.isArray(p) && p.length === 2 && insideCoverage(p, this.base)) &&
      distance(segment[0], a.point) <= 15 &&
      distance(segment.at(-1), b.point) <= 15;
    const segments = stops.slice(1).map((stop, i) => {
      const a = stops[i];
      const given = input.segments?.[i];
      if (fits(given, a, stop)) return given.map((p) => [round(p[0]), round(p[1])]);
      const old = prior.get(a.id + '>' + stop.id);
      if (fits(old, a, stop)) return old;
      return [a.point, stop.point]; // línea recta hasta que se trace por calles
    });
    const data = {
      id: routeId,
      name,
      color: input.color.toLowerCase(),
      fare,
      headway,
      bidirectional: Boolean(input.bidirectional),
      stops,
      segments,
    };
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT position FROM managed_routes WHERE id=?').get(routeId);
      const position =
        row?.position ?? this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM managed_routes').get().n;
      this.db
        .prepare(
          `INSERT INTO managed_routes (id,data,position,updated_at) VALUES (?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`
        )
        .run(routeId, JSON.stringify(data), position, Date.now());
      this.db.prepare('DELETE FROM deleted_routes WHERE id=?').run(routeId);
      try {
        validateNetwork(this.applyTo());
      } catch (error) {
        throw new ApiError(422, error.message); // revierte la transacción
      }
    });
    return this.listRoutes().routes.find((route) => route.id === routeId);
  }
  deleteRoute(id) {
    const exists = this.applyTo().routes.some((route) => route.id === id);
    if (!exists) throw new ApiError(404, 'Ruta no encontrada.');
    const assigned = this.db.prepare('SELECT COUNT(*) AS n FROM drivers WHERE route_id=?').get(id).n;
    if (assigned > 0)
      throw new ApiError(
        409,
        `Hay ${assigned} chofer(es) asignados a esta ruta. Reasígnalos antes de borrarla.`
      );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM managed_routes WHERE id=?').run(id);
      if (this.base.routes.some((route) => route.id === id))
        this.db.prepare('INSERT OR IGNORE INTO deleted_routes (id) VALUES (?)').run(id);
    });
  }
  /** Devuelve una ruta demo a su versión original (deshace ediciones y la vuelve a mostrar). */
  restoreRoute(id) {
    if (!this.base.routes.some((route) => route.id === id))
      throw new ApiError(404, 'Solo se pueden restaurar las rutas demo originales.');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM managed_routes WHERE id=?').run(id);
      this.db.prepare('DELETE FROM deleted_routes WHERE id=?').run(id);
    });
  }
  restoreDemo() {
    for (const route of this.base.routes) this.restoreRoute(route.id);
  }
}
