import { apiBase, ConnectionError } from '../liveApi.js';

// Cliente de la administración (/api/manage/*). La sesión vive solo en esta pestaña.
const KEY = 'cerca.admin';
export function adminSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return value && value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}
export function saveAdminSession(value) {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: la sesión dura mientras la página esté abierta */
  }
}

export async function manage(path, { method, body, token } = {}) {
  if (!apiBase) throw new ConnectionError('El servicio aún no está conectado.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(apiBase + '/manage' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      signal: controller.signal,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ConnectionError(data?.message ?? 'No se pudo completar la operación.', response.status);
    return data;
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError('No pudimos conectar con el servicio. Comprueba tu conexión.');
  } finally {
    clearTimeout(timer);
  }
}
