# Integración de Axel · OptiRouteLZC 1.7

Procedencia: rama [Axel, commit 3b38961](https://github.com/ManexG/Hackaton2.0/tree/3b389614c88b77e21234c627979a81b94e06919f), incluida su actualización de detección de zona y disponibilidad GPS sobre la integración inicial `fcad9cc`. El repositorio conserva sus archivos originales en `ciudadviva/`. La app que se publica y compila está en `app/`, con React y JavaScript. No se utiliza el servidor público del compañero ni se trasladan sus datos o credenciales.

## Uso

- **Comunidad / Reportes:** lista filtrable por texto, categoría, colonia y estado; fotos, apoyos y enlaces compartibles. El detalle incluye comentarios e historial de atención.
- **Nuevo reporte:** cuenta de vecino o sesión de chofer; foto opcional comprimida, GPS o punto elegido en el mapa, revisión antes de enviar. Al editar la revisión se conserva el contenido y la foto.
- **Mi cuenta:** registro de vecino, perfil, reportes propios, apoyos, reconocimientos por participación y borradores pendientes. Las cuentas de chofer y sus asignaciones siguen administradas por el operador, sin autorregistro de conductores.
- **Más / Estadísticas:** categorías, colonias, estados y actividad por día, a partir de datos guardados.
- **Más / Trabajo de campo:** puntos con fuente, observaciones de accesibilidad y conteos por fecha, hora y duración. Consultar es libre; agregar requiere sesión.
- **Más / Administración:** clave de operador, respuestas y estados, exportación CSV/GeoJSON, importación de rutas/paradas, ajuste opcional con OSRM, QR descargables e imprimibles.

Los estados son Enviado, En revisión, Resuelto y No aplica. Son respuestas del equipo responsable de esta app; no se afirma que el municipio las reciba.

## Servidor y almacenamiento

La API adaptada vive en `/api/community/*`. `server/community/axel-api.js` conserva y adapta el contrato de Axel; `migrations.json` contiene sus seis migraciones originales. `service.js` ofrece el adaptador de consultas y archivos sobre el SQLite existente, tanto en Node como en el Durable Object de Cloudflare. Las fotos de hasta 4 MB se guardan en bloques de 128 KiB, sin necesitar D1 ni R2 adicionales. Las migraciones se aplican una sola vez.

La clave de Administración es el secreto existente `CERCA_ADMIN_TOKEN`. Se escribe en el panel y se envía mediante `X-Admin-Key`; no se conserva en almacenamiento del navegador, enlaces, Git ni APK. Las exportaciones y cambios de estado exigen esa clave. Los tokens de vecinos se guardan como hashes en el servidor y caducan a los siete días. El cliente conserva el token de vecino para enviar sus borradores; cerrar sesión lo invalida. Nunca se guardan contraseñas en el cliente.

El servicio de chofer sigue siendo el existente: misma cuenta, unidad, ruta asignada, horario y señal GPS reciente. No se usa la flota simulada del prototipo de Axel. Las consultas de vehículos y llegadas de comunidad se adaptan a ese servicio. Los reportes, puntos y rutas importadas deben quedar dentro de la cobertura autorizada.

## Cambios de Axel 3b38961

El chofer ve si su última ubicación reciente está dentro o fuera de la zona de servicio, con su distancia al centro. Estar fuera detiene su servicio y no produce posiciones públicas ni tiempos de llegada. Los pasajeros ven una lista de unidades dentro de la zona con ruta y antigüedad de señal. Se conserva el límite de frescura de **45 segundos** de Las Palmas, más estricto que el prototipo original.

El área piloto opcional se toma de la última fila de `zona`, cargada por el operador. Ejemplo de formato: `{"zona":{"nombre":"Área piloto","lat":17.964,"lng":-102.200,"radio_m":1500}}`. Su radio debe ser positivo y su centro debe estar dentro de la cobertura original. El área efectiva es la intersección del círculo y el polígono; no amplía el mapa. Sin configuración se utiliza el polígono original. El mapa muestra el círculo y los cambios llegan por SSE; las llegadas y viajes tampoco pueden requerir un recorrido que salga de esa área.

`GET /api/community/vehiculos/activos` admite el contrato nuevo de Axel (`lat`, `lng`, `ultimo_ts`, `edad_s`, `en_vivo`, `en_zona`, `distancia_zona_m`, `zona`), conservando los campos anteriores para compatibilidad. Solo devuelve señales válidas y recientes. `POST /api/community/vehiculos/detener` exige la sesión real del chofer, marca su unidad inactiva y avisa a los pasajeros inmediatamente. Las cuentas de vecino no pueden usarlo para detener combis.

El service worker consulta HTML y datos públicos con `cache: 'reload'` para evitar reutilizar respuestas HTTP viejas al publicar una actualización. Los recursos con nombre de hash siguen disponibles sin señal; GPS y sesiones nunca se cachean.

## Importar rutas

El panel admite un JSON de hasta 1 MB con `zona` opcional y un arreglo `rutas`. Cada ruta admite `nombre`, `color` hexadecimal, `fuente`, `descripcion`, `trazo` como `[latitud, longitud][]` y `paradas` ordenadas:

```json
{
  "rutas": [{
    "nombre": "Ruta del equipo",
    "color": "#24551f",
    "fuente": "Levantamiento de campo",
    "trazo": [[17.9600, -102.1970], [17.9610, -102.1980]],
    "paradas": [
      { "nombre": "Inicio", "lat": 17.9600, "lng": -102.1970, "orden": 0, "qr": "LP-EJ-01" },
      { "nombre": "Término", "lat": 17.9610, "lng": -102.1980, "orden": 1, "qr": "LP-EJ-02" }
    ]
  }]
}
```

Este ejemplo ilustra el formato, no una ruta real. Las rutas con al menos dos paradas sobre un trazo válido se incorporan a `/api/network`, al buscador y al mapa con identificadores `AX<id>` y paradas `AXS<id>`. La tarifa figura como pendiente hasta que se defina. Las rutas incompletas permanecen en administración. El operador puede asignar una ruta válida a un chofer mediante el comando existente `driver:create`.

**Ajustar recorrido a las calles** utiliza OSRM externo y puede tardar. Si el proveedor falla, una parada está fuera de cobertura o el recorrido sale de la zona, no se inventa ni publica una geometría alternativa.

Los QR nuevos abren `/?stop=<id>`. Los enlaces originales `/parada/<codigo>`, `/reporte/<id>` y los enlaces con hash siguen aceptándose en esta web; un QR de otra instalación debe apuntar al dominio de esta app y su código debe haberse importado aquí.

## Sin señal

La web guarda sus recursos después de la primera visita mediante un service worker generado por Vite. El mapa plano, nombres de calles y catálogo son locales; la app Android ya incluye esos archivos. Solo se cachean recursos estáticos y consultas públicas explícitas, nunca sesiones, administración ni GPS. Los reportes públicos consultados pueden seguir disponibles sin señal.

Cada nuevo reporte se guarda primero en IndexedDB, incluido su archivo. La cola solo envía los borradores de la cuenta activa, y mantiene los que fallan para reintentarlos. `client_id` evita duplicados si la respuesta se pierde. No borres los datos de la aplicación antes de enviar los pendientes.

No hay descarga masiva de teselas de OpenStreetMap. Se conserva su atribución legible y el archivo del catálogo identifica su procedencia ODbL.
