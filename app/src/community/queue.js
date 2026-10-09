import { api, session } from './api.js';

// Derived from Axel's IndexedDB queue. Each draft belongs to its author and has
// a stable idempotency key; interrupted uploads cannot create duplicate reports.
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('las-palmas-community', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operate(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('reports', mode);
      const request = action(tx.objectStore('reports'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const drafts = () => operate('readonly', (store) => store.getAll());
export const enqueue = (item) =>
  operate('readwrite', (store) =>
    store.put({
      ...item,
      id: item.id || crypto.randomUUID(),
      owner: session()?.email || session()?.driver?.email,
    })
  );
export const removeDraft = (id) => operate('readwrite', (store) => store.delete(id));
let syncing;
export function syncDrafts() {
  if (syncing) return syncing;
  syncing = (async () => {
    const owner = session()?.email || session()?.driver?.email;
    let uploaded = 0;
    if (navigator.onLine && owner) {
      for (const item of await drafts()) {
        if (item.owner !== owner) continue;
        const form = new FormData();
        for (const field of ['categoria', 'descripcion', 'colonia', 'lat', 'lng'])
          form.set(field, item[field] ?? '');
        form.set('client_id', item.id);
        if (item.foto) form.set('foto', item.foto, 'foto.jpg');
        try {
          await api('/reportes', { method: 'POST', body: form });
          await removeDraft(item.id);
          uploaded++;
        } catch (error) {
          return {
            uploaded,
            pending: (await drafts()).filter((d) => d.owner === owner).length,
            error: error.message,
          };
        }
      }
    }
    return { uploaded, pending: (await drafts()).filter((d) => d.owner === owner).length };
  })().finally(() => {
    syncing = undefined;
  });
  return syncing;
}
