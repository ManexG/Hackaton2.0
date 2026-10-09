/**
 * cola.js — cola offline en IndexedDB.
 *
 * En Lázaro Cárdenas muchas colonias tienen señal intermitente, así que un reporte
 * se guarda PRIMERO en el teléfono y se sube solo cuando vuelve la conexión.
 * Esta lógica es del backend/infra: el equipo de diseño la consume, no la reescribe.
 */

const DB = 'lcalerta';
const STORE_COLA = 'cola';

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_COLA)) db.createObjectStore(STORE_COLA, { keyPath: 'ts' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function todos() {
  const db = await abrir();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_COLA).objectStore(STORE_COLA).getAll();
    tx.onsuccess = () => resolve(tx.result);
  });
}

async function guardar(item) {
  const db = await abrir();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_COLA, 'readwrite');
    tx.objectStore(STORE_COLA).put(item);
    tx.oncomplete = () => resolve();
  });
}

async function borrar(ts) {
  const db = await abrir();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_COLA, 'readwrite');
    tx.objectStore(STORE_COLA).delete(ts);
    tx.oncomplete = () => resolve();
  });
}

/** Comprime la foto en el dispositivo: los móviles(suben fotos de 4 MB y la señal es mala. */
export function comprimirImagen(file, maxLado = 1280, calidad = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxLado / img.width);
      const c = document.createElement('canvas');
      c.width = img.width * k;
      c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(resolve, 'image/jpeg', calidad);
    };
    img.onerror = () => resolve(file);
  });
}

/** Colonia a partir de las coordenadas. Si no hay señal o falla, se devuelve null
 *  y el vecino escribe la colonia a mano. */
export async function coloniaDesdeCoords(lat, lng) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`, { signal: ctrl.signal });
    clearTimeout(t);
    const d = await res.json();
    const p = d.features?.[0]?.properties;
    return p ? (p.suburb || p.district || p.neighbourhood || p.city_district || p.village || p.city || null) : null;
  } catch {
    return null;
  }
}

export const cola = {
  listar: todos,
  encolar: guardar,
  quitar: borrar,
  async subir(api) {
    if (!navigator.onLine) return { subidos: 0, pendientes: (await todos()).length };
    let subidos = 0;
    for (const item of await todos()) {
      const fd = new FormData();
      fd.append('categoria', item.categoria);
      fd.append('descripcion', item.descripcion);
      fd.append('colonia', item.colonia);
      fd.append('lat', item.lat);
      fd.append('lng', item.lng);
      if (item.foto) fd.append('foto', item.foto, 'foto.jpg');
      try {
        const res = await fetch('/api/reportes', { method: 'POST', headers: authHeaders(), body: fd });
        if (res.ok) {
          await borrar(item.ts);
          subidos++;
        }
      } catch {
        break; // seguimos sin señal: no seguir intentando
      }
    }
    return { subidos, pendientes: (await todos()).length };
  },
};

function authHeaders() {
  const token = localStorage.getItem('lcalerta_token');
  return token ? { authorization: `Bearer ${token}` } : {};
}