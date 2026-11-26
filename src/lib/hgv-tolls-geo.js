// Réseau des taxes PL régionales en géométrie (phase 5h ter) : R-Pass et écocontribution du Grand Est repérés en
// comparant le tracé ORS aux voies OpenStreetMap du réseau taxé, et plus seulement par les noms d'étape (ORS renvoie
// de longues étapes sans nom ni référence : 90 km entre Mulhouse et Strasbourg, 83 km d'A31 entre Thionville et Toul,
// diagnostics v30). Logique pure, partagée par l'Action (tools/osm-update.mjs, via hgv-tolls-convert.js) et l'appli.
//
// Copie data/taxes-pl-osm.json (Action mensuelle, © contributeurs OpenStreetMap, ODbL ; contours IGN Admin Express,
// Licence Ouverte, dans data/taxes-pl.json) : par taxe, les voies gardées (référence de la taxe, hors bretelles,
// hors péage poids lourd — toll:hgv=yes, ou toll=yes sans toll:hgv=no : les sections concédées à péage — A355, A36
// vers Belfort, A31 au sud de Toul — sont exclues sans liste écrite à la main), découpées par le cadre, le contour de la collectivité, les zones exclues (Eurométropole de
// Strasbourg) et le cadre ou contour propre à une route (RD83 Colmar–Sélestat, RN52 en Meurthe-et-Moselle).
//
// Comparaison au tracé : un point tous les 50 m ; il compte s'il est à 15 m au plus d'un segment du réseau, avec un
// écart de cap de 30° au plus, mesuré modulo 180° (une chaussée se parcourt dans les deux sens et l'ordre des nœuds
// OSM ne dit pas le sens de circulation). 15 m : ORS construit son graphe sur OSM, ses points sont des nœuds OSM
// (arrondi 1e-5° ≈ 1 m) ; 15 m couvrent la simplification de la copie (3 m), les retouches d'OSM entre la
// construction du graphe ORS et la copie, et l'autre chaussée (même référence, axes à 10–40 m) ; c'est l'écart déjà
// retenu pour les accès conditionnels (access-conditional.js) ; au-delà de 25 m, des contre-allées seraient prises.
// Le cap écarte les ponts et les croisements ; le nom d'étape ORS sert de veto : une étape qui nomme une autre route
// (références normalisées : « A 35;E 25 » = A35 et E25) refuse le point. Séries de moins de 300 m écartées.

import { roadRefs } from './route-samples.js';
import { prepareLine, pointAt, segmentBearing, bearing } from './nav-geo.js';

export const TOLLS_GEO = Object.freeze({
  PATH: 'data/taxes-pl-osm.json',
  SAMPLE_M: 50,
  TOLERANCE_M: 15,
  MAX_HEADING_DEG: 30,
  MIN_RUN_M: 300,
  /** Taille d'une cellule de l'index des segments (degrés) : bien plus grande que la tolérance. */
  CELL_DEG: 0.005,
  /** Routes lues dans la copie (bretelles exclues : leurs références sont celles de la route desservie). */
  HIGHWAYS: Object.freeze(new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary'])),
  SIMPLIFY_M: 3,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;

/**
 * Références normalisées d'une étiquette OSM `ref` ou d'un nom d'étape ORS : majuscules, espaces retirés, plusieurs
 * références (« A 35;E 25 », « Autoroute des Cigognes, A 35 ») → ['A35', 'E25'].
 */
export function normalizeRefs(text) {
  if (typeof text !== 'string' || !text) return [];
  return roadRefs(text.toUpperCase());
}

/** Écart de cap modulo 180° (0 à 90°) : sans le sens de circulation. */
export function axisDiff(a, b) {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return d > 90 ? 180 - d : d;
}

const inBox = ([lon, lat], [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;

/** Point dans un anneau (règle pair-impair). */
export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRings = (p, rings) => rings.some((r) => inRing(p, r));

/**
 * Le point appartient-il au périmètre de la taxe pour la route `ref` ? Cadre général, contour de la collectivité
 * (sans contour : cadre seul), hors zones exclues, cadre et contour propres à la route.
 */
export function pointInTax(point, ref, tax) {
  if (!inBox(point, tax.bbox)) return false;
  if (tax.rings?.length && !inRings(point, tax.rings)) return false;
  if (tax.excludeRings?.length && inRings(point, tax.excludeRings)) return false;
  if (ref && tax.roadBoxes?.[ref] && !inBox(point, tax.roadBoxes[ref])) return false;
  if (ref && tax.roadAreas?.[ref]?.length && !inRings(point, tax.roadAreas[ref])) return false;
  return true;
}

// ───────── Copie data/taxes-pl-osm.json ─────────

/** Ligne codée [i_refs, x0, y0, dx, dy, …] (entiers 1e-5°, écarts) → [[lon, lat], …]. */
function decodeLine(a) {
  const out = [];
  let x = 0; let y = 0;
  for (let i = 1; i + 1 < a.length; i += 2) {
    x += a[i]; y += a[i + 1];
    out.push([x / 1e5, y / 1e5]);
  }
  return out;
}

/** Ligne [[lon, lat], …] → [i_refs, x0, y0, dx, dy, …]. */
export function encodeLine(refIndex, coords) {
  const out = [refIndex];
  let px = 0; let py = 0;
  for (const [lon, lat] of coords) {
    const x = Math.round(lon * 1e5); const y = Math.round(lat * 1e5);
    out.push(x - px, y - py);
    px = x; py = y;
  }
  return out;
}

/**
 * data/taxes-pl-osm.json → { updated, taxes: { id: { segments, cells } } } ; null si illisible. Une taxe sans
 * ligne lisible est absente (l'appli revient alors au repérage par les noms d'étape pour cette taxe).
 */
export function parseTollNetwork(json) {
  if (!json || typeof json !== 'object' || !json.taxes || typeof json.taxes !== 'object') return null;
  const updated = typeof json.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.updated) ? json.updated : null;
  const taxes = {};
  for (const [id, t] of Object.entries(json.taxes)) {
    const refs = Array.isArray(t?.refs) ? t.refs.map((r) => (Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [])) : [];
    const lines = Array.isArray(t?.lines) ? t.lines : [];
    const segments = [];
    for (const a of lines) {
      if (!Array.isArray(a) || a.length < 5 || !a.every(Number.isInteger) || !refs[a[0]]?.length) continue;
      const c = decodeLine(a);
      for (let i = 0; i + 1 < c.length; i += 1) segments.push({ a: c[i], b: c[i + 1], refs: refs[a[0]] });
    }
    if (!segments.length) continue;
    taxes[id] = { segments, cells: indexSegments(segments) };
  }
  if (!Object.keys(taxes).length) return null;
  return { updated, taxes };
}

function indexSegments(segments) {
  const cells = new Map();
  const C = TOLLS_GEO.CELL_DEG;
  for (const s of segments) {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / C); const x1 = Math.floor(Math.max(s.a[0], s.b[0]) / C);
    const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / C); const y1 = Math.floor(Math.max(s.a[1], s.b[1]) / C);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const k = `${x}_${y}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(s);
      }
    }
  }
  return cells;
}

/** Distance (m) du point p au segment [a, b], projection plane locale. */
function distToSegment(p, a, b) {
  const kx = Math.cos(p[1] * RAD) * 111320; const ky = 110540;
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx; const by = (b[1] - p[1]) * ky;
  const dx = bx - ax; const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Segment du réseau le plus proche (≤ tolérance, cap compatible) ou null. */
export function nearestSegment(net, point, heading) {
  const C = TOLLS_GEO.CELL_DEG;
  const cx = Math.floor(point[0] / C); const cy = Math.floor(point[1] / C);
  let best = null; let bestD = Infinity;
  for (let x = cx - 1; x <= cx + 1; x += 1) {
    for (let y = cy - 1; y <= cy + 1; y += 1) {
      for (const s of net.cells.get(`${x}_${y}`) ?? []) {
        const d = distToSegment(point, s.a, s.b);
        if (d > TOLLS_GEO.TOLERANCE_M || d >= bestD) continue;
        if (isNum(heading) && axisDiff(heading, bearing(s.a, s.b)) > TOLLS_GEO.MAX_HEADING_DEG) continue;
        best = s; bestD = d;
      }
    }
  }
  return best;
}

/**
 * Passages du tracé sur le réseau d'une taxe : séries de points à moins de 15 m (cap compatible, pas de veto du nom
 * d'étape), de 300 m au moins.
 * @param {object} route itinéraire (coordinates, steps)
 * @param {{ segments:object[], cells:Map }} net réseau de la taxe (parseTollNetwork)
 * @param {object} tax taxe (parseTollData) : roads, bbox
 * @returns {{ enter:number, exit:number, roads:string[] }[]} distances depuis le départ (m)
 */
export function matchTollNetwork(route, net, tax, { geoAll = null } = {}) {
  const coords = Array.isArray(route?.coordinates) ? route.coordinates : [];
  if (coords.length < 2 || !net?.cells) return [];
  const line = prepareLine(coords);
  const steps = (Array.isArray(route.steps) ? route.steps : []).filter((s) => Array.isArray(s?.wayPoints));
  const stepRefs = steps.map((s) => normalizeRefs(s.name));
  const [w, s, e, n] = tax.bbox;
  const margin = 0.01;
  const runs = [];
  let cur = null;
  let si = 0;
  const N = Math.max(1, Math.ceil(line.total / TOLLS_GEO.SAMPLE_M));
  const close = () => {
    if (cur && cur.exit - cur.enter >= TOLLS_GEO.MIN_RUN_M) runs.push(cur);
    cur = null;
  };
  for (let k = 0; k <= N; k += 1) {
    const along = Math.min(line.total, k * (line.total / N));
    const at = pointAt(line, along);
    const p = at.point;
    while (si < steps.length - 1 && isNum(line.cum[steps[si].wayPoints[1]]) && line.cum[steps[si].wayPoints[1]] < along) si += 1;
    let hit = null;
    if (p[0] >= w - margin && p[0] <= e + margin && p[1] >= s - margin && p[1] <= n + margin) {
      const seg = nearestSegment(net, p, segmentBearing(line, at.segIndex ?? 0));
      const named = stepRefs[si] ?? [];
      // Veto : l'étape ORS nomme une autre route (aucune référence commune avec la voie OSM). v81 : levé si la
      // géométrie (geoRoadsAll, axis-match.js) donne la référence de la voie à cet endroit (nom ORS = début d'étape).
      const g = geoAll?.ref?.[at.segIndex];
      const geoRefs = typeof g === 'string' && g ? g.split(';') : [];
      if (seg && (!named.length || named.some((r) => seg.refs.includes(r)) || geoRefs.some((r) => seg.refs.includes(r)))) hit = seg;
    }
    if (!hit) { close(); continue; }
    const roads = hit.refs.filter((r) => tax.roads.includes(r));
    if (!cur) cur = { enter: along, exit: along, roads: [] };
    cur.exit = along;
    for (const r of roads) if (!cur.roads.includes(r)) cur.roads.push(r);
  }
  close();
  return runs;
}

// ───────── Action : voies exportées par osmium ─────────

/**
 * Objet GeoJSON exporté par osmium (--add-unique-id=type_id) → voie { id, refs, highway, toll, oneway, coords }, ou
 * null (pas une route lue, sans référence).
 */
export function tollWayFromFeature(f) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !t || f?.geometry?.type !== 'LineString' || !TOLLS_GEO.HIGHWAYS.has(t.highway)) return null;
  const refs = normalizeRefs(typeof t.ref === 'string' ? t.ref : '');
  if (!refs.length) return null;
  const coords = f.geometry.coordinates.filter((c) => Array.isArray(c) && isNum(c[0]) && isNum(c[1]));
  if (coords.length < 2) return null;
  return {
    id: Number(m[1]), refs, highway: t.highway, toll: String(t.toll ?? '').trim().toLowerCase(),
    tollHgv: String(t['toll:hgv'] ?? '').trim().toLowerCase(),
    oneway: /^(yes|1|-1)$/i.test(String(t.oneway ?? '')) || t.highway === 'motorway', coords,
  };
}
