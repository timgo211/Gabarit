// Voies à prendre du trajet (phase 11d) : copie data/voies-osm/ (index.json + une case par degré, mêmes cases que
// data/ponts-osm/), lue seulement pour les cases que les itinéraires proposés touchent. Aucune requête d'API.
// Index ou case absent, vide ou illisible : 'failed' → aucune rangée de voies, aucun message. Fichiers hors
// APP_FILES : lus au besoin, jamais dans le précache.

import { LANES } from '../lib/lanes-convert.js';
import { parseLaneTile, mergeLaneTiles } from '../lib/lanes.js';
import { createTileCopy } from './bridges.js';

const EMPTY = Object.freeze({ lines: [] });

/** @param {{ onChange:(state:{ status:string, data:{ lines:object[] }, updated:string|null, uncovered:boolean })=>void }} p */
export function createLanes({ onChange }) {
  return createTileCopy({
    indexPath: LANES.INDEX_PATH, dir: LANES.DIR, parse: parseLaneTile, merge: mergeLaneTiles, empty: EMPTY, onChange,
  });
}
