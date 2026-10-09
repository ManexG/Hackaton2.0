import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Icon } from './Icon.jsx';
import { api, ConnectionError } from './liveApi.js';
import { scheduleLabel, serviceEnd, validateWindows } from './transit.js';
import { serviceZoneStatus, shortDistance } from './serviceZone.js';
import { OfflineNotice, useConnectivity } from './connectivity.jsx';
function savedSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem('cerca.driver') ?? 'null');
    if (value?.driver) validateWindows(value.driver.windows);
    return value &&
      typeof value.token === 'string' &&
      value.expiresAt > Date.now() &&
      value.driver &&
      ['id', 'name', 'email', 'routeId', 'unit'].every(
        (key) => typeof value.driver[key] === 'string'
      ) &&
      Array.isArray(value.driver.windows)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function DriverPanel({ network, fleet, onMessage }) {
  const { online } = useConnectivity();
  const [session, setSession] = useState(savedSession);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [direction, setDirection] = useState(1);
  const [lastFix, setLastFix] = useState(null);
  const watch = useRef(null);
  const pendingStop = useRef(false);
  const stopRequest = useRef(null);
  const generation = useRef(0),
    sessionRef = useRef(session),
    uploading = useRef(false),
    lastSent = useRef(0);
  sessionRef.current = session;
  function persist(value) {
    setSession(value);
    try {
      if (value) sessionStorage.setItem('cerca.driver', JSON.stringify(value));
      else sessionStorage.removeItem('cerca.driver');
    } catch {
      /* Keep the current session in memory when storage is denied. */
    }
  }
  async function clearWatch() {
    generation.current++;
    const current = watch.current;
    watch.current = null;
    if (current?.web !== undefined) navigator.geolocation.clearWatch(current.web);
    if (current?.native) await Geolocation.clearWatch({ id: current.native }).catch(() => {});
  }
  function syncStop(current) {
    if (stopRequest.current) return stopRequest.current;
    stopRequest.current = api('/driver/service', { token: current.token, body: { active: false } })
      .then(() => {
        pendingStop.current = false;
      })
      .finally(() => {
        stopRequest.current = null;
      });
    return stopRequest.current;
  }
  useEffect(() => {
    const current = sessionRef.current;
    if (!online && current?.driver.active) {
      pendingStop.current = true;
      void clearWatch();
      persist({ ...current, driver: { ...current.driver, active: false } });
      setError(
        'Sin internet: se detuvo el GPS en este teléfono. La combi desaparecerá del mapa en un máximo de 45 segundos. Al volver la señal, activa tu servicio de nuevo.'
      );
    } else if (online && pendingStop.current && current) {
      void syncStop(current).catch(() => {});
    }
  }, [online]);
  useEffect(() => {
    const token = sessionRef.current?.token;
    if (token)
      void api('/driver/profile', { token })
        .then(async (driver) => {
          const current = sessionRef.current;
          if (current?.token !== token) return;
          persist({ ...current, driver });

          // Recargar la app ya no desactiva el servicio. Antes sí lo hacía, y
          // como el GPS solo corre con la pantalla abierta, bastaba con que el
          // sistema matara la app para que la combi desapareciera del mapa sin
          // avisar. Ahora se reanuda el observador y se pide un punto nuevo.
          if (!driver.active) return;
          if (!online) {
            setError(
              'Tu servicio sigue activo, pero este dispositivo está sin internet. La combi desaparecerá del mapa si la señal no vuelve pronto.'
            );
            return;
          }
          try {
            await startWatch();
            // No hace falta mandar un punto aquí: el observador entrega uno en
            // cuanto tenga GPS y `publish` lo envía. Basta con reengancharlo.
            // Antes se mandaba la última posición guardada en el navegador, que
            // puede ser anterior a la señal que el servidor ya tenía, y por
            // eso la rechazaba con "anterior a la última señal".
            setError('');
            onMessage('Seguimos compartiendo tu ubicación.');
          } catch (reason) {
            // Si no se puede reanudar, se dice claro. Antes el chofer solo
            // veía que su combi había desaparecido, sin explicación.
            setError(
              reason instanceof Error
                ? `Tu servicio sigue activo pero no pudimos retomar el GPS en este dispositivo: ${reason.message}`
                : 'Tu servicio sigue activo, pero no pudimos retomar el GPS. Revisa el permiso de ubicación.'
            );
          }
        })
        .catch((reason) => {
          if (reason instanceof ConnectionError && reason.status === 401) persist(null);
        });
    return () => {
      void clearWatch();
    };
  }, []);
  useEffect(() => {
    if (!session?.driver.active) return;
    const stillActive = fleet.vehicles.some((vehicle) => vehicle.id === session.driver.id);
    if (fleet.status === 'connected' && !stillActive && Date.now() - lastSent.current > 45_000) {
      void clearWatch();
      persist({ ...session, driver: { ...session.driver, active: false } });
      setError(
        'Se detuvo el servicio por falta de señal o fin de horario. Vuelve a activarlo cuando estés listo.'
      );
    }
  }, [fleet.snapshot]);
  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const value = await api('/auth/login', { body: { email, password } });
      persist(value);
      setLastFix(null);
      setPassword('');
      onMessage('Sesión de chofer iniciada. Tu servicio comienza cuando lo actives.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }
  function locationFix(position) {
    return {
      point: [position.coords.latitude, position.coords.longitude],
      accuracy: position.coords.accuracy,
      speed: position.coords.speed,
      timestamp: position.timestamp,
      direction,
    };
  }
  async function currentFix() {
    if (Capacitor.isNativePlatform()) {
      await Geolocation.requestPermissions();
      return locationFix(
        await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0,
        })
      );
    }
    return locationFix(
      await new Promise((resolve, reject) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15_000,
              maximumAge: 0,
            })
          : reject(new Error('Sin ubicación'))
      )
    );
  }
  async function publish(position, run) {
    const current = sessionRef.current;
    if (
      !current ||
      run !== generation.current ||
      uploading.current ||
      Date.now() - lastSent.current < 5000
    )
      return;
    uploading.current = true;
    const fix = locationFix(position);
    setLastFix(fix);
    lastSent.current = Date.now();
    try {
      const driver = await api('/driver/location', {
        token: current.token,
        body: fix,
      });
      if (run === generation.current) {
        persist({ ...current, driver });
        setError('');
      }
    } catch (reason) {
      if (run !== generation.current) return;
      // Tras recargar, el navegador entrega primero la posición que tenía
      // cacheada, que puede ser anterior a la última señal ya guardada. El
      // servidor la rechaza con un mensaje de "anterior a la última señal" y el
      // observador entrega una fresca justo después, así que no es un fallo que
      // deba mostrarse al chofer.
      const senalCacheada =
        reason instanceof Error && /anterior a la última señal/i.test(reason.message);
      if (!senalCacheada)
        setError(reason instanceof Error ? reason.message : 'No pudimos compartir la ubicación.');
      if (reason instanceof ConnectionError && [401, 403, 409].includes(reason.status)) {
        await clearWatch();
        if (reason.status === 401) persist(null);
        else persist({ ...current, driver: { ...current.driver, active: false } });
      }
    } finally {
      uploading.current = false;
    }
  }
  /**
   * Arranca el observador de GPS. Se separa de `toggle` porque al montar la
   * pantalla hay que poder reanudarlo sin pasar por el botón: recargar la app
   * no debe equivaler a desactivar el servicio.
   */
  async function startWatch() {
    const run = generation.current;
    if (Capacitor.isNativePlatform()) {
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 15_000, minimumUpdateInterval: 5000 },
        (position, reason) => {
          if (position) void publish(position, run);
          if (reason && run === generation.current)
            setError('No llega una señal GPS reciente. Comprueba el permiso y tu ubicación.');
        }
      );
      if (run !== generation.current) {
        await Geolocation.clearWatch({ id });
        return;
      }
      watch.current = { native: id };
    } else
      watch.current = {
        web: navigator.geolocation.watchPosition(
          (position) => {
            void publish(position, run);
          },
          () => setError('No llega una señal GPS reciente. Comprueba el permiso y tu ubicación.'),
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 15_000 }
        ),
      };
  }
  async function toggle() {
    if (!session) return;
    if (!online) {
      setError('Necesitas internet para activar el servicio.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await clearWatch();
      if (pendingStop.current) {
        await syncStop(session);
      }
      if (session.driver.active) {
        const driver = await api('/driver/service', {
          token: session.token,
          body: { active: false },
        });
        persist({ ...session, driver });
        onMessage('Servicio desactivado. Tu ubicación ya no se comparte.');
        return;
      }
      const fix = await currentFix();
      setLastFix(fix);
      const driver = await api('/driver/service', {
        token: session.token,
        body: { ...fix, active: true },
      });
      lastSent.current = Date.now();
      persist({ ...session, driver });
      await startWatch();
      onMessage('Servicio activado. Los pasajeros ya pueden ver tu combi.');
    } catch (reason) {
      await clearWatch();
      await api('/driver/service', { token: session.token, body: { active: false } }).catch(
        () => {}
      );
      persist({ ...session, driver: { ...session.driver, active: false } });
      setError(
        reason instanceof Error
          ? reason.message
          : 'Permite la ubicación precisa para activar el servicio.'
      );
    } finally {
      setBusy(false);
    }
  }
  // El chofer cambia su propia contraseña. Antes solo un administrador podía
  // restablecerla, así que quien viera la contraseña inicial no tenía forma
  // de cambiarla por su cuenta.
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const [claveActual, setClaveActual] = useState('');
  const [claveNueva, setClaveNueva] = useState('');
  const [mensajeClave, setMensajeClave] = useState('');
  async function cambiarClave(event) {
    event.preventDefault();
    setBusy(true);
    setMensajeClave('');
    try {
      await api('/driver/password', {
        token: session.token,
        body: { current: claveActual, next: claveNueva },
      });
      setClaveActual('');
      setClaveNueva('');
      setCambiandoClave(false);
      // El aviso va fuera del formulario porque este se cierra al guardar; si
      // se quedara dentro, el chofer nunca lo vería.
      onMessage('Tu contraseña quedó actualizada. Cierra sesión en los demás dispositivos.');
    } catch (reason) {
      setMensajeClave(reason instanceof Error ? reason.message : 'No pudimos cambiarla.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!session) return;
    setBusy(true);
    await clearWatch();
    try {
      await api('/auth/logout', { token: session.token, body: {} });
      persist(null);
      setLastFix(null);
    } catch (reason) {
      persist(null);
      onMessage(
        'La ubicación se detuvo en este dispositivo. Sin señal reciente, tu combi desaparecerá del mapa en un máximo de 45 segundos.'
      );
    } finally {
      setBusy(false);
    }
  }
  const route = network.routes.find((route) => route.id === session?.driver.routeId);
  const position = lastFix ?? session?.driver.location;
  const recent =
    position &&
    fleet.now - position.timestamp <= 45_000 &&
    position.timestamp <= fleet.now + 15_000;
  const where = recent ? serviceZoneStatus(position.point, network) : null;
  return (
    <section className="driver-panel" aria-label="Acceso de chofer">
      <OfflineNotice />
      <div className="section-heading">
        <div>
          <h2>{session ? `Hola, ${session.driver.name.split(' ')[0]}` : 'Tu ruta empieza aquí'}</h2>
          <p>
            {session
              ? 'Controla cuándo está disponible tu combi.'
              : 'Acceso exclusivo para choferes con cuenta asignada.'}
          </p>
        </div>
        <Icon name="user" />
      </div>
      {!session ? (
        <form className="driver-login" onSubmit={login}>
          <label htmlFor="driver-email">Correo del chofer</label>
          <input
            id="driver-email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="driver-password">Contraseña</label>
          <input
            id="driver-password"
            type="password"
            minLength={12}
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="primary-button" disabled={busy || !online} type="submit">
            {busy ? 'Iniciando sesión…' : 'Ingresar como chofer'}
            <Icon name={busy ? 'loading' : 'arrow-right'} />
          </button>
          <p className="walking-note">
            Tu cuenta, ruta y horario los asigna la persona responsable del servicio. Los pasajeros
            pueden usar Las Palmas Rutas sin registrarse.
          </p>
          <a className="walking-note" href="#/gestion">
            Acceso de administración
          </a>
        </form>
      ) : (
        <>
          <div className="driver-assignment" style={{ '--route-color': route?.color ?? '#173e31' }}>
            <span className="arrival-route">
              <Icon name="bus-front" />
              {session.driver.routeId}
            </span>
            <div>
              <strong>{route?.name ?? 'Ruta asignada'}</strong>
              <small>Unidad {session.driver.unit}</small>
            </div>
          </div>
          <div className="service-schedule">
            <Icon name="clock-3" />
            <div>
              <strong>Tu horario asignado</strong>
              <p>{scheduleLabel(session.driver.windows)}</p>
              <small>Hora de Lázaro Cárdenas</small>
            </div>
          </div>
          <label className="control-label" htmlFor="driver-direction">
            SENTIDO DE SALIDA
          </label>
          <select
            id="driver-direction"
            disabled={session.driver.active || busy}
            value={direction}
            onChange={(event) => setDirection(Number(event.target.value))}
          >
            <option value={1}>
              Ida · hacia{' '}
              {network.stops
                .find((stop) => stop.id === route?.stops.at(-1))
                ?.name.replace(' · demo', '')}
            </option>
            {route?.bidirectional && (
              <option value={-1}>
                Regreso · hacia{' '}
                {network.stops
                  .find((stop) => stop.id === route.stops[0])
                  ?.name.replace(' · demo', '')}
              </option>
            )}
          </select>
          <div className={`driver-service-state ${session.driver.active ? 'active' : ''}`}>
            <span className="tiny-dot" />
            <strong>
              {session.driver.active ? 'Tu combi está en servicio' : 'Tu servicio está desactivado'}
            </strong>
            <p>
              {session.driver.active
                ? 'Tu ubicación se comparte con los pasajeros.'
                : 'Tu ubicación no se muestra en el mapa.'}
            </p>
          </div>
          <div
            className={`driver-zone-status ${where ? (where.inZone ? 'inside' : 'outside') : ''}`}
            role="status"
            data-testid="driver-zone"
          >
            <Icon name="map-pin" />
            <div>
              <strong>
                {where
                  ? where.inZone
                    ? 'Estás dentro de la zona de servicio'
                    : 'Estás fuera de la zona de servicio'
                  : 'Ubicación por confirmar'}
              </strong>
              <p>
                {where
                  ? `${where.name} · a ${shortDistance(where.distanceMeters)} del centro.`
                  : 'Al activar tu servicio comprobaremos tu ubicación con el GPS.'}
              </p>
              {where && !where.inZone && (
                <p>
                  Tu combi no se muestra a los pasajeros y no se calculan llegadas. Acércate a la
                  zona para activar tu servicio.
                </p>
              )}
            </div>
          </div>
          <button
            className={`primary-button service-toggle ${session.driver.active ? 'pause' : ''}`}
            disabled={
              busy ||
              !online ||
              (!session.driver.active && !serviceEnd(session.driver.windows, fleet.now))
            }
            onClick={() => {
              void toggle();
            }}
          >
            {busy
              ? 'Actualizando servicio…'
              : session.driver.active
                ? 'Desactivar servicio'
                : 'Activar mi servicio'}
            <Icon name={busy ? 'loading' : 'power'} />
          </button>
          {!session.driver.active && !serviceEnd(session.driver.windows, fleet.now) && (
            <p className="walking-note">Podrás activar tu servicio dentro del horario asignado.</p>
          )}
          <p className="walking-note">
            Mantén la app abierta para compartir tu ubicación. Si no llega una señal reciente, tu
            combi deja de aparecer como disponible.
          </p>
          {!cambiandoClave ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setCambiandoClave(true);
                setMensajeClave('');
              }}
            >
              <Icon name="key" />
              Cambiar mi contraseña
            </button>
          ) : (
            <form className="driver-password" onSubmit={cambiarClave}>
              <h3>Cambiar contraseña</h3>
              <label>
                Tu contraseña actual
                <input
                  type="password"
                  value={claveActual}
                  onChange={(e) => setClaveActual(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                Contraseña nueva
                <input
                  type="password"
                  value={claveNueva}
                  onChange={(e) => setClaveNueva(e.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
                <small>Necesita al menos 12 caracteres.</small>
              </label>
              {mensajeClave && <p className="driver-note">{mensajeClave}</p>}
              <button type="submit" className="primary-button" disabled={busy}>
                Guardar contraseña
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCambiandoClave(false);
                  setClaveActual('');
                  setClaveNueva('');
                  setMensajeClave('');
                }}
              >
                Cancelar
              </button>
            </form>
          )}
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              void logout();
            }}
          >
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </>
      )}
      {error && (
        <p className="driver-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
