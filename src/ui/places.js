// Lieux « vers X » du trajet (phase 11c) : copie data/lieux-osm/ (index.json + une case par degré, mêmes cases que
// data/ponts-osm/), lue seulement pour les cases que les itinéraires proposés touchent. Aucune requête d'API.
// Index ou case absent, vide ou illisible (Geofabrik en échec : dossier vide) : 'failed' → consignes inchangées, aucun
// message. Fichiers hors APP_FILES : lus au besoin, jamais dans le précache.

import { PLACES } from '../lib/places-convert.js';
import { parsePlaceTile, mergePlaceTiles } from '../lib/places.js';
import { createTileCopy } from './bridges.js';

const EMPTY = Object.freeze({ places: [] });

/** @param {{ onChange:(state:{ status:string, data:{ places:object[] }, updated:string|null, uncovered:boolean })=>void }} p */
export function createPlaces({ onChange }) {
  return createTileCopy({
    indexPath: PLACES.INDEX_PATH, dir: PLACES.DIR, parse: parsePlaceTile, merge: mergePlaceTiles, empty: EMPTY, onChange,
  });
}
