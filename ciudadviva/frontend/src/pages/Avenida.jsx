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
import { Download, LocateFixed, Bus } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, CATEGORIAS_POR_CLAVE, esc } from '../api.js';

const CENTRO_LC = [17.958, -102.21];

// "a 210 m" o "a 325 km", para que el número se lea de un vistazo.
const distanciaCorta = (m) => (m < 1000 ? `${Math.round(m)} m` : `${Math.round(m / 100) / 10} km`);

export function Avenida() {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const capaRutas = useRef(null);
  const capaParadas = useRef(null);
  const capaCombis = useRef(null);

  const [rutas, setRutas] = useState([]);
  const [combis, setCombis] = useState([]);
  const [paradas, setParadas] = useState([]);
  const [zona, setZona] = useState(null);

  // La zona piloto la configura el ayuntamiento desde /admin. Mientras no llegue
  // se usa el centro fijo, solo como respaldo.
  useEffect(() => {
    api
      .zona()
      .then((z) => {
        if (!z) return;
        setZona(z);
        mapa.current?.setView([z.lat, z.lng], 14);
      })
      .catch(() => {});
  }, []);

  // "Centrar" usa la zona real del servidor.
  const centrar = () => {
    const destino = zona ? [zona.lat, zona.lng] : CENTRO_LC;
    mapa.current?.setView(destino, zona ? 14 : 15);
  };

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

  // El círculo de la zona piloto. Línea punteada y relleno muy tenue para que
  // diga dónde acaba la zona sin tapar las rutas.
  useEffect(() => {
    if (!zona || !mapa.current) return;
    const circulo = L.circle([zona.lat, zona.lng], {
      radius: zona.radio_m ?? 1500,
      color: '#174b3b',
      weight: 2,
      dashArray: '6 6',
      fillColor: '#174b3b',
      fillOpacity: 0.04,
      interactive: false,
    }).addTo(mapa.current);
    return () => circulo.remove();
  }, [zona]);

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
          // La API ya devuelve lat/lng sueltos (y filtró las señales viejas).
          const color = v.color || '#238361';
          // Burbuja con el número de la ruta: se identifica la combi sin
          // tocarla. Sigue el patrón del mapa del equipo de diseño.
          const glifo = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3.5" fill="#fff"/><rect x="6.5" y="6" width="11" height="6" rx="1.2" fill="${color}"/><path d="M12 6v6" stroke="#fff" stroke-width="1.6"/><circle cx="8" cy="19.4" r="1.7" fill="${color}"/><circle cx="16" cy="19.4" r="1.7" fill="${color}"/><path d="M8.5 21.5v1.5M15.5 21.5v1.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
          L.marker([v.lat, v.lng], {
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

      <button onClick={centrar}>
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

      {/* Lista de combis en lugar de un simple contador. Antes solo decía
          "1 combi reporta", y si esa combi estaba fuera del área visible del
          mapa no había forma de saber que existía. Las señales viejas ya
          llegan filtradas: desaparecen solas sin dejar rastro. */}
      <section data-testid="combis-vivas">
        <h2>
          <Bus /> Combis reportando
          {zona ? ` · ${zona.nombre}` : ''}
        </h2>
        {combis.length === 0 ? (
          <p className="aviso">Ahora mismo no hay combis reportando.</p>
        ) : (
          <ul className="lista-combis">
            {combis.map((c) => (
              <li key={c.id} data-en-zona={String(c.en_zona)}>
                <span className="punto-combi" style={{ background: c.color || '#238361' }} aria-hidden="true" />
                <div>
                  <strong>{c.nombre}</strong>
                  <small>{c.ruta || 'Sin ruta'}</small>
                  <span className={c.en_vivo ? 'senal-viva' : 'senal-vieja'}>
                    {c.en_vivo ? 'En vivo' : `Última señal hace ${Math.round(c.edad_s / 60)} min`}
                  </span>
                  {c.en_zona === false && (
                    <span className="senal-fuera">
                      Fuera de la zona, a {distanciaCorta(c.distancia_zona_m)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}