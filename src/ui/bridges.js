// Ponts sans hauteur connue du trajet (phase 12a) : copie data/ponts-osm/ (index.json + une case par degré), lue
// seulement pour les cases que les itinéraires proposés touchent. Aucune requête Overpass, aucune requête ORS.
// Index ou case absent, vide ou illisible : 'failed' → « Ponts sans hauteur : données non chargées ».
// Fichiers hors APP_FILES (comme data/acces-osm/) : lus au besoin, jamais précachés (le cache réseau du service worker,
// network-first, garde ceux déjà lus pour un usage hors ligne).

import { parseIndex, routePlan } from '../lib/areas-osm-data.js';
import { BRIDGES } from '../lib/bridges-convert.js';
import { parseBridgeTile, mergeBridgeTiles } from '../lib/bridge-check.js';

const EMPTY = Object.freeze({ bridges: [], clearances: [] });

/**
 * @param {{ onChange:(state:{ status:string, data:{ bridges:object[], clearances:object[] }, updated:string|null,
 *   uncovered:boolean })=>void }} p
 */
export function createBridges({ onChange }) {
  return createTileCopy({
    indexPath: BRIDGES.INDEX_PATH, dir: BRIDGES.DIR, parse: parseBridgeTile, merge: mergeBridgeTiles, empty: EMPTY, onChange,
  });
}

/**
 * Copie OSM lue par cases de 1° (data/ponts-osm/, data/poids-osm/ de la phase 12a bis) : index.json puis les cases
 * touchées par les itinéraires, une seule lecture par case, jamais dans le précache.
 * meta(json) : champs de index.json gardés dans state.meta (facultatif).
 */
export function createTileCopy({ indexPath, dir, parse, merge, empty, onChange, meta = null }) {
  let indexPromise = null;
  let indexMeta = null;
  const tilePromises = new Map();
  let state = { status: 'idle', data: empty, updated: null, uncovered: false, meta: null };
  let ticket = 0;

  const getIndex = () => {
    indexPromise ??= fetch(indexPath, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        // PR 3a : champs propres à une copie (data/axes-osm/ : simplification `tolerance`), lus par `meta`.
        if (meta) indexMeta = meta(j);
        return parseIndex(j);
      })
      .catch(() => null);
    return indexPromise;
  };
  const getTile = (key) => {
    if (!tilePromises.has(key)) {
      tilePromises.set(key, fetch(`${dir}${key}.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => parse(j))
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
      set({ status: 'loading', data: empty, updated: null, uncovered: false, meta: null });
      const r = await read(routes);
      if (my !== ticket) return;
      if (!r || r.failed) { set({ status: 'failed', data: empty, updated: r?.updated ?? null, uncovered: false, meta: null }); return; }
      set({ status: 'ok', data: merge(r.tiles), updated: r.updated, uncovered: r.uncovered, meta: indexMeta });
    },
    /** Itinéraire ajouté (« Éviter », recalcul) : cases manquantes ajoutées. */
    async extend(route) {
      if (state.status !== 'ok') return;
      const r = await read([route]);
      if (!r || r.failed || state.status !== 'ok') return;
      const merged = merge([state.data, ...r.tiles]);
      set({ ...state, data: merged, uncovered: state.uncovered || r.uncovered });
    },
    clear() { ticket += 1; state = { status: 'idle', data: empty, updated: null, uncovered: false, meta: null }; },
  };
}
