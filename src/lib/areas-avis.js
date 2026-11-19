// « Mon avis » sur une aire (phase 9) : Plein / Quelques places / OK + heure, gardé sur l'appareil (données de
// l'appli, donc dans l'export / import). Logique pure.
//
// Donné à l'arrêt seulement (sous 10 km/h) : Code de la route, art. R412-6-2 (pas de saisie pendant la conduite ;
// écran seulement comme aide à la navigation).

import { haversine } from './ors-response.js';

export const AVIS = Object.freeze({
  full: 'Plein',
  some: 'Quelques places',
  ok: 'OK',
});

export const AVIS_RULES = Object.freeze({
  /** Avis possible sous 10 km/h (même seuil que le recalcul « hors itinéraire »). */
  MAX_SPEED_KMH: 10,
  /** Avis gardés au plus (les plus récents). */
  MAX_REPORTS: 300,
  /** Un avis enregistré sous un autre identifiant (autre source) compte pour l'aire s'il est à moins de 150 m. */
  NEAR_M: 150,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Peut-on donner son avis ? Hors guidage : oui ; en guidage : seulement sous 10 km/h (vitesse connue). */
export function canReport({ navigating = false, speedKmh = null } = {}) {
  if (!navigating) return true;
  return isNum(speedKmh) && speedKmh < AVIS_RULES.MAX_SPEED_KMH;
}

/** Avis valide (chargé ou importé) ? */
export function sanitizeAreaReport(r) {
  if (!r || typeof r !== 'object' || !Object.hasOwn(AVIS, r.status)) return null;
  const at = typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? new Date(Date.parse(r.at)).toISOString() : null;
  if (!at || typeof r.areaId !== 'string' || !r.areaId) return null;
  const ids = Array.isArray(r.ids) ? r.ids.filter((x) => typeof x === 'string' && x).slice(0, 8).map((x) => x.slice(0, 60)) : [];
  return {
    areaId: r.areaId.slice(0, 60),
    ids: ids.length ? ids : [r.areaId.slice(0, 60)],
    name: typeof r.name === 'string' ? r.name.slice(0, 80) : '',
    lon: isNum(r.lon) ? r.lon : null,
    lat: isNum(r.lat) ? r.lat : null,
    status: r.status,
    at,
  };
}

export function sanitizeAreaReports(list) {
  return (Array.isArray(list) ? list : []).map(sanitizeAreaReport).filter(Boolean)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, AVIS_RULES.MAX_REPORTS);
}

/** Nouvel avis, ajouté en tête (les plus anciens au-delà de MAX_REPORTS sont oubliés). */
export function addAreaReport(list, area, status, now = new Date()) {
  if (!Object.hasOwn(AVIS, status) || !area?.id) return sanitizeAreaReports(list);
  const r = {
    areaId: area.id, ids: area.ids ?? [area.id], name: area.name ?? '', lon: area.lon, lat: area.lat,
    status, at: now.toISOString(),
  };
  return sanitizeAreaReports([r, ...(Array.isArray(list) ? list : [])]);
}

function matches(r, area) {
  const ids = new Set(area.ids ?? [area.id]);
  if (r.ids.some((x) => ids.has(x)) || ids.has(r.areaId)) return true;
  return isNum(r.lon) && isNum(r.lat) && isNum(area.lon) && isNum(area.lat)
    && haversine([r.lon, r.lat], [area.lon, area.lat]) <= AVIS_RULES.NEAR_M;
}

/** Dernier avis donné sur cette aire, ou null. */
export function latestReport(list, area) {
  if (!area) return null;
  let best = null;
  for (const r of Array.isArray(list) ? list : []) {
    if (!matches(r, area)) continue;
    if (!best || Date.parse(r.at) > Date.parse(best.at)) best = r;
  }
  return best;
}

/** « Plein il y a 2 j, 21h » ; « OK il y a 3 h, 18h » ; « Quelques places il y a 25 min ». */
export function reportText(r, now = new Date()) {
  if (!r) return '';
  const at = new Date(r.at);
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  const hour = `${at.getHours()}h`;
  let ago;
  if (min < 1) ago = 'à l\'instant';
  else if (min < 60) ago = `il y a ${min} min`;
  else if (min < 24 * 60) ago = `il y a ${Math.floor(min / 60)} h, ${hour}`;
  else ago = `il y a ${Math.floor(min / (24 * 60))} j, ${hour}`;
  return `${AVIS[r.status]} ${ago}`;
}
