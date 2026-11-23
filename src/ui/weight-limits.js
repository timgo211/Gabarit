// Limites de poids du trajet (phase 12a bis) : copie data/poids-osm/ (index.json + une case par degré, mêmes cases que
// data/ponts-osm/), lue seulement pour les cases que les itinéraires proposés touchent. Aucune requête d'API.
// Index ou case absent, vide ou illisible : 'failed' → « Limites de poids : données non chargées ».
// Fichiers hors APP_FILES : lus au besoin, jamais mis en cache par le service worker.

import { WEIGHTS } from '../lib/weight-convert.js';
import { parseWeightTile, mergeWeightTiles } from '../lib/weight-check.js';
import { createTileCopy } from './bridges.js';

const EMPTY = Object.freeze({ ways: [] });

/** @param {{ onChange:(state:{ status:string, data:{ ways:object[] }, updated:string|null, uncovered:boolean })=>void }} p */
export function createWeightLimits({ onChange }) {
  return createTileCopy({
    indexPath: WEIGHTS.INDEX_PATH, dir: WEIGHTS.DIR, parse: parseWeightTile, merge: mergeWeightTiles, empty: EMPTY, onChange,
  });
}
