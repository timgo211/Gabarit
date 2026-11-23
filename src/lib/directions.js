// Direction écrite sur les panneaux dans les consignes (phase 11b), d'après la copie data/directions-osm/
// (directions-convert.js). Logique pure, calculée UNE fois par itinéraire (au départ, au recalcul, à l'arrivée d'une
// case), jamais à chaque position.
//
// Une consigne prend le complément « direction Metz » seulement quand UNE seule bretelle à direction est trouvée à
// DIRECTION.NEAR_M (60 m) au plus du point de manœuvre avec un cap cohérent : sens de la bretelle (modulo 180° si elle
// est à deux sens) à DIRECTION.MAX_HEADING_DEG au plus du tracé juste après la manœuvre. Aucune, plusieurs, ou une
// consigne qui donne déjà une direction : consigne inchangée (jamais de direction devinée). À voix haute seulement si
// la correspondance est sans ambiguïté : aucune autre bretelle à direction (quel que soit son cap) à 60 m.
// Pas de repli « commune la plus proche » (jeu de données de lieux trop volumineux pour la copie).

import { prepareLine, pointAt, bearing, haversine } from './nav-geo.js';
import { axisDiff } from './hgv-tolls-geo.js';
import { distToSegment } from './weight-check.js';
import { STEP_TYPES } from './nav-guidance.js';

export const DIRECTION = Object.freeze({
  NEAR_M: 60,
  MAX_HEADING_DEG: 30,
  /** Cap du tracé mesuré sur les 30 m qui suivent la manœuvre. */
  AHEAD_M: 30,
  CELL_DEG: 0.005,
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

/** Case de data/directions-osm/ → { links:[{ key, dest, ref, bidir, coords }] } ; null si illisible. */
export function parseDirectionTile(json) {
  if (!json || !Array.isArray(json.d) || !Array.isArray(json.t)) return null;
  const text = (i) => (Number.isInteger(i) && i >= 0 && typeof json.t[i] === 'string' ? json.t[i] : null);
  const links = [];
  for (const r of json.d) {
    if (!Array.isArray(r)) continue;
    const dest = text(r[0]); const ref = text(r[1]);
    if (!dest && !ref) continue;
    const coords = decodeLine(r, 3);
    if (!coords) continue;
    links.push({ key: `${dest}|${ref}|${r.slice(3, 5).join(',')}|${r.length}`, dest, ref, bidir: r[2] === 1, coords });
  }
  return { links };
}

/** Plusieurs cases → une seule liste (une bretelle à cheval sur deux cases y est deux fois, à l'identique). */
export function mergeDirectionTiles(tiles) {
  const m = new Map();
  for (const t of tiles ?? []) for (const l of t?.links ?? []) m.set(l.key, l);
  return { links: [...m.values()] };
}

/** Texte du complément : « Metz, Nancy (A 31) », « A 31 ». */
export function directionText(link) {
  if (link.dest && link.ref) return `${link.dest} (${link.ref})`;
  return link.dest ?? link.ref ?? '';
}

function indexLinks(links) {
  const cells = new Map();
  const C = DIRECTION.CELL_DEG;
  links.forEach((l) => {
    for (let i = 1; i < l.coords.length; i += 1) {
      const a = l.coords[i - 1]; const b = l.coords[i];
      const s = { a, b, link: l, heading: bearing(a, b) };
      const x0 = Math.floor(Math.min(a[0], b[0]) / C); const x1 = Math.floor(Math.max(a[0], b[0]) / C);
      const y0 = Math.floor(Math.min(a[1], b[1]) / C); const y1 = Math.floor(Math.max(a[1], b[1]) / C);
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          const k = `${x}_${y}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(s);
        }
      }
    }
  });
  return cells;
}

const dirDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };

/** Distance du point au segment, extrémités comprises (le point de manœuvre peut tomber au tout début de la bretelle). */
function distSeg(p, a, b) {
  const d = distToSegment(p, a, b);
  return Number.isFinite(d) ? d : Math.min(haversine(p, a), haversine(p, b));
}

/**
 * Bretelles proches d'un point : { near:Set, coherent:Set }.
 * near : toutes les bretelles à 60 m ; coherent : celles dont un segment à 60 m suit le cap du tracé.
 */
function linksNear(cells, p, heading) {
  const C = DIRECTION.CELL_DEG;
  const cx = Math.floor(p[0] / C); const cy = Math.floor(p[1] / C);
  const near = new Set(); const coherent = new Set();
  for (let x = cx - 2; x <= cx + 2; x += 1) {
    for (let y = cy - 2; y <= cy + 2; y += 1) {
      for (const s of cells.get(`${x}_${y}`) ?? []) {
        if (distSeg(p, s.a, s.b) > DIRECTION.NEAR_M) continue;
        near.add(s.link);
        const diff = s.link.bidir ? axisDiff(heading, s.heading) : dirDiff(heading, s.heading);
        if (diff <= DIRECTION.MAX_HEADING_DEG) coherent.add(s.link);
      }
    }
  }
  return { near, coherent };
}

/**
 * Complément de direction de chaque manœuvre.
 * @param {{ coordinates:number[][] }} route
 * @param {{ step:number, type:number, instruction:string, at:number }[]} maneuvers buildManeuvers
 * @param {{ links:object[] }|null} data mergeDirectionTiles
 * @returns {Map<number, { text:string, speak:boolean }>} index de manœuvre → complément (absent : consigne inchangée)
 */
export function directionsForManeuvers(route, maneuvers, data) {
  const out = new Map();
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !data?.links?.length || !Array.isArray(maneuvers)) return out;
  const line = prepareLine(coords);
  const cells = indexLinks(data.links);
  maneuvers.forEach((m, i) => {
    if (!m || !isNum(m.at) || m.type === STEP_TYPES.DEPART || m.type === STEP_TYPES.GOAL || i === 0) return;
    if (/\bdirection\b/i.test(m.instruction ?? '')) return;
    const p = pointAt(line, m.at).point;
    const ahead = pointAt(line, Math.min(line.total, m.at + DIRECTION.AHEAD_M)).point;
    if (haversine(p, ahead) < 1) return;
    const { near, coherent } = linksNear(cells, p, bearing(p, ahead));
    if (coherent.size !== 1) return;
    const [link] = coherent;
    const text = directionText(link);
    if (!text) return;
    out.set(i, { text, speak: near.size === 1 });
  });
  return out;
}

/** Manœuvres avec leur complément (`direction`) ; les autres inchangées. */
export function withDirections(maneuvers, directions) {
  if (!directions?.size) return maneuvers;
  return maneuvers.map((m, i) => (directions.has(i) ? { ...m, direction: directions.get(i) } : m));
}
