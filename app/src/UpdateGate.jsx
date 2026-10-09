import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { APP_VERSION, compareVersions, validRelease } from './version.js';
import { apiBase } from './liveApi.js';
import { useConnectivity } from './connectivity.jsx';
import { Icon } from './Icon.jsx';
import { NativeUpdate } from './nativeUpdate.js';
const KEY = 'las-palmas.latest-release';
function remembered() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return validRelease(value) ? value : null;
  } catch {
    return null;
  }
}
export function UpdateGate({ children }) {
  const [release, setRelease] = useState(remembered);
  const [version, setVersion] = useState(APP_VERSION);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [started, setStarted] = useState(!navigator.onLine);
  const [download, setDownload] = useState(null);
  const [ready, setReady] = useState(false);
  const [nativeBusy, setNativeBusy] = useState(false);
  const { online, active } = useConnectivity();
  const last = useRef(0),
    pending = useRef(false);
  const targetVersion = Capacitor.isNativePlatform()
    ? release?.minimumVersion
    : release?.minimumWebVersion || release?.minimumVersion;
  const blocked = release && compareVersions(version, targetVersion) < 0;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    const listener = NativeUpdate.addListener('progress', (value) => {
      if (!disposed) setDownload(value);
    });
    return () => {
      disposed = true;
      void listener.then((handle) => handle.remove());
    };
  }, []);
  useEffect(() => {
    if (!blocked || !Capacitor.isNativePlatform()) return;
    let disposed = false;
    setReady(false);
    NativeUpdate.status({ version: release.version })
      .then((value) => {
        if (!disposed) setReady(value.ready);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [blocked, release?.version]);
  async function updateNative() {
    setNativeBusy(true);
    setMessage('');
    try {
      if (!ready) {
        await NativeUpdate.download({ version: release.version, url: release.downloadUrl });
        setReady(true);
      }
      setMessage(
        'Confirma la instalación en Android. Si pide permiso, activa «Permitir desde esta fuente» y regresa.'
      );
      await NativeUpdate.install({ version: release.version });
    } catch (error) {
      setMessage(error?.message || 'No pudimos actualizar. Revisa la conexión e intenta de nuevo.');
    } finally {
      setNativeBusy(false);
      setDownload(null);
    }
  }
  const check = useCallback(async (force = false) => {
    if (!navigator.onLine || pending.current || (!force && Date.now() - last.current < 60_000))
      return;
    pending.current = true;
    last.current = Date.now();
    setChecking(true);
    try {
      const response = await fetch((apiBase || '/api') + '/version', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      const data = response.ok ? await response.json() : null;
      if (!validRelease(data)) throw new Error();
      setRelease((previous) =>
        previous && compareVersions(previous.version, data.version) > 0 ? previous : data
      );
      const previous = remembered();
      if (!previous || compareVersions(previous.version, data.version) <= 0) {
        try {
          localStorage.setItem(KEY, JSON.stringify(data));
        } catch {
          /* Current check still applies. */
        }
      }
      setMessage('');
    } catch {
      setMessage('No pudimos comprobar la versión. Revisa tu conexión.');
    } finally {
      pending.current = false;
      setChecking(false);
      setStarted(true);
    }
  }, []);
  useEffect(() => {
    if (Capacitor.isNativePlatform())
      App.getInfo()
        .then((info) => {
          if (compareVersions(info.version, APP_VERSION) !== null) setVersion(info.version);
        })
        .catch(() => {});
  }, []);
  useEffect(() => {
    if (!online) setStarted(true);
    if (!online || !active) return;
    void check();
    const timer = setInterval(() => void check(), 10 * 60_000);
    const required = (event) => {
      if (validRelease(event.detail)) {
        setRelease(event.detail);
        try {
          localStorage.setItem(KEY, JSON.stringify(event.detail));
        } catch {
          /* Cache optional. */
        }
      } else void check(true);
    };
    window.addEventListener('las-palmas-update-required', required);
    return () => {
      clearInterval(timer);
      window.removeEventListener('las-palmas-update-required', required);
    };
  }, [online, active, check]);
  async function updateWeb() {
    setChecking(true);
    setMessage('Descargando la nueva versión…');
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.update();
        const installing = registration.installing;
        if (installing)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error()), 20000);
            installing.addEventListener('statechange', () => {
              if (installing.state === 'activated') {
                clearTimeout(timer);
                resolve();
              }
              if (installing.state === 'redundant') {
                clearTimeout(timer);
                reject(new Error());
              }
            });
          });
      }
      const html = await fetch(location.pathname + '?version=' + targetVersion, {
        cache: 'reload',
        signal: AbortSignal.timeout(15000),
      });
      const body = await html.text();
      if (!html.ok || !body.includes(`name="app-version" content="${targetVersion}"`))
        throw new Error();
      location.reload();
    } catch {
      setMessage(
        'La actualización todavía se está publicando o no hay señal. Intenta de nuevo en unos momentos.'
      );
      setChecking(false);
    }
  }
  if (!started && !blocked)
    return (
      <div className="boot" role="status">
        Comprobando la versión de OptiRouteLZC…
      </div>
    );
  if (!blocked) return children;
  return (
    <main className="update-required" aria-labelledby="update-title">
      <img src="./brand/optiroutelzc-logo.png" alt="OptiRouteLZC" />
      <h1 id="update-title">Actualiza para continuar</h1>
      <p>
        Tu versión es {version}. Está disponible la versión {release.version}.
      </p>
      <h2>¿Qué cambió?</h2>
      <ul>
        {release.notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
      {!online && !ready && (
        <p role="status">
          Necesitas internet para descargar la actualización. El aviso se conservará aunque cierres
          la app.
        </p>
      )}
      {Capacitor.isNativePlatform() ? (
        <>
          <button
            className="primary-button"
            disabled={nativeBusy || (!online && !ready)}
            onClick={updateNative}
          >
            <Icon name={nativeBusy ? 'loading' : 'arrow-right'} />
            {nativeBusy ? 'Actualizando…' : ready ? 'Instalar actualización' : 'Actualizar ahora'}
          </button>
          {download && (
            <div className="download-progress" role="status">
              <p>
                {download.stage === 'checking'
                  ? 'Preparando la descarga…'
                  : download.stage === 'verifying'
                    ? 'Verificando la actualización…'
                    : download.stage === 'ready'
                      ? 'Descarga lista. Abriendo instalación…'
                      : `Descargando${download.percent >= 0 ? ` · ${download.percent}%` : '…'}`}
              </p>
              <progress
                max="100"
                value={download.percent >= 0 ? download.percent : undefined}
                aria-label="Descarga de actualización"
              />
              {download.stage !== 'ready' && (
                <button className="secondary-button" onClick={() => NativeUpdate.cancel()}>
                  Cancelar descarga
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <button className="primary-button" disabled={!online || checking} onClick={updateWeb}>
          <Icon name={checking ? 'loading' : 'arrow-right'} />
          {checking ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
      )}
      <p>
        {Capacitor.isNativePlatform()
          ? 'Android te pedirá confirmar la instalación. Tus datos y tu cuenta se conservan.'
          : 'Se actualizará esta página sin borrar tus reportes guardados.'}
      </p>
      {!Capacitor.isNativePlatform() && (
        <a href={release.releaseUrl} target="_blank" rel="noopener">
          Ver esta versión en GitHub
        </a>
      )}
      <button
        className="secondary-button"
        disabled={!online || checking || nativeBusy}
        onClick={() => check(true)}
      >
        Comprobar de nuevo
      </button>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
