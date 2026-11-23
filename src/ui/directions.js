// Directions des panneaux du trajet (phase 11b) : copie data/directions-osm/ (index.json + une case par degré, mêmes
// cases que data/ponts-osm/), lue seulement pour les cases que les itinéraires proposés touchent. Aucune requête d'API.
// Index ou case absent, vide ou illisible : 'failed' → consignes inchangées (jamais de direction devinée). Fichiers
// hors APP_FILES : lus au besoin, jamais dans le précache.

import { DIRECTIONS } from '../lib/directions-convert.js';
import { parseDirectionTile, mergeDirectionTiles } from '../lib/directions.js';
import { createTileCopy } from './bridges.js';

const EMPTY = Object.freeze({ links: [] });

/** @param {{ onChange:(state:{ status:string, data:{ links:object[] }, updated:string|null, uncovered:boolean })=>void }} p */
export function createDirections({ onChange }) {
  return createTileCopy({
    indexPath: DIRECTIONS.INDEX_PATH, dir: DIRECTIONS.DIR, parse: parseDirectionTile, merge: mergeDirectionTiles, empty: EMPTY, onChange,
  });
}
