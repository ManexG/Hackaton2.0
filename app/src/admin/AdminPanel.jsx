import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  LogOut,
  Pencil,
  Plus,
  Route as RouteIcon,
  ShieldCheck,
  Trash2,
  Users,
  KeyRound,
} from 'lucide-react';
import { adminSession, manage, saveAdminSession } from './adminApi.js';
import { RoutesTab } from './RouteEditor.jsx';
import './admin.css';
import { OfflineNotice } from '../connectivity.jsx';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const goBack = () => {
  location.hash = '';
};

/** Panel de administración: rutas, choferes y administradores. Ruta: #/gestion */
export default function AdminPanel({ network, refreshNetwork }) {
  const [session, setSession] = useState(adminSession);
  const [tab, setTab] = useState('routes');
  const [toast, setToast] = useState(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const notify = (text, error = false) => {
    setToast({ text, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 6000);
  };
  const token = session?.token;
  function persist(value) {
    saveAdminSession(value);
    setSession(value);
  }
  // Si el servidor responde 401 en cualquier pestaña, se cierra la sesión local.
  const guarded = (error) => {
    if (error?.status === 401) persist(null);
    notify(error.message, true);
  };

  if (!session) return <Login onSession={persist} onBack={goBack} />;
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <button className="admin-btn" onClick={goBack}>
          <ArrowLeft size={16} /> Mapa
        </button>
        <div>
          <strong>Administración</strong>
          <small>{session.admin.name}</small>
        </div>
        <button
          className="admin-btn"
          onClick={async () => {
            await manage('/logout', { body: {}, token }).catch(() => {});
            persist(null);
          }}
        >
          <LogOut size={16} /> Salir
        </button>
      </header>
      <nav className="admin-tabs" role="tablist">
        {[
          ['routes', 'Rutas', RouteIcon],
          ['drivers', 'Choferes', Users],
          ['admins', 'Administradores', ShieldCheck],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>
      {toast && (
        <p
          className={'admin-toast' + (toast.error ? ' error' : '')}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.text}
        </p>
      )}
      <main>
        <OfflineNotice />
        {tab === 'routes' && (
          <RoutesTab network={network} token={token} notify={notify} onChanged={refreshNetwork} />
        )}
        {tab === 'drivers' && <DriversTab token={token} notify={notify} guarded={guarded} />}
        {tab === 'admins' && (
          <AdminsTab token={token} me={session.admin} notify={notify} guarded={guarded} />
        )}
      </main>
    </div>
  );
}

function Login({ onSession, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSession(await manage('/login', { body: { email, password } }));
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-shell admin-login">
      <OfflineNotice />
      <form className="admin-card" onSubmit={submit}>
        <h1>Acceso de administración</h1>
        <p className="admin-muted">
          Solo para personal autorizado. Los choferes inician sesión desde “Soy chofer”.
        </p>
        <label>
          Correo
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="admin-toast error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-actions">
          <button type="button" className="admin-btn" onClick={onBack}>
            Volver al mapa
          </button>
          <button className="admin-btn primary" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Secret({ title, password, onClose }) {
  return (
    <div className="admin-secret" role="alert">
      <strong>{title}</strong>
      <code>{password}</code>
      <p className="admin-muted">
        Se muestra una sola vez. Entrégala únicamente a la persona correspondiente.
      </p>
      <div className="admin-actions">
        <button className="admin-btn" onClick={() => navigator.clipboard?.writeText(password)}>
          <Copy size={14} /> Copiar
        </button>
        <button className="admin-btn primary" onClick={onClose}>
          Listo
        </button>
      </div>
    </div>
  );
}

const emptyDriver = {
  name: '',
  email: '',
  unit: '',
  routeId: '',
  windows: [{ days: [1, 2, 3, 4, 5], start: '06:00', end: '22:00' }],
};

function DriversTab({ token, notify, guarded }) {
  const [drivers, setDrivers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [form, setForm] = useState(null);
  const [secret, setSecret] = useState(null);
  async function load() {
    try {
      const [list, routeData] = await Promise.all([
        manage('/drivers', { token }),
        manage('/routes', { token }),
      ]);
      setDrivers(list);
      setRoutes(routeData.routes);
    } catch (error) {
      guarded(error);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function submit(event) {
    event.preventDefault();
    const { id, ...body } = form;
    try {
      if (id) {
        await manage('/drivers/' + id, { method: 'PATCH', body, token });
        notify('Chofer actualizado.');
      } else {
        const created = await manage('/drivers', { body, token });
        setSecret({
          title: `Contraseña inicial de ${created.driver.name}`,
          password: created.password,
        });
      }
      setForm(null);
      load();
    } catch (error) {
      guarded(error);
    }
  }
  async function reset(driver) {
    if (!confirm(`¿Restablecer la contraseña de ${driver.name}? Se cerrará su sesión.`)) return;
    try {
      const result = await manage(`/drivers/${driver.id}/reset-password`, { body: {}, token });
      setSecret({ title: `Nueva contraseña de ${driver.name}`, password: result.password });
      load();
    } catch (error) {
      guarded(error);
    }
  }
  async function remove(driver) {
    if (!confirm(`¿Eliminar la cuenta de ${driver.name}?`)) return;
    try {
      await manage('/drivers/' + driver.id, { method: 'DELETE', token });
      notify('Cuenta eliminada.');
      load();
    } catch (error) {
      guarded(error);
    }
  }
  const setWindow = (i, patch) =>
    setForm((f) => ({
      ...f,
      windows: f.windows.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    }));
  return (
    <section className="admin-panel-section">
      <div className="admin-row">
        <h2>Choferes</h2>
        <button
          className="admin-btn primary"
          disabled={!routes.length}
          onClick={() => setForm({ ...emptyDriver, routeId: routes[0]?.id ?? '' })}
        >
          <Plus size={16} /> Dar de alta
        </button>
      </div>
      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
      {form && (
        <form className="admin-card" onSubmit={submit}>
          <h3>{form.id ? 'Editar chofer' : 'Nuevo chofer'}</h3>
          <div className="admin-grid">
            <label>
              Nombre
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Correo
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              Unidad
              <input
                required
                maxLength={24}
                pattern="[a-zA-Z0-9 \-]{1,24}"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </label>
            <label>
              Ruta
              <select
                required
                value={form.routeId}
                onChange={(e) => setForm({ ...form, routeId: e.target.value })}
              >
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.id} · {route.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h4>Horario (hora de Lázaro Cárdenas)</h4>
          {form.windows.map((window, i) => (
            <div className="admin-window" key={i}>
              <div className="admin-days">
                {DAYS.map((label, day) => (
                  <label key={day} className="admin-check">
                    <input
                      type="checkbox"
                      checked={window.days.includes(day)}
                      onChange={(e) =>
                        setWindow(i, {
                          days: e.target.checked
                            ? [...window.days, day].sort()
                            : window.days.filter((d) => d !== day),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <input
                type="time"
                aria-label="Inicio"
                required
                value={window.start}
                onChange={(e) => setWindow(i, { start: e.target.value })}
              />
              <input
                type="time"
                aria-label="Fin"
                required
                value={window.end}
                onChange={(e) => setWindow(i, { end: e.target.value })}
              />
              {form.windows.length > 1 && (
                <button
                  type="button"
                  className="admin-icon danger"
                  aria-label="Quitar horario"
                  onClick={() =>
                    setForm({ ...form, windows: form.windows.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <div className="admin-actions">
            <button
              type="button"
              className="admin-btn"
              onClick={() =>
                setForm({
                  ...form,
                  windows: [...form.windows, { days: [6], start: '08:00', end: '14:00' }],
                })
              }
            >
              <Plus size={14} /> Otro horario
            </button>
            <button type="button" className="admin-btn" onClick={() => setForm(null)}>
              Cancelar
            </button>
            <button className="admin-btn primary">
              {form.id ? 'Guardar cambios' : 'Crear cuenta'}
            </button>
          </div>
          {!form.id && (
            <p className="admin-muted">
              La contraseña inicial se genera automáticamente y se muestra una sola vez.
            </p>
          )}
        </form>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Chofer</th>
              <th>Unidad</th>
              <th>Ruta</th>
              <th>Horario</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver) => (
              <tr key={driver.id}>
                <td>
                  <strong>{driver.name}</strong>
                  <small>{driver.email}</small>
                </td>
                <td>{driver.unit}</td>
                <td>{driver.routeId}</td>
                <td>
                  {driver.windows.map((w, i) => (
                    <small key={i}>
                      {w.days.map((d) => DAYS[d]).join(' ')} {w.start}–{w.end}
                    </small>
                  ))}
                </td>
                <td>{driver.active ? 'En servicio' : 'Fuera de servicio'}</td>
                <td className="admin-cell-actions">
                  <button
                    className="admin-icon"
                    aria-label={`Editar ${driver.name}`}
                    onClick={() =>
                      setForm({
                        id: driver.id,
                        name: driver.name,
                        email: driver.email,
                        unit: driver.unit,
                        routeId: driver.routeId,
                        windows: driver.windows,
                      })
                    }
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="admin-icon"
                    aria-label={`Restablecer contraseña de ${driver.name}`}
                    onClick={() => reset(driver)}
                  >
                    <KeyRound size={15} />
                  </button>
                  <button
                    className="admin-icon danger"
                    aria-label={`Eliminar ${driver.name}`}
                    onClick={() => remove(driver)}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!drivers.length && (
          <p className="admin-muted">Aún no hay choferes. Da de alta el primero.</p>
        )}
      </div>
    </section>
  );
}

function AdminsTab({ token, me, notify, guarded }) {
  const [admins, setAdmins] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [own, setOwn] = useState('');
  async function load() {
    try {
      setAdmins(await manage('/admins', { token }));
    } catch (error) {
      guarded(error);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function add(event) {
    event.preventDefault();
    try {
      await manage('/admins', { body: form, token });
      setForm({ name: '', email: '', password: '' });
      notify('Administrador agregado.');
      load();
    } catch (error) {
      guarded(error);
    }
  }
  async function remove(admin) {
    if (!confirm(`¿Eliminar al administrador ${admin.name}?`)) return;
    try {
      await manage('/admins/' + admin.id, { method: 'DELETE', token });
      load();
    } catch (error) {
      guarded(error);
    }
  }
  async function changeOwn(event) {
    event.preventDefault();
    try {
      await manage('/admins/me/password', { body: { password: own }, token });
      setOwn('');
      notify('Contraseña actualizada.');
    } catch (error) {
      guarded(error);
    }
  }
  return (
    <section className="admin-panel-section">
      <h2>Administradores</h2>
      <ul className="admin-people">
        {admins.map((admin) => (
          <li key={admin.id}>
            <div>
              <strong>{admin.name}</strong>
              <small>{admin.email}</small>
            </div>
            {admin.id === me.id ? (
              <span className="admin-muted">Tú</span>
            ) : (
              <button
                className="admin-icon danger"
                aria-label={`Eliminar a ${admin.name}`}
                onClick={() => remove(admin)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="admin-card" onSubmit={add}>
        <h3>Agregar administrador</h3>
        <div className="admin-grid">
          <label>
            Nombre
            <input
              required
              maxLength={80}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Correo
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Contraseña inicial (mín. 12)
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
        </div>
        <button className="admin-btn primary">Agregar</button>
      </form>
      <form className="admin-card" onSubmit={changeOwn}>
        <h3>Cambiar mi contraseña</h3>
        <label>
          Nueva contraseña (mín. 12)
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={own}
            onChange={(e) => setOwn(e.target.value)}
          />
        </label>
        <button className="admin-btn">Actualizar</button>
      </form>
    </section>
  );
}
