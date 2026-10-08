# Hackaton2.0 · Cerca

Aplicación Android y web para consultar combis en el corredor de Jugos Acapulco al entronque de la avenida Lázaro Cárdenas. El proyecto está en [`app/`](app/): **React, TypeScript, Vite, Leaflet y Capacitor**, con servidor propio **Node.js 24 + SQLite + SSE**.

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

[`app/SERVIDOR.md`](app/SERVIDOR.md) explica el servidor, la configuración de HTTPS con Docker Compose, la creación de choferes y la asignación de rutas y horarios. El servidor está preparado para alojarse; **no hay dominio público configurado ni cuentas creadas por defecto**.

## Android

Requiere Android Studio, SDK 36 y JDK 21. Android mínimo: 8.0/API 26.

Configura las direcciones públicas `VITE_PUBLIC_API_URL` y `VITE_PUBLIC_APP_URL` antes de compilar para conectar el APK al servidor alojado.

```sh
cd app
npm ci
npm run android:sync
npm run android:open
```

El proyecto nativo está en `app/android/`. Versión 1.2, código 3. En esta versión el chofer debe mantener la app abierta para compartir GPS; el seguimiento con pantalla bloqueada queda pendiente de definir.

## Verificar

Desde `app/`:

```sh
npm test
npm run test:ui
npm run build
```

30 pruebas de datos, búsqueda, planificación, autenticación, horarios, GPS, SSE y QR; 21 pruebas de interfaz, incluyendo chofer y pasajero con servidor real y GPS controlado. Las pruebas de interfaz usan Edge y un puerto aislado. Se verificó la compilación Android; no se probó en un teléfono físico.

Consulta [`app/LEEME.md`](app/LEEME.md) para uso, ejemplos, cobertura y formato de las rutas. Datos del mapa © [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).
