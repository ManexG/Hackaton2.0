/**
 * Chofer.jsx — Pantalla del chofer (/chofer).
 *
 * El chofer comparte su ubicación en vivo y los vecinos ven dónde está su combi.
 *
 * Criterio de diseño de esta pantalla: quien la usa va conduciendo. Todo son
 * decisiones de un solo toque, sin menús ni campos que exijan precisión.
 *
 * El flujo completo son cuatro pasos y ninguno requiere cuenta previa:
 *   1. "Crear mi cuenta de chofer"
 *   2. nombre, correo y contraseña
 *   3. nombre de la combi + qué ruta hace (tarjetas grandes)
 *   4. "Compartir mi ubicación"
 */

import { useEffect, useRef, useState } from 'react';
import { Radio, Square, Bus, UserPlus, Check, MapPin, MapPinOff } from 'lucide-react';
import { api, posicionActual } from '../api.js';
import { useSesion } from '../sesion.jsx';
import { ErrorBox } from '../components/EstadosUI.jsx';

const INTERVALO_MS = 10000; // cada cuánto se manda la posición al servidor

/**
 * Distancia de un punto al centro de la zona piloto.
 * Se usa la misma fórmula que el backend para que chofer y mapa coincidan.
 */
export function medirZona(lat, lng, zona) {
  if (!zona || !isFinite(lat) || !isFinite(lng)) return null;
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const p1 = rad(lat), p2 = rad(zona.lat);
  const dp = p2 - p1, dl = rad(lng - zona.lng);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const metros = 2 * R * Math.asin(Math.sqrt(x));
  return {
    metros: Math.round(metros),
    en_zona: metros <= (zona.radio_m ?? 1500),
  };
}

/** "a 210 m" o "a 325 km", para que el número se lea de un vistazo. */
const distanciaCorta = (m) => (m < 1000 ? `${Math.round(m)} m` : `${Math.round(m / 100) / 10} km`);

export function Chofer() {
  const { usuario, registrar } = useSesion();
  const [creando, setCreando] = useState(false);
  const [trabajo, setTrabajo] = useState(false);
  const [rutas, setRutas] = useState([]);
  const [rutaElegida, setRutaElegida] = useState(null);
  const [vehiculo, setVehiculo] = useState(null);
  const [compartiendo, setCompartiendo] = useState(false);
  const [error, setError] = useState(null);
  const [enviados, setEnviados] = useState(0);
  const timer = useRef(null);

  // Las rutas vienen del servidor: no se escriben aquí, para que cambiar una
  // ruta en el admin no obligue a tocar el código.
  //
  // También se recupera la combi ya registrada. Sin esto, al recargar la
  // pantalla (el celular se bloquea conduciendo) el chofer volvería al
  // formulario y crearía una segunda combi.
  useEffect(() => {
    if (usuario?.rol !== 'chofer') return;
    api.rutas().then(setRutas).catch(() => {});
    api
      .misVehiculos()
      .then((v) => {
        // El endpoint devuelve la ruta como texto plano; aquí se normaliza a
        // objeto para que se muestre igual que recién registrada.
        if (v) setVehiculo({ ...v, ruta: v.ruta ? { nombre: v.ruta, color: v.color } : null });
      })
      .catch(() => {});
  }, [usuario?.rol]);

  // ---------- Alta de cuenta de chofer ----------
  const crearCuenta = async (e) => {
    e.preventDefault();
    setTrabajo(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await registrar(f.get('nombre'), f.get('email'), f.get('password'), 'chofer');
    } catch (err) {
      setError(err);
    } finally {
      setTrabajo(false);
    }
  };

  // ---------- Combi ----------
  const registrarCombi = async (e) => {
    e.preventDefault();
    if (!rutaElegida) return;
    setTrabajo(true);
    setError(null);
    const nombre = new FormData(e.currentTarget).get('nombre');
    try {
      // El backend responde solo { id }, así que el nombre y la ruta elegidos
      // se guardan aquí para poder mostrarlos en los siguientes pasos.
      const v = await api.registrarVehiculo(nombre, rutaElegida.id);
      setVehiculo({ ...v, nombre, ruta: rutaElegida });
    } catch (err) {
      setError(err);
    } finally {
      setTrabajo(false);
    }
  };

  // ---------- Ubicación ----------
  // Distancia al centro de la zona piloto, para decirle al chofer si está
  // dentro o fuera. Sin esto, quien prueba la app desde otro estado ve su
  // combi "reportando" sin entender que nadie la está viendo en el mapa.
  const [zona, setZona] = useState(null);
  const [donde, setDonde] = useState(null);

  useEffect(() => {
    api.zona().then(setZona).catch(() => {});
  }, []);

  const enviar = async () => {
    const pos = await posicionActual();
    await api.enviarPosicion({
      lat: pos.lat,
      lng: pos.lng,
      velocidad: pos.velocidad != null ? Math.max(0, pos.velocidad) : null,
    });
    setEnviados((n) => n + 1);
    if (zona && isFinite(pos.lat) && isFinite(pos.lng)) {
      setDonde(medirZona(pos.lat, pos.lng, zona));
    }
  };

  const compartir = async () => {
    setError(null);
    try {
      await enviar();
      setCompartiendo(true);
      timer.current = setInterval(enviar, INTERVALO_MS);
    } catch (err) {
      setError(err);
    }
  };

  const detener = async () => {
    clearInterval(timer.current);
    timer.current = null;
    setCompartiendo(false);
    // También se le dice al servidor. Si solo se parara el temporizador del
    // navegador, la combi seguiría en los mapas hasta que su señal se viejara.
    try {
      await api.detenerVehiculo();
    } catch {
      /* si falla, la señal se vieja sola y desaparece en 5 minutos */
    }
    setVehiculo(null);
    setDonde(null);
    setEnviados(0);
  };

  useEffect(() => () => clearInterval(timer.current), []);

  /* ---------- Sin sesión: aquí se resuelve todo el alta ---------- */
  if (!usuario) {
    return (
      <section data-testid="chofer-sin-acceso">
        <h2>
          <Bus /> ¿Manejas una combi?
        </h2>
        <p>Comparte tu ubicación mientras manejas y los vecinos verán dónde estás.</p>

        {error && <ErrorBox error={error} />}

        {!creando ? (
          <div className="acciones-chofer">
            <button onClick={() => setCreando(true)}>
              <UserPlus /> Crear mi cuenta de chofer
            </button>
            <a href="/perfil" className="enlace-suave">
              Ya tengo cuenta, entrar
            </a>
          </div>
        ) : (
          <form onSubmit={crearCuenta}>
            <input name="nombre" placeholder="Tu nombre" autoComplete="name" required />
            <input
              name="email"
              type="email"
              placeholder="tu@correo.com"
              autoComplete="username"
              required
            />
            <input
              name="password"
              type="password"
              placeholder="Contraseña (6+)"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <button disabled={trabajo}>{trabajo ? 'Creando cuenta...' : 'Crear cuenta'}</button>
            <button type="button" className="boton-enlace" onClick={() => setCreando(false)}>
              Cancelar
            </button>
          </form>
        )}
      </section>
    );
  }

  /* ---------- Sesión que no es de chofer: ya se registró, no puede usar esto ---------- */
  if (usuario.rol !== 'chofer') {
    return (
      <section data-testid="chofer-sin-rol">
        <p>
          <Bus /> Esta pantalla es para quienes manejan una combi.
        </p>
        <p>Cerrar sesión y crear una cuenta de chofer para verla.</p>
        <a href="/perfil" className="enlace-suave">
          Ir a mi cuenta
        </a>
      </section>
    );
  }

  return (
    <section data-testid="chofer">
      <h2>
        <Bus /> Hola, {usuario.nombre}
      </h2>

      {error && <ErrorBox error={error} />}

      {!vehiculo && !compartiendo && (
        <form onSubmit={registrarCombi}>
          <label htmlFor="nombre-combi">Tu combi</label>
          <input
            id="nombre-combi"
            name="nombre"
            placeholder="Ej. Combi Centro"
            maxLength={60}
            required
          />

          <p className="pregunta-ruta">¿Qué ruta haces?</p>
          {rutas.length === 0 ? (
            <p className="aviso">Aún no hay rutas cargadas. Pregunta en el ayuntamiento.</p>
          ) : (
            <div className="tarjetas-ruta" role="radiogroup" aria-label="Elige tu ruta">
              {rutas.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={rutaElegida?.id === r.id}
                  className={`tarjeta-ruta${rutaElegida?.id === r.id ? ' elegida' : ''}`}
                  style={{ '--ruta-color': r.color }}
                  disabled={trabajo}
                  onClick={() => setRutaElegida(r)}
                >
                  <span className="punto-ruta" aria-hidden="true" />
                  <span className="nombre-ruta">{r.nombre}</span>
                  {rutaElegida?.id === r.id && (
                    <span className="palomita">
                      <Check size={16} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <button disabled={trabajo || !rutaElegida}>
            {trabajo ? 'Guardando...' : 'Registrar combi'}
          </button>
        </form>
      )}

      {vehiculo && !compartiendo && (
        <div className="acciones-chofer">
          <p>
            <strong>{vehiculo.nombre}</strong>
            {vehiculo.ruta ? ` · ${vehiculo.ruta.nombre}` : ' · sin ruta asignada'}
          </p>
          <button onClick={compartir}>
            <Radio /> Compartir mi ubicación
          </button>
        </div>
      )}

      {compartiendo && (
        <div className="acciones-chofer">
          <p data-testid="chofer-activo">
            <strong>Compartiendo ubicación</strong> · {enviados} puntos enviados
          </p>

          {/* Si el chofer está fuera de la zona, se le dice. Durante una prueba
              puede estar en cualquier parte, y sin esto ve "reportando" sin
              saber que nadie lo está viendo en el mapa. */}
          {donde && !donde.en_zona && (
            <p className="aviso aviso-alerta" data-testid="chofer-fuera-zona">
              <MapPinOff /> Estás <strong>fuera de la zona piloto</strong>
              {zona?.nombre ? ` (${zona.nombre})` : ''}, a {distanciaCorta(donde.metros)} de su
              centro. Tu combi se está reportando, pero no aparecerá en el mapa de los
              vecinos.
            </p>
          )}
          {donde && donde.en_zona && (
            <p className="aviso aviso-ok">
              <MapPin /> En la zona piloto{zona?.nombre ? ` (${zona.nombre})` : ''} · a{' '}
              {distanciaCorta(donde.metros)} del centro
            </p>
          )}

          <p className="aviso">
            Deja esta pantalla abierta mientras manejas. Puedes minimizedarla en el navegador.
          </p>
          <button className="boton-secundario" onClick={detener}>
            <Square /> Detener
          </button>
        </div>
      )}
    </section>
  );
}