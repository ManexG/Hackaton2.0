import bundled from '../release.json' with { type: 'json' };
import { compareVersions, parseVersion, validRelease } from '../src/version.js';
const TTL = 10 * 60_000;
export function bundledRelease() {
  return {
    version: bundled.version,
    minimumVersion: bundled.version,
    minimumWebVersion: bundled.version,
    webVersion: bundled.version,
    notes: bundled.notes,
    releaseUrl: `https://github.com/${bundled.repository}/releases/tag/v${bundled.version}`,
    downloadUrl: `https://github.com/${bundled.repository}/releases/download/v${bundled.version}/${bundled.assetName}`,
    source: 'bundled',
  };
}
export function githubRelease(data) {
  if (!data || data.draft || data.prerelease || !parseVersion(data.tag_name) || !data.published_at)
    return null;
  const version = data.tag_name.replace(/^v/, '');
  const expected = `https://github.com/${bundled.repository}/releases/download/v${version}/${bundled.assetName}`;
  const apk = data.assets?.find(
    (a) =>
      a.name === bundled.assetName &&
      a.state === 'uploaded' &&
      a.size > 0 &&
      a.browser_download_url === expected
  );
  if (!apk || compareVersions(version, bundled.version) < 0) return null;
  const notes = (data.body || '')
    .split(/\r?\n/)
    .map((n) => n.replace(/^[-*#\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 15)
    .map((n) => n.slice(0, 600));
  return {
    version,
    minimumVersion: version,
    minimumWebVersion: bundled.version,
    webVersion: bundled.version,
    notes: notes.length ? notes : ['Mejoras y correcciones de Las Palmas Rutas.'],
    releaseUrl: `https://github.com/${bundled.repository}/releases/tag/v${version}`,
    downloadUrl: expected,
    publishedAt: data.published_at,
    source: 'github',
  };
}
export class ReleaseService {
  required(version, platform = 'native') {
    const release = this.cached?.data || bundledRelease();
    const minimum = platform === 'web' ? bundled.version : release.minimumVersion;
    return parseVersion(version) && compareVersions(version, minimum) < 0 ? release : null;
  }
  constructor({ db, fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
    this.fetcher = fetcher;
    this.now = now;
    this.db = db;
    this.retryAt = 0;
    if (db) {
      db.exec(
        'CREATE TABLE IF NOT EXISTS app_release_cache (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)'
      );
      try {
        this.cached = JSON.parse(
          db.prepare('SELECT payload FROM app_release_cache WHERE id=1').get()?.payload || 'null'
        );
      } catch {
        /* Invalid cache is replaceable. */
      }
      if (this.cached) {
        if (
          !validRelease(this.cached.data) ||
          !Number.isFinite(this.cached.checkedAt) ||
          compareVersions(this.cached.data?.version, bundled.version) < 0
        )
          this.cached = null;
        else {
          this.cached.data.minimumWebVersion = bundled.version;
          this.cached.data.webVersion = bundled.version;
        }
      }
    }
  }
  async current() {
    if (this.cached && this.now() - this.cached.checkedAt < TTL) return this.cached.data;
    if (this.pending) return this.pending;
    if (this.now() < this.retryAt) return this.cached?.data || bundledRelease();
    this.pending = this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async latestManifest() {
    const response = await this.fetcher(
      `https://github.com/${bundled.repository}/releases/latest/download/release.json`,
      {
        headers: {
          'User-Agent': 'Las-Palmas-Rutas',
          ...(this.cached?.data.discovery === 'manifest' && this.cached.etag
            ? { 'If-None-Match': this.cached.etag }
            : {}),
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (response.status === 304 && this.cached?.data.discovery === 'manifest')
      return { data: this.cached.data, etag: this.cached.etag };
    if (!response.ok || Number(response.headers.get('Content-Length')) > 65536)
      throw new Error('Release manifest unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0,
      text = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) throw new Error('Release manifest too large');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const manifest = JSON.parse(text);
    if (
      manifest.repository !== bundled.repository ||
      manifest.assetName !== bundled.assetName ||
      !parseVersion(manifest.version) ||
      manifest.version.startsWith('v') ||
      compareVersions(manifest.version, bundled.version) < 0
    )
      throw new Error('Invalid release manifest');
    const data = {
      version: manifest.version,
      minimumVersion: manifest.version,
      minimumWebVersion: bundled.version,
      webVersion: bundled.version,
      notes: manifest.notes,
      releaseUrl: `https://github.com/${bundled.repository}/releases/tag/v${manifest.version}`,
      downloadUrl: `https://github.com/${bundled.repository}/releases/download/v${manifest.version}/${bundled.assetName}`,
      source: 'github',
      discovery: 'manifest',
    };
    if (!validRelease(data)) throw new Error('Invalid release notes');
    const apk = await this.fetcher(data.downloadUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
    });
    if (
      !apk.ok ||
      !(Number(apk.headers.get('Content-Length')) > 0) ||
      !['application/vnd.android.package-archive', 'application/octet-stream'].includes(
        apk.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
      )
    )
      throw new Error('Release APK not ready');
    return { data, etag: response.headers.get('ETag') };
  }
  async refresh() {
    try {
      const response = await this.fetcher(
        `https://api.github.com/repos/${bundled.repository}/releases/latest`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Las-Palmas-Rutas',
            ...(this.cached?.etag && this.cached.data.discovery !== 'manifest'
              ? { 'If-None-Match': this.cached.etag }
              : {}),
          },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (response.status === 304 && this.cached) this.cached.checkedAt = this.now();
      else {
        let data, etag;
        if ([403, 429].includes(response.status)) ({ data, etag } = await this.latestManifest());
        else {
          if (!response.ok) throw new Error('Release unavailable');
          data = githubRelease(await response.json());
          etag = response.headers.get('ETag');
        }
        if (!data || (this.cached && compareVersions(data.version, this.cached.data.version) < 0))
          throw new Error('Unpublished or older release');
        this.cached = { data, etag, checkedAt: this.now() };
      }
      if (this.db)
        this.db
          .prepare(
            'INSERT INTO app_release_cache (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload'
          )
          .run(JSON.stringify(this.cached));
      return this.cached.data;
    } catch {
      this.retryAt = this.now() + 5 * 60_000;
      return this.cached?.data || bundledRelease();
    }
  }
}
