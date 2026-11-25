// Téléchargement d'un extrait Geofabrik avec nouvelles tentatives à attente croissante. Copie de la fonction download
// de tools/osm-update.mjs (même délais, mêmes essais), sortie en module pour l'Action « Audit OSM » sans modifier
// osm-update.mjs (un envoi qui le modifie relance l'Action « Données OSM ») ; osm-update.mjs sera branché sur ce module
// dans une PR à part (ROADMAP). Node 22, sans dépendance npm.

import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Un délai par essai (une requête bloquée sans réponse ne dure pas indéfiniment), 5 essais séparés par 30 s, 1 min,
// 2 min puis 4 min (run #9 du 21/11/2026 de « Données OSM » : serveur Geofabrik instable).
export const TIMEOUT_POLY_MS = 60 * 1000;
export const TIMEOUT_PBF_MS = 20 * 60 * 1000;
export const RETRY_WAITS_MS = Object.freeze([30000, 60000, 120000, 240000]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Télécharge `url` dans `file`. Échec après le dernier essai → Error(failMessage ?? message par défaut).
 * @param {{ timeoutMs?:number, userAgent?:string, failMessage?:string, waits?:number[], fetchImpl?:typeof fetch }} [opts]
 */
export async function download(url, file, {
  timeoutMs = TIMEOUT_PBF_MS, userAgent = 'Gabarit (GitHub Action)', failMessage = null, waits = RETRY_WAITS_MS,
  fetchImpl = fetch,
} = {}) {
  for (let i = 0; i <= waits.length; i += 1) {
    if (i) await sleep(waits[i - 1]);
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetchImpl(url, { headers: { 'user-agent': userAgent }, signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file), { signal });
      return;
    } catch (err) {
      // « fetch failed » cache la vraie raison (connexion refusée, coupée, nom introuvable…) : err.cause l'écrit.
      const cause = err?.cause ? ` (${[err.cause.code, err.cause.message].filter(Boolean).join(' : ')})` : '';
      const why = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `délai de ${Math.round(timeoutMs / 1000)} s dépassé` : `${err.message}${cause}`;
      console.log(`⚠ téléchargement ${url} (essai ${i + 1}/${waits.length + 1}) : ${why}`);
    }
  }
  throw new Error(failMessage ?? `Téléchargement impossible : ${url}.`);
}
