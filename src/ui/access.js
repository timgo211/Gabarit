// Voies à accès conditionnel du trajet (phase 5d) : copie data/acces-osm/ (index.json + une case par degré), lue
// seulement pour les cases que les itinéraires proposés touchent. Aucune requête Overpass, aucune requête ORS.
// Index ou case absent, vide ou illisible : 'failed' → « Restrictions horaires indisponibles (données non chargées) ».
// Fichiers hors APP_FILES (comme data/aires-osm/) : lus au besoin, jamais mis en cache par le service worker.

import { parseIndex, routePlan } from '../lib/areas-osm-data.js';
import { ACCESS, parseAccessTile } from '../lib/access-conditional.js';

/**
 * @param {{ onChange:(state:{ status:string, ways:object[], updated:string|null, uncovered:boolean })=>void }} p
 */
export function createAccess({ onChange }) {
  let indexPromise = null;
  const tilePromises = new Map();
  let state = { status: 'idle', ways: [], updated: null, uncovered: false };
  let ticket = 0;

  const getIndex = () => {
    indexPromise ??= fetch(ACCESS.INDEX_PATH, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => parseIndex(j))
      .catch(() => null);
    return indexPromise;
  };
  const getTile = (key) => {
    if (!tilePromises.has(key)) {
      tilePromises.set(key, fetch(`${ACCESS.DIR}${key}.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => parseAccessTile(j))
        .catch(() => null));
    }
    return tilePromises.get(key);
  };
  const set = (s) => { state = s; onChange(state); };

  return {
    get state() { return state; },
    /** Cases touchées par tous les itinéraires proposés (un seul chargement par case). */
    async load(routes) {
      const my = ++ticket;
      set({ status: 'loading', ways: [], updated: null, uncovered: false });
      const index = await getIndex();
      if (my !== ticket) return;
      if (!index) { set({ status: 'failed', ways: [], updated: null, uncovered: false }); return; }
      const coords = routes.flatMap((r) => r?.coordinates ?? []);
      const plan = routePlan(coords, index);
      const tiles = await Promise.all(plan.tiles.map(getTile));
      if (my !== ticket) return;
      if (tiles.some((t) => t === null)) { set({ status: 'failed', ways: [], updated: index.updated, uncovered: false }); return; }
      set({ status: 'ok', ways: tiles.flat(), updated: index.updated, uncovered: plan.uncovered.length > 0 });
    },
    /** Itinéraire ajouté (« Éviter », recalcul) : cases manquantes ajoutées. */
    async extend(route) {
      if (state.status !== 'ok') return;
      const index = await getIndex();
      if (!index) return;
      const plan = routePlan(route?.coordinates ?? [], index);
      const tiles = await Promise.all(plan.tiles.map(getTile));
      if (tiles.some((t) => t === null)) return;
      const seen = new Set(state.ways.map((w) => w.id));
      const more = tiles.flat().filter((w) => !seen.has(w.id));
      if (more.length || plan.uncovered.length) {
        set({ ...state, ways: [...state.ways, ...more], uncovered: state.uncovered || plan.uncovered.length > 0 });
      }
    },
    clear() { ticket += 1; state = { status: 'idle', ways: [], updated: null, uncovered: false }; },
  };
}
