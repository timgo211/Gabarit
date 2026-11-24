// Historique des trajets (phase 6, v56) : une liste dans IndexedDB (base « gabarit-history », magasin « trips »,
// clé « list »), comme la mémoire de l'itinéraire (src/ui/route-save.js). Stockage local seulement, rien n'est
// envoyé. Règles (quoi garder, combien, fusion) : src/lib/trip-history.js.
// Sans IndexedDB (navigation privée, refus, stockage plein, base bloquée) : rien n'est gardé, aucune erreur ne
// remonte, le guidage continue comme avant.

import { sanitizeHistory, addToHistory, mergeHistory } from '../lib/trip-history.js';

const DB = 'gabarit-history';
const STORE = 'trips';
const KEY = 'list';
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
      req = idb.open(DB, 1);
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

/** Accès à l'historique ; aucune erreur ne remonte. list() : null si IndexedDB est indisponible. */
export function createHistoryStore() {
  const read = async () => sanitizeHistory((await run('readonly', (s) => s.get(KEY))) ?? []);
  const write = (list) => run('readwrite', (s) => s.put(sanitizeHistory(list), KEY));
  return {
    async list() {
      try { return await read(); } catch { return null; }
    },
    async add(trip) {
      try { await write(addToHistory(await read(), trip)); return true; } catch { return false; }
    },
    /** Import : trajets du fichier ajoutés (même identifiant → celui de l'appareil gardé). */
    async merge(list) {
      try { await write(mergeHistory(await read(), list)); return true; } catch { return false; }
    },
    async clear() {
      try { await run('readwrite', (s) => s.delete(KEY)); return true; } catch { return false; }
    },
  };
}
