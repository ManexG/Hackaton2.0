import { useEffect, useMemo, useState } from 'react';
import { api, apiBase, isSnapshot } from './liveApi.js';
import { currentVehicles } from './transit.js';
import { useConnectivity } from './connectivity.jsx';
export function useFleet(network) {
  const { online, active } = useConnectivity();
  const [snapshot, setSnapshot] = useState(null),
    [status, setStatus] = useState(apiBase ? 'connecting' : 'unconfigured');
  const [clock, setClock] = useState(Date.now()),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 2000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!apiBase) return;
    if (!online || !active) {
      setStatus(online ? 'paused' : 'offline');
      setSnapshot(null);
      return;
    }
    let disposed = false,
      stream,
      retryTimer,
      fallbackTimer,
      pending = false,
      attempt = 0;
    const controller = new AbortController();
    function receive(data) {
      if (disposed || !isSnapshot(data)) return false;
      setSnapshot(data);
      setOffset(data.serverTime - Date.now());
      setClock(Date.now());
      setStatus('connected');
      if (data.vehicles.length) window.dispatchEvent(new Event('las-palmas-fleet-active'));
      return true;
    }
    async function refresh() {
      if (disposed || pending) return;
      pending = true;
      try {
        if (!receive(await api('/fleet', { signal: controller.signal })))
          throw new Error('Invalid fleet response');
      } catch {
        if (!disposed) setStatus('offline');
      } finally {
        pending = false;
      }
    }
    function connect() {
      if (disposed) return;
      stream = new EventSource(apiBase + '/events');
      fallbackTimer = setTimeout(() => void refresh(), 2500);
      stream.addEventListener('fleet', (event) => {
        try {
          if (receive(JSON.parse(event.data))) {
            attempt = 0;
            clearTimeout(fallbackTimer);
          }
        } catch {
          /* Ignore malformed events. */
        }
      });
      stream.onerror = () => {
        if (disposed) return;
        stream.close();
        clearTimeout(fallbackTimer);
        setStatus('offline');
        void refresh();
        const delay = Math.min(60000, 5000 * 2 ** attempt++);
        retryTimer = setTimeout(connect, delay);
      };
    }
    setStatus('connecting');
    connect();
    return () => {
      disposed = true;
      controller.abort();
      stream?.close();
      clearTimeout(retryTimer);
      clearTimeout(fallbackTimer);
    };
  }, [online, active]);
  const now = clock + offset;
  const zoneKey = JSON.stringify(
    snapshot && Object.hasOwn(snapshot, 'pilotZone')
      ? snapshot.pilotZone
      : (network.pilotZone ?? null)
  );
  const serviceNetwork = useMemo(
    () => ({ ...network, pilotZone: JSON.parse(zoneKey) }),
    [network, zoneKey]
  );
  return {
    snapshot,
    status,
    now,
    network: serviceNetwork,
    vehicles:
      online && active && status === 'connected'
        ? currentVehicles(snapshot, serviceNetwork, now)
        : [],
  };
}
