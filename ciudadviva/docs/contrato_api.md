# Contrato de API (v2)

Base: mismo origen (`/`). Todos JSON salvo foto y export CSV.
Producción: https://lcalerta.ac-mx.workers.dev

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/categorias` | — | Lista categorías |
| GET | `/api/reportes?estado&categoria&colonia&q&limit&offset` | — | Reportes (paginados, `q` busca en la descripción) |
| GET | `/api/reportes/:id` | — | Un reporte suelto |
| POST | `/api/reportes` (multipart) | **Bearer** | Crear: `categoria`, `descripcion`, `lat`, `lng`, `colonia`, `foto` → `{id, estado:"enviado"}` |
| POST | `/api/reportes/:id/votar` | — | Cuerpo `{fingerprint}`; un voto por dispositivo (409 si repite) |
| PATCH | `/api/reportes/:id/estado` `{estado, nota}` | **X-Admin-Key** | `enviado\|recibido\|aprobado\|no_aprobado`; deja historial |
| GET | `/api/reportes/:id/historial` | — | Cambios de estado con fecha y nota |
| GET | `/api/reportes/:id/comentarios` | — | Hilo de comentarios |
| POST | `/api/reportes/:id/comentarios` `{nombre, texto}` | — | Comentar |
| GET | `/api/colonias` | — | Ranking por abiertos/votos + `dias_max_abiertos` |
| GET | `/api/estadisticas` | — | Agregados por categoría, estado, colonia y día |
| GET | `/api/foto/<key>` | — | Imagen de un reporte (R2) |
| GET | `/api/export?format=csv\|geojson` | **X-Admin-Key** o `?key=` | Exportar datos |
| POST | `/api/auth/registro` \| `/api/auth/login` | — | Sesión (PBKDF2) |
| GET | `/api/auth/me` | Bearer | Usuario de la sesión |
| GET | `/api/mis-reportes` \| `/api/mis-votos?fingerprint=` | Bearer | Datos del vecino |

Estados: `enviado → recibido → aprobado | no_aprobado`.
Urgencia (orden del panel): `votos*2 + días_sin_resolver + peso_categoría`.

Deep link público: `/reporte/:id` redirige a `/reporte.html?id=:id`.
