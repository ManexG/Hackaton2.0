-- Historial de estados: quién cambió el estado, cuándo y con qué nota
CREATE TABLE IF NOT EXISTS cambios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporte_id INTEGER NOT NULL REFERENCES reportes(id),
  estado TEXT NOT NULL CHECK (estado IN ('enviado','recibido','aprobado','no_aprobado')),
  nota TEXT,
  usuario TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cambios_reporte ON cambios(reporte_id);