export function stopFromLink(value, network, webOrigin) {
  try {
    const url = new URL(value, webOrigin);
    const isNative = url.protocol === 'cerca:' && url.hostname === 'stop';
    if (
      !isNative &&
      (!['https:', 'http:'].includes(url.protocol) || url.origin !== new URL(webOrigin).origin)
    )
      return null;
    const code = (url.hash.replace(/^#/, '') || url.pathname).match(
      /^\/parada\/([A-Za-z0-9-]+)\/?$/
    )?.[1];
    const id = isNative
      ? decodeURIComponent(url.pathname.slice(1))
      : url.searchParams.get('stop') || code;
    return network.stops.find((stop) => stop.id === id || (code && stop.qr === code)) ?? null;
  } catch {
    return null;
  }
}
export function stopWebLink(base, stopId) {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('La dirección de la web debe comenzar con https://.');
  url.hash = '';
  url.search = '';
  url.searchParams.set('stop', stopId);
  return url.toString();
}
