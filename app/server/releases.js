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
  constructor({ db, fetcher = fetch, now = Date.now } = {}) {
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
  async refresh() {
    try {
      const response = await this.fetcher(
        `https://api.github.com/repos/${bundled.repository}/releases/latest`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Las-Palmas-Rutas',
            ...(this.cached?.etag ? { 'If-None-Match': this.cached.etag } : {}),
          },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (response.status === 304 && this.cached) this.cached.checkedAt = this.now();
      else {
        if (!response.ok) throw new Error('Release unavailable');
        const data = githubRelease(await response.json());
        if (!data || (this.cached && compareVersions(data.version, this.cached.data.version) < 0))
          throw new Error('Unpublished or older release');
        this.cached = { data, etag: response.headers.get('ETag'), checkedAt: this.now() };
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
