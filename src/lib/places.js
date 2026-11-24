// « vers Metz » dans les consignes (phase 11c), d'après la copie data/lieux-osm/ (places-convert.js). Logique pure,
// calculée UNE fois par itinéraire (au départ, au recalcul, à l'arrivée d'une case), jamais à chaque position.
//
// Repli de 11b : seulement pour une manœuvre sans complément « direction X » (aucune bretelle sûre) et dont la consigne
// ORS ne donne pas déjà une direction. Lieu retenu = le PREMIER lieu OSM (place=city, town ou village) le long du tracé
// dont le nœud passe à PLACE.NEAR_M (1 km) au plus du tracé, entre PLACE.MIN_AHEAD_M (300 m) et PLACE.MAX_AHEAD_M
// (15 km) après la manœuvre, sans dépasser l'étape suivante ni l'arrivée. Deux lieux différents à moins de
// PLACE.TIE_M (300 m) l'un de l'autre le long du tracé au premier rang : rien (jamais deviné).
// Un lieu OSM est un point, pas un panneau : « vers X » (jamais « direction X »), affiché seulement, jamais dit à voix
// haute ; la signalisation fait foi.

import { prepareLine } from './nav-geo.js';
import { STEP_TYPES } from './nav-guidance.js';

export const PLACE = Object.freeze({
  NEAR_M: 1000,
  MIN_AHEAD_M: 300,
  MAX_AHEAD_M: 15000,
  TIE_M: 300,
  CELL_DEG: 0.02,
});

const RAD = Math.PI / 180;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Case de data/lieux-osm/ → { places:[{ key, name, rank, at }] } ; null si illisible. */
export function parsePlaceTile(json) {
  if (!json || !Array.isArray(json.p) || !Array.isArray(json.t)) return null;
  const places = [];
  for (const r of json.p) {
    if (!Array.isArray(r) || !Number.isInteger(r[0]) || !Number.isInteger(r[2]) || !Number.isInteger(r[3])) continue;
    const name = typeof json.t[r[0]] === 'string' ? json.t[r[0]] : null;
    if (!name || !Number.isInteger(r[1]) || r[1] < 0 || r[1] > 2) continue;
    places.push({ key: `${r[2]},${r[3]}|${name}`, name, rank: r[1], at: [r[2] / 1e5, r[3] / 1e5] });
  }
  return { places };
}

/** Plusieurs cases → une seule liste (sans doublon). */
export function mergePlaceTiles(tiles) {
  const m = new Map();
  for (const t of tiles ?? []) for (const p of t?.places ?? []) m.set(p.key, p);
  return { places: [...m.values()] };
}

/** Projection de p sur [a, b] (plan local) : { t, d } en mètres. */
function project(p, a, b) {
  const kx = Math.cos(p[1] * RAD) * 111320; const ky = 110540;
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - a[0]) * kx; const dy = (b[1] - a[1]) * ky;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / L)) : 0;
  return { t, d: Math.hypot(ax + t * dx, ay + t * dy) };
}

/**
 * Lieux qui passent à 1 km au plus du tracé, triés le long du tracé : [{ name, along }] (along = point du tracé le
 * plus proche du nœud).
 */
export function placesAlongRoute(line, places) {
  const C = PLACE.CELL_DEG;
  const cells = new Map();
  for (const p of places ?? []) {
    if (!p || typeof p.name !== 'string' || !Array.isArray(p.at) || !isNum(p.at[0]) || !isNum(p.at[1])) continue;
    const k = `${Math.floor(p.at[0] / C)}_${Math.floor(p.at[1] / C)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(p);
  }
  const best = new Map();
  for (let i = 0; i + 1 < line.coords.length; i += 1) {
    const a = line.coords[i]; const b = line.coords[i + 1];
    const segLen = line.cum[i + 1] - line.cum[i];
    const x0 = Math.floor(Math.min(a[0], b[0]) / C) - 1; const x1 = Math.floor(Math.max(a[0], b[0]) / C) + 1;
    const y0 = Math.floor(Math.min(a[1], b[1]) / C) - 1; const y1 = Math.floor(Math.max(a[1], b[1]) / C) + 1;
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (const p of cells.get(`${x}_${y}`) ?? []) {
          const r = project(p.at, a, b);
          if (r.d > PLACE.NEAR_M) continue;
          const prev = best.get(p);
          if (!prev || r.d < prev.d) best.set(p, { name: p.name, along: line.cum[i] + r.t * segLen, d: r.d });
        }
      }
    }
  }
  return [...best.values()].sort((u, v) => u.along - v.along).map(({ name, along }) => ({ name, along }));
}

/**
 * Lieu « vers X » de chaque manœuvre sans direction de panneau.
 * @param {{ coordinates:number[][] }} route
 * @param {{ type:number, instruction:string, at:number, direction?:object }[]} maneuvers après withDirections
 * @param {{ places:object[] }|null} data mergePlaceTiles
 * @returns {Map<number, { text:string }>} index de manœuvre → lieu (absent : consigne inchangée)
 */
export function placesForManeuvers(route, maneuvers, data) {
  const out = new Map();
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !data?.places?.length || !Array.isArray(maneuvers)) return out;
  const line = prepareLine(coords);
  const along = placesAlongRoute(line, data.places);
  if (!along.length) return out;
  const goals = maneuvers.filter((m) => m?.type === STEP_TYPES.GOAL && isNum(m.at)).map((m) => m.at);
  maneuvers.forEach((m, i) => {
    if (!m || !isNum(m.at) || i === 0 || m.type === STEP_TYPES.DEPART || m.type === STEP_TYPES.GOAL) return;
    if (m.direction?.text || /\bdirection\b/i.test(m.instruction ?? '')) return;
    const stop = Math.min(m.at + PLACE.MAX_AHEAD_M, ...goals.filter((g) => g > m.at), line.total);
    const near = along.filter((p) => p.along >= m.at + PLACE.MIN_AHEAD_M && p.along <= stop);
    if (!near.length) return;
    const [first, second] = near;
    if (second && second.name !== first.name && second.along - first.along < PLACE.TIE_M) return;
    out.set(i, { text: first.name });
  });
  return out;
}

/** Manœuvres avec leur lieu (`place`, affiché seulement) ; les autres inchangées. */
export function withPlaces(maneuvers, places) {
  if (!places?.size) return maneuvers;
  return maneuvers.map((m, i) => (places.has(i) ? { ...m, place: places.get(i) } : m));
}
