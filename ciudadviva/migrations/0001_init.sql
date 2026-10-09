-- Lázaro Cárdenas Alerta — esquema v1
CREATE TABLE IF NOT EXISTS categorias (
  clave  TEXT PRIMARY KEY,
  etiqueta TEXT NOT NULL,
  peso   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reportes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria  TEXT NOT NULL REFERENCES categorias(clave),
  descripcion TEXT,
  foto_key   TEXT,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  colonia    TEXT,
  estado     TEXT NOT NULL DEFAULT 'enviado'
             CHECK (estado IN ('enviado','recibido','aprobado','no_aprobado')),
  nota       TEXT,
  votos      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reportes_colonia ON reportes(colonia);
CREATE INDEX IF NOT EXISTS idx_reportes_estado  ON reportes(estado);

INSERT OR IGNORE INTO categorias (clave, etiqueta, peso) VALUES
  ('alumbrado', 'Alumbrado público', 2),
  ('bache',     'Bache',             1),
  ('basura',    'Basura acumulada',  1),
  ('fuga_agua', 'Fuga de agua',      3),
  ('otro',      'Otro',              1);
