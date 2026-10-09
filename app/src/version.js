import release from '../release.json' with { type: 'json' };
export const APP_VERSION = release.version;
export const RELEASE_REPOSITORY = release.repository;
export function parseVersion(value) {
  if (typeof value !== 'string' || !/^v?\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) return null;
  return value.replace(/^v/, '').split('.').map(Number);
}
export function compareVersions(a, b) {
  const left = parseVersion(a),
    right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function validRelease(data) {
  if (
    !data ||
    !parseVersion(data.version) ||
    !parseVersion(data.minimumVersion) ||
    !Array.isArray(data.notes) ||
    (data.minimumWebVersion && !parseVersion(data.minimumWebVersion))
  )
    return false;
  if (data.notes.length > 30 || data.notes.some((n) => typeof n !== 'string' || n.length > 1000))
    return false;
  return (
    data.releaseUrl === `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v${data.version}` &&
    data.downloadUrl ===
      `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${data.version}/Las-Palmas-Rutas.apk`
  );
}
