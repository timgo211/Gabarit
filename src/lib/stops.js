// Étapes entre le départ et l'arrivée (reste de la phase 8, v55). Logique pure, sans DOM.
//
// Règles :
// - 10 étapes au plus (STOPS.MAX), saisies à la préparation avec la même recherche que la destination ; réordonnées
//   (↑ ↓) et supprimées (✕) à l'arrêt ;
// - un seul calcul ORS avec tous les points (départ, étapes, arrivée) : budget de 3 requêtes inchangé, jamais
//   `alternative_routes` (ORS : 2 points seulement, ors-request.js) ;
// - limite de l'API publique d'ORS avec des zones évitées (150 km) : ORS additionne les distances à vol d'oiseau entre
//   points successifs (ors-api, RoutingService.java, calculateTotalDistance, lu le 23/11/2026 sur
//   raw.githubusercontent.com/GIScience/openrouteservice) → crowPath, jamais la seule distance départ–arrivée ;
// - étape ajoutée en route (station de carburant, recherche du panneau « Autres itinéraires ») : à l'arrêt seulement
//   (Code de la route art. R412-6-2), rangée selon sa place sur le tracé en cours (insertStopByRoute).

import { haversine } from './ors-response.js';
import { prepareLine, locateOnLine } from './nav-geo.js';
import { formatArrival, formatDistance, formatDuration } from './format.js';

export const STOPS = Object.freeze({
  MAX: 10,
  /** Libellé gardé au plus (caractères). */
  LABEL_MAX: 120,
  FULL_TEXT: 'Étapes : 10 au plus.',
  NO_TIME_TEXT: 'Heures sans temps passé aux étapes.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isLonLat = (lon, lat) => isNum(lon) && isNum(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;

/**
 * Étape lisible { label, lon, lat } ou null. v76 : `via: true` = point de passage technique (contournement de Lyon,
 * lyon-bypass.js) : jamais « Étape atteinte. », jamais dans la ligne « Étape k/n » ni l'historique, gardé au recalcul.
 */
export function cleanStop(s) {
  if (!s || typeof s !== 'object' || !isLonLat(s.lon, s.lat)) return null;
  const label = typeof s.label === 'string' ? s.label.trim().slice(0, STOPS.LABEL_MAX) : '';
  const out = { label: label || 'Étape', lon: s.lon, lat: s.lat };
  if (s.via === true) out.via = true;
  return out;
}

/**
 * Liste d'étapes nettoyée (sauvegarde, import) : null si une étape est illisible ou s'il y en a plus de 10 ; absente
 * → [] (ancienne sauvegarde sans étapes).
 */
export function sanitizeStops(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > STOPS.MAX) return null;
  const out = list.map(cleanStop);
  return out.every(Boolean) ? out : null;
}

/** Points [lon, lat] des étapes (champ `via` de la requête ORS ; v76 : points de passage compris). */
export function stopPoints(stops) {
  return (stops ?? []).map((s) => [s.lon, s.lat]);
}

/** v76 : points [lon, lat] des étapes à montrer (repères numérotés) : sans les points de passage techniques. */
export function shownStopPoints(stops) {
  return (stops ?? []).filter((s) => s?.via !== true).map((s) => [s.lon, s.lat]);
}

/** Déplace l'étape i d'un rang (dir = -1 vers le haut, +1 vers le bas) ; liste inchangée au bord. */
export function moveStop(list, i, dir) {
  const j = i + dir;
  if (!Array.isArray(list) || !Number.isInteger(i) || i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Retire l'étape i. */
export function removeStop(list, i) {
  if (!Array.isArray(list) || !Number.isInteger(i) || i < 0 || i >= list.length) return list;
  return list.filter((_, k) => k !== i);
}

/** Ajoute une étape à la fin (avant l'arrivée) ; { ok:false, text } au-delà de 10. */
export function appendStop(list, stop) {
  const s = cleanStop(stop);
  const cur = Array.isArray(list) ? list : [];
  if (!s) return { ok: false, text: 'Étape illisible.', list: cur };
  if (cur.length >= STOPS.MAX) return { ok: false, text: STOPS.FULL_TEXT, list: cur };
  return { ok: true, list: [...cur, s] };
}

/**
 * Étape ajoutée en route : rangée parmi les étapes selon sa place sur le tracé en cours (projection sur la ligne) ;
 * sans tracé lisible, avant l'arrivée.
 * @param {object[]} list étapes restantes, dans l'ordre du tracé
 * @param {object} stop { label, lon, lat }
 * @param {number[][]|null} coordinates tracé en cours (départ → arrivée)
 * @param {number} fromAlong distance déjà parcourue sur ce tracé (m) : une étape derrière le véhicule va en premier
 * @returns {{ ok:boolean, list:object[], index?:number, text?:string }}
 */
export function insertStopByRoute(list, stop, coordinates = null, fromAlong = 0) {
  const s = cleanStop(stop);
  const cur = Array.isArray(list) ? list : [];
  if (!s) return { ok: false, text: 'Étape illisible.', list: cur };
  if (cur.length >= STOPS.MAX) return { ok: false, text: STOPS.FULL_TEXT, list: cur };
  let line = null;
  try { line = Array.isArray(coordinates) && coordinates.length >= 2 ? prepareLine(coordinates) : null; } catch { line = null; }
  if (!line) return { ok: true, list: [...cur, s], index: cur.length };
  const at = (p) => Math.max(isNum(fromAlong) ? fromAlong : 0, locateOnLine(line, [p.lon, p.lat]).along);
  const mine = at(s);
  let index = cur.findIndex((x) => at(x) > mine);
  if (index < 0) index = cur.length;
  return { ok: true, list: [...cur.slice(0, index), s, ...cur.slice(index)], index };
}

/**
 * Distance mesurée par ORS pour ses limites (somme des distances à vol d'oiseau entre points successifs, m).
 * @param {number[][]} points [lon, lat] dans l'ordre : départ, étapes, arrivée
 */
export function crowPath(points) {
  const pts = (points ?? []).filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  let sum = 0;
  for (let i = 1; i < pts.length; i += 1) sum += haversine(pts[i - 1], pts[i]);
  return sum;
}

/** Points du trajet pour crowPath : [start, ...étapes, end]. */
export function tripPoints(start, stops, end) {
  return [start, ...stopPoints(stops), end];
}

/**
 * Lignes de la fiche, une par tronçon (v62), lues dans les `segments` de la réponse ORS (route.legs) :
 *   { title: 'Tronçon 1 : Départ → Étape 1', detail: '« Metz » · 1 h 12 · 95 km · arrivée 14:35' }
 *   …
 *   { title: 'Tronçon 2 : Étape 1 → Arrivée', detail: '1 h 05 · 80 km · arrivée 15:40' }
 * Le nom de l'étape est entre guillemets dans le détail : une station « Total » ne se lit pas comme le total du trajet.
 * Heures cumulées sur les secondes brutes (arrondies à l'affichage seulement) : la dernière heure d'arrivée est celle de
 * la fiche quand la somme des segments égale le résumé (cas d'ORS).
 * Sans tronçons lisibles (route.legs absent ou d'une autre longueur) : rien.
 * @param {object} route itinéraire lu par parseDirections (legs)
 * @param {object[]} stops étapes { label }
 * @param {Date} now
 */
export function legLines(route, allStops, now = new Date()) {
  const raw = route?.legs;
  if (!Array.isArray(allStops) || !allStops.length || !Array.isArray(raw) || raw.length !== allStops.length + 1) return [];
  // v76 : tronçons de part et d'autre d'un point de passage technique réunis (il n'est pas une étape).
  const legs = [];
  let acc = { duration: 0, distance: 0 };
  raw.forEach((leg, i) => {
    acc = { duration: acc.duration + (isNum(leg?.duration) ? leg.duration : 0), distance: acc.distance + (isNum(leg?.distance) ? leg.distance : 0) };
    if (i < allStops.length && allStops[i]?.via === true) return;
    legs.push(acc);
    acc = { duration: 0, distance: 0 };
  });
  const stops = allStops.filter((s) => s?.via !== true);
  if (!stops.length) return [];
  const name = (i) => (i === 0 ? 'Départ' : i > stops.length ? 'Arrivée' : `Étape ${i}`);
  let t = 0;
  return legs.map((leg, i) => {
    const d = isNum(leg?.duration) ? leg.duration : 0;
    const km = isNum(leg?.distance) ? leg.distance : 0;
    t += d;
    const label = i < stops.length ? `« ${stops[i].label} » · ` : '';
    return {
      title: `Tronçon ${i + 1} : ${name(i)} → ${name(i + 1)}`,
      detail: `${label}${formatDuration(d)} · ${formatDistance(km)} · arrivée ${formatArrival(now, t)}`,
    };
  });
}

/**
 * Ligne du guidage jusqu'à la prochaine étape (v62), en morceaux (v70) : `label` « Étape 1/2 : », `duration`
 * « 1 h 12 » et `distance` « 95 km ». L'écran peut passer à la ligne entre deux morceaux, jamais dans un morceau
 * (durée et km jamais coupés).
 * `next` = view.nextStop du moteur (distance le long du tracé, jamais à vol d'oiseau). Sans étape à venir : null.
 * Affichée seulement, jamais dite.
 */
export function nextStopParts(next) {
  if (!next || !Number.isInteger(next.index) || !Number.isInteger(next.count) || next.index >= next.count) return null;
  const d = isNum(next.duration) ? Math.max(0, next.duration) : 0;
  const km = isNum(next.distance) ? Math.max(0, next.distance) : 0;
  return { label: `Étape ${next.index + 1}/${next.count} :`, duration: formatDuration(d), distance: formatDistance(km) };
}

/** Même ligne en un seul texte : « Étape 1/2 : 1 h 12 · 95 km » ; sans étape à venir : ''. */
export function nextStopLine(next) {
  const parts = nextStopParts(next);
  return parts ? `${parts.label} ${parts.duration} · ${parts.distance}` : '';
}
