/**
 * ESQUELETO — Perfil. Dos situaciones: sin sesión (entrar / crear cuenta)
 * y con sesión (identidad, cifras, mis reportes, lo que apoyé).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn,
  UserPlus,
  ThumbsUp,
  ClipboardList,
  Award,
  Flame,
  Megaphone,
  Bus,
  Check,
} from 'lucide-react';
import { api, CATEGORIAS_POR_CLAVE } from '../api.js';
import { useSesion } from '../sesion.jsx';
import { Cargando, Vacio } from '../components/EstadosUI.jsx';
import { BarraEstado } from '../components/Estados.jsx';

const cat = (clave) => CATEGORIAS_POR_CLAVE[clave];

export function Perfil() {
  const { usuario, cargando, entrar, registrar, salir } = useSesion();
  const navegar = useNavigate();
  const [vista, setVista] = useState('entrar'); // 'entrar' | 'crear'
  const [rolElegido, setRolElegido] = useState('vecino');
  const [error, setError] = useState(null);
  const [trabajo, setTrabajo] = useState(false);
  const [misReportes, setMisReportes] = useState([]);
  const [misVotos, setMisVotos] = useState([]);

  useEffect(() => {
    if (!usuario) return;
    Promise.all([api.misReportes(), api.misVotos()])
      .then(([r, v]) => {
        setMisReportes(r);
        setMisVotos(v);
      })
      .catch(() => {});
  }, [usuario]);

  const resueltos = misReportes.filter((r) => r.estado === 'aprobado').length;

  /* ---------------- SIN SESIÓN ---------------- */
  if (cargando) return <Cargando filas={2} />;

  if (!usuario) {
    return (
      <section data-testid="perfil-anon">
        {/* DISEÑA: acceso.
            - Solo UN formulario visible a la vez; el otro detrás de un enlace
              ("¿No tienes cuenta? Crear cuenta") y viceversa.
              Dos formularios apilados confunden a quien no usa apps.
            - Campos grandes, botón grande, mensajes de error claros.
            - aquí se llama a entrar() o registrar() */}

        {vista === 'entrar' ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setTrabajo(true);
              setError(null);
              const f = new FormData(e.currentTarget);
              try {
                await entrar(f.get('email'), f.get('password'));
              } catch (err) {
                setError(err.message);
              } finally {
                setTrabajo(false);
              }
            }}
          >
            <h2><LogIn /> Entrar</h2>
            <input name="email" type="email" placeholder="tu@correo.com" autoComplete="username" />
            <input name="password" type="password" placeholder="Contraseña" autoComplete="current-password" />
            <button disabled={trabajo}>Entrar</button>
            {error && <p role="alert">{error}</p>}
          </form>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setTrabajo(true);
              setError(null);
              const f = new FormData(e.currentTarget);
              try {
                // El rol se elige aquí, no en una pantalla aparte: quien abre la
                // app por primera vez solo ve este formulario.
                await registrar(f.get('nombre'), f.get('email'), f.get('password'), rolElegido);
                // Si se hizo chofer, lo lleva directo a donde puede empezar a
                // trabajar; si no, se queda donde está.
                if (rolElegido === 'chofer') navegar('/chofer');
              } catch (err) {
                setError(err.message);
              } finally {
                setTrabajo(false);
              }
            }}
          >
            <h2><UserPlus /> Crear cuenta</h2>

            <p className="pregunta-ruta">¿Cómo vas a usar la app?</p>
            <div className="tarjetas-ruta" role="radiogroup" aria-label="Elige cómo vas a usar la app">
              <button
                type="button"
                role="radio"
                aria-checked={rolElegido === 'vecino'}
                className={`tarjeta-ruta${rolElegido === 'vecino' ? ' elegida' : ''}`}
                style={{ '--ruta-color': '#238361' }}
                onClick={() => setRolElegido('vecino')}
              >
                <span className="punto-ruta" aria-hidden="true" />
                <span className="nombre-ruta">Soy vecino</span>
                <span className="detalle-opcion">Reportar problemas y ver las combis</span>
                {rolElegido === 'vecino' && (
                  <span className="palomita"><Check size={16} /></span>
                )}
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={rolElegido === 'chofer'}
                className={`tarjeta-ruta${rolElegido === 'chofer' ? ' elegida' : ''}`}
                style={{ '--ruta-color': '#e58b38' }}
                onClick={() => setRolElegido('chofer')}
              >
                <span className="punto-ruta" aria-hidden="true" />
                <span className="nombre-ruta">Soy chofer</span>
                <span className="detalle-opcion">Compartir la ubicación de mi combi</span>
                {rolElegido === 'chofer' && (
                  <span className="palomita"><Check size={16} /></span>
                )}
              </button>
            </div>

            <input name="nombre" placeholder="Tu nombre" autoComplete="name" />
            <input name="email" type="email" placeholder="tu@correo.com" autoComplete="username" />
            <input name="password" type="password" placeholder="Contraseña (6+)" autoComplete="new-password" />
            <button disabled={trabajo}>{trabajo ? 'Creando cuenta...' : 'Crear cuenta'}</button>
            {error && <p role="alert">{error}</p>}
          </form>
        )}

        <button className="boton-enlace" onClick={() => setVista(vista === 'entrar' ? 'crear' : 'entrar')}>
          {vista === 'entrar' ? '¿No tienes cuenta? Crear cuenta' : '¿Ya tienes cuenta? Entrar'}
        </button>
      </section>
    );
  }

  /* ---------------- CON SESIÓN ---------------- */
  return (
    <section data-testid="perfil-user">
      {/* DISEÑA: identidad.
          - Avatar con iniciales (generado en CSS, sin subir foto: cero fricción)
          - Nombre + correo
          - TRES CIFRAS grandes: reportes / apoyos / resueltos.
            Estas cifras son lo que hace que el vecino sienta que su cuenta cuenta.
          - Cerrar sesión discreto abajo, con confirmación. */}
      <header>
        <div data-avatar>{usuario.nombre.slice(0, 2).toUpperCase()}</div>
        <h1>{usuario.nombre}</h1>
        <p>{usuario.email}</p>
        <dl>
          <div><dt>Reportes</dt><dd>{misReportes.length}</dd></div>
          <div><dt>Apoyos</dt><dd>{misVotos.length}</dd></div>
          <div><dt>Resueltos</dt><dd>{resueltos}</dd></div>
        </dl>
      </header>

      {/* DISEÑA: insignias de participación (Primer reporte, Vecino activo, etc).
          Sugerencia: cada insignia con su progreso (3 de 5) y las pendientes en gris.
          Los íconos de Lucide ya están importados: Award, Flame, ThumbsUp, Megaphone. */}
      <section data-testid="insignias">
        <span><Award /> Primer reporte</span>
        <span><Flame /> Vecino activo</span>
        <span><ThumbsUp /> Padrino de reportes</span>
        <span><Megaphone /> Tu reporte se hizo viral</span>
      </section>

      {/* DISEÑA: "Mis reportes" como tarjetas pequeñas con la BarraEstado,
          para ver de un vistazo cuáles siguen abiertos y cuáles ya se arreglaron. */}
      <section>
        <h2><ClipboardList /> Mis reportes</h2>
        {misReportes.length === 0 ? (
          <Vacio titulo="Aún no reportas nada" texto="Cuando reportes, aquí verás si se resolvió." />
        ) : (
          <ul>
            {misReportes.map((r) => (
              <li key={r.id} data-estado={r.estado}>
                <strong>{cat(r.categoria)?.etiqueta ?? r.categoria}</strong>
                <span>{r.colonia || 'Sin colonia'}</span>
                <BarraEstado estado={r.estado} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* DISEÑA: "Lo que apoyé" — aquí está el corazón de la app:
          si algo que apoyaste terminó ARREGLADO, destacarlo.
          "Arreglado · tu apoyo ayudó" es el momento que cierra el ciclo
          y hace que la gente vuelva a abrir la app. */}
      <section>
        <h2><ThumbsUp /> Lo que apoyé</h2>
        {misVotos.length === 0 ? (
          <Vacio titulo="No has apoyado nada" texto="Apoya el reporte de un vecino para que lo vean más." />
        ) : (
          <ul>
            {misVotos.map((v) => (
              <li key={v.id} data-estado={v.estado}>
                <strong>{cat(v.categoria)?.etiqueta ?? v.categoria}</strong>
                <span>{v.colonia || 'Sin colonia'}</span>
                {v.estado === 'aprobado' && <em>Arreglado · tu apoyo ayudó</em>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Si la cuenta es de chofer, el acceso a su apartado también desde aquí:
          quien ya se registró antes de que existiera la pestaña lo encuentra igual. */}
      {usuario.rol === 'chofer' && (
        <a className="enlace-panel" href="/chofer">
          <Bus /> Ir a mi apartado de chofer
        </a>
      )}

      <button className="boton-secundario" onClick={salir}>Cerrar sesión</button>
    </section>
  );
}