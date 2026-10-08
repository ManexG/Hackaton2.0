# Hackaton2.0 · Cerca

Demo de movilidad en combis para el corredor de Jugos Acapulco al entronque de la avenida Lázaro Cárdenas. La aplicación está en [`app/`](app/) y usa **React, TypeScript, Vite, Leaflet y Capacitor para Android**.

Permite buscar negocios, lugares de interés, calles y direcciones dentro de la zona, elegir origen y destino y comparar recorridos con trasbordos. El viaje seleccionado resalta todas sus combis en el mapa. Las recomendaciones se calculan según los puntos elegidos; la app empieza sin un viaje predeterminado.

Las cuatro rutas de combis son ficticias y se pueden sustituir por datos reales. El catálogo incluye 941 lugares, calles y direcciones de OpenStreetMap. La cobertura es un perímetro de demostración alrededor del corredor, no el límite oficial de la ciudad.

## Ejecutar en computadora

Requiere Node.js 22 o superior.

```sh
cd app
npm ci
npm run dev
```

## Android con Capacitor

Requiere Android Studio, SDK 36 y JDK 21.

```sh
cd app
npm ci
npm run android:sync
npm run android:open
```

El proyecto nativo está en `app/android/`. Android Studio permite compilar e instalar la aplicación sin depender del servidor de desarrollo. El APK se genera en `app/android/app/build/outputs/apk/debug/app-debug.apk`.

## Verificar

Desde `app/`:

```sh
npm test
npm run test:ui
npm run build
```

Las pruebas de interfaz usan Microsoft Edge. El navegador se puede ajustar en `app/playwright.config.ts`.

Consulta [`app/LEEME.md`](app/LEEME.md) para los ejemplos de búsqueda, la cobertura, el formato de las rutas y las limitaciones de la demo. Los datos del mapa tienen atribución a [OpenStreetMap y licencia ODbL](https://www.openstreetmap.org/copyright). La búsqueda en línea y los mapas detallados requieren conexión; el catálogo y las calles guardadas funcionan localmente.
