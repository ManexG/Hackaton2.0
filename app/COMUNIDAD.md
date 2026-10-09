# Integración de Axel · Las Palmas Rutas 1.6

Procedencia: rama [Axel, commit fcad9cc](https://github.com/ManexG/Hackaton2.0/tree/fcad9cc22bc4a93d2f1c90846396a0ac37a36853). El repositorio conserva sus archivos originales en `ciudadviva/`. La app que se publica y compila está en `app/`, con React y JavaScript. No se utiliza el servidor público del compañero ni se trasladan sus datos o credenciales.

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
