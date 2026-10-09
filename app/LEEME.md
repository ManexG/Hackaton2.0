# Las Palmas Rutas 1.8.3 · React + Capacitor + GPS + Comunidad

Aplicación Android y web de movilidad para el corredor indicado en Lázaro Cárdenas. Usa **React 19, JavaScript, Vite 8, Leaflet y Capacitor 8**. La publicación en **Cloudflare Workers** guarda cuentas y GPS en un **Durable Object con SQLite** y comparte las posiciones mediante **SSE**. También se conserva el servidor alternativo de Node.js 24 para uso local o alojamiento propio.

La configuración y los comandos para publicar en `workers.dev` están en [CLOUDFLARE.md](CLOUDFLARE.md). El almacenamiento en Cloudflare es independiente del SQLite local; no se suben automáticamente cuentas ni datos del equipo.

## Versión 1.8.3

Incluye 33 semáforos de OpenStreetMap, actualización obligatoria con novedades desde GitHub Releases, avisos sin señal, recuperación de errores y menor consumo de datos. El modelo se descarga cuando hace falta y el lector de cámara al utilizarlo. La ubicación de los semáforos no representa su estado real.

Las instalaciones 1.7 y anteriores necesitan instalar 1.8.3 una vez para recibir los avisos futuros. Publicación, firma, etiqueta de versión y despliegue en [ACTUALIZACIONES.md](ACTUALIZACIONES.md). Pruebas, correcciones y límites en [AUDITORIA.md](AUDITORIA.md).

## Interfaz para viajar con menos pasos

La identidad **Estás en: Pasajero** aparece al entrar. El acceso **Entrar como chofer** está en una sección separada y tiene un botón para volver al pasajero.

1. Indica **desde dónde sales**, usando **Mi ubicación**, una búsqueda o el mapa.
2. Indica **a dónde vas** y toca la coincidencia correcta. La selección se confirma y la pantalla se desplaza al siguiente paso.
3. Pulsa **Ver cómo llegar**. El viaje no se calcula automáticamente al tocar una sugerencia. Si no hay servicio, se ofrece consultar por dónde pasan las rutas.

**Ver rutas** abre directamente el detalle de la ruta elegida, con confirmación, origen, término, sentido y paradas. **Volver a todas las rutas** regresa a la lista. En celular, **Ver mapa de las rutas** y **Volver a las instrucciones** separan ambas vistas sin un panel que haya que descubrir o arrastrar.

Texto base de 18 px, control **Letra más grande** a 22 px con preferencia guardada, botones de al menos 48 px, contraste más alto y etiquetas escritas. Se retiraron las tarjetas numeradas de pasos y el botón de ayuda. El mapa es plano, dibuja las calles guardadas sin edificios ni teselas externas y mantiene sus nombres y una atribución discreta. Se respeta la preferencia de movimiento reducido. Estas mejoras necesitan volver a probarse con personas mayores; las pruebas automatizadas no sustituyen esa evaluación.

## Comunidad de la rama Axel

**Comunidad** abre reportes ciudadanos con foto y ubicación, apoyos únicos por dispositivo, comentarios e historial, filtros, perfil con reportes y reconocimientos, estadísticas, trabajo de campo y administración. Consultar es libre; publicar requiere cuenta. Los choferes pueden usar su sesión ya asignada. [COMUNIDAD.md](COMUNIDAD.md) documenta la integración y el formato de importación de rutas.

La web conserva sus recursos para abrir sin señal después de la primera visita. Los reportes se guardan en IndexedDB y se envían al recuperar conexión, con un identificador que evita duplicados. GPS y disponibilidad siguen requiriendo internet. La API, fotos y nuevas tablas se alojan en el mismo SQLite de Cloudflare, conservando las cuentas existentes. No hay conexión automática con un ayuntamiento.

## Pasajero

No necesita registrarse. Puede buscar entre 941 entradas de OpenStreetMap —452 negocios y puntos de interés, 412 calles y 77 direcciones con número— y consultar lugares cercanos por categoría. El origen y el destino empiezan vacíos.

El mapa muestra los recorridos de colores y las combis de choferes conectados. Seleccionar una ruta o un viaje aumenta su intensidad y atenúa las demás. Si el viaje necesita trasbordo se resaltan todas sus líneas.

La recomendación se calcula para los lugares elegidos y las combis activas, con espera estimada y trasbordos. Si no hay vehículos disponibles no se inventa un servicio ni se recomienda una ruta predeterminada; los trazados siguen disponibles en **Ver rutas**.

En **Paradas**, el pasajero consulta las próximas llegadas, el sentido, la unidad y la antigüedad de la señal. Cada parada tiene un enlace y un QR que abre la web centrada en ella y la coloca como origen. La app también puede leer el QR con la cámara.

Los botones de micrófono permiten dictar el origen o destino. El texto pasa al mismo buscador de calles y negocios y el pasajero elige la coincidencia correcta.

## Chofer

En **Entrar como chofer**, inicia sesión con una cuenta creada por el responsable. Cada cuenta tiene una unidad, una ruta y un horario asignados desde el servidor. No puede cambiar su asignación desde la app.

El chofer elige el sentido de salida y pulsa **Activar mi servicio**. Se solicita una ubicación precisa y el servidor valida el horario y la cobertura. Al activarse, los pasajeros reciben su posición GPS. **Desactivar servicio** y **Cerrar sesión** detienen la publicación.

La actualización de Axel `3b38961` añade un aviso claro de dentro/fuera de la zona y distancia a su centro para el chofer. Los pasajeros ven la unidad, ruta y edad de la señal de cada combi disponible. Si el operador configura un área piloto en Comunidad, limita el servicio dentro del perímetro original; nunca permite salir de él. Las señales caducan a los 45 segundos y no generan llegadas fuera de la zona o del horario.

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

**[SERVIDOR.md](SERVIDOR.md)** explica cómo alojar la web con HTTPS, crear cuentas, asignar horarios, configurar la dirección pública del APK y generar QR para otros teléfonos. La web ya está publicada en https://cerca-combis.alanedgardo4.workers.dev/. El APK entregado se conecta a esa API. Las cuentas se crean cuando el responsable define choferes, rutas y horarios.

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

Las estimaciones suponen continuidad del recorrido de ida y vuelta y usan velocidades, detenciones y giros aproximados. Incorporan el modelo experimental del equipo para llegadas y duración de tramos; no incorporan tráfico en vivo. Consulta [MODELO.md](MODELO.md) para procedencia, entradas, límites y reproducción. Las caminatas son distancias en línea recta, no indicaciones peatonales verificadas. Consulta los detalles en `SERVIDOR.md`.

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

Configura primero `VITE_PUBLIC_API_URL` y `VITE_PUBLIC_APP_URL` para conectar el APK al servidor publicado. El identificador es `mx.cerca.combis.demo`; versión **1.8.3**, código **12**. GitHub Releases publica el APK de release firmado. Consulta [ACTUALIZACIONES.md](ACTUALIZACIONES.md) para generar una versión y conocer la firma utilizada.

## Verificar

```sh
npm test
npm run test:ui
npm run test:offline
npm run test:cloudflare
npm run release:check
npm run build
```

Las pruebas cubren datos, búsquedas, planificación, autenticación, horarios, GPS, SSE, QR y comunidad, incluidas fotos, apoyos, importación de rutas y borradores sin señal. El runtime de Cloudflare verifica que cuentas, reportes y fotos se conserven al reiniciar. Las cuentas y posiciones de prueba existen únicamente en pruebas aisladas.

Las pruebas de interfaz usan Microsoft Edge y un puerto propio para evitar conflictos con otros proyectos. Se verificaron compilación y lint Android, y la instalación sobre la versión anterior en un Samsung SM-S938B. La revisión detallada y sus límites están en [AUDITORIA.md](AUDITORIA.md). La web pública, HTTPS, QR y SSE se verifican en Cloudflare; el contenedor Node se conserva como alternativa.

## Archivos

| Archivo | Función |
| --- | --- |
| `src/App.jsx` | Origen, destino, roles, paradas y paneles. |
| `src/MapView.jsx` | Rutas de colores, GPS de combis, paradas y trasbordos. |
| `src/DriverPanel.jsx` | Sesión del chofer, activación y publicación GPS. |
| `src/StopPanel.jsx` | Llegadas, lector QR y QR descargables. |
| `src/VoiceButton.jsx` | Dictado en navegador o Android. |
| `src/transit.js` | Horarios, frescura de señal y predicciones según vehículos. |
| `src/planner.js` | Cobertura, catálogo y candidatos de viaje. |
| `server/` | Cuentas, asignaciones, sesiones, GPS y eventos públicos. |
| `SERVIDOR.md` | Preparación, alojamiento y configuración de Android. |

Referencias: [React](https://react.dev/learn), [Capacitor](https://capacitorjs.com/docs/android), [lector QR](https://capacitorjs.com/docs/apis/barcode-scanner), [voz Android](https://developer.android.com/reference/android/speech/RecognizerIntent), [OpenStreetMap y ODbL](https://www.openstreetmap.org/copyright), [Nominatim](https://operations.osmfoundation.org/policies/nominatim/).
