# Alojar Cerca y conectar Android

Para alojar web, API y SQLite directamente en Cloudflare, sigue [CLOUDFLARE.md](CLOUDFLARE.md). Las instrucciones siguientes corresponden al servidor Node alternativo.

La web y la API ya están publicadas en **https://cerca-combis.alanedgardo4.workers.dev/**. No hay cuentas de choferes creadas por defecto. Como alternativa, el servidor propio de Node.js 24, SQLite y SSE sirve la web y la API en el mismo dominio en tu propio alojamiento.

## Probar localmente

```sh
npm ci
npm run build
npm run server
```

Abre `http://127.0.0.1:8787/`. Para editar la interfaz, deja el servidor abierto y ejecuta `npm run dev` en otra terminal. El servidor de Vite redirige `/api` a `127.0.0.1:8787`.

No copies `.env.example` sin editarlo: sus dominios son marcadores de posición. Sin `.env`, la web funciona localmente y la app Android muestra «Servicio pendiente de conexión».

## Dominio y HTTPS

Se requiere un servidor con Docker Compose, un dominio que apunte a su IP y acceso a los puertos 80 y 443. En ese servidor, dentro de esta carpeta:

1. Crea `.env` y establece `CERCA_DOMAIN` con el dominio real, por ejemplo `cerca.municipio.mx`.
2. Ejecuta:

```sh
docker compose up -d --build
```

La configuración incluida ejecuta la aplicación con un usuario sin privilegios y usa Caddy como proxy HTTPS. `PUBLIC_APP_URL` se obtiene del dominio configurado y se utiliza para generar los QR. El proxy permite recibir los eventos SSE sin almacenarlos en un búfer.

Comprueba `https://TU_DOMINIO/api/health` y abre la web. La respuesta de salud debe indicar `ok: true`. La base de datos se conserva en el volumen `cerca-data`; conserva una copia antes de cambiar o trasladar el servidor.

Se verificaron el servidor Node y sus operaciones HTTP/SSE localmente. **Docker Compose y HTTPS no se ejecutaron en este equipo**, que no tiene Docker disponible; deben comprobarse al alojarlo.

## Crear o cambiar una cuenta de chofer

La cuenta se crea desde el servidor; el pasajero no necesita una cuenta. Cada chofer tiene una unidad, una ruta y un horario. No existe registro público ni un selector que permita al chofer asignarse otra ruta.

Con el servidor local, usa `npm run driver:create`. Con Docker:

```sh
docker compose exec cerca npm run driver:create -- \
  --name "NOMBRE DEL CHOFER" \
  --email "CORREO DEL CHOFER" \
  --unit "IDENTIFICADOR DE UNIDAD" \
  --route "RUTA ASIGNADA" \
  --days "DÍAS ASIGNADOS" \
  --start "HORA INICIAL" \
  --end "HORA FINAL"
```

Sustituye todos los valores antes de ejecutar. Las rutas actuales son `R01`, `R02`, `R03` y `R04`. Días: `0` domingo, `1` lunes, `2` martes, `3` miércoles, `4` jueves, `5` viernes, `6` sábado. Puedes escribir varios días separados por comas. Las horas usan `HH:MM`, por ejemplo `06:30`; un final menor que el inicio permite un turno que cruza medianoche. Todos los horarios se interpretan en `America/Mexico_City`.

El comando genera y muestra una contraseña inicial aleatoria. Entrégala únicamente al chofer. La base guarda una derivación scrypt de la contraseña, no la contraseña. Repetir el comando con el mismo correo actualiza la asignación y la contraseña, revoca las sesiones anteriores y desactiva esa unidad.

La sesión dura un máximo de 12 horas. Iniciar sesión en otro dispositivo reemplaza la sesión anterior. Cerrar sesión desactiva el servicio. La modificación de asignaciones se realiza desde este comando; no se incluye un panel de administración web ni recuperación de contraseña por correo.

## Conectar el APK

Antes de compilar Android, configura estas variables en `.env` dentro del proyecto:

```dotenv
VITE_PUBLIC_API_URL=https://TU_DOMINIO/api
VITE_PUBLIC_APP_URL=https://TU_DOMINIO/
```

Después:

```sh
npm ci
npm run android:sync
npm run android:open
```

Genera el APK con Android Studio. También puedes ejecutar desde PowerShell, con JDK 21 y Android SDK 36 configurados:

```powershell
.\android\gradlew.bat -p android :app:assembleDebug
```

Estas dos variables son direcciones públicas, no contraseñas. Se incorporan al APK al compilar. Un cambio de servidor requiere volver a compilarlo. El APK entregado antes de definir el dominio permite revisar la interfaz, el mapa y las búsquedas locales; **no se conecta a un servidor público por defecto**.

## GPS y disponibilidad

- El chofer inicia sesión, elige el sentido de salida y activa el servicio. El servidor valida su horario y recibe una posición GPS reciente antes de mostrar la combi.
- Solo se comparte ubicación mientras el servicio está activo. En esta versión debe mantenerse la app abierta. El seguimiento con pantalla bloqueada queda pendiente de definir e implementar.
- Las posiciones se envían como máximo una vez cada 5 segundos. La precisión debe ser de 100 m o mejor y la señal debe tener menos de 30 segundos al recibirse.
- Una posición fuera de la cobertura o alejada de la ruta asignada desactiva el servicio. El sentido se actualiza cuando el movimiento sobre la ruta supera 20 m.
- Si no llega señal durante 45 segundos, termina el horario o se cierra sesión, la combi deja de mostrarse. Tras una pérdida larga de señal se debe activar de nuevo el servicio.
- Al recargar la web del chofer se detiene su seguimiento y se requiere activarlo de nuevo con una ubicación reciente.
- El servidor conserva solamente la posición más reciente, no un historial de recorridos. El público recibe unidad, ruta y ubicación; no recibe el correo, nombre ni credenciales del chofer.

## Predicciones

La llegada usa la distancia sobre el trazado, el sentido y la velocidad GPS cuando es válida. Si no existe una velocidad utilizable se aproxima con 5 m/s. Añade 15 segundos por parada intermedia y 30 segundos por cambio de sentido en rutas de ida y vuelta. Los retornos estimados suponen que el chofer continúa el recorrido durante su horario. No incorpora tráfico en vivo ni aprendizaje automático.

Las recomendaciones comparan candidatos hacia el origen y destino elegidos, incluyendo caminatas a paradas de hasta 420 m y hasta dos trasbordos. Cada tramo necesita una combi activa con una llegada estimada que permita alcanzarla, y debe terminar antes de su cierre de servicio. La espera del trasbordo se calcula según esas llegadas. No se presenta una recomendación si faltan combis disponibles.

## QR

Cada QR contiene `https://TU_DOMINIO/?stop=IDENTIFICADOR`. La cámara normal del teléfono puede abrir ese enlace en la web. Cerca centra el mapa, abre la parada y la coloca como origen, sin exigir registro.

También hay un lector de QR en la app y una descarga del QR por parada. El lector valida que el enlace pertenezca al dominio configurado y que la parada exista. La app Android admite `cerca://stop/IDENTIFICADOR` para enlaces nativos. Los QR generados con una dirección local solo funcionan en ese equipo; configura la URL pública antes de imprimirlos.

## Voz

Android abre el reconocimiento de voz del sistema en español de México. La web usa el reconocimiento del navegador cuando esté disponible. La frase se coloca en el buscador y el pasajero selecciona la coincidencia correcta; no se elige una sucursal automáticamente. Puede requerir conexión o un servicio de voz instalado.

## Datos y operación

Las rutas siguen siendo ficticias en `public/data/network.demo.json`. Reemplázalas antes de dar indicaciones de transporte reales. El servidor y la web deben usar el mismo archivo. El catálogo de negocios y calles permanece en `public/data/places.osm.json`, con atribución a OpenStreetMap y ODbL.

Ejecuta una sola instancia del servidor por base SQLite. Para varias instancias se requerirá una base y un canal de eventos compartidos. Protege el volumen de datos y conserva copias de respaldo. No publiques `.env`, `data/` ni archivos de firma Android.

API pública: `GET /api/fleet` y `GET /api/events`. Operaciones del chofer: inicio/cierre de sesión, consulta del perfil, activación/desactivación y envío de GPS; requieren un token de sesión. El servidor valida las asignaciones y tiene un límite de intentos de inicio de sesión.

Referencias: [Node.js SQLite](https://nodejs.org/api/sqlite.html), [Capacitor Android](https://capacitorjs.com/docs/android), [lector QR](https://capacitorjs.com/docs/apis/barcode-scanner), [voz Android](https://developer.android.com/reference/android/speech/RecognizerIntent), [Caddy con Docker](https://hub.docker.com/_/caddy).
