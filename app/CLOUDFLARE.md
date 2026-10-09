# Publicar OptiRouteLZC en Cloudflare

Dirección publicada: **https://cerca-combis.alanedgardo4.workers.dev/**. API: **https://cerca-combis.alanedgardo4.workers.dev/api**.

La web React, la API y la base de datos se alojan juntas en un Worker con un Durable Object que usa SQLite persistente. La dirección `https://cerca-combis.<subdominio-de-tu-cuenta>.workers.dev/` se asigna al publicar; no requiere comprar dominio ni dejar una computadora encendida. Las combis se actualizan con SSE y la API pública no entrega nombres ni correos de los choferes.

La versión 1.6 incorpora la comunidad de Axel en `/api/community`: sus tablas y fotos se añaden al mismo SQLite con migraciones idempotentes, conservando la flota y las cuentas. No requiere crear recursos D1/R2 ni cambiar los permisos de la sesión de Cloudflare. El panel de Administración usa el secreto existente `CERCA_ADMIN_TOKEN`, enviado por cabecera `X-Admin-Key`; nunca se incluye en el APK. Detalles en [COMUNIDAD.md](COMUNIDAD.md).

## Publicación

Requiere Node.js 24 y una cuenta de Cloudflare. Desde esta carpeta:

```powershell
npm ci
npm run cloudflare:login
npm run cloudflare:check
npm run cloudflare:deploy
```

En el navegador, inicia sesión y autoriza la herramienta oficial Wrangler. Si tu cuenta tiene varias organizaciones, utiliza `CLOUDFLARE_ACCOUNT_ID` para elegir la correcta. El nombre del Worker está en `wrangler.jsonc`. La primera publicación crea su almacenamiento SQLite. Las siguientes conservan las cuentas y asignaciones; la caducidad del GPS controla la disponibilidad tras un reinicio.

Workers y Durable Objects con SQLite tienen un plan gratuito con cuotas; este proyecto no activa un plan de pago. Si tu cuenta ya tiene un plan de pago, el uso se rige por ese plan. Consulta las cuotas actuales en https://developers.cloudflare.com/durable-objects/platform/pricing/.

## Acceso de operador

Genera un token aleatorio de al menos 32 bytes, configúralo como secreto `CERCA_ADMIN_TOKEN` con `npx wrangler secret put CERCA_ADMIN_TOKEN` y conserva una copia en tu archivo `.env` privado. No se incluye en la web ni en el APK. El endpoint de administración queda cerrado si el secreto no está configurado.

Configura `.env` con la dirección real que devolvió Cloudflare:

```dotenv
VITE_PUBLIC_API_URL=https://cerca-combis.alanedgardo4.workers.dev/api
VITE_PUBLIC_APP_URL=https://cerca-combis.alanedgardo4.workers.dev/
CERCA_ADMIN_TOKEN=TU-TOKEN-PRIVADO
```

Cuando el responsable defina un chofer, ruta, unidad y horario, crea la cuenta en la nube:

```powershell
npm run driver:create -- --cloudflare --name "Nombre del chofer" --email "correo-del-chofer" --unit C-01 --route R01 --days 1,2,3,4,5 --start 06:00 --end 22:00
```

El comando genera una contraseña inicial y la muestra al operador. Entrégala directamente al chofer. Repetirlo con el mismo correo cambia su asignación, restablece la contraseña y cierra sus sesiones anteriores. Los horarios y asignaciones de este ejemplo no crean cuentas automáticamente.

## Android y QR

Con las dos variables públicas anteriores, ejecuta `npm run android:sync` y compila el APK. La web puede consultar `/api` en su propio dominio. El servidor también devuelve su dirección pública para generar QR de cada parada. El GPS de esta versión requiere mantener la aplicación abierta.

## Verificación

`npm run cloudflare:check` revisa JavaScript y el paquete que recibirá Cloudflare. `npm run test:cloudflare` comprueba cuentas, sesiones, GPS, CORS y eventos sobre el runtime local de Cloudflare, con una base de datos aislada. `npm test` mantiene las pruebas de rutas, búsqueda y del servidor Node alternativo.

El almacenamiento público inicia sin choferes ni posiciones inventadas. Las cuatro rutas permanecen como demostración hasta recibir las rutas oficiales.
