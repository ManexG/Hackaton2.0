import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReleaseService, bundledRelease, githubRelease } from '../server/releases.js';
import { APP_VERSION, compareVersions, validRelease } from '../src/version.js';
import { publicPath } from '../src/offlineCache.js';
import { createTransitServer } from '../server/index.js';
import { insideCoverage } from '../src/planner.js';
const futureVersion = `${Number(APP_VERSION.split('.')[0]) + 1}.0.0`;
const candidate = (version = futureVersion) => ({
  tag_name: 'v' + version,
  published_at: '2026-10-09T00:00:00Z',
  draft: false,
  prerelease: false,
  body: '- Nuevo mapa\n- Correcciones de GPS',
  assets: [
    {
      name: 'Las-Palmas-Rutas.apk',
      state: 'uploaded',
      size: 1000,
      browser_download_url: `https://github.com/ManexG/Hackaton2.0/releases/download/v${version}/Las-Palmas-Rutas.apk`,
    },
  ],
});
test('release versions compare numerically and reject invalid or injected versions', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('v1.8.0', '1.8.0'), 0);
  for (const value of ['1.8', 'v2.0.0-beta', 'https://bad.test', '2.0.0;rm', '1.2.NaN', null])
    assert.equal(compareVersions(value, '1.8.0'), null);
});
test('only published stable releases with a complete APK from this repository can force updates', () => {
  assert.ok(validRelease(githubRelease(candidate())));
  for (const data of [
    { ...candidate(), draft: true },
    { ...candidate(), prerelease: true },
    { ...candidate(), assets: [] },
    { ...candidate(), tag_name: '1.9.0-beta' },
    candidate('1.7.0'),
    {
      ...candidate(),
      assets: [{ ...candidate().assets[0], browser_download_url: 'https://bad.test/malware.apk' }],
    },
  ])
    assert.equal(githubRelease(data), null);
  assert.equal(validRelease({ ...bundledRelease(), downloadUrl: 'javascript:alert(1)' }), false);
});
test('release checks share requests, cache for ten minutes, revalidate with ETag and resist downgrade', async () => {
  let time = 1000000,
    calls = 0,
    mode = 'ok';
  const service = new ReleaseService({
    now: () => time,
    fetcher: async (_url, options) => {
      calls++;
      if (mode === '304') {
        assert.equal(options.headers['If-None-Match'], '"release-9"');
        return new Response(null, { status: 304 });
      }
      return Response.json(candidate(mode === 'older' ? APP_VERSION : futureVersion), {
        headers: { ETag: '"release-9"' },
      });
    },
  });
  await Promise.all(Array.from({ length: 20 }, () => service.current()));
  assert.equal(calls, 1);
  assert.equal((await service.current()).version, futureVersion);
  assert.equal(calls, 1);
  time += 600001;
  mode = '304';
  await service.current();
  assert.equal(calls, 2);
  time += 600001;
  mode = 'older';
  assert.equal((await service.current()).version, futureVersion);
  assert.equal(calls, 3);
  await service.current();
  assert.equal(calls, 3);
  assert.ok(service.required(APP_VERSION, 'native'));
  assert.equal(service.required(APP_VERSION, 'web'), null);
});
test('GitHub failure does not crash startup or lose a known mandatory version', async () => {
  let calls = 0;
  const service = new ReleaseService({
    fetcher: async () => {
      calls++;
      throw Error('offline');
    },
  });
  assert.equal((await service.current()).version, APP_VERSION);
  await service.current();
  assert.equal(calls, 1);
  service.cached = { data: githubRelease(candidate()), checkedAt: 0 };
  assert.equal((await service.current()).version, futureVersion);
});

test('GitHub rate limits use a published manifest, verify APK with HEAD and reuse its ETag', async () => {
  for (const status of [403, 429]) {
    let time = 1000000,
      calls = 0;
    const service = new ReleaseService({
      now: () => time,
      fetcher: async (url, options) => {
        calls++;
        if (url.startsWith('https://api.github.com/')) {
          assert.equal(options.headers['If-None-Match'], undefined);
          return new Response(null, { status });
        }
        if (url.endsWith('/latest/download/release.json')) {
          if (time > 1000000) {
            assert.equal(options.headers['If-None-Match'], '"manifest-9"');
            return new Response(null, { status: 304 });
          }
          return Response.json(
            {
              version: futureVersion,
              repository: 'ManexG/Hackaton2.0',
              assetName: 'Las-Palmas-Rutas.apk',
              notes: ['Mapa nuevo', 'Correcciones'],
            },
            { headers: { ETag: '"manifest-9"' } }
          );
        }
        assert.equal(options.method, 'HEAD');
        assert.equal(url, candidate().assets[0].browser_download_url);
        return new Response(null, {
          headers: { 'Content-Length': '33321729', 'Content-Type': 'application/octet-stream' },
        });
      },
    });
    const releases = await Promise.all(Array.from({ length: 20 }, () => service.current()));
    assert.ok(releases.every((release) => release.version === futureVersion));
    assert.equal(releases[0].discovery, 'manifest');
    assert.equal(calls, 3);
    assert.ok(service.required(APP_VERSION, 'native'));
    assert.equal(service.required(APP_VERSION, 'web'), null);
    time += 600001;
    assert.equal((await service.current()).version, futureVersion);
    assert.equal(calls, 5);
  }
});

test('rate-limit fallback rejects invalid manifests, oversized bodies and unavailable APKs', async () => {
  const manifest = {
    version: futureVersion,
    repository: 'ManexG/Hackaton2.0',
    assetName: 'Las-Palmas-Rutas.apk',
    notes: ['Correcciones'],
  };
  for (const scenario of [
    { manifest: { ...manifest, repository: 'another/repo' } },
    { manifest: { ...manifest, version: '9.0.0-beta' } },
    { manifest: { ...manifest, version: '1.7.0' } },
    { manifest: { ...manifest, notes: ['x'.repeat(1001)] } },
    { body: ' '.repeat(65537) },
    { apkStatus: 404 },
    { apkSize: '0' },
    { apkType: 'text/html' },
  ]) {
    const service = new ReleaseService({
      fetcher: async (url) => {
        if (url.startsWith('https://api.github.com/')) return new Response(null, { status: 403 });
        if (url.endsWith('/release.json'))
          return scenario.body
            ? new Response(scenario.body)
            : Response.json(scenario.manifest ?? manifest);
        return new Response(null, {
          status: scenario.apkStatus ?? 200,
          headers: {
            'Content-Length': scenario.apkSize ?? '33321729',
            'Content-Type': scenario.apkType ?? 'application/octet-stream',
          },
        });
      },
    });
    assert.equal((await service.current()).source, 'bundled');
    assert.equal(service.required(APP_VERSION), null);
  }
});
test('offline cache never accepts sessions, live locations, operator data or mutation endpoints', () => {
  for (const path of [
    '/reportes?limit=20',
    '/reportes/7',
    '/reportes/7/comentarios',
    '/network',
    '/categorias',
  ])
    assert.equal(publicPath(path), true, path);
  for (const path of [
    '/auth/me',
    '/auth/login',
    '/driver/profile',
    '/fleet',
    '/events',
    '/admin/export',
    '/mis-reportes',
    '/reportes/7/votar',
    '/vehiculos/activos',
  ])
    assert.equal(publicPath(path), false, path);
});
test('all 33 bundled traffic signals are actual OSM nodes inside the original coverage', () => {
  const data = JSON.parse(readFileSync('src/data/traffic-signals.osm.json', 'utf8')),
    network = JSON.parse(readFileSync('public/data/network.demo.json', 'utf8'));
  assert.equal(data.source, 'OpenStreetMap');
  assert.equal(data.license, 'ODbL');
  assert.equal(data.signals.length, 33);
  assert.equal(new Set(data.signals.map((s) => s.id)).size, data.signals.length);
  for (const signal of data.signals) {
    assert.ok(insideCoverage(signal.point, network));
    assert.match(signal.id, /^osm-node-\d+$/);
    assert.ok(signal.osmUrl.endsWith(signal.id.replace('osm-node-', '/node/')));
  }
});
test('HTTP version endpoint and 426 restriction work without rejecting logout or stopping service', async () => {
  const { server } = createTransitServer({
    dbPath: ':memory:',
    releaseFetcher: async () => Response.json(candidate()),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const release = await (await fetch(base + '/api/version')).json();
    assert.equal(release.version, futureVersion);
    const outdated = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': '1.8.0',
        'X-App-Platform': 'native',
      },
      body: '{}',
    });
    assert.equal(outdated.status, 426);
    assert.equal((await outdated.json()).release.version, futureVersion);
    const currentWeb = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': APP_VERSION,
        'X-App-Platform': 'web',
      },
      body: '{}',
    });
    assert.notEqual(currentWeb.status, 426);
    const logout = await fetch(base + '/api/auth/logout', {
      method: 'POST',
      headers: { 'X-App-Version': '1.7.0' },
      body: '{}',
    });
    assert.notEqual(logout.status, 426);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
});
