# Revisión de Las Palmas Rutas 1.8.3

Revisión del 8 de octubre de 2026: React/JavaScript, servidor Node, Cloudflare Durable Object, comunidad integrada de Axel, datos cartográficos, modelo de predicción, PWA, Capacitor Android y publicación en GitHub. Se conserva la cobertura y los datos persistentes del servicio. La revisión reduce riesgos concretos; no demuestra que cualquier dispositivo o circunstancia futura esté libre de errores.

## Fallos y riesgos corregidos

| Situación | Resultado de la corrección |
| --- | --- |
| Consulta inicial duplicada de flota y conexiones en una app oculta | SSE como primera fuente; consulta de respaldo solo si no llega el evento; se cierran conexiones y temporizadores al ocultarse o perder conexión. |
| GPS o llegadas antiguas mostradas al perder señal | Se vacía la flota del cliente y se suspenden recomendaciones y llegadas; la posición del servidor caduca a los 45 s. |
| Reintentos continuos sin conexión | Reintentos progresivos hasta 60 s y reanudación únicamente con conexión y app visible. |
| Descarga inicial del modelo, lector QR y fuentes innecesarias | Modelo cuando existe flota real; cámara al usarla; fuente latina; recursos grandes excluidos de la precarga. |
| Catálogos grandes y repetición de descargas | JSON compactado sin cambiar los datos; recursos con hash reutilizables; cachés públicas acotadas con caducidad. |
| Logos grandes en cada primera visita | Copias WebP sin pérdida con dimensiones y píxeles idénticos; se conservan los PNG originales. |
| Comunidad nativa sin service worker | Caché pública en IndexedDB, también utilizable en Android, con alternativa en memoria si falla el almacenamiento. |
| Reportes pendientes enviados tras cambiar de cuenta | Autor y token capturados por sincronización; se detiene al cambiar la sesión; identificadores estables evitan duplicados. |
| Almacenamiento pendiente ilimitado o lleno | Hasta 30 borradores por autor; error comprensible si se alcanza el límite o no queda espacio. |
| Sesiones guardadas dañadas | Validación antes de usarlas; se ignoran las inválidas y la app permite volver a iniciar sesión. |
| Datos GPS inválidos recibidos | Se validan estructura, coordenadas, tiempos, sentido y servicios antes de dibujar o calcular. |
| Pausa antigua de servicio que llega después de una activación nueva | Se espera la pausa pendiente antes de reactivar; se cancela la captura GPS al perder conexión. |
| Captura nativa iniciada después de abandonar la pantalla | Identificador de generación y limpieza del watch tardío. |
| Semáforo que interceptaba el toque para marcar un punto | El mapa mantiene la selección de ubicación, incluso bajo un icono; se desactiva la interacción del icono cuando corresponde. |
| Servidor local abierto en un puerto distinto | Se admite su propio origen real y se conserva el rechazo de orígenes externos. |
| Excepción de React que dejaba pantalla vacía | Pantalla de recuperación con recarga y mensaje en español; conserva borradores. |
| Dependencia UUID vulnerable en herramientas de Capacitor | Sustitución compatible verificada en compilación Android; auditoría npm sin vulnerabilidades conocidas en este conjunto instalado. |
| Actualizaciones sin versión fiable o enlace seguro | Comparación semántica, publicación firmada por etiqueta, URLs limitadas al repositorio, notas, bloqueo obligatorio y HTTP 426. |
| Consulta de Releases incompatible con el receptor de `fetch` en Workers | Una función envolvente mantiene la llamada correcta; la prueba del runtime ahora exige descubrir una versión superior y conservarla al reiniciar SQLite. |
| GitHub devuelve 403/429 desde una dirección compartida de Cloudflare | Alternativa por el archivo público de la última Release, con JSON acotado, validación del repositorio/notas y comprobación HEAD del APK antes de anunciarlo. |
| Administración del equipo que respondía 404 en Cloudflare | Mismo controlador y permisos en Node y Workers, con primer administrador protegido, edición persistente de rutas y bloqueo al borrar rutas asignadas. |
| Paradas borradas que podían quedar en sugerencias tras editar la red | La recarga de rutas excluye paradas antiguas retiradas. |
| Respuesta de trazado externo incompleta | Validación y error 502 comprensible antes de utilizar la geometría. |
| Temporizador del editor que operaba sobre un mapa desmontado | Se cancela al abandonar el editor; las pruebas administrativas ahora rechazan cualquier excepción del navegador. |
| Etiquetas de calles que intentaban actualizar un mapa ya destruido | Todas las vistas cancelan los temporizadores del mapa antes de desmontarlo. |
| Calles invisibles en Comunidad, aunque sus nombres y semáforos aparecían | La regla de tamaño de los iconos se limita a Lucide; el SVG de Leaflet conserva sus dimensiones. La prueba falla antes de corregirlo y pasa con tamaños de escritorio y móvil. |
| Preparación Android en GitHub que pedía un paquete retirado por Google | Se solicitan únicamente platform-tools y SDK/build-tools actuales. |
| Pruebas que dependían de un servidor local o una consulta real a GitHub | Backend de pruebas aislado, versión simulada controlada y tolerancia únicamente a cancelación de solicitudes al recargar. |
| Orden de permisos en el manifiesto Android | Permisos declarados antes de la aplicación, conforme a la revisión estática. |

## Comportamiento sin internet

| Disponible | Requiere conexión |
| --- | --- |
| Mapa plano, nombres de calles, 33 semáforos, lugares guardados y trazados de cuatro rutas. | Ubicación compartida de choferes, disponibilidad actual y llegadas. |
| Buscar negocios/calles del catálogo y explorar recorridos. | Buscar lugares externos, iniciar sesión o crear una cuenta. |
| Consultar información pública ya guardada; su contenido puede ser antiguo. | Apoyos, comentarios, administración, importación y envío de reportes. |
| Guardar un reporte pendiente con una sesión existente y espacio disponible. | Descargar una actualización nueva o conocer una publicación que nunca se consultó. |

La web requiere completar una primera visita con conexión para conservar sus archivos; el APK ya incluye el mapa y el catálogo. No se guardan en la caché pública respuestas de autenticación, GPS, administración ni datos privados del perfil. Los reportes pendientes pertenecen a su autor y no se borran al recargar. Recuperar internet no activa automáticamente el servicio del chofer: debe confirmarlo otra vez.

## Verificación

- 54 pruebas de lógica y servidor: datos, búsqueda, planificación, horarios, cobertura, autenticación, GPS, SSE, QR, comunidad y actualizaciones. Incluyen 260 entradas de paridad del modelo original.
- 46 pruebas de interfaz de escritorio y móvil: accesibilidad, ampliación de texto, roles, selección y trasbordos, comunidad, errores de red, versiones, caché y cambios de cuenta.
- Una prueba de PWA compilada: recarga completa sin señal, catálogo y semáforos, borrador que se sincroniza exactamente una vez y bloqueo de actualización persistente.
- Una prueba con el runtime de Cloudflare: sesiones, GPS, SSE, CORS, persistencia de reportes/fotos, versión, rechazo de un cliente antiguo y administración por sesiones, CRUD, permisos y persistencia de rutas.
- Formato, auditoría npm, compilación Vite, revisión de despliegue Cloudflare, APK firmado y `lintRelease`.

Las pruebas de escritura usan servidores y cuentas aislados. Las cuentas reales no se reinician ni se usan para publicar posiciones ficticias. La comprobación pública consulta API, mapa, SSE, QR, recursos y asignaciones sin alterar las sesiones reales.

## Evidencia de publicación y consumo de datos

- La [verificación del commit final](https://github.com/ManexG/Hackaton2.0/actions/runs/37887096861) completó las 102 pruebas en GitHub.
- La [compilación y publicación Android](https://github.com/ManexG/Hackaton2.0/actions/runs/37887099669) terminó correctamente. La [Release v1.8.3](https://github.com/ManexG/Hackaton2.0/releases/tag/v1.8.3) contiene el APK firmado, novedades y suma SHA-256.
- APK publicado: versión 1.8.3, código Android 12, SHA-256 `4abf673ca9d5392de0617019a14ce730706fdc41365b1f1c25827e65b6a3c0d9`. La firma coincide con el certificado de las instalaciones anteriores.
- Primera visita a la web pública, con un contexto nuevo de Edge y sin choferes activos: la suma de `ResourceTiming.transferSize` de los recursos de la página bajó de 820 578 a aproximadamente 393 000 bytes, un 52 %. Se esperó a que el campo de origen y el service worker estuvieran disponibles y cuatro segundos adicionales en ambas mediciones. Esta cifra excluye el documento, transferencias de fondo del service worker y el flujo SSE; no representa todo el consumo del teléfono. La recarga siguiente reutilizó los recursos guardados, pero sigue necesitando datos para las consultas y servicios en vivo. No se atribuye una mejora de latencia a esta medición: también depende de la conexión y del servidor.

Los modelos, la cámara y la administración pueden añadir descargas cuando se usan. Los iconos de semáforo, mapa y catálogo funcionan localmente después de la primera carga; la información en vivo sigue necesitando conexión.

## Límites que permanecen

- Las rutas y tarifas son de demostración. El modelo se entrenó con datos ficticios; no tiene tráfico, lluvia ni estado actual de semáforos. Las caminatas no son indicaciones peatonales verificadas.
- El chofer debe mantener la app abierta. El seguimiento continuo con pantalla bloqueada requiere una implementación Android específica y otra validación.
- Ningún dispositivo desconectado puede conocer una Release que nunca consultó. Las instalaciones 1.7 y anteriores requieren una actualización inicial manual a la versión actual.
- La caché puede ser eliminada por el sistema o el usuario; el almacenamiento tiene límites. La voz, cámara y GPS dependen de permisos, hardware y servicios del dispositivo.
- Android lint conserva avisos de recursos generados por Capacitor, iconos y versiones de herramientas/dependencias. No quedaron errores que impidan compilar. No se modificaron dependencias nativas mayores ni archivos internos de paquetes para ocultar avisos.
- La firma de la demo conserva el certificado de desarrollo anterior para permitir instalación sobre los APK existentes. La distribución definitiva y Google Play requieren definir la firma de producción.
- La evaluación con personas mayores y recorridos reales continúa siendo necesaria; las pruebas automatizadas no sustituyen esas observaciones.

Publicación, actualización de datos y condiciones de firma en [ACTUALIZACIONES.md](ACTUALIZACIONES.md).
