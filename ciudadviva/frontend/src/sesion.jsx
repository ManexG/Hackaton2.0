/**
 * sesion.jsx — contexto de autenticación.
 * Envuelve login/registro/logout y expone el usuario a toda la app.
 * NO lo modifica el equipo de diseño: solo se usa desde las pantallas.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearSession, getToken, setSession } from './api.js';

const ContextoSesion = createContext(null);

export function ProveedorSesion({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  // Al abrir la app, comprobamos si el token guardado sigue siendo válido.
  useEffect(() => {
    if (!getToken()) {
      setCargando(false);
      return;
    }
    api
      .yo()
      .then((u) => {
        setUsuario(u);
        localStorage.setItem('lcalerta_rol', u.rol || 'vecino');
      })
      .catch(() => clearSession())
      .finally(() => setCargando(false));
  }, []);

  const entrar = useCallback(async (email, password) => {
    const d = await api.login(email, password);
    setSession(d);
    setUsuario({ nombre: d.nombre, email: d.email, rol: d.rol || 'vecino' });
    return d;
  }, []);

  const registrar = useCallback(async (nombre, email, password, rol = 'vecino') => {
    const d = await api.registro(nombre, email, password, rol);
    setSession(d);
    setUsuario({ nombre: d.nombre, email: d.email, rol: d.rol || 'vecino' });
    return d;
  }, []);

  const salir = useCallback(() => {
    clearSession();
    setUsuario(null);
  }, []);

  const editarPerfil = useCallback(async (nombre, colonia_ref) => {
    const actualizado = await api.editarPerfil(nombre, colonia_ref);
    setUsuario((u) => ({ ...u, ...actualizado }));
    if (actualizado.nombre) localStorage.setItem('lcalerta_nombre', actualizado.nombre);
    return actualizado;
  }, []);

  const valor = useMemo(
    () => ({ usuario, cargando, entrar, registrar, salir, editarPerfil }),
    [usuario, cargando, entrar, registrar, salir, editarPerfil]
  );
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion() {
  const ctx = useContext(ContextoSesion);
  if (!ctx) throw new Error('useSesion debe usarse dentro de <ProveedorSesion>');
  return ctx;
}