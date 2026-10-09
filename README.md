# Hackaton2.0 · Cerca

Aplicación Android y web para consultar combis en el corredor de Jugos Acapulco al entronque de la avenida Lázaro Cárdenas. El proyecto está en [`app/`](app/): **React, TypeScript, Vite, Leaflet y Capacitor**, alojado en **Cloudflare Workers + Durable Objects con SQLite + SSE**. Se conserva un servidor alternativo de Node.js 24.

**Web pública: [cerca-combis.alanedgardo4.workers.dev](https://cerca-combis.alanedgardo4.workers.dev/)**.

- Pasajeros sin registro: búsqueda de negocios, calles y direcciones, lugares cercanos y recorridos de colores.
- Choferes con cuenta, unidad, ruta y horario asignados: activación y desactivación de servicio con GPS.
- Combis disponibles y llegadas estimadas por parada; viajes con hasta dos trasbordos según vehículos activos.
- Enlaces y QR por parada, lector QR y búsqueda por voz en Android y navegadores compatibles.

Las rutas, paradas intermedias y tarifas siguen siendo de prueba. El catálogo incluye 941 lugares, calles y direcciones de OpenStreetMap. La cobertura rodea el corredor indicado y no representa el límite oficial de la ciudad. No se crean choferes ni horarios ficticios.

## Ejecutar

Requiere Node.js 24 o superior.

```sh
cd app
npm ci
npm run build
npm run server
```

Abre `http://127.0.0.1:8787/`. Para editar React, ejecuta también `npm run dev` en otra terminal.

## Alojar y configurar cuentas

[`app/CLOUDFLARE.md`](app/CLOUDFLARE.md) explica la publicación en `workers.dev`, el almacenamiento persistente y la creación de choferes en la nube. [`app/SERVIDOR.md`](app/SERVIDOR.md) documenta el servidor Node alternativo. **No se crean cuentas ni horarios por defecto**. Las credenciales de operador y de Cloudflare se conservan fuera del repositorio.

## Android

Requiere Android Studio, SDK 36 y JDK 21. Android mínimo: 8.0/API 26.

Configura las direcciones públicas `VITE_PUBLIC_API_URL` y `VITE_PUBLIC_APP_URL` antes de compilar para conectar el APK al servidor alojado.

```sh
cd app
npm ci
npm run android:sync
npm run android:open
```

El proyecto nativo está en `app/android/`. Versión 1.3, código 4. En esta versión el chofer debe mantener la app abierta para compartir GPS; el seguimiento con pantalla bloqueada queda pendiente de definir.

## Verificar

Desde `app/`:

```sh
npm test
npm run test:ui
npm run build
npm run cloudflare:check
npm run test:cloudflare
```

30 pruebas de datos, búsqueda, planificación, autenticación, horarios, GPS, SSE y QR; 21 pruebas de interfaz; una prueba de integración con el runtime de Cloudflare que verifica cuentas, GPS, SSE, CORS y persistencia al reiniciar. Las pruebas usan datos aislados. Se verificó la compilación Android; no se probó en un teléfono físico.

Consulta [`app/LEEME.md`](app/LEEME.md) para uso, ejemplos, cobertura y formato de las rutas. Datos del mapa © [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).
