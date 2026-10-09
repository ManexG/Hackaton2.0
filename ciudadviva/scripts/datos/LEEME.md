# Datos de rutas y paradas

Aquí van los archivos `.json` con las rutas de combi y sus paradas.
Los carga `scripts/crear-datos.js` contra el backend.

## Cómo usarlo

```bash
# 1. Con el servidor local corriendo (npm run dev en la raíz)
ADMIN_KEY=dev123 node scripts/crear-datos.mjs

# 2. Contra producción
ADMIN_KEY=<tu clave> API_URL=https://lcalerta.ac-mx.workers.dev node scripts/crear-datos.mjs
```

## Formato

Un archivo `.json` por zona o ruta. Ejemplo real de prueba en `zona-centro.json`
(contiene datos de ejemplo: reemplazar antes de presentar). Plantilla en `EJEMPLO-centro.json`.

Los archivos que empiezan con `EJEMPLO` **no se cargan**; sirven de plantilla.
El script tampoco carga dos veces la misma ruta (compara por nombre).

```json
{
  "zona": {
    "nombre": "Zona piloto centro",
    "lat": 17.958,
    "lng": -102.205,
    "radio_m": 1500,
    "descripcion": "Centro de Lázaro Cárdenas, primera zona de prueba"
  },
  "rutas": [
    {
      "nombre": "Ruta Centro - Ida",
      "color": "#238361",
      "fuente": "Colectado recorriendo la ruta el 12 de junio 2026",
      "paradas": [
        {
          "orden": 1,
          "nombre": "Parada del centro",
          "lat": 17.956,
          "lng": -102.206,
          "qr": "LC-CEN-001",
          "espera_min": 4
        }
      ]
    }
  ]
}
```

## Reglas importantes

- **`paradas` en orden, NO `trazo`.** El orden de las paradas es la fuente de verdad:
  el backend calcula el recorrido real por calles con OpenStreetMap y guarda el
  trazo. **No escribas `trazo` a mano**: una línea recta entre puntos atraviesa
  casas y manzanas, que es exactamente el error que el trazado automático evita.
  Al cargar, el script llama a `/api/admin/rutas/:id/trazar` y el servidor ajusta
  además cada parada al asfalto (una parada a 20 m de la calle se mueve al centro
  de la calzada).
- **`orden`**: la posición de la parada en el recorrido. Si se omite, el servidor
  usa el orden en que aparecen en el arreglo, pero conviene ponerlo explícito.
- **`color`**: cualquier hex válido (`#rrggbb`). Es el color de la línea en el mapa.
  Sugeridos del equipo: `#238361` verde, `#e58b38` naranja, `#7770cf` morado,
  `#329db1` turquesa.
- **`qr`**: código único de la parada. El QR físico lo imprime el equipo desde
  `/admin`, que lo genera apuntando a `/parada/<código>?soloQR=1` en la **dirección
  pública de producción** (`VITE_URL_PUBLICA` en `frontend/src/api.js`). Si no pones
  `qr`, la parada existe pero el escaneo no funciona.
  **Un código impreso no se cambia nunca**: si corriges una parada, crea una nueva.
- **`espera_min`**: opcional, y solo si lo observaste. Es el tiempo que la combi suele
  parar ahí. Cuando está, el ETA lo suma y lo declara.
- **`fuente`**: de dónde salen los datos. Es importante para no afirmar cosas sin respaldo.
- **Zona piloto**: la propuesta pide una zona delimitada, no toda la ciudad. Define el
  `radio_m` con criterio y anótalo en la descripción.
- **Ida y vuelta como dos rutas**: el modelo usa una ruta por sentido, con nombre
  ("Ruta Centro - Ida", "Ruta Centro - Vuelta") y color propio. Cada una se traza
  por separado, así que la vuelta sigue calles distintas, como en la realidad.

## Si el trazado falla

El servidor público de OSRM (`router.project-osrm.org`) es un servicio gratuito
limitado a ~1 petición por segundo y puede estar caído. Si falla, el script lo
avisa y **la ruta se queda sin trazo**: el mapa no dibuja su línea en vez de
dibujar una recta falsa. Se reintenta con el botón "Ajustar a calles" en `/admin`.

## Sobre los tiempos de llegada

La app **no conoce horarios de la ruta**. El tiempo que se muestra hacia la parada
se calcula con una velocidad supuesta (22 m/s ≈ 80 km/h) sobre el trazo real, y la
interfaz lo dice siempre. Si quieren tiempos más precisos, hay que medir tiempos
de recorrido por tramo y guardarlos como `espera_min` por parada.

## Orden recomendado de trabajo

1. Zona piloto delimitada (con radio y criterio anotados).
2. Paradas de cada ruta, **en orden de recorrido**.
3. Paradas con `qr` (el equipo decide el formato del código).
4. Trazado automático al cargar, o con "Ajustar a calles" en `/admin`.
5. Antes de presentar: reemplazar los datos de ejemplo y anotar la fuente real.