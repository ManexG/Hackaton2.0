# Administración en Cloudflare

Desde 1.8.1, el panel `#/gestion` funciona con Node y con Cloudflare. Se incorporó el trabajo del equipo de `V2Camion` (`8ce5045`) y se completó la parte que estaba pendiente en Workers. No se crea ninguna cuenta de administrador por defecto.

`AdminCore` usa el mismo SQLite del Durable Object. Las tablas nuevas se crean sin borrar datos: `admins`, `admin_sessions`, `managed_routes` y `deleted_routes`. El controlador de operaciones se comparte entre Node y Cloudflare. Las rutas demo permanecen como semilla; ediciones, nuevas rutas y rutas ocultas viven en la base. Las cuentas de chofer existentes conservan asignaciones y contraseñas.

## Primer administrador

En Node, utiliza `npm run admin:create -- --name "Nombre" --email correo`. En Cloudflare, un operador autorizado debe enviar `POST /api/admin/admins` con `Authorization: Bearer <CERCA_ADMIN_TOKEN>` y JSON `{ "name": "Nombre", "email": "correo", "password": "contraseña privada de al menos 12 caracteres" }` por HTTPS. No guardes claves ni contraseñas en Git ni las incluyas en comandos compartidos. Este endpoint solo permite crear el primer administrador; después responde 409. Los siguientes se agregan desde el panel.

La clave de operador se valida en el gateway. El prefijo `/api/manage/*` usa exclusivamente una sesión de administrador, no la clave compartida ni una sesión de chofer. Las sesiones de administración duran dos horas y se almacenan con el hash del token. Cambiar una contraseña invalida las sesiones anteriores.

## Funciones

| Método y ruta, bajo `/api/manage` | Función |
| --- | --- |
| `POST /login`, `POST /logout`, `GET /me` | Acceso, salida y cuenta propia. |
| `GET/POST /admins`, `DELETE /admins/:id` | Administradores; no se permite eliminarse ni quitar el último. |
| `POST /admins/me/password` | Cambiar contraseña propia. |
| `GET/POST /drivers`, `PATCH/DELETE /drivers/:id` | Alta, asignación y eliminación de choferes. |
| `POST /drivers/:id/reset-password` | Contraseña nueva, devuelta una sola vez. |
| `GET/POST /routes`, `PUT/DELETE /routes/:id` | Consulta y edición de rutas dentro de la cobertura. |
| `POST /routes/restore-demo`, `POST /routes/:id/restore` | Restaurar rutas de ejemplo. |
| `POST /routes/trace` | Trazar entre paradas con OSRM y validar la cobertura. |

Las modificaciones de asignación detienen el servicio; restablecer contraseña o eliminar un chofer revoca sus sesiones. Borrar una ruta con choferes asignados responde 409 y exige reasignarlos antes. Editar una parada compartida la duplica si moverla afectaría otra ruta. La búsqueda externa y el trazado necesitan conexión y pueden fallar; se muestra el error y se conserva la edición.

El cliente envía versión y plataforma y recibe el bloqueo de actualización correspondiente. Las operaciones administrativas necesitan internet; no se almacenan en la caché pública. El servidor limita los cuerpos y los intentos de acceso. El panel se descarga cuando se abre, para ahorrar datos al pasajero.

El cambio obligatorio de contraseña del chofer en su primer acceso sigue pendiente en el trabajo original del equipo. No se añadió seguimiento GPS en segundo plano. Desde 1.9.0 la pestaña Reportes y paradas integra moderación, importación y exportación de comunidad usando la sesión de administración. La clave de operador se agrega internamente en el servidor; no se entrega al cliente.

## Verificación

Las pruebas aisladas comprueban permisos, contraseñas, CRUD, paradas compartidas y errores del proveedor de calles. La prueba del runtime de Cloudflare verifica además el aprovisionamiento protegido del primer administrador, sesiones separadas de los choferes, persistencia de rutas al reiniciar y bloqueo al borrar rutas asignadas. No se aprovisionaron cuentas reales de administrador para ejecutar pruebas.
