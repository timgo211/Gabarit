// Limites officielles DiaLog du trajet (phase 12c) : copie data/dialog/ (index.json + une case par degré, même
// découpage que les copies OSM), lue seulement pour les cases que les itinéraires proposés touchent ; servie par le
// site lui-même (aucun domaine nouveau). Absente, illisible ou hors France : rien n'est affiché, aucun message.
// Fichiers hors APP_FILES : jamais dans le précache du service worker.

import { DIALOG_LIMITS, parseDialogTile, mergeDialogTiles } from '../lib/dialog-limits.js';
import { createTileCopy } from './bridges.js';

const EMPTY = Object.freeze({ ways: [] });

/** @param {{ onChange:(state:{ status:string, data:{ ways:object[] }, updated:string|null })=>void }} p */
export function createDialogLimits({ onChange }) {
  return createTileCopy({
    indexPath: DIALOG_LIMITS.INDEX_PATH, dir: DIALOG_LIMITS.DIR, parse: parseDialogTile, merge: mergeDialogTiles, empty: EMPTY,
    onChange, meta: (j) => ({ updated: typeof j?.updated === 'string' ? j.updated : null }),
  });
}
