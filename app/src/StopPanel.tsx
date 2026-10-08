import { useEffect, useState, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import { Icon } from './Icon';
import { stopArrivals } from './transit';
import { stopWebLink } from './stopLinks';
import type { Fleet } from './useFleet';
import type { Network, Stop } from './types';

const cleanName = (name: string) => name.replace(' · demo', '');
export function ScanStopButton({ onScan, onMessage }: { onScan: (text: string) => void; onMessage: (message: string) => void }) {
  const [scanning, setScanning] = useState(false);
  async function scan() {
    setScanning(true);
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint, CapacitorBarcodeScannerAndroidScanningLibrary } = await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: 'Apunta al QR de una parada de Cerca', scanButton: false, scanText: 'Leer parada', cameraDirection: 1, android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING }, web: { showCameraSelection: false, scannerFPS: 10 } });
      if (result.ScanResult) onScan(result.ScanResult);
    } catch { onMessage('No pudimos leer el QR. Permite la cámara o elige la parada de la lista.'); }
    finally { setScanning(false); }
  }
  return <button type="button" className="scan-stop" disabled={scanning} onClick={() => { void scan(); }}><Icon name={scanning ? 'loading' : 'qr'} />{scanning ? 'Leyendo parada…' : 'Escanear QR de parada'}</button>;
}
export function FleetStatus({ fleet }: { fleet: Fleet }) {
  return <div className={`fleet-status ${fleet.status}`} role="status"><Icon name={fleet.status === 'connected' ? 'radio' : 'offline'} /><div><strong>{fleet.status === 'connected' ? `${fleet.vehicles.length} combi${fleet.vehicles.length === 1 ? '' : 's'} en servicio` : fleet.status === 'connecting' ? 'Conectando con las combis…' : fleet.status === 'unconfigured' ? 'Servicio pendiente de conexión' : 'Reconectando con el servicio'}</strong><span>{fleet.status === 'connected' ? 'Ubicaciones GPS · sin registro para pasajeros' : 'Puedes seguir buscando lugares y consultar las rutas.'}</span></div></div>;
}
export function StopPanel({ network, selected, fleet, onStop, onOrigin, onScan, onMessage }: { network: Network; selected: Stop | null; fleet: Fleet; onStop: (stop: Stop) => void; onOrigin: (stop: Stop) => void; onScan: (value: string) => void; onMessage: (message: string) => void }) {
  const [qr, setQr] = useState('');
  const webBase = fleet.snapshot?.publicAppUrl || (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || (location.protocol.startsWith('http') && !location.hostname.endsWith('localhost') ? location.origin + location.pathname : '');
  const link = selected && webBase ? stopWebLink(webBase, selected.id) : '';
  useEffect(() => { let disposed = false; setQr(''); if (link) void QRCode.toDataURL(link, { width: 280, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#173e31', light: '#ffffff' } }).then(value => { if (!disposed) setQr(value); }).catch(() => onMessage('No pudimos generar el QR de esta parada.')); return () => { disposed = true; }; }, [link]);
  const arrivals = selected ? stopArrivals(selected.id, network, fleet.vehicles, fleet.now) : [];
  return <section className="stop-panel"><div className="section-heading"><div><h2>Tu parada, al momento</h2><p>Elige dónde esperar y consulta las próximas combis.</p></div><Icon name="map-pin" /></div>
    <label className="control-label" htmlFor="stop-select">PARADA</label><select id="stop-select" value={selected?.id ?? ''} onChange={event => { const stop = network.stops.find(item => item.id === event.target.value); if (stop) onStop(stop); }}><option value="" disabled>Selecciona una parada</option>{network.stops.map(stop => <option key={stop.id} value={stop.id}>{cleanName(stop.name)}</option>)}</select>
    <ScanStopButton onScan={onScan} onMessage={onMessage} />
    {selected && <><div className="selected-stop"><span className="stop-symbol"><Icon name="map-pin" /></span><div><small>ESTÁS CONSULTANDO</small><h3>{cleanName(selected.name)}</h3></div></div><button className="secondary-button" onClick={() => onOrigin(selected)}><Icon name="navigation" />Salir desde esta parada</button>
      <div className="arrivals-heading"><h3>Próximas llegadas</h3><span>ESTIMADAS</span></div><div className="arrivals-list" aria-label="Llegadas a la parada">{arrivals.map(arrival => {
        const route = network.routes.find(route => route.id === arrival.vehicle.routeId)!;
        return <div className="arrival-card" key={arrival.vehicle.id} style={{ '--route-color': route.color } as CSSProperties}><span className="arrival-route"><Icon name="bus-front" />{route.id}</span><div><strong>{arrival.vehicle.unit}</strong><small>Hacia {cleanName(network.stops.find(stop => stop.id === arrival.destination)!.name)}</small><small>Señal hace {Math.max(0, Math.floor((fleet.now - arrival.vehicle.updatedAt) / 1000))} s</small></div><b>{arrival.seconds < 30 ? 'Llegando' : `${Math.ceil(arrival.seconds / 60)} min`}</b></div>;
      })}</div>{!arrivals.length && <div className="service-empty"><Icon name="clock-3" /><p>{fleet.status !== 'connected' ? 'Las llegadas estarán disponibles al conectar con el servicio.' : 'No hay una combi activa acercándose a esta parada.'}</p></div>}
      <p className="walking-note">La llegada se estima con la última señal GPS, el sentido y el recorrido. Puede cambiar por tráfico o detenciones.</p>
      <details className="stop-qr"><summary><Icon name="qr" />QR de esta parada<Icon name="chevron-down" /></summary>{qr ? <><img src={qr} alt={`QR para abrir ${cleanName(selected.name)}`} width="220" height="220" /><p>Abre la web centrada en esta parada, sin iniciar sesión.</p><a className="secondary-button" href={qr} download={`cerca-parada-${selected.id}.png`}>Descargar QR</a><a className="stop-link" href={link}>Abrir enlace de la parada</a>{/localhost|127\.0\.0\.1/.test(webBase) && <p className="small-note">Este enlace funciona en este equipo. Los QR para otros teléfonos se generan al configurar la dirección pública.</p>}</> : <p>El QR para compartir estará disponible cuando se configure la dirección pública de la web.</p>}</details>
    </>}
  </section>;
}
