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
import { formatArrival, formatDuration } from './format.js';

export const STOPS = Object.freeze({
  MAX: 10,
  /** Libellé gardé au plus (caractères). */
  LABEL_MAX: 120,
  FULL_TEXT: 'Étapes : 10 au plus.',
  NO_TIME_TEXT: 'Heures sans temps passé aux étapes.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isLonLat = (lon, lat) => isNum(lon) && isNum(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;

/** Étape lisible { label, lon, lat } ou null. */
export function cleanStop(s) {
  if (!s || typeof s !== 'object' || !isLonLat(s.lon, s.lat)) return null;
  const label = typeof s.label === 'string' ? s.label.trim().slice(0, STOPS.LABEL_MAX) : '';
  return { label: label || 'Étape', lon: s.lon, lat: s.lat };
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

/** Points [lon, lat] des étapes (champ `via` de la requête ORS). */
export function stopPoints(stops) {
  return (stops ?? []).map((s) => [s.lon, s.lat]);
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
 * Lignes de la fiche, une par étape : « Étape 1 · Metz — 14:35 (1 h 12) » (heure d'arrivée cumulée, durée du tronçon).
 * Sans tronçons lisibles (route.legs absent ou d'une autre longueur) : rien.
 * @param {object} route itinéraire lu par parseDirections (legs)
 * @param {object[]} stops étapes { label }
 * @param {Date} now
 */
export function legLines(route, stops, now = new Date()) {
  const legs = route?.legs;
  if (!Array.isArray(stops) || !stops.length || !Array.isArray(legs) || legs.length !== stops.length + 1) return [];
  let t = 0;
  return stops.map((s, i) => {
    const d = isNum(legs[i]?.duration) ? legs[i].duration : 0;
    t += d;
    return `Étape ${i + 1} · ${s.label} — ${formatArrival(now, t)} (${formatDuration(d)})`;
  });
}
