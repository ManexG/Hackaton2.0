-- Migración 6: movilidad (Ciudad Viva + combis)
-- Objetivo: rutas, paradas, vehículos en vivo, y los puntos/observaciones
-- de campo que pide la propuesta (imagen urbana / orientación).

-- Rol en la cuenta: los vecinos son 'vecino' (default); los choferes, 'chofer'.
ALTER TABLE usuarios ADD COLUMN rol TEXT NOT NULL DEFAULT 'vecino';

-- Colonia de referencia del vecino: alimenta el "cercano a ti" del perfil.
ALTER TABLE usuarios ADD COLUMN colonia_ref TEXT;

-- Rutas de combi. El trazo se guarda como JSON [[lat,lng], ...] para pintar la línea.
CREATE TABLE IF NOT EXISTS rutas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  trazo TEXT,                 -- JSON: [[lat,lng], ...]
  activa INTEGER NOT NULL DEFAULT 1,
  fuente TEXT,                -- de dónde salen los datos (obligatorio para no inventar)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Paradas, con su código QR (el QR físico lo imprime el equipo).
CREATE TABLE IF NOT EXISTS paradas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruta_id INTEGER NOT NULL REFERENCES rutas(id),
  nombre TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  qr TEXT UNIQUE,             -- p.ej. LC-COMBI-A-007
  espera_min REAL,            -- espera promedio observada en la parada (dato de campo, opcional)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_paradas_ruta ON paradas(ruta_id, orden);
CREATE INDEX IF NOT EXISTS idx_paradas_qr ON paradas(qr);

-- Sentido de la ruta: algunas líneas tienen ida y vuelta con trazos distintos.
CREATE TABLE IF NOT EXISTS sentidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruta_id INTEGER NOT NULL REFERENCES rutas(id),
  nombre TEXT NOT NULL,      -- 'ida', 'vuelta', o el nombre que usen los choferes
  color TEXT,                -- si el sentido usa otro color
  paradas TEXT               -- JSON: [id_parada, ...] en orden de este sentido
);
CREATE INDEX IF NOT EXISTS idx_sentidos_ruta ON sentidos(ruta_id);

-- Vehículos (combis). Se crean desde la app del chofer.
CREATE TABLE IF NOT EXISTS vehiculos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  ruta_id INTEGER REFERENCES rutas(id),
  nombre TEXT,                -- "Combi 12", placa, etc.
  sentido TEXT,               -- 'ida' | 'vuelta'
  activo INTEGER NOT NULL DEFAULT 1,
  ultima_posicion TEXT,       -- JSON: {lat,lng,ts,velocidad}
  ultima_ts TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_activo ON vehiculos(activo);

-- Historial de posiciones: permite después analizar flujo por horario.
CREATE TABLE IF NOT EXISTS posiciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  velocidad REAL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posiciones_ts ON posiciones(ts);

-- Longitude y latitud de la zona piloto: define qué parte de la ciudad se estudia.
CREATE TABLE IF NOT EXISTS zona (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radio_m REAL,                -- radio aproximado de la zona (metros)
  descripcion TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Puntos relevantes de la zona piloto (la propuesta de Alan).
CREATE TABLE IF NOT EXISTS puntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,         -- cruce, comercio, escuela, acceso, espacio publico, otro
  nombre TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  notas TEXT,
  fuente TEXT,                -- cómo se verificó (campo, mapa, entrevista)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Observaciones de campo sobre las condiciones del recorrido.
CREATE TABLE IF NOT EXISTS observaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  punto_id INTEGER REFERENCES puntos(id),
  tipo TEXT NOT NULL,         -- banqueta, rampa, iluminacion, obstaculo, senalizacion
  detalle TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conteos por hora (peatones / vehículos) para los flujos por horario.
CREATE TABLE IF NOT EXISTS conteos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  hora TEXT NOT NULL,
  tipo TEXT NOT NULL,         -- peatones | vehiculos
  cantidad INTEGER NOT NULL,
  minutos INTEGER NOT NULL,   -- duración del intervalo observado
  notas TEXT
);
CREATE INDEX IF NOT EXISTS idx_conteos_fecha ON conteos(fecha, hora);