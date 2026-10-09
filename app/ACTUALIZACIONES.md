# Actualizaciones de Las Palmas Rutas

La versión 1.8.1 incorpora el control de versiones. Un commit conserva el trabajo; una etiqueta estable `vX.Y.Z` publica una actualización Android mediante GitHub Actions. No se solicita instalar un APK diferente por cada commit.

## Publicar una versión Android

Desde `app/`, en la rama `V2Camion`:

```sh
npm ci
npm version patch --no-git-tag-version
```

El script `version` sincroniza `package.json`, `package-lock.json`, `release.json`, el número Android, `index.html` y el agente de Capacitor. Edita `release.json` para escribir novedades breves y claras en `notes`. No reutilices un `versionCode` publicado.

```sh
npm run release:check
npm run format:check
npm test
npm run test:ui
npm run test:offline
npm run test:cloudflare
git add .
git commit -m "Publicar versión X.Y.Z"
git push origin V2Camion
git tag vX.Y.Z
git push origin vX.Y.Z
```

Sustituye `X.Y.Z` por la versión real, por ejemplo `1.9.0`. La etiqueta debe coincidir exactamente con `release.json`; el workflow rechaza incoherencias. Publica desde el commit ya revisado, sin credenciales ni archivos locales. Los commits de `V2Camion` ejecutan verificación; las etiquetas ejecutan además compilación y publicación.

El workflow raíz `.github/workflows/release.yml` instala Node 24, JDK 21 y SDK 36, revisa dependencias, ejecuta pruebas, sincroniza Capacitor y compila un APK de release firmado. Solo entonces crea una GitHub Release estable con:

- `Las-Palmas-Rutas.apk`.
- `SHA256SUMS.txt`, con la suma SHA-256 del APK.
- `release.json`, con versión y novedades.

Si una comprobación falla, no se publica una actualización incompleta. Corrige el fallo y publica una nueva versión; evita cambiar una etiqueta de una versión ya distribuida.

## Firma y secretos

Ya están configurados en los secretos cifrados de GitHub Actions `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`. No deben entrar en el repositorio, el ZIP ni el APK. Se conserva el certificado de los APK entregados anteriormente para que Android acepte una actualización sobre la instalación existente.

El certificado actual procede de la clave de desarrollo de esta demo. El APK de release no es depurable, pero esto no convierte la clave en una identidad de publicación para Google Play. Antes de una distribución definitiva, el equipo debe decidir y custodiar la firma de producción y su estrategia de migración; cambiar el certificado puede impedir actualizar instalaciones actuales. Conserva una copia privada recuperable de la clave existente.

## Cómo recibe el usuario la actualización

`GET /api/version` consulta la última GitHub Release estable con el APK completamente publicado. Ignora borradores, versiones preliminares, URLs ajenas y versiones anteriores. El servidor comparte la consulta entre usuarios, usa ETag y conserva el resultado en SQLite; la caché normal dura 10 minutos. Si GitHub falla, conserva la última versión válida y reduce los reintentos.

Si la API devuelve 403 o 429, el servidor consulta `release.json` mediante el [enlace de GitHub a la última descarga](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases). Valida su tamaño, versión, repositorio y novedades, y comprueba con HEAD que el APK exista con tamaño positivo y tipo de archivo válido. Esta alternativa conserva ETag y caché, no descarga el APK al servidor y no requiere copiar un token personal de GitHub a Cloudflare.

Android comprueba al iniciar y, mientras permanece visible y conectado, cada 10 minutos; también al volver a la app o recuperar conexión. Al conocer una versión superior, bloquea la navegación, explica las novedades y ofrece actualizar. Desde 1.9.0 el APK se descarga con progreso dentro de Android, se verifica su SHA-256 y firma, y se abre el instalador del sistema, sin navegador. Android pide permiso y confirmación; una instalación silenciosa no está disponible. El aviso conocido persiste sin internet; no hay un botón para omitirlo. Las solicitudes de modificación de clientes con versión antigua reciben HTTP 426. Desactivar servicio y cerrar sesión siguen permitidos.

La web usa la versión realmente desplegada en Cloudflare. Su botón actualiza el service worker y comprueba el HTML nuevo antes de recargar. Publicar un APK no obliga a la web a descargar una versión web que todavía no existe.

**Las instalaciones 1.7 y anteriores no tenían este mecanismo: deben instalar la versión actual (1.9.0) una vez para recibir los avisos siguientes.** No se puede añadir código a un APK ya instalado desde el servidor. Si un teléfono nunca pudo consultar una versión nueva, conserva las funciones locales disponibles; no puede conocer una publicación estando desconectado. Este control es un flujo de actualización, no una protección contra clientes modificados que falseen su versión.

## Publicar también la web y el servidor

GitHub Actions publica Android. La web y el backend se despliegan desde un equipo autorizado en Cloudflare:

```sh
npm run cloudflare:deploy
```

Conserva el Worker `cerca-combis`, la clase `FleetService`, el nombre del Durable Object y las migraciones existentes. No borres el SQLite ni aprovisiones otra vez las cuentas. Publica primero el APK para que su enlace esté disponible antes de desplegar un servidor que anuncie esa versión mínima. Comprueba `/api/version`, la Release y la web después de publicar; durante el despliegue el backend puede tardar en adoptar la nueva versión.

## Semáforos y datos

Los 33 iconos representan ubicaciones etiquetadas en OpenStreetMap dentro de la cobertura. Los colores del dibujo identifican un semáforo; **no indican su estado real ni un flujo de tráfico en vivo**. Se incluyen en la app y no consumen una consulta externa por usuario. Cada icono ofrece la fuente de su nodo.

El mantenedor puede actualizar el catálogo con `npm run map:refresh`, revisar el resultado y publicarlo con la siguiente versión. Si Overpass falla, se conserva el archivo existente. La atribución de OpenStreetMap sigue visible.

Los APK anteriores a 1.9.0 deben instalar esta versión una vez para adoptar el instalador nativo. Ver [CAMBIOS-1.9.md](CAMBIOS-1.9.md).
