/**
 * api.js — cliente único de la API.
 *
 * IMPORTANTE: este archivo no lo modifica el equipo de diseño.
 * Si necesitan un dato nuevo, primero se agrega aquí (o se avisa) y luego se usa.
 * Así el contrato con el backend se mantiene en un solo lugar.
 */

const BASE = ''; // mismo origen: en dev el proxy de Vite lo resuelve, en prod es el Worker

/**
 * URL pública de la app, para los QR que se IMPRIMEN en papel.
 *
 * No usar `window.location.origin`: las etiquetas se generan desde /admin, que en
 * desarrollo corre en localhost. Un QR con `localhost` no abre nada cuando alguien
 * lo escanea en la calle, y el papel ya está impreso. Por eso es una constante fija
 * que se puede cambiar con VITE_URL_PUBLICA.
 */
const URL_PUBLICA = (import.meta.env?.VITE_URL_PUBLICA || 'https://lcalerta.ac-mx.workers.dev').replace(/\/+$/, '');

/**
 * Escapa texto antes de inyectarlo como HTML.
 * Los popups y tooltips de Leaflet se arman con template strings, así que
 * cualquier nombre de ruta, parada o combi se interpretaría como marcado.
 * Todos los textos que vengan de la base de datos deben pasar por aquí.
 */
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const CATEGORIAS = [
  { clave: 'alumbrado', etiqueta: 'Alumbrado', icono: 'lightbulb', color: 'var(--color-cat-alumbrado)' },
  { clave: 'bache', etiqueta: 'Bache', icono: 'alert-triangle', color: 'var(--color-cat-bache)' },
  { clave: 'basura', etiqueta: 'Basura', icono: 'trash-2', color: 'var(--color-cat-basura)' },
  { clave: 'fuga_agua', etiqueta: 'Fuga de agua', icono: 'droplet', color: 'var(--color-cat-fuga)' },
  { clave: 'otro', etiqueta: 'Otro', icono: 'help-circle', color: 'var(--color-cat-otro)' },
];

/** Búsqueda rápida de una categoría por clave. */
export const CATEGORIAS_POR_CLAVE = Object.fromEntries(CATEGORIAS.map((c) => [c.clave, c]));

export const ESTADOS = [
  { clave: 'enviado', etiqueta: 'Enviado', icono: 'send' },
  { clave: 'recibido', etiqueta: 'Visto por el ayuntamiento', icono: 'eye' },
  { clave: 'aprobado', etiqueta: 'Arreglado', icono: 'check-circle-2' },
  { clave: 'no_aprobado', etiqueta: 'No aplica', icono: 'x-circle' },
];

// Identificador anónimo del dispositivo: permite el voto único sin obligar a iniciar sesión.
// Se genera una sola vez y se guarda en el navegador.
export const fingerprint = (() => {
  const clave = 'lcalerta_fp';
  let v = localStorage.getItem(clave);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(clave, v);
  }
  return v;
})();

/**
 * Servicio de geolocalización.
 *
 * Se abstrae porque la app se va a empaquetar con Capacitor: en nativo conviene
 * usar el plugin de Capacitor (mejor precisión y seguimiento en segundo plano),
 * y en navegador la Web API. Si escribimos navigator.geolocation directo en las
 * pantallas, habrá que rehacerlo cuando exista el build nativo.
 *
 * TODO(equipo de móvil): al integrar Capacitor, sustituir la rama web por
 * import { Geolocation } from '@capacitor/geolocation'.
 */

/** Posición actual, una vez. */
export function posicionActual({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Este dispositivo no reporta ubicación'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, velocidad: p.coords.speed, precision: p.coords.accuracy }),
      (err) =>
        reject(
          new Error(
            err.code === 1 ? 'Permiso de ubicación denegado' : 'No se pudo obtener la ubicación'
          )
        ),
      { enableHighAccuracy: true, timeout, maximumAge: 5000 }
    );
  });
}

/**
 * Seguimiento continuo (para el chofer).
 * Devuelve una función para detenerlo.
 */
export function seguirPosicion({ alRecibir, alError, intervaloMs = 5000 } = {}) {
  let timer = null;
  let activo = false;

  const pedir = async () => {
    try {
      alRecibir(await posicionActual({ timeout: intervaloMs }));
    } catch (e) {
      alError?.(e);
    }
  };

  const alVolver = () => {
    if (document.visibilityState === 'visible' && activo) pedir();
  };

  activo = true;
  pedir();
  timer = setInterval(pedir, intervaloMs);
  document.addEventListener('visibilitychange', alVolver);

  return function parar() {
    activo = false;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', alVolver);
  };
}

export function getToken() {
  return localStorage.getItem('lcalerta_token');
}

export function setSession({ token, nombre }) {
  localStorage.setItem('lcalerta_token', token);
  localStorage.setItem('lcalerta_nombre', nombre);
}

export function clearSession() {
  localStorage.removeItem('lcalerta_token');
  localStorage.removeItem('lcalerta_nombre');
  localStorage.removeItem('lcalerta_rol');
}

/** Error con el código HTTP, para que cada pantalla decida qué mostrar. */
export class ApiError extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.status = status;
  }
}

async function pedir(ruta, opciones = {}) {
  const cabeceras = { ...(opciones.headers || {}) };
  const token = getToken();
  if (token) cabeceras.authorization = `Bearer ${token}`;

  let cuerpo;
  if (opciones.body instanceof FormData) {
    cuerpo = opciones.body; // el navegador pone el boundary del multipart
  } else if (opciones.body) {
    cabeceras['content-type'] = 'application/json';
    cuerpo = JSON.stringify(opciones.body);
  }

  const res = await fetch(BASE + ruta, { ...opciones, headers: cabeceras, body: cuerpo });

  if (res.status === 204) return null;

  // El servidor siempre responde JSON; si no, es un error de red o una ruta mal.
  let datos = null;
  try {
    datos = await res.json();
  } catch {
    throw new ApiError('El servidor no respondió correctamente', res.status);
  }

  if (!res.ok) throw new ApiError(datos?.error || 'Ocurrió un error', res.status);
  return datos;
}

export const api = {
  // --- público ---
  categorias: () => pedir('/api/categorias'),
  reportes: ({ estado, categoria, colonia, q, limit = 20, offset = 0 } = {}) => {
    const p = new URLSearchParams({ limit, offset });
    if (estado) p.set('estado', estado);
    if (categoria) p.set('categoria', categoria);
    if (colonia) p.set('colonia', colonia);
    if (q) p.set('q', q);
    return pedir(`/api/reportes?${p}`);
  },
  reporte: (id) => pedir(`/api/reportes/${id}`),
  historial: (id) => pedir(`/api/reportes/${id}/historial`),
  comentarios: (id) => pedir(`/api/reportes/${id}/comentarios`),
  colonias: () => pedir('/api/colonias'),
  estadisticas: () => pedir('/api/estadisticas'),
  fotoUrl: (foto_key) => (foto_key ? `${BASE}/api/foto/${foto_key}` : null),

  // --- sesión ---
  registro: (nombre, email, password, rol) => pedir('/api/auth/registro', { method: 'POST', body: { nombre, email, password, rol } }),
  login: (email, password) => pedir('/api/auth/login', { method: 'POST', body: { email, password } }),
  yo: () => pedir('/api/auth/me'),
  rolActual: () => localStorage.getItem('lcalerta_rol') || 'vecino',

  // --- vecino ---
  misReportes: () => pedir('/api/mis-reportes'),
  misVotos: () => pedir(`/api/mis-votos?fingerprint=${fingerprint}`),
  votar: (id) => pedir(`/api/reportes/${id}/votar`, { method: 'POST', body: { fingerprint } }),
  comentar: (id, nombre, texto) => pedir(`/api/reportes/${id}/comentarios`, { method: 'POST', body: { nombre, texto } }),
  crearReporte: (formData) => pedir('/api/reportes', { method: 'POST', body: formData }),

  // --- gobierno (requiere clave de admin) ---
  adminCambiarEstado: (id, estado, nota, clave) =>
    pedir(`/api/reportes/${id}/estado`, {
      method: 'PATCH',
      headers: { 'x-admin-key': clave },
      body: { estado, nota },
    }),
  /** Subir una imagen de reporte directamente a R2. El Worker la guarda y devuelve la clave. */
  subirFoto: async (blob) => {
    const fd = new FormData();
    fd.append('foto', blob, 'foto.jpg');
    const res = await fetch(`${BASE}/api/fotos`, {
      method: 'POST',
      headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
      body: fd,
    });
    const datos = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(datos?.error || 'No se pudo subir la foto', res.status);
    return datos.foto_key;
  },
  adminExportUrl: (formato, clave) => `${BASE}/api/export?format=${formato}&key=${encodeURIComponent(clave)}`,

  // --- perfil ---
  editarPerfil: (nombre, colonia_ref) => pedir('/api/auth/perfil', { method: 'PATCH', body: { nombre, colonia_ref } }),

  // --- movilidad (Ciudad Viva / combis) ---
  registrarVehiculo: (nombre, ruta_id, sentido) => pedir('/api/vehiculos', { method: 'POST', body: { nombre, ruta_id, sentido } }),
  /** La combi del chofer conectado (o null). Permite recuperar la pantalla. */
  misVehiculos: () => pedir('/api/mis-vehiculos'),
  enviarPosicion: ({ lat, lng, velocidad, sentido }) => pedir('/api/vehiculos/posicion', { method: 'POST', body: { lat, lng, velocidad, sentido } }),
  vehiculosActivos: () => pedir('/api/vehiculos/activos'),
  rutas: () => pedir('/api/rutas'),
  paradasDeRuta: (rutaId) => pedir(`/api/rutas/${rutaId}/paradas`),
  /** Escaneo de QR en la parada: devuelve la parada + su ruta para centrar el mapa. */
  paradaPorQr: (codigo) => pedir(`/api/paradas/qr/${encodeURIComponent(codigo)}`),

  /**
   * Enlace de la parada: es lo que va dentro del QR físico que pega el equipo.
   * Con `?soloQR=1` la página se abre sin navegación, pensada para escanear
   * estando parado en la calle.
   */
  enlaceParada: (codigo) => `${URL_PUBLICA}/parada/${encodeURIComponent(codigo)}?soloQR=1`,

  /** Llegada: combi más cercana a la parada + distancia.
   *  IMPORTANTE: `estimado_min` se calcula con una velocidad SUPuesta, no observada.
   *  Si la interfaz lo muestra, debe decirlo (ver criterio que devuelve el backend). */
  llegadaAParada: (paradaId) => pedir(`/api/paradas/${paradaId}/llegada`),

  // --- campo (propuesta de Alan) ---
  puntos: () => pedir('/api/puntos'),
  registrarPunto: (datos) => pedir('/api/puntos', { method: 'POST', body: datos }),
  registrarObservacion: (datos) => pedir('/api/observaciones', { method: 'POST', body: datos }),
  conteos: () => pedir('/api/conteos'),
  registrarConteo: (datos) => pedir('/api/conteos', { method: 'POST', body: datos }),
  zona: () => pedir('/api/zona'),

  // --- carga de datos desde archivo (solo admin) ---
  crearRuta: (datos, clave) => pedirAdmin('/api/admin/rutas', datos, clave),
  crearParadas: (rutaId, paradas, clave) => pedirAdmin('/api/admin/paradas', { ruta_id: rutaId, paradas }, clave),
  crearZona: (datos, clave) => pedirAdmin('/api/admin/zona', datos, clave),
  /** Recalcula el trazo por calles reales a partir de las paradas ordenadas. */
  trazarRuta: (rutaId, clave) => pedirAdmin(`/api/admin/rutas/${rutaId}/trazar`, {}, clave),
};

async function pedirAdmin(ruta, cuerpo, clave) {
  const res = await fetch(BASE + ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': clave },
    body: JSON.stringify(cuerpo),
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(datos?.error || 'Error', res.status);
  return datos;
}

/** Urgencia con la que el gobierno ordena la cola. */
export function urgencia(reporte) {
  const peso = CATEGORIAS.find((c) => c.clave === reporte.categoria)?.peso ?? 1;
  const dias = Math.floor((Date.now() - new Date(String(reporte.created_at).replace(' ', 'T') + 'Z')) / 86400000);
  return reporte.votos * 2 + dias + peso;
}