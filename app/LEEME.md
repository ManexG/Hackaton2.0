# Cerca 1.2 · React + Capacitor + GPS

Aplicación Android y web de movilidad para el corredor indicado en Lázaro Cárdenas. Usa **React 19, TypeScript, Vite 8, Leaflet y Capacitor 8**. El servidor propio usa **Node.js 24, SQLite y SSE** para compartir disponibilidad y ubicación entre dispositivos.

## Pasajero

No necesita registrarse. Puede buscar entre 941 entradas de OpenStreetMap —452 negocios y puntos de interés, 412 calles y 77 direcciones con número— y consultar lugares cercanos por categoría. El origen y el destino empiezan vacíos.

El mapa muestra los recorridos de colores y las combis de choferes conectados. Seleccionar una ruta o un viaje aumenta su intensidad y atenúa las demás. Si el viaje necesita trasbordo se resaltan todas sus líneas.

La recomendación se calcula para los lugares elegidos y las combis activas, con espera estimada y trasbordos. Si no hay vehículos disponibles no se inventa un servicio ni se recomienda una ruta predeterminada; los trazados siguen disponibles en **Ver rutas**.

En **Paradas**, el pasajero consulta las próximas llegadas, el sentido, la unidad y la antigüedad de la señal. Cada parada tiene un enlace y un QR que abre la web centrada en ella y la coloca como origen. La app también puede leer el QR con la cámara.

Los botones de micrófono permiten dictar el origen o destino. El texto pasa al mismo buscador de calles y negocios y el pasajero elige la coincidencia correcta.

## Chofer

En **Soy chofer**, inicia sesión con una cuenta creada por el responsable. Cada cuenta tiene una unidad, una ruta y un horario asignados desde el servidor. No puede cambiar su asignación desde la app.

El chofer elige el sentido de salida y pulsa **Activar mi servicio**. Se solicita una ubicación precisa y el servidor valida el horario y la cobertura. Al activarse, los pasajeros reciben su posición GPS. **Desactivar servicio** y **Cerrar sesión** detienen la publicación.

Esta versión requiere mantener la app abierta para compartir GPS. El seguimiento con pantalla bloqueada está pendiente de definir. La señal se actualiza como máximo cada 5 segundos y la combi deja de aparecer si pasan 45 segundos sin señal, termina su horario o sale de la zona/ruta. Después de una pérdida prolongada debe activarse de nuevo.

No se incluyen choferes ficticios ni horarios predeterminados. Las cuentas y asignaciones están listas para agregarse cuando se definan.

## Ejecutar

Requiere Node.js 24 o superior. Desde esta carpeta:

```sh
npm ci
npm run build
npm run server
```

Abre `http://127.0.0.1:8787/`. Para editar React deja abierto el servidor y ejecuta `npm run dev` en otra terminal. No abras `index.html` directamente.

**[SERVIDOR.md](SERVIDOR.md)** explica cómo alojar la web con HTTPS, crear cuentas, asignar horarios, configurar la dirección pública del APK y generar QR para otros teléfonos. Todavía no se ha configurado un dominio ni publicado un servidor externo. El APK compilado sin dirección pública permite explorar la interfaz y los datos locales; muestra que el servicio está pendiente de conexión.

## Ejemplos de búsqueda

- **Jugos Acapulco** como origen y **Entronque av. Lázaro Cárdenas** como destino.
- **Café del Puerto · demo** para explorar una conexión con trasbordo.
- **Mercado del Sol · demo** para cambiar el destino y comparar caminos.
- **Reforma**, **Avenida Reforma 534**, **Pollo Feliz**, **Oxxo** y **farmacias**.

Sin choferes activos se pueden consultar los trazados, pero no aparecen recomendaciones de servicio. Una calle sin número representa un punto de referencia sobre la calle. Para mayor precisión elige una dirección registrada o marca el lugar en el mapa.

## Cobertura y datos

| Punto | Referencia | Coordenadas |
| --- | --- | --- |
| Inicio | Jugos Acapulco, frente al Pollo Feliz | `17.95424278298213, -102.19209866241583` |
| Término | Entronque de la avenida Lázaro Cárdenas | `17.97270449633531, -102.20675286385264` |

La cobertura usa latitud `17.951–17.977` y longitud `-102.214–-102.186`, con margen alrededor del corredor. **No es el límite oficial de la ciudad.** Se limita el mapa y se validan búsquedas, GPS y viajes contra este perímetro.

Las cuatro rutas, paradas intermedias y tarifas siguen siendo ficticias. Los lugares con `source: "osm"` proceden de OpenStreetMap y pueden estar incompletos o desactualizados. Las entradas `demo: true`, incluyendo números interpolados de ejemplo, se identifican como simuladas. No se inventan ubicaciones para direcciones reales desconocidas.

Para incorporar datos reales, edita `public/data/network.demo.json`: cobertura, paradas, rutas, colores, tarifas, sentidos y geometría entre paradas. Cada trasbordo comparte el mismo identificador de parada. Actualiza tanto el servidor como la app con el mismo archivo y retira las numeraciones simuladas antes del uso real.

El catálogo de lugares y las calles locales están separados en `public/data/places.osm.json`, con atribución a OpenStreetMap y licencia ODbL. Las calles guardadas mantienen visible la zona si los mapas externos no cargan.

## Cómo estima

El motor considera caminatas de hasta 420 m hacia las paradas y hasta dos trasbordos. Cada tramo necesita una combi activa cuya llegada permita alcanzarla y finalizar antes del fin de su servicio. La posición se proyecta sobre el trazado para calcular la distancia recorrida, el sentido y la llegada.

Las estimaciones suponen continuidad del recorrido de ida y vuelta y usan velocidades, detenciones y giros aproximados. No incorporan tráfico en vivo ni aprendizaje automático. Las caminatas son distancias en línea recta, no indicaciones peatonales verificadas. Consulta los detalles en `SERVIDOR.md`.

## Conexión y voz

Las sugerencias mientras escribes son locales. La búsqueda en línea se ejecuta solo al solicitarla; usa Nominatim con cobertura obligatoria, país México, filtrado del polígono, caché y separación entre solicitudes. Puede fallar o tardar; los lugares guardados continúan disponibles. Para más volumen configura un proveedor adecuado de mapas y búsqueda.

GPS compartido, sesiones y disponibilidad requieren el servidor e internet. Los QR para otros teléfonos requieren una dirección pública accesible. La voz necesita un navegador compatible o el servicio de reconocimiento de Android. No se grabó audio ni se probó el escaneo con una cámara física en esta entrega.

## Android

Requiere Android Studio, SDK 36 y JDK 21. Android mínimo: **8.0/API 26**, requerido por el lector QR.

```sh
npm ci
npm run android:sync
npm run android:open
```

Configura primero `VITE_PUBLIC_API_URL` y `VITE_PUBLIC_APP_URL` para conectar el APK al servidor publicado. El identificador es `mx.cerca.combis.demo`; versión **1.2**, código **3**. El APK de depuración se genera en `android/app/build/outputs/apk/debug/app-debug.apk`.

## Verificar

```sh
npm test
npm run test:ui
npm run build
```

Hay 30 pruebas de datos, búsqueda, planificación, autenticación, horarios, GPS, disponibilidad, SSE y enlaces QR; y 21 pruebas de interfaz, incluidas dos ventanas con servidor real y GPS controlado. Las cuentas y posiciones de prueba existen únicamente en pruebas aisladas, no en el servidor de la app.

Las pruebas de interfaz usan Microsoft Edge y un puerto propio para evitar conflictos con otros proyectos. Se verificó la compilación Android. No se instaló ni se probó en un teléfono físico. El contenedor y HTTPS se comprobarán al alojarlos.

## Archivos

| Archivo | Función |
| --- | --- |
| `src/App.tsx` | Origen, destino, roles, paradas y paneles. |
| `src/MapView.tsx` | Rutas de colores, GPS de combis, paradas y trasbordos. |
| `src/DriverPanel.tsx` | Sesión del chofer, activación y publicación GPS. |
| `src/StopPanel.tsx` | Llegadas, lector QR y QR descargables. |
| `src/VoiceButton.tsx` | Dictado en navegador o Android. |
| `src/transit.ts` | Horarios, frescura de señal y predicciones según vehículos. |
| `src/planner.ts` | Cobertura, catálogo y candidatos de viaje. |
| `server/` | Cuentas, asignaciones, sesiones, GPS y eventos públicos. |
| `SERVIDOR.md` | Preparación, alojamiento y configuración de Android. |

Referencias: [React](https://react.dev/learn), [Capacitor](https://capacitorjs.com/docs/android), [lector QR](https://capacitorjs.com/docs/apis/barcode-scanner), [voz Android](https://developer.android.com/reference/android/speech/RecognizerIntent), [OpenStreetMap y ODbL](https://www.openstreetmap.org/copyright), [Nominatim](https://operations.osmfoundation.org/policies/nominatim/).
