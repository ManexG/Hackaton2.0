# Administración en Cloudflare — pendiente de portar

La administración (administradores, alta de choferes, gestión de rutas) está implementada y probada en el **servidor Node**. En Cloudflare **todavía no existe**: `/api/manage/*` responde 404. Esta guía indica qué falta; la lógica ya está escrita para reutilizarse.

## Qué se reutiliza tal cual

`server/admin-core.js` (`AdminCore`) no depende de Node HTTP ni de `node:sqlite`. Solo usa:

- la interfaz `db` `{ exec, prepare().get/all/run, transaction }` — **la misma que ya construye `FleetService`** en `cloudflare/index.js`;
- `node:crypto` (igual que `store-core.js`, requiere `nodejs_compat`).

Crea sus propias tablas con `CREATE TABLE IF NOT EXISTS` (`admins`, `admin_sessions`, `managed_routes`, `deleted_routes`), así que no hay migración aparte.

## Pasos

1. **Instanciar** en el constructor de `FleetService` (hay un `TODO(cloudflare-admin)`):
   ```js
   this.admin = new AdminCore(db, network, this.store);
   this.community.transform = (base) => this.admin.applyTo(base);
   this.community.refreshNetwork();
   ```
   `transform` es el gancho que ya añadí en `server/community/service.js`: aplica rutas editadas/creadas/ocultas sobre `network.demo.json` (la semilla).
2. **Enrutar `/api/manage/*`** dentro de `FleetService.fetch`, portando `server/admin.js` (`createManageHandler`). Allí están todos los endpoints; solo cambia el acceso a la petición:
   - cuerpo: `this.body(request)`; para `/routes*` el límite debe subir a ~512 KB (los trazados por calles pesan más que los 16 KB actuales);
   - login: usar `this.throttle(...)` (tabla `login_attempts`) como en `/api/auth/login`;
   - tras cambiar rutas o choferes: `this.community.refreshNetwork(); this.broadcast();`;
   - `traceByStreets` (OSRM) se puede copiar tal cual: usa `fetch`, que existe en Workers.
3. **Gateway** (`export default { fetch }`): `/api/manage/*` debe pasar al Durable Object **sin** exigir `CERCA_ADMIN_TOKEN`, porque se autentica con sesión de administrador (`AdminCore.authenticate`). No reutilizar el prefijo `/api/admin/`, que el gateway reserva para el token de operador (por eso se eligió `/api/manage/`).
4. **CORS**: añadir `PUT` y `DELETE` a `Access-Control-Allow-Methods` (hoy `GET,POST,PATCH,OPTIONS`).
5. **Primer administrador**: no hay cuenta por defecto. En Node se crea con `npm run admin:create`. En Cloudflare hace falta un equivalente, por ejemplo `POST /api/admin/admins` protegido por `CERCA_ADMIN_TOKEN` que llame a `admin.createAdmin(...)` (un solo uso cuando no haya administradores), análogo a `/api/admin/drivers`. Los siguientes se dan de alta desde el panel.
6. **Pruebas**: copiar los casos de `tests/admin.test.js` a `cloudflare/integration.test.js`. Cubren login, roles, CRUD de choferes y rutas, trazado y el bloqueo al borrar rutas con choferes.

## Puntos que conviene vigilar

- **`network` en el Durable Object**: `FleetService` importa `network` desde el JSON empaquetado. `AdminCore` lo trata como semilla de solo lectura; todo cambio vive en SQLite del DO.
- **Sesiones**: las de administrador duran 2 h (`ADMIN_SESSION_MS`); las de chofer, 12 h. Son tablas distintas (`admin_sessions` / `sessions`).
- **Misma red en cliente y servidor**: tras guardar rutas, el cliente llama a `refreshNetwork()` y lee `GET /api/network`. En Cloudflare esa ruta pasa por `CommunityService.refreshNetwork`, que ya aplica `transform`.
- **Contraseñas iniciales**: se generan en el servidor y se devuelven una sola vez; no se almacenan en claro.

## Referencia de endpoints (todos salvo `login` exigen `Authorization: Bearer <token de admin>`)

| Método | Ruta | Función |
| --- | --- | --- |
| POST | `/api/manage/login` | Inicia sesión (`{email,password}` → `{token,expiresAt,admin}`) |
| POST | `/api/manage/logout` · GET `/me` | Cierra sesión / datos propios |
| GET, POST | `/api/manage/admins` | Listar / dar de alta administradores |
| DELETE | `/api/manage/admins/:id` | Eliminar (no a sí mismo ni al último) |
| POST | `/api/manage/admins/me/password` | Cambiar la propia contraseña |
| GET, POST | `/api/manage/drivers` | Listar / alta (devuelve `{driver,password}` una vez) |
| PATCH, DELETE | `/api/manage/drivers/:id` | Editar asignación / eliminar |
| POST | `/api/manage/drivers/:id/reset-password` | Nueva contraseña (una vez) |
| GET, POST | `/api/manage/routes` | Listar (incluye demo) / crear |
| PUT, DELETE | `/api/manage/routes/:id` | Editar / borrar (409 si tiene choferes) |
| POST | `/api/manage/routes/:id/restore` · `/routes/restore-demo` | Restaurar demo original |
| POST | `/api/manage/routes/trace` | Trazar por calles (OSRM) entre paradas |
