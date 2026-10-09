# Frontend React + Vite — LCAlerta

Es el frontend nuevo, en React. **La API y la lógica ya están conectadas**: el trabajo
pendiente es el diseño visual, que lo hace el equipo.

El frontend anterior (vanilla, en `../app/`) **sigue intacto y desplegado**. No se borra
hasta que esta versión esté lista.

## Correr

```bash
npm install
npm run dev        # http://localhost:5173
```

Para que funcione, la API debe estar levantada en otra terminal:

```bash
cd .. && npm run dev     # Worker en http://localhost:8787
```

Vite hace proxy de `/api` hacia el Worker, así que el navegador nunca hace peticiones
cross-origin: el código es idéntico al de producción.

## Build

```bash
npm run build      # genera dist/
```

## Qué NO deben tocar (es del backend / infraestructura)

| Archivo | Por qué |
|---|---|
| `src/api.js` | Contrato con el Worker. Si falta un dato, primero se agrega aquí. |
| `src/sesion.jsx` | Login, registro, sesión y expiración. |
| `src/cola.js` | Cola offline en IndexedDB. Es la parte que hace que la app sirva en colonias sin señal. |
| `vite.config.js` | Proxy de desarrollo. |

Si necesitan algo de esos, avisan y lo agrego.

## Qué sí es de ustedes

Todo lo visual: `src/pages/*`, `src/components/*`, `src/index.css`, `src/App.jsx`
(la navegación). Busquen los comentarios `DISEÑA:`.

Cada pantalla ya recibe sus datos y tiene sus estados (cargando, vacío, error).
No hace falta que escriban la conexión a la API: ya está.

## Estructura

```
src/
├── api.js          cliente de la API (no tocar)
├── sesion.jsx      contexto de autenticación (no tocar)
├── cola.js         cola offline IndexedDB (no tocar)
├── App.jsx         rutas y navegación — DISEÑA
├── index.css       tokens de diseño + Tailwind/DaisyUI — DISEÑA
├── pages/
│   ├── Feed.jsx        búsqueda, filtros, tarjetas, paginación
│   ├── Mapa.jsx        Leaflet, marcadores, descarga de tiles sin señal
│   ├── Perfil.jsx      entrar / crear cuenta / cifras / insignias / mis reportes
│   ├── Reporte.jsx     página pública del reporte + historial + comentarios
│   ├── Admin.jsx       cola del gobierno por urgencia + exportar
│   └── Estadisticas.jsx  gráficas (la librería la eligen ustedes)
└── components/
    ├── TarjetaReporte.jsx  tarjeta del reporte + formulario en 2 pasos
    ├── Estados.jsx         badge, barra de progreso, chip de colonia
    └── EstadosUI.jsx       cargando, vacío, error
```

## Capacitor (fase 2, cuando la PWA esté firme)

La PWA ya se instala desde el celular (Chrome → "Agregar a la pantalla de inicio"),
así que el demo no depende de un APK. Cuando quieran app nativa:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init                 # appId: mx.lazaro.cardenas.lcalerta
npm run build
npx cap add android
npx cap sync
npx cap open android         # compila desde Android Studio
```

`capacitor.config.js` ya está con `webDir: 'dist'`. **No hay que cambiar el código de la
app**: es el mismo build. La geolocalización ya está abstraída en `api.js`
(`posicionActual` / `seguirPosicion`); ahí se sustituye la Web API por el plugin
de Capacitor cuando exista el build nativo.

## Notas técnicas

- **Tailwind v4** con `@tailwindcss/vite` (no hay `tailwind.config.js`; se configura en CSS).
- **DaisyUI 5** como plugin. Ojo: DaisyUI ya define una clase `.modal` que rompe los
  modales si la usas; la app anterior la renombró a `.modal-lcalerta`. Si crean un
  modal, cuídense de eso.
- **Rutas**: React Router. `/admin` y `/estadisticas` se cargan bajo demanda (`lazy`)
  para no lastrar el bundle en teléfonos baratos.
- **`data-testid`** en cada pantalla y estado: sirve para probar y para el demo.

## Pantallas nuevas (movilidad)

| Ruta | Qué es |
|---|---|
| `/chofer` | El chofer registra su combi y comparte ubicación cada 10 s |
| `/avenida` | Mapa de la avenida: rutas por color, paradas, combis en vivo |
| `/parada/:codigo` | Se abre escaneando el QR de la parada. Con `?soloQR=1` sin navegación |

Puntos importantes que ya están resueltos en el backend:

- El tiempo de llegada **se declara como estimado**: el backend devuelve `criterio`
  explicando que usa una velocidad supuesta. Si la interfaz muestra un tiempo,
  debe mostrar también ese criterio. Ver la regla de honestidad en `docs/frontend/ESPECIFICACION.md`.
- `/admin` tiene una pestaña **Rutas y paradas** para subir un `.json` con los datos.
  También genera e imprime los **QR** de cada parada.
- Los datos se cargan también por consola: `npm run datos` (ver `scripts/datos/LEEME.md`).

## Despliegue

Cuando esté listo, se sirve el `dist/` desde el mismo Worker. Hay que:

1. En `wrangler.toml`, cambiar `directory = "./app"` por `directory = "./frontend/dist"`.
2. Añadir `not_found_handling = "single-page-application"` en `[assets]`
   (para que `/perfil` y `/reporte/5` funcionen al recargar).
3. `npm run build && npx wrangler deploy`.

Hasta que se decida el cambio, **producción sigue sirviendo la versión anterior**.