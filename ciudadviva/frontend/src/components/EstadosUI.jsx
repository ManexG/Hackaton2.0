/**
 * ESQUELETO — estructura lista, diseño del equipo.
 * Estos tres son estados que TODA pantalla con datos necesita.
 */
import { Inbox, RefreshCw, WifiOff } from 'lucide-react';

/** Cargando con esqueleto (ya existe la clase .esqueleto en index.css). */
export function Cargando({ filas = 3 }) {
  /* DISEÑA: esqueletos que respeten la altura real de la tarjeta,
     para que la página no salte cuando lleguen los datos. */
  return (
    <div data-testid="cargando" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="esqueleto" style={{ height: 120, marginBottom: 16 }} />
      ))}
    </div>
  );
}

/** Sin resultados / sin datos todavía. */
export function Vacio({ icono: Icono, titulo, texto, accion }) {
  /* DISEÑA: estado vacío. Es la primera pantalla que verá quien abre la app
     en una colonia sin reportes: debe explicar qué hacer, no solo decir "nada". */
  return (
    <div data-testid="vacio" className="text-center">
      {Icono ? <Icono size={48} /> : <Inbox size={48} />}
      <p>{titulo}</p>
      {texto && <p>{texto}</p>}
      {accion}
    </div>
  );
}

/** Error: red caída, servidor sin respuesta, o fallo concreto de la API. */
export function ErrorBox({ error, alReintentar }) {
  /* DISEÑA: mensaje claro + botón de reintentar.
     Si no hay señal debe decir explícitamente "sin señal" y explicar que
     los reportes se guardan igual en el teléfono. */
  const sinRed = !navigator.onLine;
  return (
    <div role="alert" data-testid="error">
      {sinRed ? <WifiOff /> : null}
      <p>{sinRed ? 'Sin conexión. Puedes seguir reportando: se guardará en tu teléfono.' : error?.message || 'Algo salió mal'}</p>
      {alReintentar && (
        <button onClick={alReintentar}>
          <RefreshCw /> Reintentar
        </button>
      )}
    </div>
  );
}