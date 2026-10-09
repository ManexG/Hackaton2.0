import { createContext, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
const Connectivity = createContext({ online: true, active: true });
export function ConnectivityProvider({ children }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [active, setActive] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const visibility = () => setActive(document.visibilityState !== 'hidden');
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    document.addEventListener('visibilitychange', visibility);
    const native = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', ({ isActive }) => setActive(isActive))
      : null;
    return () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      document.removeEventListener('visibilitychange', visibility);
      native?.then((handle) => handle.remove());
    };
  }, []);
  return <Connectivity.Provider value={{ online, active }}>{children}</Connectivity.Provider>;
}
export const useConnectivity = () => useContext(Connectivity);
export function OfflineNotice() {
  const { online } = useConnectivity();
  if (online) return null;
  return (
    <aside className="offline-notice" role="status">
      <strong>Sin internet · consulta guardada</strong>
      <p>
        Puedes ver el mapa, calles, semáforos y rutas. Los reportes se guardan para enviar después.
        Las combis en vivo, llegadas, cuentas y búsqueda en línea requieren conexión.
      </p>
    </aside>
  );
}
