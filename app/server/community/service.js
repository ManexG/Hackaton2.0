import axelApi from './axel-api.js';
import migrations from './migrations.json' with { type: 'json' };
import { insideCoverage, distance, validateNetwork } from '../../src/planner.js';
import { stopArrivals } from '../../src/transit.js';
import { serviceZoneStatus, pilotZone } from '../../src/serviceZone.js';

const json = (data, status = 200) => Response.json(data, { status });

// Keep Axel's API and schema while adapting D1/R2 operations to the existing
// SQLite service. This preserves the deployed driver database and avoids two
// incompatible live fleets or credentials embedded in the Android app.
export class CommunityService {
  constructor(store, adminKey = '') {
    this.store = store;
    this.db = store.db;
    this.baseNetwork = store.network;
    // Gancho opcional: lo usa la administración (server/admin-core.js) para aplicar rutas editadas.
    // CLOUDFLARE: asignar aquí `admin.applyTo` al crear el servicio en FleetService.
    this.transform = null;
    this.adminKey = adminKey;
    this.db.exec('CREATE TABLE IF NOT EXISTS community_migrations (id TEXT PRIMARY KEY)');
    for (const migration of migrations) {
      if (this.db.prepare('SELECT id FROM community_migrations WHERE id=?').get(migration.id))
        continue;
      this.db.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO community_migrations(id) VALUES(?)').run(migration.id);
      });
    }
    if (!this.db.prepare('SELECT id FROM community_migrations WHERE id=?').get('integration-v1')) {
      this.db.transaction(() => {
        this.db.exec(`ALTER TABLE reportes ADD COLUMN client_id TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS reportes_client ON reportes(user_id,client_id);
          CREATE TABLE IF NOT EXISTS community_photos (key TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS community_photo_chunks (key TEXT NOT NULL REFERENCES community_photos(key) ON DELETE CASCADE, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(key,part));`);
        this.db.prepare('INSERT INTO community_migrations(id) VALUES(?)').run('integration-v1');
      });
    }
    this.env = {
      ADMIN_KEY: adminKey,
      INSIDE: (point) =>
        Array.isArray(point) && point.length === 2 && insideCoverage(point, this.baseNetwork),
      DRIVER_USER: (token) => this.driverUser(token),
      DB: { prepare: (sql) => this.statement(sql) },
      FOTOS: {
        put: (key, bytes, options) => this.putPhoto(key, bytes, options),
        get: (key) => this.getPhoto(key),
      },
    };
    this.refreshNetwork();
  }
  statement(sql, args = []) {
    return {
      bind: (...values) => this.statement(sql, values),
      first: async () => this.db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: this.db.prepare(sql).all(...args) }),
      run: async () => {
        const result = this.db.prepare(sql).run(...args);
        return {
          success: true,
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(this.db.prepare('SELECT last_insert_rowid() AS id').get().id),
          },
        };
      },
    };
  }
  driverUser(token) {
    try {
      const driver = this.store.authenticate(token);
      let user = this.db
        .prepare('SELECT id,nombre,email,rol,colonia_ref FROM usuarios WHERE email=?')
        .get(driver.email);
      if (!user) {
        this.db
          .prepare('INSERT INTO usuarios(nombre,email,salt,hash,rol) VALUES(?,?,?,?,?)')
          .run(driver.name, driver.email, '', '', 'chofer');
        user = this.db
          .prepare('SELECT id,nombre,email,rol,colonia_ref FROM usuarios WHERE email=?')
          .get(driver.email);
      }
      return user;
    } catch {
      return null;
    }
  }
  putPhoto(key, bytes, options) {
    const data = new Uint8Array(bytes);
    if (data.byteLength > 4_000_000) throw new Error('Foto demasiado grande');
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO community_photos(key,type,size) VALUES(?,?,?)')
        .run(key, options.httpMetadata.contentType, data.byteLength);
      for (let offset = 0, part = 0; offset < data.byteLength; offset += 131072, part++) {
        this.db
          .prepare('INSERT INTO community_photo_chunks(key,part,bytes) VALUES(?,?,?)')
          .run(key, part, data.slice(offset, offset + 131072));
      }
    });
  }
  getPhoto(key) {
    const meta = this.db.prepare('SELECT type,size FROM community_photos WHERE key=?').get(key);
    if (!meta) return null;
    const data = new Uint8Array(meta.size);
    let offset = 0;
    for (const chunk of this.db
      .prepare('SELECT bytes FROM community_photo_chunks WHERE key=? ORDER BY part')
      .all(key)) {
      data.set(new Uint8Array(chunk.bytes), offset);
      offset += chunk.bytes.byteLength;
    }
    return { body: data, httpMetadata: { contentType: meta.type } };
  }
  refreshNetwork() {
    const managed = this.transform ? this.transform(this.baseNetwork) : this.baseNetwork;
    const network = {
      ...managed,
      routes: [...managed.routes],
      stops: [...managed.stops],
      places: [...managed.places],
    };
    const row = this.db
      .prepare('SELECT nombre,lat,lng,radio_m FROM zona ORDER BY id DESC LIMIT 1')
      .get();
    network.pilotZone = row
      ? pilotZone({
          ...network,
          pilotZone: {
            ...row,
            lat: Number(row.lat),
            lng: Number(row.lng),
            radio_m: Number(row.radio_m),
          },
        })
      : null;
    for (const route of this.db
      .prepare('SELECT * FROM rutas WHERE activa=1 AND trazo IS NOT NULL')
      .all()) {
      try {
        const geometry = JSON.parse(route.trazo);
        const rows = this.db
          .prepare('SELECT * FROM paradas WHERE ruta_id=? ORDER BY orden,id')
          .all(route.id);
        if (
          rows.length < 2 ||
          !Array.isArray(geometry) ||
          geometry.some((p) => !this.env.INSIDE(p))
        )
          continue;
        const indices = rows.map((row) => {
          let best = { index: -1, meters: Infinity };
          geometry.forEach((p, index) => {
            const meters = distance([row.lat, row.lng], p);
            if (meters < best.meters) best = { index, meters };
          });
          if (best.meters > 15) throw new Error('Parada desconectada');
          return best.index;
        });
        if (indices.some((index, i) => i > 0 && index <= indices[i - 1])) continue;
        const stops = rows.map((row) => ({
          id: `AXS${row.id}`,
          name: row.nombre,
          point: [row.lat, row.lng],
          description: route.fuente || 'Ruta incorporada por el equipo',
          qr: row.qr,
        }));
        const segments = stops
          .slice(1)
          .map((stop, i) => [
            stops[i].point,
            ...geometry.slice(indices[i] + 1, indices[i + 1]),
            stop.point,
          ]);
        const candidate = {
          id: `AX${route.id}`,
          name: route.nombre,
          color: route.color,
          stops: stops.map((s) => s.id),
          segments,
          fare: 0,
          fareKnown: false,
          headway: 0,
          bidirectional: false,
          speedKmh: 20,
          source: route.fuente,
        };
        const next = {
          ...network,
          routes: [...network.routes, candidate],
          stops: [...network.stops, ...stops],
        };
        validateNetwork(next);
        network.routes.push(candidate);
        network.stops.push(...stops);
        network.places.push(...stops.map((s) => ({ ...s, kind: 'stop' })));
      } catch {
        /* Incomplete imports stay in administration until their geometry is valid. */
      }
    }
    this.store.network = network;
    return network;
  }
  async fetch(original) {
    if (!['GET', 'HEAD'].includes(original.method)) {
      const reader = original.body?.getReader();
      const chunks = [];
      let size = 0;
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4_500_000) {
            await reader.cancel();
            return json({ error: 'Solicitud demasiado grande. Usa una foto de hasta 4 MB.' }, 413);
          }
          chunks.push(value);
        }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      original = new Request(original.url, {
        method: original.method,
        headers: original.headers,
        body: bytes,
      });
    }
    const url = new URL(original.url);
    const path = url.pathname.replace(/^\/api\/community/, '/api');
    url.pathname = path;
    const request = new Request(url, original);
    if (path === '/api/network') return json(this.refreshNetwork());
    if (path === '/api/vehiculos/detener' && request.method === 'POST') {
      const driver = this.store.authenticate(
        request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
      );
      this.store.pause(driver.id);
      return json({ ok: true, desactivadas: driver.active ? 1 : 0 });
    }
    const qr = path.match(/^\/api\/paradas\/qr\/([A-Za-z0-9-]+)$/);
    if (qr && request.method === 'GET') {
      const network = this.refreshNetwork();
      const direct = network.stops.find((stop) => stop.id === qr[1]);
      const row = this.db.prepare('SELECT * FROM paradas WHERE qr=?').get(qr[1]);
      const stop = direct || (row && network.stops.find((stop) => stop.id === `AXS${row.id}`));
      return stop
        ? json({
            ...row,
            stopId: stop.id,
            nombre: stop.name,
            lat: stop.point[0],
            lng: stop.point[1],
          })
        : json({ error: 'Esta parada aún no tiene una ruta válida cargada.' }, 404);
    }
    // All mobility views use the same assigned routes, hours, fresh GPS and ETA model.
    if (path === '/api/vehiculos/activos') {
      const snapshot = this.store.snapshot();
      return json(
        snapshot.vehicles.map((v) => ({
          id: v.id,
          nombre: v.unit,
          ruta_id: v.routeId,
          ruta: this.store.network.routes.find((r) => r.id === v.routeId)?.name,
          color: this.store.network.routes.find((r) => r.id === v.routeId)?.color,
          sentido: v.direction === 1 ? 'ida' : 'regreso',
          lat: v.point[0],
          lng: v.point[1],
          ultimo_ts: new Date(v.updatedAt).toISOString(),
          edad_s: Math.max(0, Math.round((snapshot.serverTime - v.updatedAt) / 1000)),
          en_vivo: true,
          en_zona: serviceZoneStatus(v.point, this.store.network).inZone,
          distancia_zona_m: serviceZoneStatus(v.point, this.store.network).distanceMeters,
          zona: this.store.network.pilotZone ?? null,
          ultima_posicion: JSON.stringify({
            lat: v.point[0],
            lng: v.point[1],
            ts: new Date(v.updatedAt).toISOString(),
          }),
          ultima_ts: new Date(v.updatedAt).toISOString(),
        }))
      );
    }
    if (path.startsWith('/api/vehiculos') || path === '/api/mis-vehiculos')
      return json({ error: 'Usa «Entrar como chofer» para tu unidad y ruta asignadas.' }, 403);
    const arrival = path.match(/^\/api\/paradas\/(\d+)\/llegada$/);
    if (arrival) {
      const row = this.db.prepare('SELECT * FROM paradas WHERE id=?').get(Number(arrival[1]));
      if (!row) return json({ error: 'Parada no encontrada' }, 404);
      const network = this.refreshNetwork();
      const stop = network.stops.find((s) => s.id === `AXS${row.id}`);
      const next = stop
        ? stopArrivals(stop.id, network, this.store.snapshot().vehicles, Date.now())[0]
        : null;
      return json({
        parada: row,
        vehiculo: next ? { id: next.vehicle.id, nombre: next.vehicle.unit, en_zona: true } : null,
        estimado_min: next ? Math.ceil(next.seconds / 60) : null,
        criterio: next
          ? 'Estimación según GPS reciente, horario y distancia por la ruta.'
          : 'No hay combis con GPS reciente para esta parada.',
      });
    }
    const vote = path.match(/^\/api\/reportes\/(\d+)\/votar$/);
    if (vote && request.method === 'POST') {
      const { fingerprint } = await request.json().catch(() => ({}));
      if (typeof fingerprint !== 'string' || fingerprint.length < 8 || fingerprint.length > 64)
        return json({ error: 'Identificador del dispositivo inválido' }, 400);
      if (!this.db.prepare('SELECT id FROM reportes WHERE id=?').get(Number(vote[1])))
        return json({ error: 'Reporte no encontrado' }, 404);
      try {
        this.db.transaction(() => {
          this.db
            .prepare('INSERT INTO votos(reporte_id,fingerprint) VALUES(?,?)')
            .run(Number(vote[1]), fingerprint);
          this.db.prepare('UPDATE reportes SET votos=votos+1 WHERE id=?').run(Number(vote[1]));
        });
      } catch {
        return json({ error: 'Ya apoyaste este reporte' }, 409);
      }
      return json({ ok: true });
    }
    if (path.startsWith('/api/admin/') && request.headers.get('x-admin-key') !== this.adminKey)
      return json({ error: 'Acceso de administración requerido' }, 401);
    if (path === '/api/auth/registro') {
      const data = await request
        .clone()
        .json()
        .catch(() => ({}));
      if (
        typeof data.email === 'string' &&
        this.db.prepare('SELECT id FROM drivers WHERE email=?').get(data.email.trim().toLowerCase())
      )
        return json(
          { error: 'Esta cuenta de chofer ya existe. Entra desde «Entrar como chofer».' },
          409
        );
    }
    const response = await axelApi.fetch(request, this.env);
    if (path.startsWith('/api/admin/') && response.ok) this.refreshNetwork();
    return response;
  }
}
