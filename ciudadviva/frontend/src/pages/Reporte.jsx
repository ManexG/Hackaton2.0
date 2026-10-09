/**
 * ESQUELETO — Página pública de un reporte (/reporte/:id).
 * Es la que se abre cuando alguien comparte por WhatsApp. Funciona SIN sesión.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ThumbsUp, Landmark, History, MessageCircle } from 'lucide-react';
import { api, CATEGORIAS_POR_CLAVE } from '../api.js';
import { BadgeEstado, BarraEstado } from '../components/Estados.jsx';
import { Cargando, Vacio, ErrorBox } from '../components/EstadosUI.jsx';

const cat = (clave) => CATEGORIAS_POR_CLAVE[clave] ?? { etiqueta: clave };

export function Reporte() {
  const { id } = useParams();
  const [reporte, setReporte] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [comentarios, setComentarios] = useState([]);
  const [error, setError] = useState(null);
  const [votoMsg, setVotoMsg] = useState(null);

  useEffect(() => {
    api
      .reporte(id)
      .then((r) => {
        setReporte(r);
        return Promise.all([api.historial(id), api.comentarios(id)]);
      })
      .then(([h, c]) => {
        setHistorial(h);
        setComentarios(c);
      })
      .catch(setError);
  }, [id]);

  const voter = async () => {
    try {
      await api.votar(id);
      setVotoMsg('¡Gracias por apoyar!');
    } catch (e) {
      setVotoMsg(e.status === 409 ? 'Ya apoyaste este reporte' : 'No pudimos registrar tu apoyo');
    }
  };

  if (error) return <ErrorBox error={error} />;
  if (!reporte) return <Cargando filas={1} />;

  return (
    <article data-testid="reporte">
      {/* DISEÑA: encabezado con categoría, estado y colonia.
          Que se entienda de un vistazo si ya se resolvió. */}
      <header>
        <h1>{cat(reporte.categoria).etiqueta}</h1>
        <BadgeEstado estado={reporte.estado} />
        <p>
          {reporte.colonia || 'Sin colonia'} · reportado por {reporte.user_nombre || 'un vecino'}
        </p>
        {reporte.descripcion && <p>{reporte.descripcion}</p>}
        {reporte.foto_key && <img src={`/api/foto/${reporte.foto_key}`} alt="" />}
      </header>

      {/* NOTA DEL AYUNTAMIENTO: es la respuesta oficial. Dale espacio visual:
          es la prueba de que el canal funciona. */}
      {reporte.nota && (
        <aside data-testid="nota-ayuntamiento">
          <Landmark /> {reporte.nota}
        </aside>
      )}

      <button onClick={voter}>
        <ThumbsUp /> Apoyar ({reporte.votos})
      </button>
      {votoMsg && <p>{votoMsg}</p>}

      {/* DISEÑA: línea de tiempo del historial.
          Cada cambio de estado con su fecha y la nota que dejó el ayuntamiento.
          Esto es la prueba de transparencia ante el vecino. */}
      <section data-testid="historial">
        <h2>
          <History /> Historial
        </h2>
        <ol>
          <li>Reportado por un vecino</li>
          {historial.map((h) => (
            <li key={h.id}>
              <BarraEstado estado={h.estado} />
              {h.nota && <span>{h.nota}</span>}
            </li>
          ))}
        </ol>
      </section>

      {/* DISEÑA: hilo de comentarios tipo conversación de vecindario. */}
      <section data-testid="comentarios">
        <h2>
          <MessageCircle /> Comentarios
        </h2>
        {comentarios.length === 0 ? (
          <Vacio titulo="Sin comentarios" texto="Sé el primero en comentar." />
        ) : (
          <ul>
            {comentarios.map((c) => (
              <li key={c.id}>
                <strong>{c.nombre || 'Vecino'}:</strong> {c.texto}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}