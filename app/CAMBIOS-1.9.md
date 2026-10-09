# OptiRouteLZC 1.9.1

## Buscar un viaje

Origen y destino tienen tarjetas independientes. Solo se abre un editor a la vez.
Al elegir un lugar, su tarjeta se pliega y conserva el nombre. Toca la tarjeta para
cambiarlo; el otro lugar se conserva. **Ver cómo llegar** sigue siendo una acción
explícita. El mapa también permite editar el campo que esté abierto.

## Cobertura y rutas

Se conservan los dos puntos exactos y el encuadre inicial del corredor. La búsqueda,
el GPS y los puntos del mapa aceptan la zona urbana de Lázaro Cárdenas, La Orilla y
Las Guacamayas. La cobertura es aproximada para esta demo, no un límite administrativo
oficial. No incluye todo el municipio ni La Mira. El círculo piloto heredado ya no
recorta la cobertura urbana. **Ver toda la ciudad** muestra la zona ampliada.

Hay ocho rutas de ejemplo: las cuatro anteriores, Centro y Las Palmas (R05),
Entronque y La Orilla (R06), Las Guacamayas (R07), Colonias y Centro (R08).
Los nuevos recorridos se prepararon con OSRM sobre calles de OpenStreetMap.
No representan rutas autorizadas reales. Se preservan las asignaciones R01/R03.
El catálogo incluye 2,904 lugares, calles y direcciones guardados; la búsqueda
externa necesita internet. Se dibujan solo calles del área visible para evitar
cargar miles de objetos de mapa al mismo tiempo.

Aceptar una dirección en la ciudad no garantiza servicio: una recomendación requiere
paradas próximas y combis activas en todos sus tramos, con GPS reciente y horario
válido. No se inventan choferes, llegadas ni una conexión desde cualquier domicilio.

## Cómo usar Paradas

1. Abre **Paradas** y elige una zona.
2. Elige el punto donde vas a esperar. La lista se pliega y puedes tocar la tarjeta
   para cambiar de parada. Debajo aparecen las rutas que pasan por ese punto.
3. Consulta las próximas llegadas de combis activas. Sin GPS reciente o sin internet,
   no se muestran tiempos en vivo inventados.
4. **Salir desde esta parada** coloca ese punto como origen y abre el destino.
5. **Escanear QR de parada** abre su consulta directamente. El QR identifica un punto;
   no verifica que la persona esté físicamente ahí ni sustituye el GPS.

Una parada es un punto de subida, bajada o trasbordo. Las paradas de esta demo deben
reemplazarse con ubicaciones reales antes de ofrecer instrucciones de servicio reales.
Administración permite generar/imprimir sus códigos QR después de iniciar sesión.

## Actualización nativa Android

Desde 1.9.1, **Actualizar ahora** descarga el APK dentro de la app, muestra progreso,
comprueba SHA-256 contra `SHA256SUMS.txt` de la misma Release y valida el identificador,
la versión Android creciente y el certificado de firma contra la instalación actual.
Solo admite los enlaces HTTPS del repositorio y sus servidores de assets de GitHub.
No abre el navegador. Se comparte únicamente el archivo verificado con el instalador
de Android mediante un FileProvider restringido a `cache/updates/`.

Android pide permiso para instalar desde OptiRouteLZC y confirmación de instalación.
No es una instalación silenciosa. Si cancelas, puedes instalar el archivo ya descargado,
incluso sin conexión; una descarga incompleta se puede reintentar. Se conservan los datos.
El bloqueo de versión sigue activo hasta actualizar. Un APK anterior a 1.9.1 conserva
su código antiguo y requiere instalar 1.9.1 una vez para adoptar este nuevo flujo.

Referencias Android: [instalación de paquetes](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()),
[permiso de instalación](https://developer.android.com/reference/android/provider/Settings#ACTION_MANAGE_UNKNOWN_APP_SOURCES).

## Administración

`#/gestion` y el antiguo `#/admin` muestran únicamente el inicio de sesión hasta
validar la cuenta en el servidor con `/api/manage/me`. Secciones de rutas, choferes,
administradores y **Reportes y paradas** se muestran después de autenticar.
Una sesión de chofer o una sesión local falsa no habilita este panel.

La moderación, importación y exportación del módulo Axel se integran al panel con
la sesión de administración. La clave de operador permanece en el servidor. Las
operaciones `/api/manage/community/*` exigen una sesión válida y una lista limitada
de funciones. No se cachean cuentas ni operaciones administrativas. Sin conexión,
no se muestran herramientas de una sesión que todavía no se pudo verificar.
La creación del primer administrador está documentada en `CLOUDFLARE-ADMIN.md`.

## Actualizaciones de Axel

Se integró el commit `ce138d1` de la rama `Axel`. Recargar el panel del chofer
conserva el servicio y retoma el observador GPS; si no puede obtener una señal
reciente, muestra el motivo. La disponibilidad pública sigue exigiendo GPS vigente.
El chofer puede cambiar su contraseña con la actual: se conserva su sesión y se
cierran las demás. Los servidores Node y Cloudflare admiten esta función.

## Icono y verificación

Van 4303195, Cuputo / Noun Project, de la página indicada por el usuario. Se utiliza
la imagen pública con máscara CSS y el color de cada ruta, con atribución en el mapa.
La descarga pública accesible es PNG; no se afirma que sea un SVG vectorial.

La integración de Axel se comprobó con sus pruebas de servidor y de interfaz de
chofer. Las pruebas existentes incluyen mapa, buscador plegable y paradas en escritorio/móvil;
protección del panel; integración de la interfaz con el puente nativo (progreso,
cancelación, instalación y reutilización sin internet); PWA sin conexión; SQLite y
permisos en el runtime de Cloudflare; compilación Android y lint de release.
Las pruebas del puente en navegador simulan el instalador: la confirmación final de
Android y el comportamiento de diferentes fabricantes requieren validación en teléfonos.
