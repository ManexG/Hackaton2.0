/**
 * ESQUELETO — Parada: se abre escaneando el QR físico de la parada.
 *
 * Flujo: el vecino escanea el QR pegado en la parada -> el celular abre
 * /parada/LC-CODIGO y la app se centra en esa parada, muestra las combis
 * cercanas y cuánto falta (si hay datos suficientes).
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Bus } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, posicionActual, esc } from '../api.js';
import { Cargando, Vacio, ErrorBox } from '../components/EstadosUI.jsx';

export function Parada() {
  const { codigo } = useParams();
  const nodo = useRef(null);
  const [parada, setParada] = useState(null);
  const [llegada, setLlegada] = useState(null);
  const [error, setError] = useState(null);
  const [distancia, setDistancia] = useState(null);

  // "Estoy aquí": con el QR en la mano ya estamos en la parada, pero sirve
  // para confirmar que la ubicación coincide (y para probar la accuracy del GPS).
  const verificarAqui = async () => {
    try {
      const pos = await posicionActual();
      const metros = Math.round(
        Math.hypot((pos.lat - parada.lat) * 111320, (pos.lng - parada.lng) * 111320)
      );
      setDistancia(metros);
    } catch (e) {
      setError(e);
    }
  };

  // Escaneado desde la calle: se abre sin navegación, solo la información útil.
  const soloQR = new URLSearchParams(location.search).get('soloQR') === '1';

  useEffect(() => {
    api
      .paradaPorQr(codigo)
      .then((p) => {
        setParada(p);
        return api.llegadaAParada(p.id);
      })
      .then(setLlegada)
      .catch(setError);
  }, [codigo]);

// Centrar el mapa en la parada
  useEffect(() => {
    if (!parada || !nodo.current || nodo.current.dataset.iniciado) return;
    nodo.current.dataset.iniciado = '1';
    const mapa = L.map(nodo.current).setView([parada.lat, parada.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
    // Marcador con tooltip, no con popup: el nombre ya está en el encabezado y
// un globo flotante encima del punto solo estorba en pantalla chica.
    L.marker([parada.lat, parada.lng], {
      icon: L.divIcon({ className: '', iconSize: [16, 16], html: '<span class="marker-parada"></span>' }),
    })
      .bindTooltip(esc(parada.nombre), { direction: 'top', offset: [0, -12] })
      .addTo(mapa);
    return () => {
      mapa.remove();
      delete nodo.current.dataset.iniciado;
    };
  }, [parada]);

  const LLEGADA_POLL_MS = 15000; // cada cuánto se recalcula la llegada

  // Recalcula la llegada mientras la pantalla esté abierta: la combi se mueve.
  useEffect(() => {
    if (!parada) return;
    const t = setInterval(async () => {
      try {
        setLlegada(await api.llegadaAParada(parada.id));
      } catch {
        /* sin red: se conserva el último dato conocido */
      }
    }, LLEGADA_POLL_MS);
    return () => clearInterval(t);
  }, [parada]);

  if (error) return <ErrorBox error={error} />;
  if (!parada) return <Cargando filas={1} />;

  return (
    <section data-testid="parada" data-soloqr={soloQR}>
      {/* DISEÑA: pantalla de "estoy en la parada".
          Es la que abre el QR, así que debe entenderse en 2 segundos:
          dónde estoy, qué combi viene y cuánto falta.
          En modo `soloQR` se prioriza la respuesta y se oculta la navegación. */}

      {/* En modo QR el nombre va arriba, en grande: es lo primero que se lee
          estando parado en la calle. */}
      <header>
        <h1>{parada.nombre}</h1>
        <p className="opacity-70">{parada.ruta}</p>
      </header>

      <div ref={nodo} style={{ height: soloQR ? '34vh' : '45vh' }} />

      {/* TIEMPO DE LLEGADA
          IMPORTANTE (regla del proyecto): si no hay datos suficientes, la interfaz
          debe decirlo en vez de inventar. Ejemplos de honestidad:
            - "Sin posiciones recientes: no podemos estimar la llegada"
            - "A 400 m · llega en ~2 min (estimado con velocidad supuesta)"
          El backend devuelve `criterio` con esa explicación: muéstralo. */}
      {parada && !soloQR && (
        <button onClick={verificarAqui}>
          <MapPin /> Confirmar que estoy aquí
        </button>
      )}
      {distancia != null && (
        <p>
          Estás a {distancia} m de la parada
          {distancia < 150 ? ' (correcto)' : ' · parece que estás en otro punto'}
        </p>
      )}

      {llegada?.vehiculo ? (
        <div data-testid="llegada">
          {/* Combi fuera de la zona: se dice sin dar un tiempo, porque antes
              producía "llega en 246 min" para un vehículo a 324 km, que suena
              a que viene camino cuando en realidad no está en la ciudad. */}
          {llegada.estimado_min == null ? (
            <p className="aviso aviso-alerta" data-testid="llegada-fuera-zona">
              <Bus /> Hay una combi reportando, pero <strong>está fuera de la zona piloto</strong>.
            </p>
          ) : (
            <>
              <p>
                <Bus /> {llegada.vehiculo.nombre} · a {llegada.vehiculo.metros} m
              </p>
              <p style={{ fontSize: soloQR ? '2rem' : '1.4rem', fontWeight: 800 }}>
                {llegada.estimado_min === 1 ? 'Llega en 1 min' : `Llega en unos ${llegada.estimado_min} min`}
              </p>
            </>
          )}
          <small>{llegada.criterio}</small>
        </div>
      ) : (
        <Vacio
          titulo="Sin combis reportando ahora"
          texto="No hay posiciones recientes. No podemos estimar la llegada sin inventar datos."
        />
      )}
    </section>
  );
}