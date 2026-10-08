# Cerca 1.1 · React + Capacitor para Android

Demo funcional en español de rutas de combis para el corredor indicado en Lázaro Cárdenas. Esta versión está hecha con **React 19, TypeScript, Vite 8, Leaflet y Capacitor 8**. Las pantallas usan componentes y estado de React; el mapa Leaflet se sincroniza mediante efectos con limpieza de eventos y capas.

## Qué cambió

- La app empieza con origen y destino vacíos, sin una ruta recomendada predeterminada.
- El catálogo incluye **941 entradas de OpenStreetMap: 452 negocios y puntos de interés, 412 calles y 77 direcciones con número** dentro de la zona.
- Al escribir se buscan nombres, direcciones, categorías y palabras en cualquier orden, con soporte para acentos y abreviaciones de avenida.
- Al elegir el origen se sugieren lugares cercanos por categoría: comer, compras, salud, interés y calles. Las tarjetas muestran la combi sugerida cuando existe una conexión.
- Elegir un destino calcula su propio viaje. Cambiar el texto elimina inmediatamente la recomendación anterior para no mostrar un camino hacia un lugar que ya no está seleccionado.
- Existe una búsqueda en línea explícita para direcciones o negocios que no estén guardados. Cada resultado se filtra nuevamente por la cobertura.
- Se incluyen trazos locales de calles para conservar una referencia del área cuando los mapas por internet tardan o no están disponibles.
- Se conservan el buscador lateral Android, el panel inferior deslizable, la consulta de inicio y término, la intensidad de las combis seleccionadas y los trasbordos.

## Probar

Para probar en un teléfono Android, genera el APK siguiendo la sección **Android** de este documento. El repositorio contiene el código fuente; los archivos compilados se generan localmente.

En computadora, desde esta carpeta:

```sh
npm ci
npm run dev
```

Abre la dirección local indicada por el servidor. No abras `index.html` directamente.

Ejemplos:

1. Busca **Jugos Acapulco** como origen y selecciona la coincidencia.
2. Para una ruta directa, busca **Entronque av. Lázaro Cárdenas** como destino.
3. Para probar trasbordos, cambia el destino a **Café del Puerto · demo**.
4. Para comprobar que la recomendación cambia, elige **Mercado del Sol · demo**; se recomienda otra combi.
5. Busca **Reforma**, **Avenida Reforma 534**, **Pollo Feliz**, **Oxxo** o **farmacias** para explorar datos del mapa.
6. Prueba las categorías de lugares cercanos y toca un resultado para calcular cómo llegar.

Si hay varios negocios con el mismo nombre, se ordenan por proximidad al origen elegido. Selecciona la sucursal que buscas. Una calle sin número identifica un punto de referencia sobre esa calle; para un destino más preciso elige una dirección registrada o marca el lugar en el mapa.

## Datos y cobertura

Se conservaron exactamente los puntos originales:

| Punto | Referencia | Coordenadas |
| --- | --- | --- |
| Inicio | Jugos Acapulco, frente al Pollo Feliz | `17.95424278298213, -102.19209866241583` |
| Término | Entronque de la avenida Lázaro Cárdenas | `17.97270449633531, -102.20675286385264` |

La cobertura de prueba usa latitud `17.951–17.977` y longitud `-102.214–-102.186`, con margen alrededor del corredor. **No es el límite oficial de la ciudad.** El mapa limita su desplazamiento y oculta el área exterior. Búsquedas, coordenadas GPS y viajes se validan contra este perímetro.

Las cuatro rutas de combis, paradas intermedias, tarifas, intervalos y tiempos siguen siendo ficticios. Los lugares con `source: "osm"` vienen de OpenStreetMap y pueden estar incompletos o desactualizados. Las entradas con `demo: true`, incluyendo direcciones interpoladas de ejemplo, se identifican como simuladas. No se inventan coordenadas de direcciones reales desconocidas.

## Archivos principales

| Archivo | Función |
| --- | --- |
| `src/main.tsx` | Inicio de React y carga del catálogo y la red. |
| `src/App.tsx` | Estado del origen, destino, búsqueda, viaje y paneles. |
| `src/SearchFields.tsx` | Sugerencias, selección por teclado y búsqueda en línea. |
| `src/ExplorePlaces.tsx` | Categorías, lugares cercanos y cómo llegar a cada uno. |
| `src/MapView.tsx` | Mapa, calles locales, rutas, intensidad de las combis y trasbordos. |
| `src/Journeys.tsx` | Recomendaciones y pasos hacia el destino elegido. |
| `src/RouteExplorer.tsx` | Consulta de recorrido completo e ida/regreso. |
| `src/planner.ts` | Búsqueda local, proximidad, cobertura y cálculo de viajes. |
| `src/geocoding.ts` | Consulta en línea acotada, caché, límite de frecuencia y cancelación. |
| `public/data/network.demo.json` | Red ficticia editable. |
| `public/data/places.osm.json` | Catálogo del mapa y geometría local de calles. |

## Incorporar rutas reales

Edita **`public/data/network.demo.json`**:

- `coverage.bounds` y `coverage.polygon`: cobertura exacta, siempre `[latitud, longitud]`.
- `stops`: paradas con identificadores únicos y coordenadas.
- `routes`: nombre, color, tarifa, frecuencia, sentidos y paradas en orden.
- `routes[].segments`: un conjunto de coordenadas entre cada par de paradas consecutivas. Sus extremos deben coincidir con las paradas.
- Una conexión entre líneas comparte el mismo identificador de parada.
- `places` y `addressRanges`: ejemplos adicionales de la demo. Retira las numeraciones simuladas al preparar un catálogo real.

El catálogo de OpenStreetMap está separado. Puedes actualizar `public/data/places.osm.json` o agregar un catálogo propio con ubicaciones verificadas. Cada lugar incluye identificador, nombre, descripción, tipo, coordenadas, categoría, fuente y alias opcionales. Las calles pueden incluir `streetSegments` para su representación local.

Después de cambiar datos:

```sh
npm test
npm run android:sync
npm run android:open
```

La validación rechaza referencias inválidas, paradas y geometrías fuera de cobertura y tramos desconectados.

## Cómo recomienda los viajes

El cálculo usa exclusivamente el origen y destino seleccionados. Busca paradas a un máximo de 420 m de cada extremo y compara recorridos de hasta tres combis, con hasta dos trasbordos. Considera caminata, tiempo de trayecto, espera media y una penalización por conexión. Omite alternativas excesivamente largas y resalta simultáneamente todas las líneas del viaje elegido.

Si los puntos no tienen una conexión disponible, se informa al usuario; no se reutiliza una ruta predeterminada. Las caminatas son distancias aproximadas en línea recta, no instrucciones peatonales verificadas. Las combis son ilustrativas y la simulación no es rastreo en vivo.

## Búsqueda en línea y conexión

Las sugerencias mientras escribes funcionan **localmente**, sin consultas externas por tecla. **Buscar dirección o negocio en línea**, o enviar una búsqueda sin coincidencias locales, consulta Nominatim con un rectángulo de cobertura obligatorio, país México y filtrado adicional del polígono. Hay caché de resultados y una separación mínima de 1.1 segundos entre solicitudes. Editar la consulta cancela la petición anterior para evitar resultados atrasados.

El servicio externo necesita internet y puede tardar o no estar disponible. En la comprobación en vivo de esta entrega agotó el tiempo de espera; los flujos de respuesta, cancelación y rechazo de ubicaciones externas se verificaron con respuestas controladas. El catálogo guardado y las calles locales siguen funcionando. No se garantiza encontrar todos los negocios ni todos los números de la zona.

El mapa detallado por internet usa OpenStreetMap. La capa de calles incluida se dibuja de inmediato como respaldo y conserva la atribución. Para publicar la app a mayor escala se debe configurar un proveedor de búsqueda y mapas adecuado al volumen de uso.

## Android

El proyecto nativo está en **`android/`**. Requiere Node.js 22 o superior, Android Studio compatible con Capacitor 8, SDK 36 y un JDK compatible. Esta entrega se compiló con **JDK 21**.

```sh
npm ci
npm run android:sync
npm run android:open
```

Para generar el APK desde PowerShell con `JAVA_HOME` y `ANDROID_HOME` configurados:

```powershell
.\android\gradlew.bat -p android :app:assembleDebug
```

El archivo queda en `android/app/build/outputs/apk/debug/app-debug.apk`. El identificador es `mx.cerca.combis.demo`; versión 1.1, código 2. El APK incluye React, la interfaz, tipografía, rutas, catálogo y calles locales; no depende del servidor de desarrollo.

## Verificación

```sh
npm test
npm run test:ui
npm run build
```

La suite incluye **21 pruebas de datos, búsqueda, proximidad y cálculo**, y **16 pruebas de interfaz**, incluyendo inicio sin recomendaciones, cambio de destino, lugares del mapa, calles con número, categorías cercanas, búsqueda en línea acotada, cancelación de resultados atrasados, manejo de fallos de conexión, respaldo de calles sin mapas externos y buscador lateral móvil.

Se verificó la compilación del APK. No se instaló ni se probó en un teléfono físico. Las pruebas de interfaz usan Edge; puede cambiarse el navegador en `playwright.config.ts` para otros equipos.

Referencias: [React](https://react.dev/learn/add-react-to-an-existing-project), [Capacitor Android](https://capacitorjs.com/docs/android), [Leaflet](https://leafletjs.com/reference.html), [OpenStreetMap y ODbL](https://www.openstreetmap.org/copyright), [política de Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [política de mapas](https://operations.osmfoundation.org/policies/tiles/).
