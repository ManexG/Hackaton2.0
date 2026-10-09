/**
 * ESTE ARCHIVO ES UN ESQUELETO: la estructura y los datos están listos,
 * el DISEÑO es responsabilidad del equipo de frontend.
 *
 * Busca los comentarios `DISEÑA:` — ahí va su trabajo.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Camera, CheckCircle2, Edit3, XCircle, Lightbulb, AlertTriangle, Trash2, Droplet, HelpCircle, ThumbsUp, Share2, MessageCircle } from 'lucide-react';
import { CATEGORIAS, CATEGORIAS_POR_CLAVE, posicionActual } from '../api.js';
import { cola, comprimirImagen, coloniaDesdeCoords } from '../cola.js';
import { BadgeEstado } from './Estados.jsx';

// Un ícono por categoría (los colores ya están en los tokens)
const ICONO_CAT = { alumbrado: Lightbulb, bache: AlertTriangle, basura: Trash2, fuga_agua: Droplet, otro: HelpCircle };
const cat = (clave) => CATEGORIAS_POR_CLAVE[clave] || CATEGORIAS[4];

function tiempo(iso) {
  const d = (Date.now() - new Date(String(iso).replace(' ', 'T') + 'Z')) / 86400000;
  if (d < 1) return 'hoy';
  if (d < 2) return 'ayer';
  return `hace ${Math.floor(d)} días`;
}

/**
 * Tarjeta de un reporte. Es el componente que más se repite en la app:
 * Feed, "Mis reportes" del perfil y página pública.
 */
export function TarjetaReporte({ reporte, onApoyar, onComentarios, onCompartir }) {
  const c = cat(reporte.categoria);
  const IconoCat = ICONO_CAT[reporte.categoria] || HelpCircle;
  return (
    <article
      className="animate-card-in"
      data-testid="tarjeta-reporte"
      data-estado={reporte.estado}
      /* DISEÑA: la tarjeta.
         - Foto grande arriba si la hay
         - Categoría + estado visual (que resalte cuando está resuelto)
         - Quién reportó, colonia y fecha
         - Botón de apoyar destacado; compartir y comentarios secundarios
         - NO cambies el orden de los estados:
           enviado -> recibido -> aprobado | no_aprobado */
    >
      {reporte.foto_key && (
        <img src={`/api/foto/${reporte.foto_key}`} alt="" loading="lazy" className="w-full" />
      )}

      <div>
        <h3>
          <IconoCat style={{ color: c.color }} /> {c.etiqueta}
        </h3>
        <BadgeEstado estado={reporte.estado} />
      </div>

      <p>
        {reporte.user_nombre && <>de {reporte.user_nombre} · </>}
        {reporte.colonia || 'Sin colonia'} · {tiempo(reporte.created_at)}
      </p>

      {reporte.descripcion && <p>{reporte.descripcion}</p>}
      {reporte.nota && <aside>Nota del ayuntamiento: {reporte.nota}</aside>}

      <footer>
        <button onClick={() => onApoyar(reporte)}>
          <ThumbsUp /> Apoyar ({reporte.votos})
        </button>
        <button onClick={() => onCompartir(reporte)} aria-label="Compartir">
          <Share2 />
        </button>
        <button onClick={() => onComentarios(reporte)}>
          <MessageCircle /> Comentarios
        </button>
        <Link to={`/reporte/${reporte.id}`}>Ver detalle</Link>
      </footer>
    </article>
  );
}

/**
 * Formulario de alta en dos pasos: formulario -> confirmacion -> enviar.
 *
 * La logica de la cola offline vive en src/cola.js (no se toca aqui):
 * el reporte se guarda en el telefono primero y sube solo cuando hay senal.
 */
export function FormularioReporte({ abierto, onCerrar, onEncolado, haySesion }) {
  const [paso, setPaso] = useState(1);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pos, setPos] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cerrar = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPaso(1);
    setForm(null);
    setPreview(null);
    setPos(null);
    setError(null);
    onCerrar?.();
  };

  if (!abierto) return null;
  if (!haySesion) return <p>Necesitas iniciar sesión para reportar</p>;

  const leer = async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.currentTarget).entries());
    let coords = pos;
    if (!coords) {
      try {
        coords = await posicionActual();
      } catch (err) {
        setError(err.message || 'Necesitamos tu ubicación para ubicar el reporte');
        return;
      }
    }
    let foto = null;
    const archivo = e.currentTarget.elements.foto.files?.[0];
    if (archivo) {
      foto = await comprimirImagen(archivo);
      setPreview(URL.createObjectURL(foto));
    }
    if (!datos.colonia) {
      const c = await coloniaDesdeCoords(coords.lat, coords.lng);
      if (c) datos.colonia = c;
    }
    setForm({ ...datos, lat: coords.lat, lng: coords.lng, foto });
    setPaso(2);
  };

  const enviar = async () => {
    if (!form) return;
    setGuardando(true);
    try {
      await cola.encolar({
        ts: Date.now(),
        categoria: form.categoria,
        descripcion: form.descripcion || '',
        colonia: form.colonia || '',
        lat: form.lat,
        lng: form.lng,
        foto: form.foto,
      });
      await cola.subir();
      onEncolado?.();
      cerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="modal-lcalerta">
      {/* DISEÑA: el modal. Ojo con el nombre de la clase: DaisyUI ya define
          `.modal` con visibility:hidden y rompe el diálogo, por eso usamos
          `.modal-lcalerta`. */}
      <div className="modal-lcalerta-carta">
        {paso === 1 ? (
          <form onSubmit={leer}>
            <h2>
              <Camera /> Cuéntanos qué pasa
            </h2>

            <label>
              Tipo de problema
              <select name="categoria" defaultValue="alumbrado">
                {CATEGORIAS.map((c) => (
                  <option key={c.clave} value={c.clave}>
                    {c.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label>
              ¿Qué ves?
              <input name="descripcion" maxLength={200} placeholder="Máximo un renglón" />
            </label>

            <label>
              ¿En qué colonia?
              <input name="colonia" placeholder="Se llena sola con tu ubicación" />
            </label>

            <label>
              Foto
              <input type="file" name="foto" accept="image/*" capture="environment" />
            </label>

            <button type="button" onClick={() => posicionActual().then(setPos).catch((err) => setError(err.message))}>
              <MapPin /> {pos ? 'Ubicación lista' : 'Usar mi ubicación'}
            </button>

            {error && <p role="alert">{error}</p>}
            <button type="submit">Continuar</button>
            <button type="button" onClick={cerrar}>
              <XCircle /> Cancelar
            </button>
          </form>
        ) : (
          <div>
            <h2>
              <CheckCircle2 /> Revisa antes de enviar
            </h2>
            {preview && <img src={preview} alt="Foto del reporte" />}
            <p>{cat(form.categoria).etiqueta}</p>
            {form.descripcion && <p>{form.descripcion}</p>}
            <p>
              {form.colonia || 'Sin colonia'} · {form.lat.toFixed(5)}, {form.lng.toFixed(5)}
            </p>
            <p className="text-sm">Se enviará a tus compañeros y al ayuntamiento. Puedes editar antes de confirmar.</p>
            {error && <p role="alert">{error}</p>}
            <button onClick={enviar} disabled={guardando}>
              <CheckCircle2 /> {guardando ? 'Guardando...' : 'Confirmar y enviar'}
            </button>
            <button onClick={() => setPaso(1)}>
              <Edit3 /> Editar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}