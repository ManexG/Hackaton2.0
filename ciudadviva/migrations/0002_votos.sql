CREATE TABLE IF NOT EXISTS votos (
  reporte_id INTEGER NOT NULL REFERENCES reportes(id),
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(reporte_id, fingerprint)
);
