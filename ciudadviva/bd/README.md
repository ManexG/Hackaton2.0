# bd/ — Modelo

D1 = SQLite gestionado por Cloudflare. Esquema vivo en `../migrations/`.

- `categorias(clave, etiqueta, peso)` — pesos: alumbrado 2, bache 1, basura 1, fuga_agua 3, otro 1
- `reportes(id, categoria, descripcion, foto_key, lat, lng, colonia, estado, nota, votos, created_at)`

Notas:
- Sin auth de vecinos: anonimato por diseño. Anti-abuso = rate limit en Worker + validación.
- Producción: proteger `/admin` además con Cloudflare Zero Trust Access (correo admin).
