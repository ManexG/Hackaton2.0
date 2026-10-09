/**
 * ESQUELETO — Estadísticas de la ciudad (/estadisticas).
 * Sirven para el jurado y para el gobierno: el dato duro del proyecto.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Cargando } from '../components/EstadosUI.jsx';

export function Estadisticas() {
  const [datos, setDatos] = useState(null);
  const error = useRef(false);

  useEffect(() => {
    api.estadisticas().then(setDatos).catch(() => (error.current = true));
  }, []);

  if (!datos) return <Cargando filas={2} />;

  /* NOTA PARA EL EQUIPO:
     La versión actual usa Chart.js con 4 gráficas (dona/pie/bar/línea).
     Chart.js NO está instalado aquí a propósito: elegir la librería de gráficas
     es parte de su trabajo. Solo deben respetar:
     - fondo oscuro, texto legible
     - que se vean bien en móvil (alturasalyzed automáticamente)
     - datos exactos: porCat, porColonia, porDia, estados
  */
  return (
    <section data-testid="estadisticas">
      {/* DISEÑA: 4 gráficas con estos datos:
          - porCat     [{ categoria, n }]  -> qué falla más
          - porColonia [{ colonia, n }]    -> dónde se concentra
          - porDia     [{ d, n }]          -> ritmo de reportes
          - estados    [{ estado, n }]     -> cuántos ya se resolvieron
          Ese último es el que demuestra que el canal sirve. */}
      <pre data-testid="datos-crudos">{JSON.stringify(datos, null, 2)}</pre>
    </section>
  );
}