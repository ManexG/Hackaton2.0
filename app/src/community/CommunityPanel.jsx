import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BusFront,
  Camera,
  Check,
  ChevronRight,
  Download,
  MapPin,
  MessageCircle,
  Newspaper,
  Plus,
  Send,
  Share2,
  ThumbsUp,
  UserRound,
  WifiOff,
} from 'lucide-react';
import L from 'leaflet';
import QRCode from 'qrcode';
import {
  api,
  categories,
  statuses,
  session,
  saveSession,
  fingerprint,
  photoUrl,
  currentPosition,
  compressPhoto,
  urgency,
  reportLink,
  stopLink,
} from './api.js';
import { drafts, enqueue, removeDraft, syncDrafts } from './queue.js';
import { insideCoverage } from '../planner.js';
import { addStreetMap } from '../streetMap.js';
import './community.css';

const go = (path) => {
  location.hash = path;
};
const category = (id) => categories.find((c) => c.id === id) ?? categories.at(-1);
function Message({ children }) {
  return children ? (
    <p className="community-message" role="status">
      {children}
    </p>
  ) : null;
}
function Empty({ children }) {
  return <p className="community-empty">{children}</p>;
}

function LocalMap({ network, reports = [], points = [], pick, chosen }) {
  const container = useRef(null);
  const instance = useRef(null);
  const layer = useRef(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    const bounds = L.latLngBounds(network.coverage.bounds);
    const map = L.map(container.current, {
      minZoom: 14,
      maxZoom: 18,
      maxBounds: bounds,
      maxBoundsViscosity: 1,
    }).fitBounds(bounds);
    instance.current = map;
    addStreetMap(map, network, { interactiveSignals: !pickRef.current });
    map.createPane('communityMask').style.zIndex = '270';
    map.getPane('communityMask').style.pointerEvents = 'none';
    L.polygon(
      [
        [
          [85, -180],
          [85, 180],
          [-85, 180],
          [-85, -180],
        ],
        network.coverage.polygon,
      ],
      {
        pane: 'communityMask',
        stroke: false,
        fillColor: '#e9eee4',
        fillOpacity: 1,
        fillRule: 'evenodd',
        interactive: false,
      }
    ).addTo(map);
    layer.current = L.layerGroup().addTo(map);
    map.on('click', (event) => {
      const point = [event.latlng.lat, event.latlng.lng];
      if (insideCoverage(point, network)) pickRef.current?.(point);
    });
    const timer = setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(bounds);
    }, 100);
    return () => {
      clearTimeout(timer);
      map.remove();
    };
  }, [network]);
  useEffect(() => {
    if (!layer.current) return;
    layer.current.clearLayers();
    for (const item of [...reports, ...points]) {
      if (!insideCoverage([item.lat, item.lng], network)) continue;
      const marker = L.circleMarker([item.lat, item.lng], {
        color: '#fff',
        weight: 3,
        fillColor: category(item.categoria).color,
        fillOpacity: 1,
        radius: 10,
      }).addTo(layer.current);
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.nombre || category(item.categoria).name;
      popup.append(title);
      const text = document.createElement('p');
      text.textContent = item.descripcion || item.notas || '';
      popup.append(text);
      if (item.categoria) {
        const link = document.createElement('a');
        link.href = `#/reporte/${item.id}`;
        link.textContent = 'Ver reporte';
        popup.append(link);
      }
      marker.bindPopup(popup);
    }
    if (chosen)
      L.circleMarker(chosen, {
        color: '#24551f',
        fillColor: '#fff',
        fillOpacity: 1,
        radius: 10,
        weight: 4,
      }).addTo(layer.current);
  }, [reports, points, chosen, network]);
  return (
    <div
      ref={container}
      className="community-map"
      aria-label={
        pick ? 'Toca el mapa para elegir la ubicación' : 'Mapa de reportes dentro de la zona'
      }
    />
  );
}

function ReportCard({ report, refresh, notify }) {
  const cat = category(report.categoria);
  async function vote() {
    try {
      await api(`/reportes/${report.id}/votar`, {
        method: 'POST',
        body: { fingerprint: fingerprint() },
      });
      notify('Gracias. Tu apoyo quedó registrado.');
      refresh?.();
    } catch (error) {
      notify(error.message);
    }
  }
  async function share() {
    try {
      const url = reportLink(report.id);
      if (navigator.share)
        await navigator.share({ title: 'Las Palmas · Comunidad', text: report.descripcion, url });
      else {
        await navigator.clipboard.writeText(url);
        notify('Enlace copiado. Puedes compartirlo.');
      }
    } catch (error) {
      if (error.name !== 'AbortError')
        notify('No pudimos copiar el enlace. Abre el detalle para compartirlo.');
    }
  }
  return (
    <article
      className="community-report"
      data-testid="community-report"
      style={{ '--category-color': cat.color }}
    >
      {report.foto_key && (
        <img
          className="report-photo"
          src={photoUrl(report.foto_key)}
          alt={`Foto de ${cat.name.toLowerCase()}`}
          loading="lazy"
        />
      )}
      <div className="report-body">
        <div className="report-heading">
          <h2>{cat.name}</h2>
          <span className={`report-status ${report.estado}`}>{statuses[report.estado]}</span>
        </div>
        <p className="report-meta">
          {report.colonia || 'Zona del corredor'} ·{' '}
          {new Date(report.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('es-MX', {
            timeZone: 'America/Mexico_City',
          })}
        </p>
        <p>{report.descripcion}</p>
        {report.nota && (
          <blockquote>
            <strong>Respuesta del equipo:</strong> {report.nota}
          </blockquote>
        )}
        <div className="community-actions">
          <button onClick={vote}>
            <ThumbsUp />
            Apoyar ({report.votos})
          </button>
          <button onClick={() => go(`/reporte/${report.id}`)}>
            <MessageCircle />
            Ver detalle
          </button>
          <button onClick={share} aria-label="Compartir reporte">
            <Share2 />
          </button>
        </div>
      </div>
    </article>
  );
}

function CreateReport({ network, user, close, refresh, notify }) {
  const dialog = useRef(null);
  const [position, setPosition] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [review, setReview] = useState(null);
  const [formDraft, setFormDraft] = useState({
    categoria: 'alumbrado',
    descripcion: '',
    foto: null,
  });
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [colony, setColony] = useState('');
  useEffect(() => {
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );
  async function locate() {
    setBusy(true);
    setError('');
    try {
      const point = await currentPosition();
      if (!insideCoverage(point, network))
        throw new Error('Estás fuera de la zona. Elige el lugar del problema en el mapa.');
      setPosition(point);
      if (!colony) {
        try {
          const result = await fetch(
            `https://photon.komoot.io/reverse?lat=${point[0]}&lon=${point[1]}&limit=1`,
            { signal: AbortSignal.timeout(4000) }
          ).then((r) => r.json());
          const p = result.features?.[0]?.properties;
          if (p) setColony(p.suburb || p.district || p.neighbourhood || '');
        } catch {
          /* The colony can always be entered manually. */
        }
      }
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare(event) {
    event.preventDefault();
    if (!position) {
      setError('Usa tu ubicación o elige el lugar en el mapa.');
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const photo = form.get('foto')?.size ? await compressPhoto(form.get('foto')) : formDraft.foto;
      if (photo) setPreview(URL.createObjectURL(photo));
      setFormDraft({
        categoria: form.get('categoria'),
        descripcion: form.get('descripcion'),
        foto: photo,
      });
      setReview({
        categoria: form.get('categoria'),
        descripcion: form.get('descripcion'),
        colonia: colony,
        lat: position[0],
        lng: position[1],
        foto: photo,
      });
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    setError('');
    try {
      await enqueue(review);
      const result = await syncDrafts();
      notify(
        result.pending
          ? `Reporte guardado en este teléfono. ${result.error || 'Se enviará cuando vuelva la señal.'}`
          : 'Tu reporte se envió correctamente.'
      );
      refresh();
      close();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="community-dialog"
      ref={dialog}
      onCancel={close}
      aria-labelledby="report-form-title"
    >
      <div className="community-dialog-heading">
        <h2 id="report-form-title">{review ? 'Revisa tu reporte' : 'Reportar un problema'}</h2>
        <button onClick={close} aria-label="Cerrar formulario">
          ✕
        </button>
      </div>
      {!user ? (
        <>
          <p>
            Para guardar tus reportes necesitas una cuenta. Puedes seguir consultando rutas sin
            registrarte.
          </p>
          <button
            className="community-primary"
            onClick={() => {
              close();
              go('/perfil');
            }}
          >
            Entrar o crear cuenta
          </button>
        </>
      ) : review ? (
        <>
          {preview && <img className="report-preview" src={preview} alt="Foto que enviarás" />}
          <h3>{category(review.categoria).name}</h3>
          <p>{review.descripcion}</p>
          <p>{review.colonia || 'Zona del corredor'} · Ubicación elegida en el mapa</p>
          <p>
            El reporte será público para la comunidad. Se guarda primero en tu teléfono si falta
            señal.
          </p>
          <Message>{error}</Message>
          <div className="community-actions">
            <button onClick={() => setReview(null)} disabled={busy}>
              Editar
            </button>
            <button className="community-primary" disabled={busy} onClick={send}>
              <Send />
              {busy ? 'Guardando…' : 'Confirmar y enviar'}
            </button>
          </div>
        </>
      ) : (
        <form className="community-form" onSubmit={prepare}>
          <label>
            Tipo de problema
            <select name="categoria" defaultValue={formDraft.categoria}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            ¿Qué está pasando?
            <textarea
              name="descripcion"
              required
              minLength={4}
              maxLength={500}
              rows={3}
              defaultValue={formDraft.descripcion}
            />
          </label>
          <label>
            Colonia o referencia
            <input
              value={colony}
              onChange={(e) => setColony(e.target.value)}
              maxLength={120}
              placeholder="Puedes escribirla aquí"
            />
          </label>
          <label>
            Foto del problema (opcional)
            <input
              type="file"
              name="foto"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
            />
          </label>
          {formDraft.foto && (
            <p>Tu foto anterior sigue elegida. Puedes seleccionar otra para cambiarla.</p>
          )}
          <div className="community-actions">
            <button type="button" onClick={locate} disabled={busy}>
              <MapPin />
              {position ? 'Cambiar mi ubicación' : 'Usar mi ubicación'}
            </button>
            <button type="button" onClick={() => setShowMap((v) => !v)}>
              Elegir en el mapa
            </button>
          </div>
          {position && (
            <p className="community-success">
              <Check />
              Ubicación elegida
            </p>
          )}
          {showMap && (
            <>
              <p>Toca la calle donde está el problema.</p>
              <LocalMap network={network} pick={setPosition} chosen={position} />
            </>
          )}
          <Message>{error}</Message>
          <button className="community-primary" disabled={busy}>
            {busy ? 'Preparando…' : 'Revisar reporte'}
          </button>
        </form>
      )}
    </dialog>
  );
}

function ReportDetail({ id, user, notify }) {
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [error, setError] = useState('');
  async function load() {
    try {
      const [r, h, c] = await Promise.all([
        api(`/reportes/${id}`),
        api(`/reportes/${id}/historial`),
        api(`/reportes/${id}/comentarios`),
      ]);
      setReport(r);
      setHistory(h);
      setComments(c);
    } catch (reason) {
      setError(reason.message);
    }
  }
  useEffect(() => {
    load();
  }, [id]);
  async function comment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await api(`/reportes/${id}/comentarios`, {
        method: 'POST',
        body: {
          nombre: user?.nombre || values.get('nombre') || 'Vecino',
          texto: values.get('texto'),
        },
      });
      form.reset();
      await load();
      notify('Comentario publicado.');
    } catch (reason) {
      notify(reason.message);
    }
  }
  return (
    <>
      <button onClick={() => go('/comunidad')}>
        <ArrowLeft />
        Volver a reportes
      </button>
      <Message>{error}</Message>
      {report ? (
        <>
          <ReportCard report={report} refresh={load} notify={notify} />
          <section className="community-section">
            <h2>Historial del reporte</h2>
            <ol className="report-history">
              <li>
                <strong>Enviado</strong>
                <span>{report.created_at}</span>
              </li>
              {history.map((h) => (
                <li key={h.id}>
                  <strong>{statuses[h.estado]}</strong>
                  <span>{h.nota || 'Estado actualizado por el equipo'}</span>
                  <small>{h.created_at}</small>
                </li>
              ))}
            </ol>
          </section>
          <section className="community-section">
            <h2>Comentarios ({comments.length})</h2>
            {comments.map((c) => (
              <div className="community-comment" key={c.id}>
                <strong>{c.nombre || 'Vecino'}</strong>
                <p>{c.texto}</p>
              </div>
            ))}
            <form className="community-form" onSubmit={comment}>
              {!user && (
                <label>
                  Tu nombre (opcional)
                  <input name="nombre" maxLength={40} />
                </label>
              )}
              <label>
                Escribe un comentario
                <textarea name="texto" required maxLength={500} rows={3} />
              </label>
              <button className="community-primary">
                <Send />
                Publicar comentario
              </button>
            </form>
          </section>
        </>
      ) : (
        !error && <Empty>Cargando reporte…</Empty>
      )}
    </>
  );
}

function Profile({ user, setUser, notify }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState([]);
  const [votes, setVotes] = useState([]);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState('');
  async function load() {
    try {
      const [reports, supported, queue] = await Promise.all([
        api('/mis-reportes'),
        api(`/mis-votos?fingerprint=${fingerprint()}`),
        drafts(),
      ]);
      setMine(reports);
      setVotes(supported);
      setPending(queue.filter((d) => d.owner === user.email));
    } catch (reason) {
      setError(reason.message);
    }
  }
  useEffect(() => {
    if (user) load();
  }, [user]);
  async function auth(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api(register ? '/auth/registro' : '/auth/login', {
        method: 'POST',
        body: values,
      });
      saveSession(result);
      setUser(await api('/auth/me'));
      notify('Sesión iniciada.');
      await syncDrafts();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  if (!user)
    return (
      <section className="community-section profile-access">
        <h1>{register ? 'Crear cuenta de vecino' : 'Tu cuenta de comunidad'}</h1>
        <p>
          Consulta reportes sin registrarte. Tu cuenta sirve para publicar y seguir tus reportes.
        </p>
        <form className="community-form" onSubmit={auth}>
          {register && (
            <label>
              Tu nombre
              <input name="nombre" required maxLength={60} autoComplete="name" />
            </label>
          )}
          <label>
            Correo electrónico
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              required
              minLength={register ? 12 : 1}
              autoComplete={register ? 'new-password' : 'current-password'}
            />
          </label>
          {register && <small>Usa al menos 12 caracteres.</small>}
          <Message>{error}</Message>
          <button className="community-primary" disabled={busy}>
            {busy ? 'Espera…' : register ? 'Crear mi cuenta' : 'Iniciar sesión'}
          </button>
        </form>
        <button
          onClick={() => {
            setRegister((v) => !v);
            setError('');
          }}
        >
          {register ? 'Ya tengo cuenta' : 'Crear una cuenta'}
        </button>
        <button
          onClick={() => {
            location.hash = '';
            location.search = '?driver=1';
          }}
        >
          <BusFront />
          Soy chofer: entrar con mi cuenta asignada
        </button>
      </section>
    );
  return (
    <>
      <section className="community-section">
        <div className="profile-identity">
          <span>{user.nombre.slice(0, 2).toUpperCase()}</span>
          <div>
            <h1>{user.nombre}</h1>
            <p>{user.email}</p>
          </div>
        </div>
        <div className="community-numbers">
          <div>
            <strong>{mine.length}</strong>Mis reportes
          </div>
          <div>
            <strong>{votes.length}</strong>Mis apoyos
          </div>
          <div>
            <strong>{mine.filter((r) => r.estado === 'aprobado').length}</strong>Resueltos
          </div>
        </div>
        <form
          className="community-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const updated = await api('/auth/perfil', {
                method: 'PATCH',
                body: Object.fromEntries(new FormData(e.currentTarget)),
              });
              setUser({ ...user, ...updated });
              notify('Perfil actualizado.');
            } catch (reason) {
              notify(reason.message);
            }
          }}
        >
          <label>
            Nombre
            <input name="nombre" defaultValue={user.nombre} maxLength={60} required />
          </label>
          <label>
            Colonia de referencia
            <input name="colonia_ref" defaultValue={user.colonia_ref || ''} maxLength={80} />
          </label>
          <button>Guardar perfil</button>
        </form>
        <div className="community-badges">
          <span>{mine.length ? '✓' : '○'} Primer reporte</span>
          <span>
            {mine.length >= 5 ? '✓' : '○'} Vecino activo ({Math.min(5, mine.length)}/5)
          </span>
          <span>
            {votes.length >= 5 ? '✓' : '○'} Apoyo a la comunidad ({Math.min(5, votes.length)}/5)
          </span>
        </div>
      </section>
      <Message>{error}</Message>
      <section className="community-section">
        <h2>Reportes pendientes de envío ({pending.length})</h2>
        {pending.map((item) => (
          <div className="community-comment" key={item.id}>
            <p>{item.descripcion}</p>
            <button
              onClick={async () => {
                await removeDraft(item.id);
                await load();
              }}
            >
              Eliminar borrador
            </button>
          </div>
        ))}
        {pending.length > 0 && (
          <button
            className="community-primary"
            onClick={async () => {
              const result = await syncDrafts();
              notify(
                result.error ||
                  `${result.uploaded} reportes enviados; ${result.pending} pendientes.`
              );
              await load();
            }}
          >
            Intentar enviar ahora
          </button>
        )}
      </section>
      <h2>Mis reportes</h2>
      {mine.length ? (
        mine.map((r) => <ReportCard key={r.id} report={r} refresh={load} notify={notify} />)
      ) : (
        <Empty>Aún no has publicado reportes.</Empty>
      )}
      <h2>Lo que apoyé</h2>
      {votes.map((r) => (
        <ReportCard key={r.id} report={r} refresh={load} notify={notify} />
      ))}
      {user.rol === 'chofer' ? (
        <p>Tu sesión de chofer se administra desde el apartado de transporte.</p>
      ) : (
        <button
          onClick={async () => {
            try {
              await api('/auth/logout', { method: 'POST' });
              saveSession(null);
              setUser(null);
            } catch (reason) {
              notify(reason.message);
            }
          }}
        >
          Cerrar sesión de comunidad
        </button>
      )}
    </>
  );
}

function Statistics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/estadisticas')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  if (!data)
    return (
      <>
        <h1>Estadísticas</h1>
        <Message>{error || 'Cargando…'}</Message>
      </>
    );
  const series = [
    ['Por categoría', data.porCat.map((r) => ({ label: category(r.categoria).name, count: r.n }))],
    ['Por estado', data.estados.map((r) => ({ label: statuses[r.estado], count: r.n }))],
    ['Por colonia', data.porColonia.map((r) => ({ label: r.colonia, count: r.n }))],
    ['Por día', data.porDia.map((r) => ({ label: r.d, count: r.n }))],
  ];
  return (
    <>
      <h1>Así va la comunidad</h1>
      <p>Cifras de los reportes publicados en esta app.</p>
      {series.map(([title, rows]) => (
        <section className="community-section" key={title}>
          <h2>{title}</h2>
          {rows.length ? (
            rows.map((row) => (
              <div className="community-chart-row" key={row.label}>
                <span>{row.label}</span>
                <meter
                  min="0"
                  max={Math.max(1, ...rows.map((r) => r.count))}
                  value={row.count}
                  aria-label={row.label}
                />
                <strong>{row.count}</strong>
              </div>
            ))
          ) : (
            <Empty>Aún no hay datos.</Empty>
          )}
        </section>
      ))}
    </>
  );
}

function Fieldwork({ network, user, notify }) {
  const [points, setPoints] = useState([]);
  const [counts, setCounts] = useState([]);
  const [observations, setObservations] = useState([]);
  const [position, setPosition] = useState(null);
  async function load() {
    try {
      const [p, c, o] = await Promise.all([api('/puntos'), api('/conteos'), api('/observaciones')]);
      setPoints(p);
      setCounts(c);
      setObservations(o);
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function submit(event, path) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (path === '/puntos') {
      if (!position) {
        notify('Elige un punto en el mapa.');
        return;
      }
      values.lat = position[0];
      values.lng = position[1];
    }
    if (path === '/observaciones') values.punto_id = Number(values.punto_id);
    try {
      await api(path, { method: 'POST', body: values });
      form.reset();
      await load();
      notify('Observación guardada.');
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <h1>Trabajo de campo</h1>
      <p>Puntos, condiciones de accesibilidad y conteos observados por el equipo.</p>
      <LocalMap
        network={network}
        points={points}
        pick={user ? setPosition : undefined}
        chosen={position}
      />
      {user ? (
        <>
          <section className="community-section">
            <h2>Agregar un punto</h2>
            <p>Toca el mapa para ubicarlo.{position ? ' Ubicación elegida.' : ''}</p>
            <form className="community-form" onSubmit={(e) => submit(e, '/puntos')}>
              <label>
                Tipo
                <select name="tipo">
                  {['cruce', 'comercio', 'escuela', 'acceso', 'espacio público', 'otro'].map(
                    (t) => (
                      <option key={t}>{t}</option>
                    )
                  )}
                </select>
              </label>
              <label>
                Nombre
                <input name="nombre" required maxLength={120} />
              </label>
              <label>
                Notas
                <textarea name="notas" maxLength={500} />
              </label>
              <label>
                Fuente
                <input
                  name="fuente"
                  placeholder="Visita de campo, entrevista…"
                  required
                  maxLength={120}
                />
              </label>
              <button className="community-primary">Guardar punto</button>
            </form>
          </section>
          <section className="community-section">
            <h2>Condiciones del recorrido</h2>
            <form className="community-form" onSubmit={(e) => submit(e, '/observaciones')}>
              <label>
                Punto
                <select name="punto_id" required>
                  <option value="">Elige un punto</option>
                  {points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Condición
                <select name="tipo">
                  {['banqueta', 'rampa', 'iluminacion', 'obstaculo', 'senalizacion'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Detalle
                <textarea name="detalle" required maxLength={500} />
              </label>
              <button className="community-primary">Guardar observación</button>
            </form>
          </section>
          <section className="community-section">
            <h2>Conteo por horario</h2>
            <form className="community-form" onSubmit={(e) => submit(e, '/conteos')}>
              <label>
                Fecha
                <input name="fecha" type="date" required />
              </label>
              <label>
                Hora
                <input name="hora" type="time" required />
              </label>
              <label>
                Qué contaste
                <select name="tipo">
                  <option value="peatones">Peatones</option>
                  <option value="vehiculos">Vehículos</option>
                </select>
              </label>
              <label>
                Cantidad
                <input name="cantidad" type="number" min="0" required />
              </label>
              <label>
                Duración en minutos
                <input name="minutos" type="number" min="1" required />
              </label>
              <label>
                Notas
                <input name="notas" maxLength={300} />
              </label>
              <button className="community-primary">Guardar conteo</button>
            </form>
          </section>
        </>
      ) : (
        <p>Entra a tu cuenta para agregar observaciones.</p>
      )}
      <section className="community-section">
        <h2>Observaciones registradas ({observations.length})</h2>
        {observations.map((o) => (
          <p key={o.id}>
            <strong>
              {points.find((p) => p.id === o.punto_id)?.nombre || 'Punto'} · {o.tipo}
            </strong>{' '}
            — {o.detalle}
          </p>
        ))}
      </section>
      <section className="community-section">
        <h2>Conteos registrados ({counts.length})</h2>
        {counts.map((c) => (
          <p key={c.id}>
            {c.fecha} · {c.hora} · {c.cantidad} {c.tipo} en {c.minutos} minutos
          </p>
        ))}
      </section>
    </>
  );
}

function Admin({ network, notify, refreshNetwork }) {
  const [key, setKey] = useState('');
  const [reports, setReports] = useState([]);
  const [colonies, setColonies] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState(null);
  const [qrImage, setQrImage] = useState('');
  async function load() {
    try {
      const [r, c, rs] = await Promise.all([
        api('/reportes?limit=200'),
        api('/colonias'),
        api('/rutas'),
      ]);
      setReports([...r].sort((a, b) => urgency(b) - urgency(a)));
      setColonies(c);
      setRoutes(rs);
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    let canceled = false;
    setQrImage('');
    if (qr)
      QRCode.toDataURL(stopLink(qr.id), { width: 300, margin: 2 })
        .then((value) => {
          if (!canceled) setQrImage(value);
        })
        .catch(() => notify('No pudimos generar el QR. Intenta de nuevo.'));
    return () => {
      canceled = true;
    };
  }, [qr]);
  async function state(event, id) {
    event.preventDefault();
    try {
      await api(`/reportes/${id}/estado`, {
        method: 'PATCH',
        headers: { 'X-Admin-Key': key },
        body: Object.fromEntries(new FormData(event.currentTarget)),
      });
      await load();
      notify('Estado y respuesta guardados.');
    } catch (e) {
      notify(e.message);
    }
  }
  async function download(format) {
    try {
      const blob = await api(`/export?format=${format}`, {
        headers: { 'X-Admin-Key': key },
        download: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `las-palmas-reportes.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify(e.message);
    }
  }
  async function importFile(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const file = new FormData(event.currentTarget).get('archivo');
      if (!file?.size || file.size > 1_000_000)
        throw new Error('Selecciona un archivo JSON de hasta 1 MB.');
      const data = JSON.parse(await file.text());
      const allPoints = [
        ...(data.zona ? [[Number(data.zona.lat), Number(data.zona.lng)]] : []),
        ...(data.rutas || []).flatMap((r) => [
          ...(Array.isArray(r.trazo) ? r.trazo : []),
          ...(r.paradas || []).map((p) => [Number(p.lat), Number(p.lng)]),
        ]),
      ];
      if (allPoints.some((p) => !insideCoverage(p, network)))
        throw new Error(
          'Hay puntos fuera de la zona permitida. Corrige el archivo antes de cargarlo.'
        );
      const admin = (path, body) =>
        api('/admin' + path, { method: 'POST', headers: { 'X-Admin-Key': key }, body });
      if (data.zona) await admin('/zona', data.zona);
      for (const route of data.rutas || []) {
        const { paradas, ...rest } = route;
        const created = await admin('/rutas', rest);
        if (paradas?.length) await admin('/paradas', { ruta_id: created.id, paradas });
      }
      await load();
      await refreshNetwork();
      notify('Datos cargados. Las rutas con trazo y paradas válidas ya aparecen en el mapa.');
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>Administración</h1>
      <p>Panel del equipo responsable. La clave autoriza los cambios y las exportaciones.</p>
      <label className="community-admin-key">
        Clave de administración
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
      </label>
      <section className="community-section">
        <h2>Reportes por urgencia</h2>
        {reports.length ? (
          reports.map((r) => (
            <div className="admin-report" key={r.id}>
              <p>
                <strong>
                  {category(r.categoria).name} · {r.colonia || 'Corredor'}
                </strong>
              </p>
              <p>{r.descripcion}</p>
              <p>
                {r.votos} apoyos · prioridad {urgency(r)}
              </p>
              <form className="community-form" onSubmit={(e) => state(e, r.id)}>
                <label>
                  Estado
                  <select name="estado" defaultValue={r.estado}>
                    {Object.entries(statuses).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Respuesta al vecino
                  <input name="nota" maxLength={300} defaultValue={r.nota || ''} />
                </label>
                <button disabled={!key}>Guardar respuesta</button>
              </form>
            </div>
          ))
        ) : (
          <Empty>No hay reportes pendientes.</Empty>
        )}
        <div className="community-actions">
          <button disabled={!key} onClick={() => download('csv')}>
            <Download />
            Descargar CSV
          </button>
          <button disabled={!key} onClick={() => download('geojson')}>
            <Download />
            Descargar GeoJSON
          </button>
        </div>
      </section>
      <section className="community-section">
        <h2>Colonias pendientes de atención</h2>
        {colonies.map((c) => (
          <p key={c.colonia}>
            {c.colonia} · {c.abiertos} abiertos · {c.dias_max_abiertos || 0} días sin resolver
          </p>
        ))}
      </section>
      <section className="community-section">
        <h2>Cargar rutas y paradas</h2>
        <form className="community-form" onSubmit={importFile}>
          <label>
            Archivo JSON del equipo
            <input name="archivo" type="file" accept="application/json" required />
          </label>
          <button className="community-primary" disabled={!key || busy}>
            {busy ? 'Cargando…' : 'Cargar datos'}
          </button>
        </form>
        {routes.map((r) => (
          <div key={r.id} className="community-comment">
            <strong>{r.nombre}</strong>
            <p>{r.trazo ? 'Trazo guardado' : 'Falta calcular el trazo por calles'}</p>
            <button
              disabled={!key || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await api(`/admin/rutas/${r.id}/trazar`, {
                    method: 'POST',
                    signal: AbortSignal.timeout(120000),
                    headers: { 'X-Admin-Key': key },
                    body: {},
                  });
                  await load();
                  await refreshNetwork();
                  notify(result.advertencia || `Recorrido ajustado: ${result.distancia_m} metros.`);
                } catch (e) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ajustar recorrido a las calles
            </button>
          </div>
        ))}
      </section>
      <section className="community-section">
        <h2>QR de paradas</h2>
        <label>
          Parada
          <select
            value={qr?.id || ''}
            onChange={(e) => setQr(network.stops.find((s) => s.id === e.target.value))}
          >
            <option value="">Elige una parada</option>
            {network.stops.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name.replace(' · demo', '')}
              </option>
            ))}
          </select>
        </label>
        {qr && (
          <div className="community-qr">
            <h3>{qr.name.replace(' · demo', '')}</h3>
            {qrImage && <img src={qrImage} alt={`QR de ${qr.name}`} />}
            <p>{stopLink(qr.id)}</p>
            <a href={qrImage} download={`parada-${qr.id}.png`}>
              Descargar QR
            </a>
            <button onClick={() => window.print()}>Imprimir etiqueta</button>
          </div>
        )}
      </section>
    </>
  );
}

export default function CommunityPanel({ network, route, refreshNetwork }) {
  const [user, setUser] = useState(() => {
    const saved = session();
    return saved?.nombre
      ? saved
      : saved?.driver
        ? { nombre: saved.driver.name, email: saved.driver.email, rol: 'chofer' }
        : null;
  });
  const [reports, setReports] = useState([]);
  const [colonies, setColonies] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [cat, setCat] = useState('');
  const [colony, setColony] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const page = route.split('/')[1] || 'comunidad';
  async function load(append = false) {
    const ticket = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        q: query,
        estado: status,
        categoria: cat,
        colonia: colony,
        limit: page === 'mapa' ? 200 : 20,
        offset: append ? offset : 0,
      });
      const data = await api('/reportes?' + params);
      if (ticket !== generation.current) return;
      setReports((current) => (append ? [...current, ...data] : data));
      setOffset((append ? offset : 0) + data.length);
      setHasMore(data.length === 20);
    } catch (e) {
      if (ticket === generation.current) setError(e.message);
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 250);
    return () => clearTimeout(timer);
  }, [query, status, cat, colony, page]);
  useEffect(() => {
    api('/colonias')
      .then(setColonies)
      .catch(() => {});
    if (session())
      api('/auth/me')
        .then(setUser)
        .catch((error) => {
          if (error.status === 401) {
            saveSession(null);
            setUser(null);
          }
        });
  }, []);
  useEffect(() => {
    const change = async () => {
      setOnline(navigator.onLine);
      const result = await syncDrafts();
      setPending(result.pending);
      if (result.uploaded) {
        setMessage(`${result.uploaded} reportes enviados.`);
        await load();
      }
    };
    change().catch(() => {});
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, [user]);
  return (
    <div className="community-root">
      <header className="community-header">
        <button
          onClick={() => {
            location.hash = '';
          }}
        >
          <ArrowLeft />
          Volver a transporte
        </button>
        <img src="./brand/las-palmas-logo.png" alt="Las Palmas Rutas" />
        <span>
          {!online && <WifiOff />}
          {online ? 'En línea' : 'Sin señal'}
          {pending > 0 ? ` · ${pending} guardados` : ''}
        </span>
      </header>
      <nav className="community-nav" aria-label="Comunidad">
        <button
          aria-current={page === 'comunidad' ? 'page' : undefined}
          onClick={() => go('/comunidad')}
        >
          <Newspaper />
          Reportes
        </button>
        <button aria-current={page === 'mapa' ? 'page' : undefined} onClick={() => go('/mapa')}>
          <MapPin />
          Mapa
        </button>
        <button aria-current={page === 'perfil' ? 'page' : undefined} onClick={() => go('/perfil')}>
          <UserRound />
          Mi cuenta
        </button>
        <details>
          <summary>Más</summary>
          <button onClick={() => go('/estadisticas')}>Estadísticas</button>
          <button onClick={() => go('/campo')}>Trabajo de campo</button>
          <button onClick={() => go('/admin')}>Administración</button>
        </details>
      </nav>
      <main className="community-content">
        <Message>{message}</Message>
        {page === 'reporte' ? (
          <ReportDetail id={route.split('/')[2]} user={user} notify={setMessage} />
        ) : page === 'perfil' ? (
          <Profile user={user} setUser={setUser} notify={setMessage} />
        ) : page === 'estadisticas' ? (
          <Statistics />
        ) : page === 'campo' ? (
          <Fieldwork network={network} user={user} notify={setMessage} />
        ) : page === 'admin' ? (
          <Admin network={network} notify={setMessage} refreshNetwork={refreshNetwork} />
        ) : page === 'mapa' ? (
          <>
            <h1>Problemas en la zona</h1>
            <LocalMap network={network} reports={reports} />
            <div className="community-actions">
              {categories.map((c) => (
                <span key={c.id} style={{ color: c.color }}>
                  ● {c.name}
                </span>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="community-title">
              <div>
                <h1>Tu comunidad</h1>
                <p>Reporta un problema y sigue lo que pasa en tu zona.</p>
              </div>
              <button className="community-primary" onClick={() => setCreating(true)}>
                <Plus />
                Nuevo reporte
              </button>
            </div>
            <div className="community-filters">
              <label>
                Buscar reportes
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Una calle o un problema"
                />
              </label>
              <label>
                Estado
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Todos</option>
                  {Object.entries(statuses).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Problema
                <select value={cat} onChange={(e) => setCat(e.target.value)}>
                  <option value="">Todos</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Colonia
                <select value={colony} onChange={(e) => setColony(e.target.value)}>
                  <option value="">Toda la zona</option>
                  {colonies.map((c) => (
                    <option key={c.colonia}>{c.colonia}</option>
                  ))}
                </select>
              </label>
            </div>
            <Message>{error}</Message>
            {error && <button onClick={() => load()}>Volver a intentar</button>}
            {reports.map((r) => (
              <ReportCard key={r.id} report={r} refresh={() => load()} notify={setMessage} />
            ))}
            {loading ? (
              <Empty>Cargando reportes…</Empty>
            ) : (
              !reports.length &&
              !error && <Empty>Aún no hay reportes aquí. Puedes publicar el primero.</Empty>
            )}
            {hasMore && (
              <button disabled={loading} onClick={() => load(true)}>
                Ver más reportes
              </button>
            )}
          </>
        )}
      </main>
      {creating && (
        <CreateReport
          network={network}
          user={user}
          close={() => setCreating(false)}
          refresh={() => {
            load();
            syncDrafts().then((r) => setPending(r.pending));
          }}
          notify={setMessage}
        />
      )}
    </div>
  );
}
