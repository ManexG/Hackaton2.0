/**
 * ESQUELETO — Vista de la avenida con las combis en vivo.
 *
 * Depende de los datos de rutas y paradas que tú vas a proporcionar.
 * El backend ya acepta todo esto:
 *   GET  /api/rutas
 *   GET  /api/rutas/:id/paradas
 *   GET  /api/vehiculos/activos
 *   GET  /api/paradas/qr/:codigo
 *
 * Para el mapa se usa Leaflet (ya instalado). Si quieren una dependencia más
 * rica para rutas coloreadas, la decisión es suya; la capa de datos ya existe.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, LocateFixed } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, CATEGORIAS_POR_CLAVE, esc } from '../api.js';

const CENTRO_LC = [17.958, -102.21];

export function Avenida() {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const capaRutas = useRef(null);
  const capaParadas = useRef(null);
  const capaCombis = useRef(null);

  const [rutas, setRutas] = useState([]);
  const [combis, setCombis] = useState([]);
  const [paradas, setParadas] = useState([]);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo || nodo.dataset.iniciado) return;
    nodo.dataset.iniciado = '1';

    const m = L.map(nodo).setView(CENTRO_LC, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    capaRutas.current = L.layerGroup().addTo(m);
    capaParadas.current = L.layerGroup().addTo(m);
    capaCombis.current = L.layerGroup().addTo(m);
    mapa.current = m;

    return () => {
      m.remove();
      delete nodo.dataset.iniciado;
    };
  }, []);

  useEffect(() => {
    api
      .rutas()
      .then((rs) => {
        setRutas(rs);
        return Promise.all(rs.map((r) => api.paradasDeRuta(r.id).then((p) => [r, p])));
      })
      .then((pares) => setParadas(pares.flatMap(([, ps]) => ps)))
      .catch(() => {});
  }, []);

  // Dibujar la línea de cada ruta con su color
  useEffect(() => {
    if (!capaRutas.current) return;
    capaRutas.current.clearLayers();
    for (const r of rutas) {
      if (!r.trazo) continue; // sin trazo no se dibuja: se avisará en la interfaz
      let puntos;
      try {
        puntos = JSON.parse(r.trazo);
      } catch {
        continue;
      }
      L.polyline(puntos, { color: r.color, weight: 5, opacity: 0.85 }).addTo(capaRutas.current);
    }
  }, [rutas]);

  // Paradas
  useEffect(() => {
    if (!capaParadas.current) return;
    capaParadas.current.clearLayers();
    for (const p of paradas) {
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', iconSize: [14, 14], html: '<span class="marker-parada"></span>' }),
      })
        .bindPopup(`<b>${esc(p.nombre)}</b><br>Código QR: ${esc(p.qr || 'sin código')}`)
        .addTo(capaParadas.current);
    }
  }, [paradas]);

  // Combis en vivo: consultar cada 5 segundos
  useEffect(() => {
    const refrescar = async () => {
      try {
        const activos = await api.vehiculosActivos();
        setCombis(activos);
        if (!capaCombis.current) return;
        capaCombis.current.clearLayers();
        for (const v of activos) {
          if (!v.ultima_posicion) continue;
          const pos = JSON.parse(v.ultima_posicion);
          const color = v.color || '#238361';
          // Burbuja con el número de la ruta: se identifica la combi sin
          // tocarla. Sigue el patrón del mapa del equipo de diseño.
          const glifo = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3.5" fill="#fff"/><rect x="6.5" y="6" width="11" height="6" rx="1.2" fill="${color}"/><path d="M12 6v6" stroke="#fff" stroke-width="1.6"/><circle cx="8" cy="19.4" r="1.7" fill="${color}"/><circle cx="16" cy="19.4" r="1.7" fill="${color}"/><path d="M8.5 21.5v1.5M15.5 21.5v1.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
          L.marker([pos.lat, pos.lng], {
            icon: L.divIcon({
              className: 'marker-combi',
              // Ancho fijo: Leaflet impone el tamaño del icono en línea, así que
              // la burbuja no puede crecer con el texto. 126px es lo que entra
              // sin recortar; el nombre completo sale en el title y el popup.
              iconSize: [126, 38],
              iconAnchor: [63, 19],
              html: `<span class="burbuja-combi" style="--combi-color:${color}" title="${esc(v.nombre)}">${glifo}<b>${esc(v.nombre)}</b></span>`,
            }),
          })
            .bindPopup(`<b>${esc(v.nombre)}</b><br>${esc(v.ruta || 'Sin ruta')}<br>${esc(v.sentido || '')}`)
            .addTo(capaCombis.current);
        }
      } catch {
        /* sin conexión: se conserva lo último que se pintó */
      }
    };
    refrescar();
    const t = setInterval(refrescar, 10000); // mismo intervalo que el chofer envía
    return () => clearInterval(t);
  }, []);

  const ultimo = combis.map((c) => c.ultima_ts).filter(Boolean).sort().at(-1);

  return (
    <section data-testid="avenida">
      {/* DISEÑA:
          - Leyenda con una línea por ruta y su color (el backend ya trae el color)
          - Botón "Centrar" para volver a la zona piloto
          - Indicador discreto de "última actualización hace X"
          - Si no hay combis reportando, mostrarlo con claridad en vez de un mapa vacío:
            la propuesta de Alan pide que la interfaz diga cuándo faltan datos */}

      {/* El mapa ocupa el alto de la pantalla; sin bordes duros para no
          recortar los controles de zoom. */}
      <div ref={contenedor} style={{ height: '70vh' }} />

      <button onClick={() => mapa.current?.setView(CENTRO_LC, 15)}>
        <LocateFixed /> Centrar en la zona piloto
      </button>

      <ul data-testid="leyenda-rutas">
        {rutas.map((r) => (
          <li key={r.id}>
            {/* El color va en el punto, no en el texto: el nombre siempre
                mantiene el contraste del tema y se lee igual de rápido. */}
            <i aria-hidden="true" style={{ background: r.color }} />
            {r.nombre} {!r.trazo && '(sin trazo todavía)'}
          </li>
        ))}
      </ul>

      <p data-testid="estado-combis">
        {(() => {
          const n = combis.filter((c) => c.ultima_posicion).length;
          return `${n} ${n === 1 ? 'combi reporta' : 'combis reportan'}`;
        })()}
        {ultimo && ` · última señal ${new Date(ultimo).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`}
      </p>
    </section>
  );
}