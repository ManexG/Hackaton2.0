// Public JSON only. Never persist login, profiles, GPS or operator responses here.
const memory = new Map();
const MAX_ENTRIES = 80;
export async function invalidatePublic() {
  for (const value of memory.values()) value.savedAt = 0;
  try {
    const entries = await dbAction('readonly', (store) => store.getAll());
    for (const entry of entries)
      await dbAction('readwrite', (store) => store.put({ ...entry, savedAt: 0 }));
  } catch {
    /* The in-memory cache was still invalidated. */
  }
}
export const publicPath = (path) =>
  /^\/(network(?:\?|$)|reportes(?:\?|$|\/\d+(?:\/(?:comentarios|historial))?(?:\?|$))|categorias$|colonias$|estadisticas$|rutas(?:\/\d+\/paradas)?$)/.test(
    path
  );
async function dbAction(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('las-palmas-public-cache', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('data', { keyPath: 'key' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction('data', mode),
        request = action(tx.objectStore('data'));
      tx.oncomplete = () => {
        resolve(request.result);
        db.close();
      };
      tx.onerror = tx.onabort = () => {
        reject(tx.error);
        db.close();
      };
    };
  });
}
export async function readPublic(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const value = await dbAction('readonly', (store) => store.get(key));
    if (value) memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}
export async function savePublic(key, data) {
  const value = { key, data, savedAt: Date.now() };
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
  try {
    await dbAction('readwrite', (store) => store.put(value));
    const entries = await dbAction('readonly', (store) => store.getAll());
    for (const row of entries.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_ENTRIES))
      await dbAction('readwrite', (store) => store.delete(row.key));
  } catch {
    /* Storage denied or full: keep the current in-memory response. */
  }
}
