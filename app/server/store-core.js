import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  scrypt,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Buffer } from 'node:buffer';
import { distance } from '../src/planner.js';
import { GPS_MAX_AGE, projectOnRoute, serviceEnd, validateWindows } from '../src/transit.js';
import { inServiceZone } from '../src/serviceZone.js';
export class ApiError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const deriveKey = promisify(scrypt);
export class TransitStoreCore {
  db;
  network;
  publicAppUrl;
  constructor(db, network, publicAppUrl = '') {
    this.db = db;
    this.network = network;
    this.publicAppUrl = publicAppUrl;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drivers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, unit TEXT NOT NULL UNIQUE,
        route_id TEXT NOT NULL, windows TEXT NOT NULL, password TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0, direction INTEGER NOT NULL DEFAULT 1,
        latitude REAL, longitude REAL, accuracy REAL NOT NULL DEFAULT 0, speed REAL,
        updated_at INTEGER NOT NULL DEFAULT 0, service_end INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_driver ON sessions(driver_id);`);
  }
  close() {
    this.db.close();
  }
  resetServices() {
    this.db.exec('UPDATE drivers SET active=0;');
  }
  row(id) {
    return this.db.prepare('SELECT * FROM drivers WHERE id=?').get(id);
  }
  profile(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      unit: row.unit,
      routeId: row.route_id,
      windows: JSON.parse(row.windows),
      active: Boolean(row.active),
      location:
        row.latitude !== null && row.longitude !== null
          ? { point: [row.latitude, row.longitude], timestamp: row.updated_at }
          : null,
    };
  }
  provision(input) {
    if (
      !input.name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      !/^[a-zA-Z0-9 -]{1,24}$/.test(input.unit) ||
      input.password.length < 12
    )
      throw new Error(
        'Nombre, correo, unidad o contraseña inválidos; la contraseña requiere 12 caracteres.'
      );
    if (!this.network.routes.some((route) => route.id === input.routeId))
      throw new Error('La ruta no existe.');
    validateWindows(input.windows);
    const salt = Buffer.from(randomBytes(16)).toString('hex');
    const password = `${salt}:${Buffer.from(scryptSync(input.password, salt, 64)).toString('hex')}`;
    const email = input.email.trim().toLowerCase();
    const old = this.db.prepare('SELECT id FROM drivers WHERE email=?').get(email);
    const id = old?.id ?? randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO drivers (id,name,email,unit,route_id,windows,password) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET name=excluded.name,unit=excluded.unit,route_id=excluded.route_id,windows=excluded.windows,password=excluded.password,active=0,updated_at=0`
        )
        .run(
          id,
          input.name.trim(),
          email,
          input.unit,
          input.routeId,
          JSON.stringify(input.windows),
          password
        );
      this.db.prepare('DELETE FROM sessions WHERE driver_id=?').run(id);
    });
    return this.profile(this.row(id));
  }
  async login(email, password, now = Date.now()) {
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      email.length > 254 ||
      password.length > 256
    )
      throw new ApiError(400, 'Escribe tu correo y contraseña.');
    const row = this.db
      .prepare('SELECT * FROM drivers WHERE email=?')
      .get(email.trim().toLowerCase());
    const [salt, saved] = (
      row?.password ?? '00000000000000000000000000000000:' + '00'.repeat(64)
    ).split(':');
    const key = await deriveKey(password, salt, 64);
    if (!row || !timingSafeEqual(key, Buffer.from(saved, 'hex')))
      throw new ApiError(401, 'El correo o la contraseña no coinciden.');
    const token = Buffer.from(randomBytes(48)).toString('base64url'),
      expiresAt = now + 12 * 3600_000;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM sessions WHERE driver_id=? OR expires_at<=?').run(row.id, now);
      this.db.prepare('UPDATE drivers SET active=0 WHERE id=?').run(row.id);
      this.db
        .prepare('INSERT INTO sessions VALUES (?,?,?)')
        .run(hashToken(token), row.id, expiresAt);
    });
    return { token, expiresAt, driver: this.profile(this.row(row.id)) };
  }
  authenticate(token, now = Date.now()) {
    if (!token || token.length > 128) throw new ApiError(401, 'Inicia sesión como chofer.');
    const session = this.db
      .prepare('SELECT driver_id FROM sessions WHERE token_hash=? AND expires_at>?')
      .get(hashToken(token), now);
    const row = session && this.row(session.driver_id);
    if (!row) throw new ApiError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
    return this.profile(row);
  }
  logout(token) {
    const driver = this.authenticate(token);
    this.db.prepare('UPDATE drivers SET active=0 WHERE id=?').run(driver.id);
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  }
  /**
   * El chofer cambia su propia contraseña. Antes solo el administrador podía
   * restablecerla, así que si alguien veía la contraseña inicial no había
   * forma de cambiarla sin pedirle ayuda a un operador.
   *
   * Se pide la contraseña actual para confirmar que quien está en el panel es
   * el dueño de la cuenta. Se cierran las demás sesiones del chofer, no la
   * actual: cerrarla desenchufaría el GPS que acaba de activar.
   */
  async changePassword(token, current, next) {
    const driver = this.authenticate(token);
    const row = this.row(driver.id);
    if (typeof next !== 'string' || next.length < 12 || next.length > 256)
      throw new ApiError(422, 'La contraseña necesita al menos 12 caracteres.');
    if (typeof current !== 'string' || current.length > 256)
      throw new ApiError(400, 'Escribe tu contraseña actual.');
    const [salt, saved] = row.password.split(':');
    const key = await deriveKey(current, salt, 64);
    if (!timingSafeEqual(key, Buffer.from(saved, 'hex')))
      throw new ApiError(401, 'Tu contraseña actual no coincide.');
    const nuevoSalt = Buffer.from(randomBytes(16)).toString('hex');
    const nuevo = `${nuevoSalt}:${Buffer.from(scryptSync(next, nuevoSalt, 64)).toString('hex')}`;
    this.db.transaction(() => {
      this.db.prepare('UPDATE drivers SET password=? WHERE id=?').run(nuevo, driver.id);
      // Se cierra el resto de sesiones por si la contraseña estaba comprometida.
      this.db
        .prepare('DELETE FROM sessions WHERE driver_id=? AND token_hash<>?')
        .run(driver.id, hashToken(token));
    });
  }
  pause(id) {
    this.db.prepare('UPDATE drivers SET active=0 WHERE id=?').run(id);
    return this.profile(this.row(id));
  }
  update(id, fix, activate, now = Date.now()) {
    const row = this.row(id);
    if (!row) throw new ApiError(401, 'Cuenta no disponible.');
    if (!activate && !row.active) throw new ApiError(409, 'Tu servicio está desactivado.');
    const end = serviceEnd(JSON.parse(row.windows), now);
    if (!end) {
      this.pause(id);
      throw new ApiError(403, 'Estás fuera de tu horario asignado.');
    }
    if (
      !Array.isArray(fix.point) ||
      fix.point.length !== 2 ||
      !fix.point.every(Number.isFinite) ||
      !Number.isFinite(fix.accuracy) ||
      fix.accuracy < 0 ||
      fix.accuracy > 100 ||
      !Number.isFinite(fix.timestamp) ||
      now - fix.timestamp > 30_000 ||
      fix.timestamp > now + 15_000
    )
      throw new ApiError(422, 'Necesitamos una ubicación reciente con precisión de 100 m o mejor.');
    if (!activate && fix.timestamp <= row.updated_at)
      throw new ApiError(422, 'La ubicación recibida es anterior a la última señal.');
    if (!inServiceZone(fix.point, this.network)) {
      this.pause(id);
      throw new ApiError(403, 'La ubicación está fuera de la zona. Se desactivó tu servicio.');
    }
    const route = this.network.routes.find((route) => route.id === row.route_id);
    if (!route) {
      this.pause(id);
      throw new ApiError(
        403,
        'Tu ruta asignada ya no está disponible. Contacta al responsable del servicio.'
      );
    }
    const projection = projectOnRoute(fix.point, route);
    if (projection.away > Math.min(200, 100 + fix.accuracy)) {
      this.pause(id);
      throw new ApiError(403, 'Estás lejos de tu ruta asignada. Se desactivó tu servicio.');
    }
    let direction = activate ? (fix.direction === -1 ? -1 : 1) : row.direction;
    if (direction === -1 && !route.bidirectional)
      throw new ApiError(400, 'Esta ruta solo permite ida.');
    const seconds = (fix.timestamp - row.updated_at) / 1000;
    let measuredSpeed = null;
    if (
      !activate &&
      row.latitude !== null &&
      row.longitude !== null &&
      seconds > 0 &&
      seconds < 60
    ) {
      const previous = [row.latitude, row.longitude];
      const delta = projection.along - projectOnRoute(previous, route).along;
      if (distance(previous, fix.point) / seconds > 40)
        throw new ApiError(
          422,
          'La ubicación cambió demasiado rápido. Espera la siguiente señal GPS.'
        );
      if (Math.abs(delta) > 20 && route.bidirectional) direction = delta > 0 ? 1 : -1;
      measuredSpeed = Math.max(0, Math.min(15, Math.abs(delta) / seconds));
    }
    const speed =
      typeof fix.speed === 'number' &&
      Number.isFinite(fix.speed) &&
      fix.speed >= 0 &&
      fix.speed <= 40
        ? fix.speed
        : measuredSpeed;
    this.db
      .prepare(
        'UPDATE drivers SET active=1,direction=?,latitude=?,longitude=?,accuracy=?,speed=?,updated_at=?,service_end=? WHERE id=?'
      )
      .run(direction, fix.point[0], fix.point[1], fix.accuracy, speed, fix.timestamp, end, id);
    return this.profile(this.row(id));
  }
  expire(now = Date.now()) {
    let changed =
      this.db
        .prepare('UPDATE drivers SET active=0 WHERE active=1 AND (updated_at<? OR service_end<=?)')
        .run(now - GPS_MAX_AGE, now).changes > 0;
    for (const row of this.db
      .prepare('SELECT id,latitude,longitude FROM drivers WHERE active=1')
      .all()) {
      if (!inServiceZone([row.latitude, row.longitude], this.network)) {
        this.pause(row.id);
        changed = true;
      }
    }
    return changed;
  }
  snapshot(now = Date.now()) {
    this.expire(now);
    const rows = this.db.prepare('SELECT * FROM drivers').all();
    return {
      serverTime: now,
      publicAppUrl: this.publicAppUrl,
      pilotZone: this.network.pilotZone ?? null,
      vehicles: rows
        .filter(
          (row) =>
            row.active &&
            row.latitude !== null &&
            row.longitude !== null &&
            inServiceZone([row.latitude, row.longitude], this.network) &&
            row.updated_at <= now + 15_000 &&
            this.network.routes.some((route) => route.id === row.route_id)
        )
        .map((row) => ({
          id: row.id,
          unit: row.unit,
          routeId: row.route_id,
          point: [row.latitude, row.longitude],
          direction: row.direction,
          accuracy: row.accuracy,
          speed: row.speed,
          updatedAt: row.updated_at,
          serviceEndAt: row.service_end,
        })),
      services: this.network.routes.map((route) => {
        const assigned = rows.filter((row) => row.route_id === route.id);
        const windows = assigned.flatMap((row) => JSON.parse(row.windows));
        return {
          routeId: route.id,
          assignedDrivers: assigned.length,
          windows: windows.filter(
            (window, i) =>
              windows.findIndex((other) => JSON.stringify(other) === JSON.stringify(window)) === i
          ),
        };
      }),
    };
  }
}
