# Hackaton2.0 · Las Palmas Rutas

Aplicación Android y web para consultar combis en el corredor de Jugos Acapulco al entronque de la avenida Lázaro Cárdenas. El proyecto está en [`app/`](app/): **React con JavaScript/JSX, Vite, Leaflet y Capacitor**, alojado en **Cloudflare Workers + Durable Objects con SQLite + SSE**. Los componentes usan `.jsx` y la lógica, el servidor, Cloudflare y las pruebas usan `.js` con módulos ES. Se conserva un servidor alternativo de Node.js 24. No se necesita compilar TypeScript ni instalar `tsx`. Capacitor se configura con `capacitor.config.json`.

**Web pública: [cerca-combis.alanedgardo4.workers.dev](https://cerca-combis.alanedgardo4.workers.dev/)**.

- Pasajeros sin registro: búsqueda de negocios, calles y direcciones, lugares cercanos y recorridos de colores.
- Choferes con cuenta, unidad, ruta y horario asignados: activación y desactivación de servicio con GPS.
- Combis disponibles y llegadas estimadas por parada; viajes con hasta dos trasbordos según vehículos activos.
- Enlaces y QR por parada, lector QR y búsqueda por voz en Android y navegadores compatibles.
- Comunidad: reportes con fotos y GPS, apoyos, comentarios, perfil, estadísticas, trabajo de campo y administración, integrados desde la rama `Axel`.

Las rutas, paradas intermedias y tarifas siguen siendo de prueba. El catálogo incluye 941 lugares, calles y direcciones de OpenStreetMap. La cobertura incluye la zona urbana de Lázaro Cárdenas, La Orilla y Las Guacamayas, con encuadre inicial en el corredor indicado y no representa el límite oficial de la ciudad. No se crean choferes ni horarios ficticios.

## Actualizaciones y funcionamiento sin señal

La versión 1.8.1 agrega 33 semáforos de OpenStreetMap, animaciones de carga, avisos sin conexión, caché pública acotada y cargas diferidas para reducir datos. Los semáforos son ubicaciones cartográficas; no indican el estado de la luz.

Una etiqueta estable `vX.Y.Z` ejecuta pruebas, compila Android firmado y publica APK, suma SHA-256 y novedades en GitHub Releases. La app muestra las novedades y bloquea versiones antiguas cuando conoce una actualización. **Los APK anteriores a 1.8.1 requieren instalar esta versión una vez.** Los commits ordinarios ejecutan verificación sin forzar una actualización. La web usa la versión realmente desplegada en Cloudflare. Procedimiento y condiciones de firma en [app/ACTUALIZACIONES.md](app/ACTUALIZACIONES.md).

## Interfaz y modelo del equipo

Indica origen y destino y pulsa **Ver cómo llegar**. Las selecciones se confirman, las instrucciones quedan abiertas y tocar una ruta muestra directamente su inicio, término y paradas. El acceso de choferes está separado y se indica claramente el modo pasajero. Se retiraron las tarjetas numeradas de pasos y el botón de ayuda.

Texto base de 18 px, opción de 22 px persistente, botones grandes y vistas de mapa/instrucciones con acciones explícitas en celular. El mapa plano usa las calles locales sin edificios ni teselas externas; mantiene sus nombres y la atribución requerida. Se incorporan los logos proporcionados de **Las Palmas Rutas**. Las pruebas incluyen ampliación de texto, teclado y pantallas móviles; queda pendiente validarlo de nuevo con personas mayores. Se verificó la instalación de actualización en un teléfono Samsung SM-S938B.

La rama **Axel**, actualizada al commit **3b38961**, se incorpora conservando sus originales en [`ciudadviva/`](ciudadviva/). Sus funciones se adaptan a React y al servidor existente: la comunidad usa `/api/community`, las fotos y reportes se guardan en el mismo SQLite, y rutas importadas, QR y vehículos comparten el motor de movilidad. Incluye avisos de dentro/fuera de zona al chofer, área piloto configurable dentro del perímetro original, lista de unidades con edad de señal y desactivación inmediata en servidor. No se calculan llegadas de combis remotas ni con señal caducada. No se usan la base de datos ni el servidor público del compañero. Los reportes pueden guardarse sin señal y enviarse al reconectar. Uso e importación en [app/COMUNIDAD.md](app/COMUNIDAD.md).

El modelo original de la rama **prediction-model**, commit **4266afc**, está integrado en las llegadas a paradas y la clasificación de viajes. Sus árboles se exportan a JSON para evaluarlos en React y Capacitor sin un servidor Python. Se verifica paridad con 260 entradas y las tres salidas originales de scikit-learn. **Fue entrenado con datos ficticios** y se muestra como experimental; no hay observaciones reales de lluvia o semáforos. Procedencia y reproducción en [app/MODELO.md](app/MODELO.md). Se conservan intactos los archivos originales en `model/`.

## Ejecutar

Requiere Node.js 24 o superior.

```sh
cd app
npm ci
npm run build
npm run server
```

Abre `http://127.0.0.1:8787/`. Para editar React, ejecuta también `npm run dev` en otra terminal.

## Alojar y configurar cuentas

[`app/CLOUDFLARE.md`](app/CLOUDFLARE.md) explica la publicación en `workers.dev`, el almacenamiento persistente y la creación de choferes en la nube. [`app/SERVIDOR.md`](app/SERVIDOR.md) documenta el servidor Node alternativo. **No se crean cuentas ni horarios por defecto**. Las credenciales de operador y de Cloudflare se conservan fuera del repositorio.

## Android

Requiere Android Studio, SDK 36 y JDK 21. Android mínimo: 8.0/API 26.

Configura las direcciones públicas `VITE_PUBLIC_API_URL` y `VITE_PUBLIC_APP_URL` antes de compilar para conectar el APK al servidor alojado.

```sh
cd app
npm ci
npm run android:sync
npm run android:open
```

El proyecto nativo está en `app/android/`. Versión 1.8.1, código 10. En esta versión el chofer debe mantener la app abierta para compartir GPS; el seguimiento con pantalla bloqueada queda pendiente de definir.

## Verificar

Desde `app/`:

```sh
npm run format:check
npm test
npm run test:ui
npm run test:offline
npm run release:check
npm run build
npm run cloudflare:check
npm run test:cloudflare
```

52 pruebas de datos, búsqueda, planificación, autenticación, horarios, GPS, SSE, QR, comunidad y zona piloto; 46 pruebas de interfaz; una prueba de integración con el runtime de Cloudflare que verifica cuentas, GPS, desactivación por SSE, CORS y persistencia de reportes y fotos al reiniciar. Las pruebas usan datos aislados. También se verifica una PWA compilada sin señal. Compilación y lint Android pasaron y el APK se instaló conservando los datos de la versión anterior en un Samsung SM-S938B. Detalles y límites en [app/AUDITORIA.md](app/AUDITORIA.md).

Consulta [`app/LEEME.md`](app/LEEME.md) para uso, ejemplos, cobertura y formato de las rutas. Datos del mapa © [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).

La versión 1.9.1 integra actualización dentro de Android, origen/destino plegables, paradas por zonas y panel de administración después de autenticar. [Cambios y uso de paradas](app/CAMBIOS-1.9.md).
