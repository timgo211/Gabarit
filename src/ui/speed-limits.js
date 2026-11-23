// Limitations de vitesse du trajet (phase 11a) : copie data/vitesses-osm/ (index.json + une case par degré, mêmes cases
// que data/ponts-osm/), lue seulement pour les cases que les itinéraires proposés touchent. Aucune requête d'API.
// Index ou case absent, vide ou illisible : 'failed' → « Limites de vitesse connues : inconnues » (jamais une limite
// inventée). Fichiers hors APP_FILES : lus au besoin, jamais dans le précache.

import { SPEEDS } from '../lib/speed-convert.js';
import { parseSpeedTile, mergeSpeedTiles } from '../lib/speed-limit.js';
import { createTileCopy } from './bridges.js';

const EMPTY = Object.freeze({ ways: [] });

/** @param {{ onChange:(state:{ status:string, data:{ ways:object[] }, updated:string|null, uncovered:boolean })=>void }} p */
export function createSpeedLimits({ onChange }) {
  return createTileCopy({
    indexPath: SPEEDS.INDEX_PATH, dir: SPEEDS.DIR, parse: parseSpeedTile, merge: mergeSpeedTiles, empty: EMPTY, onChange,
  });
}
