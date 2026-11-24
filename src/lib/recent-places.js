// Recherches récentes (v64) : derniers lieux choisis dans la liste de suggestions (départ, arrivée, étapes et
// « Ajouter une étape » d'Autres itinéraires : une seule liste). Logique pure, sans DOM ni localStorage
// (src/ui/recent-places.js).
//
// Règles :
// - enregistré seulement un lieu choisi dans la liste (nom, commune / code postal, coordonnées) ; jamais le texte tapé,
//   jamais « Ma position », jamais des coordonnées tapées ;
// - doublon (mêmes coordonnées arrondies à 4 décimales, ≈ 10 m, ou même libellé sans accents ni majuscules) : le lieu
//   remonte en tête ; 20 lieux au plus ;
// - champ vide : titre « Recherches récentes » puis les 5 derniers ; en tapant : les récents qui correspondent (filtre
//   local) passent avant les suggestions d'ORS, doublons retirés ; aucun appel réseau, rien compté dans le plafond ;
// - ✕ d'une ligne et effacement : en guidage, à l'arrêt seulement (recentEditAllowed, R412-6-2) ;
// - gardé seulement sur l'appareil (clé localStorage à part), inclus dans l'export (champ `recentPlaces`), fusionné à
//   l'import ; un ancien export sans ce champ s'importe sans erreur.

import { parseCoordinates } from './coords.js';

export const RECENT = Object.freeze({
  KEY: 'gabarit.recentPlaces',
  MAX: 20,
  SHOW: 5,
  TEXT_MAX: 160,
  TITLE: 'Recherches récentes',
  PRIVACY_TEXT: "Gardé seulement sur cet appareil. Inclus dans l'export.",
  CLEAR_CONFIRM: 'Effacer les recherches récentes de cet appareil ?',
  CLEARED_TEXT: 'Recherches récentes effacées.',
  EMPTY_TEXT: 'Aucune recherche récente.',
  MOVING_TEXT: "À l'arrêt seulement.",
  REMOVE_LABEL: (name) => `Retirer ${name} des recherches récentes`,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const str = (x) => (typeof x === 'string' ? x.trim().slice(0, RECENT.TEXT_MAX) : '');

/** Minuscules, sans accents, tirets et apostrophes en espaces, espaces réduits. */
export function normalizeText(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[-'’_,.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Lieu gardé (champs connus seulement), ou null : coordonnées invalides, libellé vide ou coordonnées tapées. */
export function recentEntry(item) {
  if (!item || typeof item !== 'object') return null;
  const { lon, lat } = item;
  if (!isNum(lon) || !isNum(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const label = str(item.label) || str(item.name);
  if (!label || parseCoordinates(label)) return null;
  const name = str(item.name) || label;
  const place = str(item.place);
  return { label, name, place, lon, lat };
}

const coordKey = (p) => `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`;
const labelKey = (p) => normalizeText(p.label);

/** Même lieu : coordonnées arrondies ou libellé identiques. */
export function samePlace(a, b) {
  if (!a || !b || !isNum(a.lon) || !isNum(b.lon)) return false;
  return coordKey(a) === coordKey(b) || (!!labelKey(a) && labelKey(a) === labelKey(b));
}

/** Liste lue (stockage, import) : entrées valides, sans doublon, 20 au plus. JSON abîmé → []. */
export function sanitizeRecent(raw) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const e = recentEntry(r);
    if (e && !out.some((o) => samePlace(o, e))) out.push(e);
    if (out.length >= RECENT.MAX) break;
  }
  return out;
}

/** Lieu choisi en tête ; doublon retiré ; 20 au plus. Lieu non gardable → liste inchangée. */
export function addRecent(list, item) {
  const e = recentEntry(item);
  const cur = sanitizeRecent(list);
  if (!e) return cur;
  return [e, ...cur.filter((o) => !samePlace(o, e))].slice(0, RECENT.MAX);
}

/** Retire ce lieu (✕ de la ligne). */
export function removeRecent(list, item) {
  return sanitizeRecent(list).filter((o) => !samePlace(o, item));
}

/** Import : mes lieux d'abord, puis ceux du fichier ; doublons retirés, 20 au plus. */
export function mergeRecent(mine, imported) {
  return sanitizeRecent([...sanitizeRecent(mine), ...sanitizeRecent(imported)]);
}

/**
 * Lieux à proposer : champ vide → les 5 derniers ; sinon ceux dont chaque mot tapé se trouve dans le libellé, le nom ou
 * la commune (sans accents ni majuscules), 5 au plus, du plus récent au plus ancien.
 */
export function matchRecent(list, text) {
  const all = sanitizeRecent(list);
  const words = normalizeText(text).split(' ').filter(Boolean);
  if (!words.length) return all.slice(0, RECENT.SHOW);
  return all.filter((p) => {
    const hay = normalizeText(`${p.label} ${p.name} ${p.place}`);
    return words.every((w) => hay.includes(w));
  }).slice(0, RECENT.SHOW);
}

/**
 * ✕ d'une ligne et « Effacer les recherches récentes » permis ? Hors guidage : oui (écran d'avant le départ) ; en
 * guidage : seulement à l'arrêt (parkedState, vitesse inconnue = en mouvement). Code de la route art. R412-6-2 :
 * aucune saisie en roulant.
 */
export function recentEditAllowed({ navigating = false, parked = false } = {}) {
  return !navigating || parked === true;
}

/** Suggestions d'ORS sans les lieux déjà proposés en récents. */
export function withoutRecent(items, recent) {
  return (Array.isArray(items) ? items : []).filter((s) => !(recent ?? []).some((r) => samePlace(r, s)));
}

/**
 * Accès aux recherches récentes, stockage injectable (localStorage dans le navigateur, objet en mémoire dans les
 * tests). Jamais bloquant : lecture refusée ou JSON abîmé → liste vide ; écriture refusée ou stockage plein → liste
 * gardée en mémoire pour la session ; aucune erreur ne remonte.
 * @param {{ getItem:(k:string)=>string|null, setItem:(k:string,v:string)=>void, removeItem:(k:string)=>void }|null} storage
 */
export function createRecentStore(storage) {
  let mem = null; // copie de la session (lue une fois, ou gardée après un refus d'écriture)
  function read() {
    if (mem) return mem;
    try {
      const text = storage?.getItem(RECENT.KEY);
      mem = text ? sanitizeRecent(JSON.parse(text)) : [];
    } catch {
      mem = [];
    }
    return mem;
  }
  function write(list) {
    mem = sanitizeRecent(list);
    try {
      if (mem.length) storage?.setItem(RECENT.KEY, JSON.stringify(mem));
      else storage?.removeItem(RECENT.KEY);
    } catch { /* refusé ou plein : gardé en mémoire pour la session */ }
    return mem;
  }
  return {
    list: () => read().slice(),
    match: (text) => matchRecent(read(), text),
    add: (item) => write(addRecent(read(), item)),
    remove: (item) => write(removeRecent(read(), item)),
    clear: () => write([]),
    merge: (imported) => write(mergeRecent(read(), imported)),
  };
}
