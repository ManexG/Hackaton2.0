import { useEffect, useState } from 'react';
import { api, apiBase, isSnapshot } from './liveApi';
import { currentVehicles, type FleetSnapshot } from './transit';
import type { Network } from './types';

export function useFleet(network: Network) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline' | 'unconfigured'>(apiBase ? 'connecting' : 'unconfigured');
  const [clock, setClock] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!apiBase) return;
    let disposed = false, pending = false;
    const controller = new AbortController();
    function receive(data: unknown) {
      if (disposed || !isSnapshot(data)) return;
      setSnapshot(data); setOffset(data.serverTime - Date.now()); setClock(Date.now()); setStatus('connected');
    }
    async function refresh() {
      if (disposed || pending) return;
      pending = true;
      try { receive(await api('/fleet', { signal: controller.signal })); }
      catch { if (!disposed) setStatus('offline'); }
      finally { pending = false; }
    }
    void refresh();
    const stream = new EventSource(apiBase + '/events');
    stream.addEventListener('fleet', event => { try { receive(JSON.parse((event as MessageEvent).data)); } catch { /* Ignore incomplete network events. */ } });
    stream.onerror = () => { if (!disposed) setStatus('offline'); };
    const interval = setInterval(() => { if (stream.readyState !== EventSource.OPEN) void refresh(); }, 10_000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', resume);
    return () => { disposed = true; controller.abort(); stream.close(); clearInterval(interval); document.removeEventListener('visibilitychange', resume); };
  }, []);
  const now = clock + offset;
  return { snapshot, status, now, vehicles: currentVehicles(snapshot, network, now) };
}
export type Fleet = ReturnType<typeof useFleet>;
