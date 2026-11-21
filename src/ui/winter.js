// Équipements d'hiver (phase 5f) : copie data/hiver/ (index.json + une case par degré), lue seulement pour les cases
// que les itinéraires proposés traversent. Aucune requête d'API. Index ou case absent, vide ou illisible : 'failed'
// → « Équipements d'hiver indisponibles (données non chargées) ». Fichiers hors APP_FILES (lus au besoin).

import { WINTER, parseWinterIndex, parseWinterTile, routeTiles } from '../lib/winter.js';

/**
 * @param {{ onChange:(state:{ status:string, communes:object[], index:object|null })=>void }} p
 */
export function createWinter({ onChange }) {
  let indexPromise = null;
  const tilePromises = new Map();
  let state = { status: 'idle', communes: [], index: null };
  let ticket = 0;

  const getIndex = () => {
    indexPromise ??= fetch(WINTER.INDEX_PATH, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => parseWinterIndex(j))
      .catch(() => null);
    return indexPromise;
  };
  const getTile = (key) => {
    if (!tilePromises.has(key)) {
      tilePromises.set(key, fetch(`${WINTER.DIR}${key}.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => parseWinterTile(j))
        .catch(() => null));
    }
    return tilePromises.get(key);
  };
  const set = (s) => { state = s; onChange(state); };

  const tilesFor = async (routes, index) => {
    const keys = [...new Set(routes.flatMap((r) => routeTiles(r?.coordinates ?? [], index)))];
    return Promise.all(keys.map(getTile));
  };

  return {
    get state() { return state; },
    async load(routes) {
      const my = ++ticket;
      set({ status: 'loading', communes: [], index: null });
      const index = await getIndex();
      if (my !== ticket) return;
      if (!index) { set({ status: 'failed', communes: [], index: null }); return; }
      const tiles = await tilesFor(routes, index);
      if (my !== ticket) return;
      if (tiles.some((t) => t === null)) { set({ status: 'failed', communes: [], index }); return; }
      set({ status: 'ok', communes: tiles.flat(), index });
    },
    /** Itinéraire ajouté (« Éviter », recalcul) : cases manquantes ajoutées. */
    async extend(route) {
      if (state.status !== 'ok') return;
      const tiles = await tilesFor([route], state.index);
      if (tiles.some((t) => t === null)) return;
      const seen = new Set(state.communes.map((c) => c.code));
      const more = tiles.flat().filter((c) => !seen.has(c.code));
      if (more.length) set({ ...state, communes: [...state.communes, ...more] });
    },
    clear() { ticket += 1; state = { status: 'idle', communes: [], index: null }; },
  };
}
