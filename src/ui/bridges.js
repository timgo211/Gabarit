// Ponts sans hauteur connue du trajet (phase 12a) : copie data/ponts-osm/ (index.json + une case par degré), lue
// seulement pour les cases que les itinéraires proposés touchent. Aucune requête Overpass, aucune requête ORS.
// Index ou case absent, vide ou illisible : 'failed' → « Ponts sans hauteur : données non chargées ».
// Fichiers hors APP_FILES (comme data/acces-osm/) : lus au besoin, jamais mis en cache par le service worker.

import { parseIndex, routePlan } from '../lib/areas-osm-data.js';
import { BRIDGES } from '../lib/bridges-convert.js';
import { parseBridgeTile, mergeBridgeTiles } from '../lib/bridge-check.js';

const EMPTY = Object.freeze({ bridges: [], clearances: [] });

/**
 * @param {{ onChange:(state:{ status:string, data:{ bridges:object[], clearances:object[] }, updated:string|null,
 *   uncovered:boolean })=>void }} p
 */
export function createBridges({ onChange }) {
  let indexPromise = null;
  const tilePromises = new Map();
  let state = { status: 'idle', data: EMPTY, updated: null, uncovered: false };
  let ticket = 0;

  const getIndex = () => {
    indexPromise ??= fetch(BRIDGES.INDEX_PATH, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => parseIndex(j))
      .catch(() => null);
    return indexPromise;
  };
  const getTile = (key) => {
    if (!tilePromises.has(key)) {
      tilePromises.set(key, fetch(`${BRIDGES.DIR}${key}.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => parseBridgeTile(j))
        .catch(() => null));
    }
    return tilePromises.get(key);
  };
  const set = (s) => { state = s; onChange(state); };
  const read = async (routes) => {
    const index = await getIndex();
    if (!index) return null;
    const coords = routes.flatMap((r) => r?.coordinates ?? []);
    const plan = routePlan(coords, index);
    const tiles = await Promise.all(plan.tiles.map(getTile));
    if (tiles.some((t) => t === null)) return { failed: true, updated: index.updated };
    return { tiles, updated: index.updated, uncovered: plan.uncovered.length > 0 };
  };

  return {
    get state() { return state; },
    /** Cases touchées par tous les itinéraires proposés (un seul chargement par case). */
    async load(routes) {
      const my = ++ticket;
      set({ status: 'loading', data: EMPTY, updated: null, uncovered: false });
      const r = await read(routes);
      if (my !== ticket) return;
      if (!r || r.failed) { set({ status: 'failed', data: EMPTY, updated: r?.updated ?? null, uncovered: false }); return; }
      set({ status: 'ok', data: mergeBridgeTiles(r.tiles), updated: r.updated, uncovered: r.uncovered });
    },
    /** Itinéraire ajouté (« Éviter », recalcul) : cases manquantes ajoutées. */
    async extend(route) {
      if (state.status !== 'ok') return;
      const r = await read([route]);
      if (!r || r.failed || state.status !== 'ok') return;
      const merged = mergeBridgeTiles([state.data, ...r.tiles]);
      set({ ...state, data: merged, uncovered: state.uncovered || r.uncovered });
    },
    clear() { ticket += 1; state = { status: 'idle', data: EMPTY, updated: null, uncovered: false }; },
  };
}
