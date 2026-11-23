// Mémoire de l'itinéraire (v53) : une seule entrée dans IndexedDB (base « gabarit-route », magasin « save », clé
// « current »). IndexedDB plutôt que localStorage : un long tracé et ses variantes dépassent les 5 Mo de localStorage.
// Stockage local seulement, rien n'est envoyé. Décisions (quoi garder, quand reprendre) : src/lib/route-save.js.
// Sans IndexedDB (navigation privée, refus, stockage plein, base bloquée) : rien n'est gardé, aucune erreur ne remonte,
// le guidage continue comme avant.

const DB = 'gabarit-route';
const STORE = 'save';
const KEY = 'current';

/** Ouverture : jamais pendue (bloquée, sans réponse) au-delà de OPEN_TIMEOUT_MS ; toute erreur = rejet. */
export const OPEN_TIMEOUT_MS = 2000;

function open() {
  return new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (!idb) { reject(new Error('IndexedDB indisponible')); return; }
    let done = false;
    const timer = setTimeout(() => { done = true; reject(new Error('IndexedDB sans réponse')); }, OPEN_TIMEOUT_MS);
    const finish = (fn) => (x) => { if (done) { if (fn === resolve) x?.close?.(); return; } done = true; clearTimeout(timer); fn(x); };
    let req;
    try {
      req = idb.open(DB, 1); // refus (navigation privée, réglage) : lève parfois au lieu d'échouer
    } catch (err) { finish(reject)(err); return; }
    req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch { /* déjà là */ } };
    req.onsuccess = () => finish(resolve)(req.result);
    req.onerror = () => finish(reject)(req.error);
    req.onblocked = () => finish(reject)(new Error('IndexedDB bloquée'));
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      // Écriture refusée (stockage plein : QuotaExceededError) : lève ici ou annule la transaction ; rejet dans les deux cas.
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
