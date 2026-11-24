// Voies à prendre sous le bandeau (phase 11d), d'après la copie data/voies-osm/ (lanes-convert.js). Logique pure,
// calculée UNE fois par itinéraire (au départ, au recalcul, à l'arrivée d'une case), jamais à chaque position.
//
// Rapprochement (même méthode que 11b, directions.js) : la ligne de voies retenue est celle qui ARRIVE au point de
// manœuvre — un segment à DIRECTION.NEAR_M (60 m) au plus du point, dans le sens de roulage (cap à
// DIRECTION.MAX_HEADING_DEG = 30° au plus du tracé sur les 30 m AVANT la manœuvre, jamais modulo 180° : la copie est
// déjà orientée, forward / backward compris) et dont la fin (le carrefour) est elle aussi à 60 m au plus du point.
// Une seule ligne, ou plusieurs aux flèches identiques (voie OSM coupée en chemins consécutifs) ; flèches différentes
// ou aucune ligne : rien. Ronds-points (entrée, sortie), départ et arrivée : rien.
// Voies valides : celles dont une flèche correspond au type de manœuvre ORS (VALID_TURNS) ; aucune voie valide : rien
// (jamais de voie inventée). Affichage seulement (pictogrammes, voies valides en clair, les autres grisées), jamais
// dit ; la signalisation fait foi.
// v63 : voie « none » (sans flèche, gardée sur autoroute et bretelle d'autoroute seulement par lanes-convert.js) :
// jamais valide, toujours grisée, pictogramme neutre ; une rangée entièrement sans flèche n'est jamais affichée.
// Types ORS : docs/api-reference/endpoints/directions/instruction-types.md (GIScience/openrouteservice) ; valeurs
// turn:lanes : wiki OSM Key:turn (lu le 24/11/2026).

import { prepareLine, pointAt, bearing, haversine } from './nav-geo.js';
import { STEP_TYPES } from './nav-guidance.js';
import { DIRECTION, indexLinks, linksNear } from './directions.js';
import { LANES } from './lanes-convert.js';

const T = STEP_TYPES;
/** Flèches valides par type de manœuvre ORS. Types absents (ronds-points, départ, arrivée) : aucune voie affichée. */
export const VALID_TURNS = Object.freeze({
  [T.LEFT]: Object.freeze(['left']),
  [T.RIGHT]: Object.freeze(['right']),
  [T.SHARP_LEFT]: Object.freeze(['sharp_left']),
  [T.SHARP_RIGHT]: Object.freeze(['sharp_right']),
  [T.SLIGHT_LEFT]: Object.freeze(['slight_left']),
  [T.SLIGHT_RIGHT]: Object.freeze(['slight_right']),
  [T.STRAIGHT]: Object.freeze(['through']),
  [T.UTURN]: Object.freeze(['reverse']),
  [T.KEEP_LEFT]: Object.freeze(['slight_left', 'left']),
  [T.KEEP_RIGHT]: Object.freeze(['slight_right', 'right']),
});

export const LANE = Object.freeze({
  /** Cap du tracé mesuré sur les 30 m qui précèdent la manœuvre. */
  BEHIND_M: 30,
  /** Rangée affichée à 1 km au plus de la manœuvre. */
  SHOW_M: 1000,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function decodeLine(arr, start) {
  const out = [];
  let x = 0; let y = 0;
  for (let i = start; i + 1 < arr.length; i += 2) {
    if (!Number.isInteger(arr[i]) || !Number.isInteger(arr[i + 1])) return null;
    x += arr[i]; y += arr[i + 1];
    out.push([x / 1e5, y / 1e5]);
  }
  return out.length >= 2 ? out : null;
}

/**
 * « left|through;right » → [['left'], ['through','right']] si n valeurs reconnues, sinon null. « none » (v63) : seul
 * dans sa voie ; toutes les voies « none » → null.
 */
export function splitTurnLanes(text, n) {
  if (typeof text !== 'string' || !Number.isInteger(n) || n < 1) return null;
  const lanes = text.split('|').map((l) => l.split(';'));
  if (lanes.length !== n) return null;
  const none = (l) => l.length === 1 && l[0] === LANES.NONE;
  if (lanes.some((l) => !none(l) && l.some((v) => !LANES.VALUES.has(v)))) return null;
  if (lanes.every(none)) return null;
  return lanes;
}

/** Case de data/voies-osm/ → { lines:[{ key, values, coords }] } ; null si illisible ; lignes abîmées ignorées. */
export function parseLaneTile(json) {
  if (!json || !Array.isArray(json.v) || !Array.isArray(json.t)) return null;
  const lines = [];
  for (const r of json.v) {
    if (!Array.isArray(r)) continue;
    const text = Number.isInteger(r[0]) && typeof json.t[r[0]] === 'string' ? json.t[r[0]] : null;
    const values = splitTurnLanes(text, r[1]);
    const coords = values ? decodeLine(r, 2) : null;
    if (!coords) continue;
    lines.push({ key: `${text}|${r.slice(2, 4).join(',')}|${r.length}`, values, coords });
  }
  return { lines };
}

/** Plusieurs cases → une seule liste (une ligne à cheval sur deux cases y est deux fois, à l'identique). */
export function mergeLaneTiles(tiles) {
  const m = new Map();
  for (const t of tiles ?? []) for (const l of t?.lines ?? []) m.set(l.key, l);
  return { lines: [...m.values()] };
}

/**
 * Voies d'une ligne pour un type de manœuvre : [{ values, ok }] ; null si aucune voie valide ou type ignoré. Voie
 * « none » : jamais valide (VALID_TURNS ne la cite jamais).
 */
export function lanesFor(values, type) {
  const valid = VALID_TURNS[type];
  if (!valid || !Array.isArray(values)) return null;
  const out = values.map((v) => ({ values: v.slice(), ok: v.some((x) => valid.includes(x)) }));
  return out.some((l) => l.ok) ? out : null;
}

/**
 * Voies de chaque manœuvre.
 * @param {{ coordinates:number[][] }} route
 * @param {{ type:number, at:number }[]} maneuvers buildManeuvers
 * @param {{ lines:object[] }|null} data mergeLaneTiles
 * @returns {Map<number, { values:string[], ok:boolean }[]>} index de manœuvre → voies (absent : rien d'affiché)
 */
export function lanesForManeuvers(route, maneuvers, data) {
  const out = new Map();
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !data?.lines?.length || !Array.isArray(maneuvers)) return out;
  const line = prepareLine(coords);
  const cells = indexLinks(data.lines.map((l) => ({ ...l, bidir: false })));
  maneuvers.forEach((m, i) => {
    if (!m || !isNum(m.at) || i === 0 || !VALID_TURNS[m.type]) return;
    const p = pointAt(line, m.at).point;
    const back = pointAt(line, Math.max(0, m.at - LANE.BEHIND_M)).point;
    if (haversine(back, p) < 1) return;
    const { coherent } = linksNear(cells, p, bearing(back, p));
    const arriving = [...coherent].filter((l) => haversine(l.coords[l.coords.length - 1], p) <= DIRECTION.NEAR_M);
    // Voie OSM coupée en plusieurs chemins juste avant le carrefour : acceptée seulement si toutes les lignes qui
    // arrivent portent les mêmes flèches ; sinon rien (jamais deviné).
    if (!arriving.length || new Set(arriving.map((l) => JSON.stringify(l.values))).size !== 1) return;
    const lanes = lanesFor(arriving[0].values, m.type);
    if (lanes) out.set(i, lanes);
  });
  return out;
}

/** Manœuvres avec leurs voies (`lanes`, affichées seulement) ; les autres inchangées. */
export function withLanes(maneuvers, lanes) {
  if (!lanes?.size) return maneuvers;
  return maneuvers.map((m, i) => (lanes.has(i) ? { ...m, lanes: lanes.get(i) } : m));
}

/** Rangée de voies du bandeau : voies de la manœuvre affichée, à 1 km au plus ; sinon null. */
export function lanesRow(maneuver) {
  const lanes = maneuver?.lanes;
  if (!Array.isArray(lanes) || !lanes.length || !isNum(maneuver.distance) || maneuver.distance > LANE.SHOW_M) return null;
  return lanes;
}
