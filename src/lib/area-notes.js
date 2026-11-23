// Notes perso sur les aires et parkings utilisés (phase 6, v56) : sécurité, douches, propreté et un texte libre,
// gardés sur l'appareil (champ `areaNotes` de gabarit.data, donc dans l'export / import), affichés au prochain
// passage (fiche de l'aire, liste et encart des aires du guidage), en plus de « Mon avis » (phase 9). Logique pure.
//
// Saisie à l'arrêt seulement (Code de la route, art. R412-6-2 : aucune saisie pendant la conduite ; vitesse inconnue
// = en mouvement, parkedState) : plus strict que « Mon avis » (< 10 km/h). Jamais dit à voix haute.

import { matches } from './areas-avis.js';

export const NOTE_CHOICES = Object.freeze({
  security: Object.freeze({ label: 'Sécurité', values: Object.freeze({ good: 'bonne', fair: 'moyenne', bad: 'mauvaise' }) }),
  showers: Object.freeze({ label: 'Douches', values: Object.freeze({ yes: 'oui', paid: 'payantes', no: 'non' }) }),
  clean: Object.freeze({ label: 'Propreté', values: Object.freeze({ good: 'bonne', fair: 'moyenne', bad: 'mauvaise' }) }),
});

export const AREA_NOTES = Object.freeze({
  MAX: 500,
  TEXT_MAX: 280,
  PARKED_TEXT: 'Ma note : à l\'arrêt seulement.',
  SAVED_TEXT: 'Note gardée sur cet appareil.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const pick = (key, v) => (typeof v === 'string' && Object.hasOwn(NOTE_CHOICES[key].values, v) ? v : null);

/** Note lisible (chargée ou importée), ou null (rien de renseigné, champs illisibles). */
export function sanitizeAreaNote(n) {
  if (!n || typeof n !== 'object' || typeof n.areaId !== 'string' || !n.areaId) return null;
  const at = typeof n.updatedAt === 'string' && Number.isFinite(Date.parse(n.updatedAt)) ? new Date(Date.parse(n.updatedAt)).toISOString() : null;
  if (!at) return null;
  const text = typeof n.text === 'string' ? n.text.trim().slice(0, AREA_NOTES.TEXT_MAX) : '';
  const out = {
    areaId: n.areaId.slice(0, 60),
    ids: (Array.isArray(n.ids) ? n.ids : []).filter((x) => typeof x === 'string' && x).slice(0, 8).map((x) => x.slice(0, 60)),
    name: typeof n.name === 'string' ? n.name.slice(0, 80) : '',
    lon: isNum(n.lon) ? n.lon : null,
    lat: isNum(n.lat) ? n.lat : null,
    security: pick('security', n.security),
    showers: pick('showers', n.showers),
    clean: pick('clean', n.clean),
    text,
    updatedAt: at,
  };
  if (!out.ids.length) out.ids = [out.areaId];
  if (!out.security && !out.showers && !out.clean && !out.text) return null;
  return out;
}

export function sanitizeAreaNotes(list) {
  return (Array.isArray(list) ? list : []).map(sanitizeAreaNote).filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, AREA_NOTES.MAX);
}

/** Note de cette aire (la plus récente), ou null. */
export function noteFor(list, area) {
  if (!area) return null;
  let best = null;
  for (const n of Array.isArray(list) ? list : []) {
    if (!matches(n, area)) continue;
    if (!best || Date.parse(n.updatedAt) > Date.parse(best.updatedAt)) best = n;
  }
  return best;
}

/**
 * Note enregistrée (remplace celle de la même aire) ; champs tous vides → note retirée.
 * @param {object[]} list
 * @param {{ id:string, ids?:string[], name?:string, lon:number, lat:number }} area
 * @param {{ security?:string|null, showers?:string|null, clean?:string|null, text?:string }} fields
 */
export function setAreaNote(list, area, fields, now = new Date()) {
  const rest = (Array.isArray(list) ? list : []).filter((n) => !matches(n, area));
  if (!area?.id) return sanitizeAreaNotes(list);
  const note = sanitizeAreaNote({
    areaId: area.id, ids: area.ids ?? [area.id], name: area.name ?? '', lon: area.lon, lat: area.lat,
    ...fields, updatedAt: now.toISOString(),
  });
  return sanitizeAreaNotes(note ? [note, ...rest] : rest);
}

/** Ligne courte (liste et encart des aires) : « Ma note : sécurité mauvaise · douches oui · propre : bonne ». */
export function noteShort(n) {
  if (!n) return '';
  const parts = [];
  for (const key of ['security', 'showers', 'clean']) {
    if (n[key]) parts.push(`${NOTE_CHOICES[key].label.toLowerCase()} ${NOTE_CHOICES[key].values[n[key]]}`);
  }
  if (!parts.length && n.text) parts.push(n.text.length > 40 ? `${n.text.slice(0, 39)}…` : n.text);
  return parts.length ? `Ma note : ${parts.join(' · ')}` : '';
}
