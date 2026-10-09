// Adapted from ManexG/Hackaton2.0, Axel fcad9cc. Original preserved in ciudadviva/.
// LCAlerta — Worker API (D1 + R2 + Assets estáticos)
const ESTADOS = ['enviado', 'recibido', 'aprobado', 'no_aprobado'];
const CATS = ['alumbrado', 'bache', 'basura', 'fuga_agua', 'otro'];

// Rate limit simple en memoria (best-effort por isolado)
const RL = new Map();
function rateLimited(ip, max = 10, windowMs = 3600_000) {
  const now = Date.now();
  const e = RL.get(ip) || { n: 0, t: now };
  if (now - e.t > windowMs) {
    e.n = 0;
    e.t = now;
  }
  e.n++;
  RL.set(ip, e);
  return e.n > max;
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });

// ---------- Auth (email + password, PBKDF2) ----------
async function pbkdf2(pass, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pass),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sessionHash = async (token) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function getUser(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token && env.DRIVER_USER) {
    const driver = env.DRIVER_USER(token);
    if (driver) return driver;
  }
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.nombre, u.email, u.rol, u.colonia_ref FROM sesiones s JOIN usuarios u ON u.id = s.user_id WHERE s.token = ? AND s.created_at > datetime('now','-7 days')`
  )
    .bind(await sessionHash(token))
    .first();
  return row || null;
}

const isAdmin = (req, env) => {
  const k = req.headers.get('x-admin-key');
  return env.ADMIN_KEY && k === env.ADMIN_KEY;
};

// ---------- Geometría y trazado de rutas ----------
// Un trazo escrito a mano une puntos con segmentos rectos que atraviesan casas y
// manzanas. Aquí se calcula el recorrido REAL por calles usando OSRM, a partir de
// las paradas ordenadas, que son la fuente de verdad de la ruta.

const OSRM = 'https://router.project-osrm.org';
// El servidor de OSRM responde 403 a cualquier petición sin User-Agent, y el
// fetch del Worker no lo manda por defecto. Sin esta cabecera, el trazado falla.
const OSRM_HEADERS = {
  'User-Agent': 'CiudadViva-LazaroCardenas/1.0 (demo de movilidad; contacto del equipo)',
};
const GRADOS = 6; // OSRM devuelve 400 si le mandamos float sin redondear.

const metrosEntre = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180,
    p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/** OSRM devuelve [lon, lat]; nosotros guardamos [lat, lng]. Redondeamos siempre. */
const aLatLng = (lon, lat) => [Number(lat.toFixed(GRADOS)), Number(lon.toFixed(GRADOS))];

/** Mueve un punto al asfalto. Devuelve { lat, lng, ajuste_m }. */
async function ajustarAlAsfalto(lat, lng) {
  const url = `${OSRM}/nearest/v1/driving/${lng.toFixed(GRADOS)},${lat.toFixed(GRADOS)}?number=1`;
  const r = await fetch(url, { headers: OSRM_HEADERS });
  if (!r.ok) throw new Error(`OSRM /nearest respondió ${r.status}`);
  const d = await r.json();
  if (d.code !== 'Ok' || !d.waypoints?.length)
    throw new Error('OSRM no encontró calle cerca del punto');
  const wp = d.waypoints[0];
  return { lng: wp.location[0], lat: wp.location[1], ajuste_m: Math.round(wp.distance) };
}

/**
 * Recorrido real por calles que pasa por TODOS los puntos dados, en ese orden.
 * Devuelve la geometría como [[lat, lng], ...] y la distancia en metros.
 */
async function trazarPorCalles(ordenadas) {
  const coordas = ordenadas
    .map((p) => `${p.lng.toFixed(GRADOS)},${p.lat.toFixed(GRADOS)}`)
    .join(';');
  const url = `${OSRM}/route/v1/driving/${coordas}?overview=full&geometries=geojson`;
  const r = await fetch(url, { headers: OSRM_HEADERS });
  if (!r.ok) throw new Error(`OSRM /route respondió ${r.status}`);
  const d = await r.json();
  if (d.code !== 'Ok' || !d.routes?.length)
    throw new Error(`OSRM no encontró recorrido (${d.code})`);
  const ruta = d.routes[0];
  return {
    trazo: ruta.geometry.coordinates.map(([lon, lat]) => aLatLng(lon, lat)),
    distancia_m: Math.round(ruta.distance),
  };
}

/** Proyecta un punto sobre la polilínea y devuelve los metros hasta el más cercano. */
function metrosHastaPolilinea(lat, lng, trazo) {
  let mejor = Infinity;
  for (let i = 1; i < trazo.length; i++) {
    const [aLat, aLng] = trazo[i - 1];
    const [bLat, bLng] = trazo[i];
    // Proyección del punto sobre el segmento, en grados planos (la escala es
    // local a un tramo de calle: basta para decidir qué vertice está más cerca).
    const dx = (bLng - aLng) * Math.cos((lat * Math.PI) / 180);
    const dy = bLat - aLat;
    const len2 = dx * dx + dy * dy;
    let t = len2
      ? ((lng - aLng) * Math.cos((lat * Math.PI) / 180) * dx + (lat - aLat) * dy) / len2
      : 0;
    t = Math.max(0, Math.min(1, t));
    const px = aLng + t * (bLng - aLng);
    const py = aLat + t * (bLat - aLat);
    const d = metrosEntre(lat, lng, py, px);
    if (d < mejor) mejor = d;
  }
  return mejor === Infinity ? null : Math.round(mejor);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (!pathname.startsWith('/api')) {
      // Rutas de la SPA (React). Los assets están configurados con
      // not_found_handling = "single-page-application", así que todo lo que no
      // sea un archivo real devuelve index.html y React Router lo resuelve.
      // Esto es lo que hace que /parada/LC-XXX funcione al escanear el QR
      // y que /reporte/5 funcione al compartirlo o recargar.
      return env.ASSETS.fetch(req);
    }

    try {
      // ---------- Auth ----------
      if (pathname === '/api/auth/registro' && req.method === 'POST') {
        const data = await req.json().catch(() => ({}));
        const nombre = typeof data.nombre === 'string' ? data.nombre.trim() : '';
        const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
        const password = data.password;
        if (
          !nombre ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 120 ||
          typeof password !== 'string' ||
          password.length < 12 ||
          password.length > 256
        ) {
          return json({ error: 'Nombre, correo válido y contraseña (12+) requeridos' }, 400);
        }
        const rolValido = 'vecino'; // Driver roles and assignments are provisioned by the operator.
        const saltHex = hex(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await pbkdf2(password, saltHex);
        try {
          const r = await env.DB.prepare(
            'INSERT INTO usuarios (nombre, email, salt, hash, rol) VALUES (?,?,?,?,?)'
          )
            .bind(
              nombre.toString().slice(0, 60),
              email.toLowerCase().slice(0, 120),
              saltHex,
              hash,
              rolValido
            )
            .run();
          const token = crypto.randomUUID();
          await env.DB.prepare('INSERT INTO sesiones (token, user_id) VALUES (?,?)')
            .bind(await sessionHash(token), r.meta.last_row_id)
            .run();
          const alta = await env.DB.prepare('SELECT rol, colonia_ref FROM usuarios WHERE id = ?')
            .bind(r.meta.last_row_id)
            .first();
          return json(
            {
              token,
              nombre: nombre.toString().slice(0, 60),
              email,
              rol: rolValido,
              colonia_ref: alta.colonia_ref,
            },
            201
          );
        } catch {
          return json({ error: 'Ese correo ya tiene cuenta' }, 409);
        }
      }

      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { email, password } = await req.json().catch(() => ({}));
        if (typeof email !== 'string' || typeof password !== 'string' || password.length > 256)
          return json({ error: 'Escribe tu correo y contraseña.' }, 400);
        const u = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?')
          .bind(email.trim().toLowerCase())
          .first();
        if (
          !u ||
          !u.salt ||
          typeof password !== 'string' ||
          (await pbkdf2(password, u.salt)) !== u.hash
        )
          return json(
            {
              error:
                'Correo o contraseña incorrectos. Las cuentas de chofer entran desde Transporte.',
            },
            401
          );
        const token = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO sesiones (token, user_id) VALUES (?,?)')
          .bind(await sessionHash(token), u.id)
          .run();
        return json({
          token,
          nombre: u.nombre,
          email: u.email,
          rol: u.rol,
          colonia_ref: u.colonia_ref,
        });
      }

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const u = await getUser(req, env);
        return u ? json(u) : json({ error: 'No hay sesión' }, 401);
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = req.headers.get('authorization')?.replace(/^Bearer /, '') || '';
        await env.DB.prepare('DELETE FROM sesiones WHERE token = ?')
          .bind(await sessionHash(token))
          .run();
        return json({ ok: true });
      }

      // ============ ADMINISTRACIÓN DE DATOS DE MOVILIDAD ============
      // Estas rutas exigen la clave del ayuntamiento. Sirven para cargar rutas,
      // paradas y zonas desde un archivo, sin escribirlas a mano en la consola.

      if (isAdmin(req, env) && pathname === '/api/admin/rutas' && req.method === 'POST') {
        const { nombre, color, trazo, fuente } = await req.json().catch(() => ({}));
        if (!nombre || !/^#[0-9a-fA-F]{6}$/.test(color || '#3b82f6'))
          return json({ error: 'Nombre y color válidos requeridos' }, 400);

        // El trazo puede venir como arreglo [[lat,lng],...] o como texto JSON.
        // Se normaliza a texto JSON para guardarlo siempre igual en D1.
        let trazoTexto = null;
        if (Array.isArray(trazo)) {
          trazoTexto = JSON.stringify(trazo);
        } else if (typeof trazo === 'string' && trazo.trim()) {
          trazoTexto = trazo;
        }
        if (trazoTexto) {
          try {
            const t = JSON.parse(trazoTexto);
            if (
              !Array.isArray(t) ||
              t.length < 2 ||
              !t.every((p) => Array.isArray(p) && p.length === 2 && env.INSIDE(p))
            ) {
              return json({ error: 'trazo debe ser [[lat,lng], ...] con al menos 2 puntos' }, 400);
            }
          } catch {
            return json({ error: 'trazo no es válido' }, 400);
          }
        }

        const r = await env.DB.prepare(
          'INSERT INTO rutas (nombre, color, trazo, fuente) VALUES (?,?,?,?)'
        )
          .bind(
            String(nombre).slice(0, 120),
            String(color || '#3b82f6').slice(0, 9),
            trazoTexto,
            (fuente || '').toString().slice(0, 200)
          )
          .run();
        return json({ id: r.meta.last_row_id }, 201);
      }

      if (isAdmin(req, env) && pathname === '/api/admin/paradas' && req.method === 'POST') {
        const { ruta_id, paradas: lista } = await req.json().catch(() => ({}));
        if (!ruta_id || !Array.isArray(lista) || lista.length === 0) {
          return json({ error: 'ruta_id y un arreglo de paradas son obligatorios' }, 400);
        }
        let guardadas = 0;
        for (const [i, p] of lista.entries()) {
          if (!p.nombre || !env.INSIDE([Number(p.lat), Number(p.lng)]))
            return json({ error: 'Parada fuera de la zona' }, 400);
          await env.DB.prepare(
            'INSERT INTO paradas (ruta_id, nombre, lat, lng, orden, qr, espera_min) VALUES (?,?,?,?,?,?,?)'
          )
            .bind(
              ruta_id,
              String(p.nombre).slice(0, 120),
              Number(p.lat),
              Number(p.lng),
              Number(p.orden ?? i + 1),
              p.qr ? String(p.qr).slice(0, 40) : null,
              isFinite(Number(p.espera_min)) ? Number(p.espera_min) : null
            )
            .run();
          guardadas++;
        }
        return json({ guardadas }, 201);
      }

      // Traza la ruta por calles reales a partir de sus paradas ordenadas.
      // POST /api/admin/rutas/:id/trazar
      let mt = pathname.match(/^\/api\/admin\/rutas\/(\d+)\/trazar$/);
      if (isAdmin(req, env) && mt && req.method === 'POST') {
        const rutaId = +mt[1];
        const { results: paradas } = await env.DB.prepare(
          'SELECT id, nombre, lat, lng, orden FROM paradas WHERE ruta_id = ? ORDER BY orden'
        )
          .bind(rutaId)
          .all();

        if (paradas.length < 2) {
          return json(
            { error: 'La ruta necesita al menos 2 paradas ordenadas para poder trazar' },
            400
          );
        }

        // El servidor público de OSRM tolera ~1 petición por segundo.
        const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
        const ajustes = [];
        const ordenadas = [];
        for (const p of paradas) {
          const a = await ajustarAlAsfalto(p.lat, p.lng);
          ajustes.push({
            id: p.id,
            nombre: p.nombre,
            orden: p.orden,
            de: [p.lat, p.lng],
            ajuste_m: a.ajuste_m,
          });
          ordenadas.push({ id: p.id, lat: a.lat, lng: a.lng });
          await pausa(1100); // no saturar el servicio público
        }

        let salida;
        try {
          salida = await trazarPorCalles(ordenadas);
        } catch (e) {
          // Regla de honestidad: si no se pudo calcular el recorrido real, se
          // avisa y NO se guarda una línea inventada que atraviese manzanas.
          return json(
            { error: `No se pudo trazar por calles: ${e.message}. La ruta quedó sin trazo.` },
            502
          );
        }

        if (salida.trazo.some((p) => !env.INSIDE(p)))
          return json({ error: 'El recorrido calculado sale de la zona permitida' }, 400);
        await env.DB.prepare('UPDATE rutas SET trazo = ? WHERE id = ?')
          .bind(JSON.stringify(salida.trazo), rutaId)
          .run();

        // La parada se queda donde realmente está la calle: sin esto la etiqueta
        // pegada en el poste apunta a un punto que no existe.
        for (const o of ordenadas) {
          await env.DB.prepare('UPDATE paradas SET lat = ?, lng = ? WHERE id = ?')
            .bind(Number(o.lat.toFixed(GRADOS)), Number(o.lng.toFixed(GRADOS)), o.id)
            .run();
        }

        const desviaciones = paradas.map((p) => {
          const o = ordenadas.find((x) => x.id === p.id);
          return {
            nombre: p.nombre,
            metros_al_trazo: metrosHastaPolilinea(o.lat, o.lng, salida.trazo),
          };
        });

        return json({
          ruta_id: rutaId,
          puntos: salida.trazo.length,
          distancia_m: salida.distancia_m,
          ajustes,
          desviaciones,
          // Si alguna parada quedó lejos de la línea, el dato de entrada es dudoso.
          advertencia: ajustes.some((a) => a.ajuste_m > 80)
            ? 'Alguna parada estaba lejos de una calle (más de 80 m): revisa las coordenadas.'
            : null,
        });
      }

      if (isAdmin(req, env) && pathname === '/api/admin/zona' && req.method === 'POST') {
        const { nombre, lat, lng, radio_m, descripcion } = await req.json().catch(() => ({}));
        if (!nombre || !env.INSIDE([Number(lat), Number(lng)])) {
          return json({ error: 'nombre, lat y lng son obligatorios' }, 400);
        }
        const r = await env.DB.prepare(
          'INSERT INTO zona (nombre, lat, lng, radio_m, descripcion) VALUES (?,?,?,?,?)'
        )
          .bind(
            String(nombre).slice(0, 120),
            Number(lat),
            Number(lng),
            isFinite(Number(radio_m)) ? Number(radio_m) : null,
            (descripcion || '').toString().slice(0, 500)
          )
          .run();
        return json({ id: r.meta.last_row_id }, 201);
      }

      if (pathname === '/api/zona' && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM zona ORDER BY id DESC LIMIT 1'
        ).all();
        return json(results[0] ?? null);
      }

      // Actualiza el perfil (nombre y colonia de referencia)
      if (pathname === '/api/auth/perfil' && req.method === 'PATCH') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'No hay sesión' }, 401);
        const { nombre, colonia_ref } = await req.json().catch(() => ({}));
        if (nombre)
          await env.DB.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?')
            .bind(String(nombre).slice(0, 60), u.id)
            .run();
        if (colonia_ref)
          await env.DB.prepare('UPDATE usuarios SET colonia_ref = ? WHERE id = ?')
            .bind(String(colonia_ref).slice(0, 80), u.id)
            .run();
        const fresh = await env.DB.prepare(
          'SELECT nombre, email, rol, colonia_ref FROM usuarios WHERE id = ?'
        )
          .bind(u.id)
          .first();
        return json(fresh);
      }

      if (pathname === '/api/mis-reportes' && req.method === 'GET') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'No hay sesión' }, 401);
        const { results } = await env.DB.prepare(
          'SELECT * FROM reportes WHERE user_id = ? ORDER BY id DESC'
        )
          .bind(u.id)
          .all();
        return json(results);
      }

      if (pathname === '/api/mis-votos' && req.method === 'GET') {
        const fpQ = new URL(req.url).searchParams.get('fingerprint');
        if (!fpQ) return json([]);
        const { results } = await env.DB.prepare(
          'SELECT r.* FROM votos v JOIN reportes r ON r.id = v.reporte_id WHERE v.fingerprint = ? ORDER BY v.created_at DESC'
        )
          .bind(fpQ)
          .all();
        return json(results);
      }

      // ---------- Movilidad: vehicles en vivo ----------
      if (pathname === '/api/vehiculos/posicion' && req.method === 'POST') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión para reportar posición' }, 401);
        const { lat, lng, velocidad, sentido } = await req.json().catch(() => ({}));
        if (!isFinite(lat) || !isFinite(lng)) return json({ error: 'lat y lng obligatorios' }, 400);

        const veh = await env.DB.prepare(
          'SELECT id FROM vehiculos WHERE usuario_id = ? AND activo = 1'
        )
          .bind(u.id)
          .first();
        if (!veh) return json({ error: 'No tienes un vehículo asignado' }, 403);

        const ts = new Date().toISOString();
        await env.DB.prepare(
          'INSERT INTO posiciones (vehiculo_id, lat, lng, velocidad, ts) VALUES (?,?,?,?,?)'
        )
          .bind(veh.id, lat, lng, velocidad ?? null, ts)
          .run();
        await env.DB.prepare(
          'UPDATE vehiculos SET ultima_posicion = ?, ultima_ts = ?, sentido = COALESCE(?, sentido) WHERE id = ?'
        )
          .bind(
            JSON.stringify({ lat, lng, ts, velocidad: velocidad ?? null }),
            ts,
            sentido ?? null,
            veh.id
          )
          .run();
        return json({ ok: true, ts });
      }

      if (pathname === '/api/vehiculos/activos' && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT v.id, v.nombre, v.sentido, v.ultima_posicion, v.ultima_ts, r.id AS ruta_id, r.nombre AS ruta, r.color
           FROM vehiculos v LEFT JOIN rutas r ON r.id = v.ruta_id
           WHERE v.activo = 1`
        ).all();
        return json(results);
      }

      // El chofer registra su combi una vez; luego solo manda posición.
      if (pathname === '/api/vehiculos' && req.method === 'POST') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión' }, 401);
        if (u.rol !== 'chofer')
          return json({ error: 'Solo las cuentas de chofer pueden registrar un vehículo' }, 403);
        const { nombre, ruta_id, sentido } = await req.json().catch(() => ({}));
        if (!nombre) return json({ error: 'Falta el nombre de la combi' }, 400);
        // Una combi activa por chofer: sin esto, al recargar la pantalla (el
        // celular se bloquea conduciendo) volvería al formulario y crearía una
        // segunda combi que se queda reportando sin que nadie la vaya a parar.
        const yaTiene = await env.DB.prepare(
          'SELECT id FROM vehiculos WHERE usuario_id = ? AND activo = 1'
        )
          .bind(u.id)
          .first();
        if (yaTiene) {
          return json(
            { error: 'Ya tienes una combi registrada. Cierra sesión si quieres cambiarla.' },
            409
          );
        }
        const r = await env.DB.prepare(
          'INSERT INTO vehiculos (usuario_id, ruta_id, nombre, sentido) VALUES (?,?,?,?)'
        )
          .bind(u.id, ruta_id ?? null, String(nombre).slice(0, 60), sentido ?? null)
          .run();
        return json({ id: r.meta.last_row_id }, 201);
      }

      // La combi del chofer que está conectado, con su ruta. Permite que la
      // pantalla del chofer se recupere sola tras cerrar o recargar.
      if (pathname === '/api/mis-vehiculos' && req.method === 'GET') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión' }, 401);
        const v = await env.DB.prepare(
          `SELECT v.id, v.nombre, v.sentido, v.ruta_id, v.ultima_ts, r.nombre AS ruta, r.color
           FROM vehiculos v LEFT JOIN rutas r ON r.id = v.ruta_id
           WHERE v.usuario_id = ? AND v.activo = 1 ORDER BY v.id LIMIT 1`
        )
          .bind(u.id)
          .first();
        return json(v ?? null);
      }

      // ---------- Puntos y observaciones de campo ----------
      if (pathname === '/api/puntos' && req.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM puntos ORDER BY id DESC').all();
        return json(results);
      }
      if (pathname === '/api/puntos' && req.method === 'POST') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión' }, 401);
        const { tipo, nombre, lat, lng, notas, fuente } = await req.json().catch(() => ({}));
        if (!tipo || !env.INSIDE([lat, lng]))
          return json({ error: 'tipo, lat y lng son obligatorios' }, 400);
        const r = await env.DB.prepare(
          'INSERT INTO puntos (tipo, nombre, lat, lng, notas, fuente) VALUES (?,?,?,?,?,?)'
        )
          .bind(
            String(tipo).slice(0, 40),
            (nombre || '').toString().slice(0, 120),
            lat,
            lng,
            (notas || '').toString().slice(0, 500),
            (fuente || 'campo').toString().slice(0, 120)
          )
          .run();
        return json({ id: r.meta.last_row_id }, 201);
      }

      if (pathname === '/api/observaciones' && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM observaciones ORDER BY id DESC'
        ).all();
        return json(results);
      }
      if (pathname === '/api/observaciones' && req.method === 'POST') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión' }, 401);
        const { punto_id, tipo, detalle } = await req.json().catch(() => ({}));
        if (!tipo) return json({ error: 'tipo es obligatorio' }, 400);
        await env.DB.prepare('INSERT INTO observaciones (punto_id, tipo, detalle) VALUES (?,?,?)')
          .bind(
            punto_id ?? null,
            String(tipo).slice(0, 40),
            (detalle || '').toString().slice(0, 500)
          )
          .run();
        return json({ ok: true }, 201);
      }

      // Conteos por hora: alimentan el análisis de flujos. Son observaciones de campo,
      // NO datos de tráfico: la interfaz debe presentarlos como tales.
      if (pathname === '/api/conteos' && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM conteos ORDER BY fecha DESC, hora DESC'
        ).all();
        return json(results);
      }
      if (pathname === '/api/conteos' && req.method === 'POST') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión' }, 401);
        const { fecha, hora, tipo, cantidad, minutos, notas } = await req.json().catch(() => ({}));
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora || '') ||
          !['peatones', 'vehiculos'].includes(tipo) ||
          !Number.isInteger(Number(cantidad)) ||
          Number(cantidad) < 0 ||
          !Number.isInteger(Number(minutos)) ||
          Number(minutos) <= 0
        ) {
          return json({ error: 'fecha, hora, tipo y cantidad son obligatorios' }, 400);
        }
        await env.DB.prepare(
          'INSERT INTO conteos (fecha, hora, tipo, cantidad, minutos, notas) VALUES (?,?,?,?,?,?)'
        )
          .bind(
            fecha,
            hora,
            String(tipo).slice(0, 20),
            Number(cantidad),
            Number(minutos) || null,
            (notas || '').toString().slice(0, 300)
          )
          .run();
        return json({ ok: true }, 201);
      }

      // ---------- Movilidad: rutas y paradas ----------
      if (pathname === '/api/rutas' && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM rutas WHERE activa = 1 ORDER BY nombre'
        ).all();
        return json(results);
      }

      let mp = pathname.match(/^\/api\/rutas\/(\d+)\/paradas$/);
      if (mp && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM paradas WHERE ruta_id = ? ORDER BY orden'
        )
          .bind(+mp[1])
          .all();
        return json(results);
      }

      // Escaneo de QR en la parada: abre la app centrada en esa parada
      mp = pathname.match(/^\/api\/paradas\/qr\/([A-Za-z0-9-]+)$/);
      if (mp && req.method === 'GET') {
        const fila = await env.DB.prepare(
          `SELECT p.*, r.nombre AS ruta, r.color, r.trazo
           FROM paradas p JOIN rutas r ON r.id = p.ruta_id
           WHERE UPPER(p.qr) = UPPER(?)`
        )
          .bind(mp[1])
          .first();
        return fila ? json(fila) : json({ error: 'QR no reconocido' }, 404);
      }

      // Ruta recomendada hacia una parada: la más cercana que aún reporte posición.
      // Con few datos se muestra la más cercana y se declara el criterio.
      mp = pathname.match(/^\/api\/paradas\/(\d+)\/llegada$/);
      if (mp && req.method === 'GET') {
        const parada = await env.DB.prepare(
          `SELECT p.*, r.nombre AS ruta, r.color, r.trazo FROM paradas p
           JOIN rutas r ON r.id = p.ruta_id WHERE p.id = ?`
        )
          .bind(+mp[1])
          .first();
        if (!parada) return json({ error: 'Parada no encontrada' }, 404);
        // El trazo pesa ~2 KB y la pantalla no lo usa: se separa para no enviarlo.
        const { trazo: _trazoCrudo, ...paradaLimpia } = parada;

        // Solo las combis de ESTA ruta. Antes se elegía la más cercana de todas,
        // así que una combi de otra calle podía aparecer como "llega en 1 min".
        const combis = await env.DB.prepare(
          `SELECT v.id, v.nombre, v.ultima_ts, v.ultima_posicion, v.ruta_id, r.color FROM vehiculos v
           LEFT JOIN rutas r ON r.id = v.ruta_id
           WHERE v.activo = 1 AND v.ultima_posicion IS NOT NULL AND v.ruta_id = ?`
        )
          .bind(parada.ruta_id)
          .all();

        const posDe = (c) => {
          try {
            const p = JSON.parse(c.ultima_posicion);
            return p && isFinite(p.lat) && isFinite(p.lng) ? p : null;
          } catch {
            return null;
          }
        };

        // Si la ruta tiene trazo real, se mide SOBRE la calle; si no, se cae a la
        // distancia recta y el criterio lo dice, para no fingir precisión.
        let trazo = null;
        try {
          const t = parada.trazo ? JSON.parse(parada.trazo) : null;
          if (Array.isArray(t) && t.length >= 2) trazo = t;
        } catch {
          trazo = null;
        }

        const cerca = (c) => {
          const p = posDe(c);
          if (!p) return Infinity;
          return trazo
            ? metrosHastaPolilinea(p.lat, p.lng, trazo)
            : Math.round(metrosEntre(p.lat, p.lng, parada.lat, parada.lng));
        };

        const ordenada = combis.results
          .map((c) => ({ ...c, metros: cerca(c) }))
          .sort((a, b) => a.metros - b.metros);

        const c = ordenada[0];
        // Sin posiciones reales no se inventa un tiempo estimado.
        if (!c || !isFinite(c.metros)) {
          return json({
            parada: paradaLimpia,
            vehiculo: null,
            estimado_min: null,
            criterio: combis.results.length
              ? 'sin posiciones recientes de combis en esta ruta'
              : 'ninguna combi de esta ruta está reportando ahora',
          });
        }

        // Velocidad supuesta: NO es un dato observado. Si la parada tiene
        // espera_min medida en campo, se usa esa en su lugar.
        const velocidad = 22; // m/s, valor por defecto
        const espera = isFinite(Number(parada.espera_min)) ? Number(parada.espera_min) : 0;
        const estimado = Math.max(1, Math.round(c.metros / velocidad / 60)) + espera;

        // La parte de espera observada va SIEMPRE, con trazo o sin él: si el
        // tiempo mostrado incluye la espera, la etiqueta tiene que declararla.
        const notaEspera = espera
          ? `; más ${espera} min de espera observada en la parada`
          : '; sin espera observada todavía';

        const criterio =
          (trazo
            ? `distancia medida sobre el trazo real de la ruta (${c.metros} m) a velocidad supuesta de 22 m/s`
            : 'distancia en línea recta a velocidad supuesta de 22 m/s; la ruta no tiene trazo por calles') +
          notaEspera;

        return json({
          parada: paradaLimpia,
          vehiculo: { id: c.id, nombre: c.nombre, color: c.color, metros: c.metros },
          estimado_min: estimado,
          criterio,
        });
      }

      // ---------- Etiquetas: devuelve el token del usuario y su rol ----------
      // GET /api/categorias
      if (pathname === '/api/categorias' && req.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM categorias').all();
        return json(results);
      }

      // GET /api/reportes?estado&categoria&colonia
      if (pathname === '/api/reportes' && req.method === 'GET') {
        const conds = [],
          args = [];
        for (const f of ['estado', 'categoria', 'colonia']) {
          const v = url.searchParams.get(f);
          if (v) {
            conds.push(`${f} = ?`);
            args.push(v);
          }
        }
        const q = url.searchParams.get('q');
        if (q) {
          conds.push('descripcion LIKE ?');
          args.push('%' + q + '%');
        }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const limit = Math.max(
          1,
          Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 200)
        );
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0') || 0, 0);
        const { results } = await env.DB.prepare(
          `SELECT * FROM reportes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
        )
          .bind(...args, limit, offset)
          .all();
        return json(results);
      }

      // Subir una imagen suelta (QR del chofer, foto de una observación de campo).
      // Se guarda en R2 y se devuelve la clave para ponerla en un reporte o en un punto.
      if (pathname === '/api/fotos' && req.method === 'POST') {
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión' }, 401);
        const form = await req.formData();
        const foto = form.get('foto');
        if (!foto || typeof foto !== 'object' || !foto.size)
          return json({ error: 'Falta el archivo foto' }, 400);
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(foto.type))
          return json({ error: 'Usa una foto JPG, PNG o WebP' }, 415);
        if (foto.size > 4_000_000) return json({ error: 'La imagen supera 4 MB' }, 413);
        const key = `fotos/${u.id}/${crypto.randomUUID()}.jpg`;
        await env.FOTOS.put(key, await foto.arrayBuffer(), {
          httpMetadata: { contentType: foto.type || 'image/jpeg' },
        });
        return json({ foto_key: key }, 201);
      }

      // ---------- Comentarios ----------
      let mq = pathname.match(/^\/api\/reportes\/(\d+)\/comentarios$/);
      if (mq && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM comentarios WHERE reporte_id = ? ORDER BY id'
        )
          .bind(+mq[1])
          .all();
        return json(results);
      }
      if (mq && req.method === 'POST') {
        const { nombre, texto } = await req.json().catch(() => ({}));
        if (!texto || !texto.trim()) return json({ error: 'Escribe algo' }, 400);
        await env.DB.prepare('INSERT INTO comentarios (reporte_id, nombre, texto) VALUES (?,?,?)')
          .bind(
            +mq[1],
            (nombre || 'Vecino').toString().slice(0, 40),
            texto.toString().slice(0, 500)
          )
          .run();
        return json({ ok: true }, 201);
      }

      // ---------- Estadísticas agregadas ----------
      if (pathname === '/api/estadisticas' && req.method === 'GET') {
        const porCat = await env.DB.prepare(
          'SELECT categoria, COUNT(*) n FROM reportes GROUP BY categoria'
        ).all();
        const porColonia = await env.DB.prepare(
          `SELECT colonia, COUNT(*) n FROM reportes WHERE colonia<>'' GROUP BY colonia ORDER BY n DESC LIMIT 10`
        ).all();
        const porDia = await env.DB.prepare(
          'SELECT substr(created_at,1,10) d, COUNT(*) n FROM reportes GROUP BY d ORDER BY d'
        ).all();
        const estados = await env.DB.prepare(
          'SELECT estado, COUNT(*) n FROM reportes GROUP BY estado'
        ).all();
        return json({
          porCat: porCat.results,
          porColonia: porColonia.results,
          porDia: porDia.results,
          estados: estados.results,
        });
      }

      // POST /api/reportes (multipart: categoria, descripcion, lat, lng, colonia, foto)
      if (pathname === '/api/reportes' && req.method === 'POST') {
        if (rateLimited(req.headers.get('cf-connecting-ip') || 'anon')) {
          return json({ error: 'Demasiados reportes. Inténtalo más tarde.' }, 429);
        }
        const form = await req.formData();
        const categoria = form.get('categoria');
        const lat = parseFloat(form.get('lat'));
        const lng = parseFloat(form.get('lng'));
        if (!CATS.includes(categoria) || !env.INSIDE([lat, lng])) {
          return json({ error: 'categoria, lat y lng son obligatorios y válidos' }, 400);
        }
        const u = await getUser(req, env);
        if (!u) return json({ error: 'Inicia sesión para reportar' }, 401);
        const userId = u.id;
        const userNombre = u.nombre;
        const clientId = form.get('client_id');
        if (clientId) {
          const old = await env.DB.prepare(
            'SELECT id,estado FROM reportes WHERE client_id=? AND user_id=?'
          )
            .bind(String(clientId).slice(0, 80), userId)
            .first();
          if (old) return json(old);
        }
        let fotoKey = null;
        const foto = form.get('foto');
        if (foto && typeof foto === 'object' && foto.size > 0) {
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(foto.type))
            return json({ error: 'Usa una foto JPG, PNG o WebP' }, 415);
          if (foto.size > 4_000_000) return json({ error: 'Foto muy grande (máx 4 MB)' }, 413);
          fotoKey = `fotos/${Date.now()}-${crypto.randomUUID()}.jpg`;
          await env.FOTOS.put(fotoKey, await foto.arrayBuffer(), {
            httpMetadata: { contentType: foto.type || 'image/jpeg' },
          });
        }
        const r = await env.DB.prepare(
          `INSERT INTO reportes (categoria, descripcion, foto_key, lat, lng, colonia, user_id, user_nombre, client_id)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            categoria,
            (form.get('descripcion') || '').toString().slice(0, 500),
            fotoKey,
            lat,
            lng,
            (form.get('colonia') || '').toString().slice(0, 120),
            userId,
            userNombre,
            clientId ? String(clientId).slice(0, 80) : null
          )
          .run();
        return json({ id: r.meta.last_row_id, estado: 'enviado' }, 201);
      }

      // GET /api/foto/<key>
      if (pathname.startsWith('/api/foto/') && req.method === 'GET') {
        const key = pathname.replace('/api/foto/', '');
        const obj = await env.FOTOS.get(key);
        if (!obj) return json({ error: 'No encontrada' }, 404);
        return new Response(obj.body, {
          headers: {
            'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
            'cache-control': 'public, max-age=31536000',
          },
        });
      }

      // POST /api/reportes/:id/votar
      let m = pathname.match(/^\/api\/reportes\/(\d+)\/votar$/);
      if (m && req.method === 'POST') {
        const { fingerprint } = await req.json().catch(() => ({}));
        if (!fingerprint) return json({ error: 'fingerprint requerido' }, 400);
        try {
          await env.DB.prepare('INSERT INTO votos (reporte_id, fingerprint) VALUES (?,?)')
            .bind(+m[1], fingerprint.toString().slice(0, 64))
            .run();
        } catch {
          return json({ error: 'Ya apoyaste este reporte 👍' }, 409);
        }
        await env.DB.prepare('UPDATE reportes SET votos = votos + 1 WHERE id = ?')
          .bind(+m[1])
          .run();
        return json({ ok: true });
      }

      // PATCH /api/reportes/:id/estado  (admin)
      m = pathname.match(/^\/api\/reportes\/(\d+)\/estado$/);
      if (m && req.method === 'PATCH') {
        if (!isAdmin(req, env)) return json({ error: 'No autorizado' }, 401);
        const { estado, nota } = await req.json().catch(() => ({}));
        if (!ESTADOS.includes(estado)) return json({ error: 'estado inválido' }, 400);
        await env.DB.prepare('UPDATE reportes SET estado = ?, nota = ? WHERE id = ?')
          .bind(estado, (nota || '').toString().slice(0, 300), +m[1])
          .run();
        await env.DB.prepare(
          'INSERT INTO cambios (reporte_id, estado, nota, usuario) VALUES (?,?,?,?)'
        )
          .bind(+m[1], estado, (nota || '').toString().slice(0, 300), 'equipo')
          .run();
        return json({ ok: true });
      }

      // Historial de estados de un reporte
      m = pathname.match(/^\/api\/reportes\/(\d+)\/historial$/);
      if (m && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM cambios WHERE reporte_id = ? ORDER BY id'
        )
          .bind(+m[1])
          .all();
        return json(results);
      }

      // Un reporte suelto (página pública /reporte/:id)
      m = pathname.match(/^\/api\/reportes\/(\d+)$/);
      if (m && req.method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM reportes WHERE id = ?').bind(+m[1]).first();
        return r ? json(r) : json({ error: 'Reporte no encontrado' }, 404);
      }

      // GET /api/colonias (ranking)
      if (pathname === '/api/colonias' && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT colonia, COUNT(*) AS total,
                  SUM(CASE WHEN estado IN ('enviado','recibido') THEN 1 ELSE 0 END) AS abiertos,
                  SUM(votos) AS votos,
                  MAX(CASE WHEN estado IN ('enviado','recibido')
                           THEN CAST(julianday('now') - julianday(created_at) AS INTEGER) END) AS dias_max_abiertos
           FROM reportes WHERE colonia IS NOT NULL AND colonia <> ''
           GROUP BY colonia ORDER BY abiertos DESC, votos DESC`
        ).all();
        return json(results);
      }

      // GET /api/export?format=csv|geojson
      if (pathname === '/api/export' && req.method === 'GET') {
        if (!isAdmin(req, env)) return json({ error: 'No autorizado' }, 401);
        const { results } = await env.DB.prepare('SELECT * FROM reportes ORDER BY id').all();
        const fmt = url.searchParams.get('format') || 'csv';
        if (fmt === 'geojson') {
          return json({
            type: 'FeatureCollection',
            features: results.map((r) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
              properties: { ...r, lat: undefined, lng: undefined },
            })),
          });
        }
        const cols = [
          'id',
          'categoria',
          'descripcion',
          'lat',
          'lng',
          'colonia',
          'estado',
          'nota',
          'votos',
          'created_at',
        ];
        const esc = (v) => {
          let text = String(v ?? '');
          if (typeof v === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
          return `"${text.replaceAll('"', '""')}"`;
        };
        const csv = [
          cols.join(','),
          ...results.map((r) => cols.map((c) => esc(r[c])).join(',')),
        ].join('\n');
        return new Response(csv, {
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="lcalerta_reportes.csv"',
          },
        });
      }

      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (e) {
      return json({ error: 'No pudimos completar la operación. Intenta de nuevo.' }, 500);
    }
  },
};
