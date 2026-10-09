# Propuesta: usuario administrador, alta de choferes y gestión de rutas

Estado: **implementado en el servidor Node** (rama `V2Camion`). Pendiente en Cloudflare: ver [CLOUDFLARE-ADMIN.md](CLOUDFLARE-ADMIN.md).

Decisiones tomadas: las rutas demo son editables y se conservan como ejemplo (se pueden restaurar); varios administradores con alta desde el panel; las rutas se guardan en la base (el JSON es la semilla). Difiere de la propuesta original en que el login de administrador es `POST /api/manage/login` (no comparte `/api/auth/login`) y el prefijo es `/api/manage/*`, porque `/api/admin/*` está reservado al token de operador en Cloudflare. El cambio obligatorio de contraseña del chofer en su primer acceso **no** se implementó.

Uso: `npm run admin:create -- --name "Nombre" --email correo` crea el primer administrador; luego se entra en `#/gestion` (enlace "Acceso de administración" en el login de choferes).

## Qué existe hoy (y por qué no basta)

| Tema | Situación actual |
| --- | --- |
| Alta de choferes | Solo por consola: `npm run driver:create` (`server/create-driver.js`) o `POST /admin/drivers` con `CERCA_ADMIN_TOKEN` en Cloudflare. La contraseña inicial sale por terminal. |
| Administración | Un panel en `CommunityPanel.jsx` (`Admin`) protegido por una **clave compartida** (`X-Admin-Key`). No hay usuario, rol ni sesión; cualquiera con la clave es "admin" y la clave se teclea en el navegador. |
| Rutas | `public/data/network.demo.json` (estático). La comunidad ya puede añadir rutas en D1 (`/api/admin/rutas`, `/paradas`, `/trazar`), pero solo crear: **no editar ni borrar**, y sin orden por arrastre. |
| Choferes ↔ rutas | `drivers.route_id` apunta a un id de `network.routes`. Si una ruta se borra, el chofer queda huérfano. |

## 1. Usuario administrador

- Nueva tabla `admins (id, name, email, password, created_at)` junto a `drivers`, con el mismo hash `scrypt` y la misma tabla `sessions` ampliada con `role` (`driver` | `admin`).
- Login por el mismo `POST /api/auth/login`; la respuesta incluye `role`. Sesión de 2 h para admin (12 h para chofer), con el límite de intentos que ya existe.
- Primer admin: `npm run admin:create -- --email … ` (contraseña generada, mostrada una vez). Sin admin por defecto. Se retira la dependencia de `X-Admin-Key` para el flujo de movilidad.
- Todas las rutas `/api/admin/*` exigen sesión con `role = admin` (middleware único en `server/index.js` y `cloudflare/index.js`).
- Entrada en la app: botón "Administrar" visible solo si `role === 'admin'`; sin sesión de admin no se carga el panel.

## 2. Alta de choferes (pestaña "Choferes")

- Lista: nombre, correo, unidad, ruta, horario, en servicio / fuera.
- Formulario: nombre, correo, unidad, **ruta (selector con las rutas existentes)**, ventanas de horario (días + inicio/fin; reutiliza `validateWindows`).
- La contraseña inicial se genera en el servidor, se muestra **una sola vez** con botón copiar, y el chofer debe cambiarla en su primer acceso.
- Acciones: editar asignación, restablecer contraseña, desactivar/eliminar cuenta (cierra sesiones y servicio activo).
- Endpoints: `GET/POST /api/admin/drivers`, `PATCH/DELETE /api/admin/drivers/:id`, `POST /api/admin/drivers/:id/reset-password`. Reutilizan `store.provision`.

## 3. Gestión de rutas (pestaña "Rutas", edición en la misma pestaña)

**Disposición**: lista de rutas a la izquierda (o arriba en móvil) y el mapa Leaflet ya existente (`MapView.jsx`) en el mismo panel. Al elegir una ruta se edita ahí mismo, sin cambiar de pantalla.

- **Lista**: color, nombre, nº de paradas, choferes asignados; botones Agregar, Editar, Borrar.
- **Agregar/editar**: nombre, color, tarifa, frecuencia, bidireccional.
- **Puntos en el mapa**: modo "Agregar parada": clic en el mapa añade un punto (valida `insideCoverage`). Los puntos se pueden arrastrar en el mapa para reubicarlos.
- **Por dirección**: un campo de búsqueda que usa `searchPlaces`/`geocodeInCoverage` (ya existentes) y añade el resultado como parada.
- **Orden por arrastre**: lista de paradas con asa de arrastre (HTML5 drag-and-drop o `@dnd-kit/sortable`, con botones ↑↓ como alternativa táctil/accesible). Reordenar redibuja la línea en el mapa al instante.
- **Trazado**: botón "Trazar por calles" que reutiliza `/trazar` (ya existe) entre paradas consecutivas; mientras tanto se muestra la línea recta.
- **Borrar**: confirmación; si hay choferes asignados se bloquea y se pide reasignarlos primero (evita choferes huérfanos).
- **Guardar**: se envía la ruta completa de una vez (`POST/PUT /api/admin/routes`), se valida con `validateNetwork` y se emite `broadcast()` para que los pasajeros vean el cambio.

### Almacenamiento (decisión principal)

El JSON estático no se puede escribir en producción. Propuesta: rutas y paradas administradas en la base de datos (SQLite local / Durable Object en Cloudflare, tablas `routes` y `route_stops` con `position`), y `network.demo.json` pasa a ser la **semilla inicial**. `refreshNetwork()` (`server/community/service.js`) ya fusiona rutas de la BD con la base, así que el pasajero y el planificador no cambian.

## 4. Orden de implementación sugerido

1. Tabla `admins`, rol en sesión y middleware; `admin:create`.
2. Endpoints de choferes + pestaña "Choferes".
3. Tablas `routes`/`route_stops`, siembra desde el JSON, CRUD de rutas.
4. Pestaña "Rutas" (lista + mapa + puntos + dirección + arrastre).
5. Pruebas: unitarias de permisos y CRUD (`tests/`), UI con Playwright (crear ruta, reordenar, borrar bloqueado con choferes).

## Riesgos / decisiones para ti

- Cloudflare y Node son dos backends: cada endpoint debe hacerse en ambos (`server/index.js`, `cloudflare/index.js`).
- ¿Las rutas "demo" actuales se pueden borrar, o quedan protegidas como semilla?
- ¿Un solo admin o varios (con alta de admins desde el panel)?
- Hoy hay dos sistemas de cuentas (choferes y comunidad `usuarios`); se propone no mezclarlos.
