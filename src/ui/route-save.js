// Mémoire de l'itinéraire (v53) : une seule entrée dans IndexedDB (base « gabarit-route », magasin « save », clé
// « current »). IndexedDB plutôt que localStorage : un long tracé et ses variantes dépassent les 5 Mo de localStorage.
// Stockage local seulement, rien n'est envoyé. Décisions (quoi garder, quand reprendre) : src/lib/route-save.js.
// Sans IndexedDB (navigation privée, refus) : rien n'est gardé, l'appli marche comme avant.

const DB = 'gabarit-route';
const STORE = 'save';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponible')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Accès à la sauvegarde ; aucune erreur ne remonte (l'itinéraire n'est simplement pas gardé). */
export function createRouteStore() {
  return {
    async load() {
      try { return (await run('readonly', (s) => s.get(KEY))) ?? null; } catch { return null; }
    },
    async put(save) {
      try { await run('readwrite', (s) => s.put(save, KEY)); return true; } catch { return false; }
    },
    async clear() {
      try { await run('readwrite', (s) => s.delete(KEY)); return true; } catch { return false; }
    },
  };
}
