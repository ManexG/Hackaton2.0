import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Icon } from './Icon.jsx';
import { stopArrivals } from './transit.js';
import { stopWebLink } from './stopLinks.js';
import { arrivalRangeLabel } from './etaModel.js';
const cleanName = (name) => name.replace(' · demo', '');
export function ScanStopButton({ onScan, onMessage }) {
  const [scanning, setScanning] = useState(false);
  async function scan() {
    setScanning(true);
    try {
      const {
        CapacitorBarcodeScanner,
        CapacitorBarcodeScannerTypeHint,
        CapacitorBarcodeScannerAndroidScanningLibrary,
      } = await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: 'Apunta al QR de una parada de OptiRouteLZC',
        scanButton: false,
        scanText: 'Leer parada',
        cameraDirection: 1,
        android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING },
        web: { showCameraSelection: false, scannerFPS: 10 },
      });
      if (result.ScanResult) onScan(result.ScanResult);
    } catch {
      onMessage('No pudimos leer el QR. Permite la cámara o elige la parada de la lista.');
    } finally {
      setScanning(false);
    }
  }
  return (
    <button
      type="button"
      className="scan-stop"
      disabled={scanning}
      onClick={() => {
        void scan();
      }}
    >
      <Icon name={scanning ? 'loading' : 'qr'} />
      {scanning ? 'Leyendo parada…' : 'Escanear QR de parada'}
    </button>
  );
}
export function FleetStatus({ fleet, network }) {
  return (
    <>
      <div className={`fleet-status ${fleet.status}`} role="status">
        <Icon name={fleet.status === 'connected' ? 'radio' : 'offline'} />
        <div>
          <strong>
            {fleet.status === 'connected'
              ? `${fleet.vehicles.length} combi${fleet.vehicles.length === 1 ? '' : 's'} en servicio`
              : fleet.status === 'connecting'
                ? 'Conectando con las combis…'
                : fleet.status === 'unconfigured'
                  ? 'Servicio pendiente de conexión'
                  : fleet.status === 'paused'
                    ? 'Consulta en pausa'
                    : 'Sin conexión con las combis'}
          </strong>
          <span>
            {fleet.status === 'connected'
              ? 'Ubicaciones GPS · sin registro para pasajeros'
              : 'Puedes seguir buscando lugares y consultar las rutas.'}
          </span>
        </div>
      </div>
      {fleet.vehicles.length > 0 && (
        <section className="reporting-fleet" aria-label="Combis reportando">
          <h3>Combis en la zona</h3>
          <ul>
            {fleet.vehicles.map((vehicle) => {
              const route = network.routes.find((item) => item.id === vehicle.routeId);
              return (
                <li key={vehicle.id} style={{ '--route-color': route?.color || '#24551f' }}>
                  <Icon name="bus-front" />
                  <div>
                    <strong>{vehicle.unit}</strong>
                    <span>
                      {vehicle.routeId} · {route?.name}
                    </span>
                    <small>
                      {fleet.status === 'connected' ? 'En vivo' : 'Última ubicación'} · señal hace{' '}
                      {Math.max(0, Math.floor((fleet.now - vehicle.updatedAt) / 1000))} s · Dentro
                      de la zona
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
export function StopPanel({ network, selected, fleet, onStop, onOrigin, onScan, onMessage }) {
  const [qr, setQr] = useState('');
  const [choosing, setChoosing] = useState(true);
  const [zone, setZone] = useState('Corredor principal');
  useEffect(() => {
    if (selected) setChoosing(false);
  }, [selected?.id]);
  const zones = [...new Set(network.stops.map((stop) => stop.zone || 'Otras paradas'))];
  const webBase =
    fleet.snapshot?.publicAppUrl ||
    import.meta.env.VITE_PUBLIC_APP_URL ||
    (location.protocol.startsWith('http') && !location.hostname.endsWith('localhost')
      ? location.origin + location.pathname
      : '');
  const link = selected && webBase ? stopWebLink(webBase, selected.id) : '';
  useEffect(() => {
    let disposed = false;
    setQr('');
    if (link)
      void QRCode.toDataURL(link, {
        width: 280,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#173e31', light: '#ffffff' },
      })
        .then((value) => {
          if (!disposed) setQr(value);
        })
        .catch(() => onMessage('No pudimos generar el QR de esta parada.'));
    return () => {
      disposed = true;
    };
  }, [link]);
  const arrivals =
    selected && fleet.status === 'connected'
      ? stopArrivals(selected.id, network, fleet.vehicles, fleet.now)
      : [];
  return (
    <section className="stop-panel">
      <div className="section-heading">
        <div>
          <h2>Tu parada, al momento</h2>
          <p>Elige dónde esperar y consulta las próximas combis.</p>
        </div>
        <Icon name="map-pin" />
      </div>
      <p className="stop-explanation">
        Una parada es el punto donde subes, bajas o cambias de combi. Elige una para ver qué rutas
        pasan y cuánto falta para que llegue una combi en servicio.
      </p>
      <button
        type="button"
        className="field-summary stop-picker-summary"
        aria-expanded={choosing}
        aria-controls="stop-zones"
        onClick={() => setChoosing(!choosing)}
      >
        <Icon name="map-pin" />
        <span>
          <small>{selected ? 'Parada elegida · toca para cambiar' : 'Busca por zona'}</small>
          <strong>{selected ? cleanName(selected.name) : 'Elige dónde esperar'}</strong>
        </span>
        <Icon name={choosing ? 'chevron-up' : 'chevron-down'} />
      </button>
      <div id="stop-zones" className="stop-zones" hidden={!choosing}>
        {zones.map((name) => (
          <section className="stop-zone" key={name}>
            <button
              type="button"
              className="zone-heading"
              aria-expanded={zone === name}
              aria-controls={`zone-${zones.indexOf(name)}`}
              onClick={() => setZone(zone === name ? null : name)}
            >
              <span>{name}</span>
              <Icon name={zone === name ? 'chevron-up' : 'chevron-down'} />
            </button>
            <div id={`zone-${zones.indexOf(name)}`} hidden={zone !== name}>
              {network.stops
                .filter((stop) => (stop.zone || 'Otras paradas') === name)
                .map((stop) => (
                  <button
                    type="button"
                    className="stop-choice"
                    key={stop.id}
                    aria-pressed={selected?.id === stop.id}
                    onClick={() => {
                      onStop(stop);
                      setChoosing(false);
                    }}
                  >
                    <Icon name="map-pin" />
                    <span>
                      <strong>{cleanName(stop.name)}</strong>
                      <small>
                        {network.routes
                          .filter((route) => route.stops.includes(stop.id))
                          .map((route) => route.id)
                          .join(' · ')}
                      </small>
                    </span>
                    {selected?.id === stop.id && <Icon name="check" />}
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
      <ScanStopButton onScan={onScan} onMessage={onMessage} />
      {selected && (
        <>
          <div className="selected-stop">
            <span className="stop-symbol">
              <Icon name="map-pin" />
            </span>
            <div>
              <small>ESTÁS CONSULTANDO</small>
              <h3>{cleanName(selected.name)}</h3>
            </div>
          </div>
          <button className="secondary-button" onClick={() => onOrigin(selected)}>
            <Icon name="navigation" />
            Salir desde esta parada
          </button>
          <div className="stop-route-tags" aria-label="Rutas de esta parada">
            {network.routes
              .filter((route) => route.stops.includes(selected.id))
              .map((route) => (
                <span style={{ '--route-color': route.color }} key={route.id}>
                  <i />
                  {route.id} · {route.name}
                </span>
              ))}
          </div>
          <div className="arrivals-heading">
            <h3>Próximas llegadas</h3>
            <span>ESTIMADAS</span>
          </div>
          <div className="arrivals-list" aria-label="Llegadas a la parada">
            {arrivals.map((arrival) => {
              const route = network.routes.find((route) => route.id === arrival.vehicle.routeId);
              return (
                <div
                  className="arrival-card"
                  key={arrival.vehicle.id}
                  style={{ '--route-color': route.color }}
                >
                  <span className="arrival-route">
                    <Icon name="bus-front" />
                    {route.id}
                  </span>
                  <div>
                    <strong>{arrival.vehicle.unit}</strong>
                    <small>
                      Hacia{' '}
                      {cleanName(
                        network.stops.find((stop) => stop.id === arrival.destination).name
                      )}
                    </small>
                    <small>
                      Señal hace{' '}
                      {Math.max(0, Math.floor((fleet.now - arrival.vehicle.updatedAt) / 1000))} s
                    </small>
                  </div>
                  <b>
                    {arrival.seconds < 30 ? 'Llegando' : `${Math.ceil(arrival.seconds / 60)} min`}
                    {arrival.experimental && (
                      <small className="arrival-range">{arrivalRangeLabel(arrival)}</small>
                    )}
                  </b>
                </div>
              );
            })}
          </div>
          {!arrivals.length && (
            <div className="service-empty">
              <Icon name="clock-3" />
              <p>
                {fleet.status !== 'connected'
                  ? 'Las llegadas estarán disponibles al conectar con el servicio.'
                  : 'No hay una combi activa acercándose a esta parada.'}
              </p>
            </div>
          )}
          {!arrivals.length && (
            <p className="arrival-availability-note">
              Solo calculamos llegadas de combis dentro de la zona, en horario y con señal GPS
              reciente.
            </p>
          )}
          <p className="walking-note">
            La llegada se estima con la última señal GPS, el sentido y el recorrido. Puede cambiar
            por tráfico o detenciones.
          </p>
          {arrivals.some((arrival) => arrival.experimental) && (
            <p className="model-note">
              <strong>Estimación experimental.</strong> El modelo se entrenó con viajes ficticios.
              No incluye lluvia ni semáforos reales.
            </p>
          )}
          <details className="stop-qr">
            <summary>
              <Icon name="qr" />
              QR de esta parada
              <Icon name="chevron-down" />
            </summary>
            {qr ? (
              <>
                <img
                  src={qr}
                  alt={`QR para abrir ${cleanName(selected.name)}`}
                  width="220"
                  height="220"
                />
                <p>Abre la web centrada en esta parada, sin iniciar sesión.</p>
                <a
                  className="secondary-button"
                  href={qr}
                  download={`cerca-parada-${selected.id}.png`}
                >
                  Descargar QR
                </a>
                <a className="stop-link" href={link}>
                  Abrir enlace de la parada
                </a>
                {/localhost|127\.0\.0\.1/.test(webBase) && (
                  <p className="small-note">
                    Este enlace funciona en este equipo. Los QR para otros teléfonos se generan al
                    configurar la dirección pública.
                  </p>
                )}
              </>
            ) : (
              <p>
                El QR para compartir estará disponible cuando se configure la dirección pública de
                la web.
              </p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
