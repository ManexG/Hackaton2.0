/**
 * ESQUELETO — Feed. Lógica conectada a la API; el diseño lo hace el equipo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { api, ApiError, ESTADOS } from '../api.js';
import { TarjetaReporte, FormularioReporte } from '../components/TarjetaReporte.jsx';
import { ChipColonia } from '../components/Estados.jsx';
import { Cargando, Vacio, ErrorBox } from '../components/EstadosUI.jsx';
import { useSesion } from '../sesion.jsx';

const TAMANO_PAGINA = 20;

export function Feed() {
  const { usuario } = useSesion();
  const [reportes, setReportes] = useState([]);
  const [colonias, setColonias] = useState([]);
  const [filtros, setFiltros] = useState({ q: '', estado: '', colonia: '' });
  const [offset, setOffset] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const timer = useRef(null);

  const cargar = useCallback(
    async (filtrosActuales, nuevoOffset = 0, reemplazar = true) => {
      setCargando(true);
      setError(null);
      try {
        const datos = await api.reportes({ ...filtrosActuales, limit: TAMANO_PAGINA, offset: nuevoOffset });
        setReportes((prev) => (reemplazar ? datos : [...prev, ...datos]));
        setOffset(nuevoOffset + datos.length);
      } catch (e) {
        setError(e);
      } finally {
        setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargar(filtros, 0, true);
  }, [filtros, cargar]);

  useEffect(() => {
    api.colonias().then(setColonias).catch(() => {});
  }, []);

  const cambiarFiltro = useCallback((parcial) => {
    setFiltros((f) => ({ ...f, ...parcial }));
  }, []);

  // Búsqueda con retardo para no pegarle al servidor en cada tecla
  const onBuscar = useCallback(
    (texto) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => cambiarFiltro({ q: texto }), 300);
    },
    [cambiarFiltro]
  );

  const apoyar = useCallback(async (reporte) => {
    try {
      await api.votar(reporte.id);
      await cargar(filtros, 0, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Ya se apoyanó este reporte antes: avisar en pantalla, no contar dos veces.
        // DISEÑA: el aviso (toast) para "Ya apoyaste este reporte".
      }
    }
  }, [cargar, filtros]);

  const compartir = useCallback(async (reporte) => {
    const url = `${location.origin}/reporte/${reporte.id}`;
    if (navigator.share) await navigator.share({ title: 'LCAlerta', text: 'Mira este reporte de mi colonia', url }).catch(() => {});
    else await navigator.clipboard?.writeText(url);
  }, []);

  return (
    <section data-testid="feed">
      {/* DISEÑA: buscador y filtros (estado / colonia) arriba del feed. Ya están
          conectados: el buscador escribe en onBuscar (con retardo) y los filtros en
          cambiarFiltro. No deben ocupar más de una línea en móvil. */}
      <div className="flex gap-2 mb-3">
        <input
          value={filtros.q}
          onChange={(e) => onBuscar(e.target.value)}
          placeholder="Buscar en los reportes"
          aria-label="Buscar"
          className="input input-bordered flex-1"
        />
        <select
          value={filtros.estado}
          onChange={(e) => cambiarFiltro({ estado: e.target.value })}
          aria-label="Filtrar por estado"
          className="select select-bordered w-auto"
        >
          <option value="">Todo</option>
          {ESTADOS.map((s) => (
            <option key={s.clave} value={s.clave}>{s.etiqueta}</option>
          ))}
        </select>
        <select
          value={filtros.colonia}
          onChange={(e) => cambiarFiltro({ colonia: e.target.value })}
          aria-label="Filtrar por colonia"
          className="select select-bordered w-auto"
        >
          <option value="">Toda la ciudad</option>
          {colonias.map((c) => (
            <option key={c.colonia} value={c.colonia}>{c.colonia}</option>
          ))}
        </select>
      </div>

      <button className="btn btn-primary btn-block mb-3" onClick={() => setFormAbierto(true)}>
        <Camera /> Reportar un problema
      </button>

      {colonias.length > 0 && (
        /* Chips de colonia: los más problemáticos primero. DISEÑA el estilo. */
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
          {colonias.map((c) => (
            <ChipColonia
              key={c.colonia}
              colonia={c.colonia}
              abiertos={c.abiertos}
              diasSinAtender={c.dias_max_abiertos}
              alFiltrar={(col) => cambiarFiltro({ colonia: col })}
            />
          ))}
        </div>
      )}

      {error && <ErrorBox error={error} alReintentar={() => cargar(filtros, 0, true)} />}
      {cargando && reportes.length === 0 && <Cargando />}

      {!cargando && reportes.length === 0 && !error && (
        /* Primera vez en una colonia sin reportes: DISEÑALO para que invite a reportar */
        <Vacio titulo="Aún no hay reportes aquí" texto="Sé el primero en contarlo." accion={<button onClick={() => setFormAbierto(true)}>Reportar</button>} />
      )}

      <div className="space-y-3">
        {reportes.map((r) => (
          <TarjetaReporte key={r.id} reporte={r} onApoyar={apoyar} onCompartir={compartir} onComentarios={() => {}} />
        ))}
      </div>

      {reportes.length >= TAMANO_PAGINA && (
        <button className="btn btn-outline btn-block" onClick={() => cargar(filtros, offset, false)}>
          Cargar más
        </button>
      )}

      <FormularioReporte
        abierto={formAbierto}
        onCerrar={() => setFormAbierto(false)}
        onEncolado={() => cargar(filtros, 0, true)}
        haySesion={!!usuario}
      />
    </section>
  );
}