import { readFileSync, writeFileSync } from 'node:fs';
import { parseVersion, compareVersions } from '../src/version.js';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const write = (path, value) => writeFileSync(new URL('../' + path, import.meta.url), value);
const pkg = JSON.parse(read('package.json')),
  release = JSON.parse(read('release.json'));
if (!parseVersion(pkg.version)) throw new Error('Usa una versión estable: MAJOR.MINOR.PATCH.');
if (compareVersions(pkg.version, release.version) <= 0)
  throw new Error('La versión nueva debe ser mayor que la anterior.');
release.version = pkg.version;
release.androidVersionCode++;
write('release.json', JSON.stringify(release, null, 2) + '\n');
write(
  'android/app/build.gradle',
  read('android/app/build.gradle')
    .replace(/versionCode \d+/, `versionCode ${release.androidVersionCode}`)
    .replace(/versionName "[^"]+"/, `versionName "${release.version}"`)
);
write(
  'index.html',
  read('index.html').replace(
    /name="app-version" content="[^"]+"/,
    `name="app-version" content="${release.version}"`
  )
);
const capacitor = JSON.parse(read('capacitor.config.json'));
capacitor.appendUserAgent = `OptiRouteLZC/${release.version}`;
write('capacitor.config.json', JSON.stringify(capacitor, null, 2) + '\n');
console.log(
  `Versión ${release.version}, Android ${release.androidVersionCode}. Actualiza las novedades de release.json antes de crear la etiqueta.`
);
