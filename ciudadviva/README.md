# LCAlerta — Lázaro Cárdenas

App ciudadana para que los vecinos de colonias no turísticas reporten problemas urbanos
(alumbrado, baches, basura, fugas) con foto + GPS, y para que el municipio los priorice.

**Producción:** https://lcalerta.ac-mx.workers.dev
**Panel del municipio:** https://lcalerta.ac-mx.workers.dev/admin.html

---

## Correr en local

```bash
npm install
npm run db:local     # crea el esquema en la BD local de D1
npm run dev          # http://localhost:8787
```

- App ciudadana: `/`
- Panel municipio: `/admin` (clave de desarrollo: `dev123`, está en `.dev.vars`)
- Página pública de un reporte: `/reporte/3`

En local la BD es una copia SQLite en `.wrangler/`; **nunca** se toca la de producción.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend + API | Cloudflare Workers con Assets estáticos (`worker/src/index.js` + `app/`) |
| Base de datos | Cloudflare D1 (SQLite) |
| Fotos | Cloudflare R2 |
| Frontend | HTML/CSS/JS vanilla, Tailwind CDN, DaisyUI, Lucide (íconos), Chart.js |
| PWA | Manifest + Service Worker (offline-first) |
| Geocoding | Photon / OpenStreetMap (reverse, sin API key) |

---

## Estructura

```
app/          frontend (index.html, admin.html, reporte.html, estadisticas.html, js/, css/, img/)
worker/src/   API
migrations/   esquema D1 (0001..0005)
bd/           notas del modelo de datos
docs/         contrato de la API
assets/       identidad visual (equipo, no lo tocan)
```

## Zonas de los compañeros (aisladas)

`assets/`, `docs/pitch.md` y `docs/flucho_demo.md` están libres para el equipo.
No deben modificar `app/`, `worker/` ni `migrations/`.

---

## Cómo funciona

1. El vecino **crea cuenta** (email + contraseña, PBKDF2-SHA256 con salt).
2. Reporta con **foto + GPS** (dos pasos: formulario → confirmación).
3. La **colonia se autocompleta** desde las coordenadas (Photon); el mapa de la zona
   se puede descargar para usarlo sin señal.
4. Los reportes se ven en el **feed** (con búsqueda y filtros) y en el **mapa**.
5. Los vecinos **apoyan** un reporte (un voto por dispositivo).
6. El ayuntamiento, en `/admin`, ve una **cola ordenada por urgencia**
   (`votos×2 + días sin responder + peso de categoría`), cambia el estado
   (`enviado → recibido → aprobado | no_aprobado`) y deja una nota.
7. Cada cambio queda en el **historial** del reporte, visible en `/reporte/:id`.
8. Todo se puede **exportar** (CSV / GeoJSON) y hay **estadísticas** agregadas.

### Offline-first

Los reportes se guardan primero en el teléfono (IndexedDB) y se suben solos cuando
hay señal. El Service Worker sirve primero desde la red y usa su caché como respaldo,
de modo que la app abre y se usa aunque el barrio no tenga internet.

---

## Producción — runbook

```bash
# 1. Base de datos y bucket (ya existen; solo si se empiezan de cero)
npx wrangler d1 create lcalerta
npx wrangler r2 bucket create lcalerta-fotos

# 2. Poner el database_id real en wrangler.toml

# 3. Migraciones contra la base remota
npx wrangler d1 migrations apply lcalerta --remote

# 4. Secreto del panel de gobierno (nunca en el repo)
npx wrangler secret put ADMIN_KEY

# 5. Desplegar
npm run deploy
```

### Datos de producción actuales

- **URL:** https://lcalerta.ac-mx.workers.dev
- **`ADMIN_KEY`:** NO se escribe en el repositorio. Está como secreto de Wrangler:
  `npx wrangler secret put ADMIN_KEY`. Para recuperarla no está; si se necesita,
  se genera una nueva.
- **D1:** `lcalerta` — `61b3828e-80b9-476c-8ede-15e58441c039`
- **R2:** `lcalerta-fotos`

### Proteger `/admin` con Cloudflare Zero Trust (recomendado)

La clave `ADMIN_KEY` protege las **acciones**, pero la página del panel es pública.
Para dejarla solo accesible a ti:

1. Dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**
2. Type: **Self-hosted**, domain: `lcalerta.ac-mx.workers.dev`, path: `/admin*`
3. Policy: **Allow** tu correo (o un grupo), con **Require** el proveedor de correo
4. Free plan: hasta 50 usuarios.

Con esto, aunque alguien tenga la URL, ve la pantalla de login de Cloudflare.

---

## Comprobaciones hechas

- `POST /api/reportes` **exige sesión** (401 sin token): la app no se usa sin cuenta.
- Un voto por dispositivo (`votos` con `UNIQUE(reporte_id, fingerprint)` → 409).
- Export CSV/GeoJSON **exigen `ADMIN_KEY`**.
- Historial de estados se registra en cada cambio del ayuntamiento.