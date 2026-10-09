import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import release from '../release.json' with { type: 'json' };
import { parseVersion } from '../src/version.js';
const text = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
assert.ok(parseVersion(release.version));
assert.equal(JSON.parse(text('package.json')).version, release.version);
assert.ok(text('android/app/build.gradle').includes(`versionName "${release.version}"`));
assert.ok(text('android/app/build.gradle').includes(`versionCode ${release.androidVersionCode}`));
assert.ok(text('index.html').includes(`name="app-version" content="${release.version}"`));
assert.ok(
  release.notes.length > 0 && release.notes.every((n) => typeof n === 'string' && n.length > 5)
);
if (process.env.RELEASE_TAG)
  assert.equal(
    process.env.RELEASE_TAG,
    `v${release.version}`,
    'La etiqueta y la versión de la app deben coincidir.'
  );
writeFileSync(
  new URL('../release-notes.txt', import.meta.url),
  release.notes.map((n) => '- ' + n).join('\n') + '\n'
);
console.log(`Release v${release.version} validada; Android ${release.androidVersionCode}.`);
