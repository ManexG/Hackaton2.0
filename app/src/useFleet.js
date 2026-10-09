import { useEffect, useMemo, useState } from 'react';
import { api, apiBase, isSnapshot } from './liveApi.js';
import { currentVehicles } from './transit.js';
export function useFleet(network) {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState(apiBase ? 'connecting' : 'unconfigured');
  const [clock, setClock] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!apiBase) return;
    let disposed = false,
      pending = false;
    const controller = new AbortController();
    function receive(data) {
      if (disposed || !isSnapshot(data)) return;
      setSnapshot(data);
      setOffset(data.serverTime - Date.now());
      setClock(Date.now());
      setStatus('connected');
    }
    async function refresh() {
      if (disposed || pending) return;
      pending = true;
      try {
        receive(await api('/fleet', { signal: controller.signal }));
      } catch {
        if (!disposed) setStatus('offline');
      } finally {
        pending = false;
      }
    }
    void refresh();
    const stream = new EventSource(apiBase + '/events');
    stream.addEventListener('fleet', (event) => {
      try {
        receive(JSON.parse(event.data));
      } catch {
        /* Ignore incomplete network events. */
      }
    });
    stream.onerror = () => {
      if (!disposed) setStatus('offline');
    };
    const interval = setInterval(() => {
      if (stream.readyState !== EventSource.OPEN) void refresh();
    }, 10_000);
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      controller.abort();
      stream.close();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
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
    vehicles: currentVehicles(snapshot, serviceNetwork, now),
  };
}
