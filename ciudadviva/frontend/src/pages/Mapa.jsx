/**
 * ESQUELETO — Mapa. Leaflet con los reportes georeferenciados.
 * El marcado de puntos con latido (.punto-radar en index.css) ya está resuelto.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, MapPin } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, CATEGORIAS_POR_CLAVE, esc } from '../api.js';

const CENTRO_LC = [17.958, -102.21]; // Lázaro Cárdenas

const color = (clave) => CATEGORIAS_POR_CLAVE[clave]?.color || '#8e9786';

export function Mapa() {
  const contenedor = useRef(null);
  const capa = useRef(null);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo || nodo.dataset.iniciado) return;
    nodo.dataset.iniciado = '1';

    const mapa = L.map(nodo).setView(CENTRO_LC, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
    capa.current = L.layerGroup().addTo(mapa);

    return () => {
      mapa.remove();
      delete nodo.dataset.iniciado;
    };
  }, []);

  useEffect(() => {
    if (!capa.current) return;
    api
      .reportes({ limit: 200 })
      .then((reportes) => {
        capa.current.clearLayers();
        for (const r of reportes) {
          L.marker([r.lat, r.lng], {
            icon: L.divIcon({
              className: '',
              iconSize: [12, 12],
              html: `<span class="punto-radar" style="background:${color(r.categoria)}"></span>`,
            }),
          })
            .bindPopup(`<b>${esc(r.colonia || 'Sin colonia')}</b><br>${esc(r.estado)}<br>Apoyos: ${r.votos}`)
            .addTo(capa.current);
        }
      })
      .catch(() => {});
  }, []);

  /**
   * Descarga los tiles de la zona para que el mapa abra sin señal.
   * Útil el día del demo: si el lugar no tiene internet, el mapa ya está guardado.
   */
  const descargarMapa = async () => {
    setDescargando(true);
    const BBOX = { sur: 17.88, norte: 18.06, oeste: -102.32, este: -102.06 };
    const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
    const lat2y = (lat, z) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
    for (const z of [13, 14, 15]) {
      for (let x = lon2x(BBOX.oeste, z); x <= lon2x(BBOX.este, z); x++) {
        for (let y = lat2y(BBOX.norte, z); y <= lat2y(BBOX.sur, z); y++) {
          fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`).catch(() => {});
        }
      }
    }
    setDescargando(false);
    localStorage.setItem('lcalerta_tiles_ok', '1');
  };

  return (
    <section data-testid="mapa">
      {/* DISEÑA: botón "Descargar mapa para usar sin señal".
          Explica por qué sirve: en la colonia no hay internet. */}
      <button onClick={descargarMapa} disabled={descargando}>
        <Download /> {descargando ? 'Descargando mapas...' : 'Descargar mapa sin señal'}
      </button>

      {/* DISEÑA: leyenda de categorías (colores + íconos) */}
      <div ref={contenedor} style={{ height: '62vh' }} />
    </section>
  );
}