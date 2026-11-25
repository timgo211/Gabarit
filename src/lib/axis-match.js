// Repli par la géométrie (PR 3a, v73) : retrouver la route (autoroute, voie rapide, primaire et son numéro `ref`) des
// tronçons qu'ORS renvoie sans nom ni référence, en comparant le tracé à la copie data/axes-osm/ (Action « Audit OSM »,
// axes-convert.js ; © contributeurs OpenStreetMap, ODbL). Logique pure, testée sous Node.
//
// Pourquoi : ORS nomme une étape d'après la première arête de l'instruction ; une étape commencée sur une bretelle
// sans `name` ni `ref` garde « - » jusqu'à la manœuvre suivante (docs/etude-osm-axes.md, section 5 : sur Joigny →
// Gonfreville-l'Orcher, 199 km sur 321 sans nom, dont 103 km d'A13). Les règles fondées sur la référence (régime
// week-end d'Île-de-France, hgv-bans.js) ne voyaient alors pas l'A13.
//
// Usage : avertissements seulement. Le calcul d'itinéraire (ORS seul moteur), l'ordre des fiches et le « Recommandé »
// (road-class.js, pickRecommendedIndex) ne lisent jamais ce repli. Une étape nommée par ORS n'est jamais réécrite :
// seules les étapes sans nom ni référence reçoivent la référence retrouvée. Toujours « à vérifier ».
//
// Méthode : celle déjà éprouvée en phase 5h ter (hgv-tolls-geo.js) :
// - un point du tracé tous les 50 m ;
// - tolérance 15 m : ORS construit son graphe sur OSM, ses points sont des nœuds OSM (arrondi 1e-5° ≈ 1 m) ; 15 m
//   couvrent la simplification de la copie (3 m), les retouches d'OSM entre la construction du graphe ORS et la copie,
//   et l'autre chaussée d'une même route (axes à 10–40 m, même référence) ; au-delà de 25 m, des contre-allées et des
//   routes voisines seraient prises. Copie simplifiée à plus de 3 m (repli de l'Action à 8 ou 20 m quand la copie est
//   trop grosse) : la tolérance ne couvre plus l'écart, repli désactivé (jamais une tolérance élargie en silence) ;
// - cap à 30° au plus, mesuré modulo 180° (axisDiff : une chaussée se parcourt dans les deux sens, l'ordre des nœuds
//   OSM ne dit pas le sens de circulation) : écarte les ponts et les croisements (route qui passe dessus ou dessous)
//   et les bretelles qui divergent ;
// - ambigu = inconnu : à un même point, voies de classes différentes, ou références incompatibles (« A13 » et
//   « A13;E5 » sont compatibles : l'une contient l'autre ; « A13 » et « N13 » ne le sont pas). Une voie sans référence
//   (bretelle) à côté d'une voie de même classe qui en a une : la référence est gardée ;
// - séries de moins de 300 m écartées (bout de bretelle, échangeur) ; un tronçon du tracé dont les points ne
//   s'accordent pas reste inconnu.

import { prepareLine, pointAt, segmentBearing } from './nav-geo.js';
import { axisDiff } from './hgv-tolls-geo.js';
import { unnamedSegments } from './road-class.js';

export const AXIS_MATCH = Object.freeze({
  SAMPLE_M: 50,
  TOLERANCE_M: 15,
  MAX_HEADING_DEG: 30,
  MIN_RUN_M: 300,
  /** Taille d'une cellule de l'index des segments (degrés, ≈ 550 m) : bien plus grande que la tolérance. */
  CELL_DEG: 0.005,
  /** Simplification de la copie au-delà de laquelle le repli est désactivé (m). */
  MAX_COPY_TOLERANCE_M: 3,
});

export const AXIS_GEO_NOTE = 'Numéro de route retrouvé par la géométrie (OpenStreetMap) : à vérifier.';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

/**
 * Case de data/axes-osm/ → { lines:[{ cls, ref, refs, coords, key }] } ; null si illisible.
 * ref : références jointes (« A13;E5 ») ou '' (voie sans référence) ; key : ligne encodée (doublons des voies écrites
 * dans deux cases).
 */
export function parseAxesTile(json) {
  if (!json || !Array.isArray(json.r) || !Array.isArray(json.a)) return null;
  const lines = [];
  for (const row of json.a) {
    if (!Array.isArray(row) || row.length < 6 || !Number.isInteger(row[0]) || !Number.isInteger(row[1])) continue;
    if (row[1] < 0 || row[1] > 2) continue;
    const ref = row[0] >= 0 && typeof json.r[row[0]] === 'string' ? json.r[row[0]] : '';
    const coords = [];
    let x = 0; let y = 0; let ok = true;
    for (let i = 2; i + 1 < row.length; i += 2) {
      if (!isNum(row[i]) || !isNum(row[i + 1])) { ok = false; break; }
      x += row[i]; y += row[i + 1];
      coords.push([x / 1e5, y / 1e5]);
    }
    if (!ok || coords.length < 2) continue;
    lines.push({ cls: row[1], ref, refs: ref ? ref.split(';') : [], coords, key: `${ref}|${row.slice(1).join(',')}` });
  }
  return { lines };
}

/** Cases lues → une seule liste de voies, sans doublon (voie à cheval sur deux cases). */
export function mergeAxesTiles(tiles) {
  const seen = new Set();
  const lines = [];
  for (const t of tiles) {
    for (const l of t?.lines ?? []) {
      if (seen.has(l.key)) continue;
      seen.add(l.key);
      lines.push(l);
    }
  }
  return { lines };
}

const cellOf = (lon, lat) => `${Math.floor(lon / AXIS_MATCH.CELL_DEG)}_${Math.floor(lat / AXIS_MATCH.CELL_DEG)}`;

/**
 * Cellules du couloir du tracé (cellules de ses points, tous les 100 m, et leurs voisines) : seuls les segments de la
 * copie qui y tombent sont indexés (un long trajet lit beaucoup de cases).
 */
function corridorCells(line) {
  const cells = new Set();
  const c = AXIS_MATCH.CELL_DEG;
  for (let along = 0; ; along += 100) {
    const p = pointAt(line, Math.min(along, line.total)).point;
    const cx = Math.floor(p[0] / c); const cy = Math.floor(p[1] / c);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) cells.add(`${cx + dx}_${cy + dy}`);
    if (along >= line.total) break;
  }
  return cells;
}

/**
 * Index des segments de la copie proches du tracé (cellules de CELL_DEG ; un segment est rangé dans toutes les
 * cellules que touche son emprise élargie de la tolérance, seulement dans le couloir `corridor`).
 */
export function buildAxisIndex(lines, corridor) {
  const cells = new Map();
  const tolDeg = AXIS_MATCH.TOLERANCE_M / M_PER_DEG_LAT * 2;
  const c = AXIS_MATCH.CELL_DEG;
  let segments = 0;
  for (const [li, l] of lines.entries()) {
    for (let i = 1; i < l.coords.length; i += 1) {
      const a = l.coords[i - 1]; const b = l.coords[i];
      const x0 = Math.floor((Math.min(a[0], b[0]) - tolDeg) / c); const x1 = Math.floor((Math.max(a[0], b[0]) + tolDeg) / c);
      const y0 = Math.floor((Math.min(a[1], b[1]) - tolDeg) / c); const y1 = Math.floor((Math.max(a[1], b[1]) + tolDeg) / c);
      let seg = null;
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
          const k = `${cx}_${cy}`;
          if (!corridor.has(k)) continue;
          if (!seg) { seg = { a, b, li }; segments += 1; }
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(seg);
        }
      }
    }
  }
  return { cells, segments };
}

/** Distance (m) du point p au segment ab, et cap du segment (degrés), en projection locale. */
function toSegment(p, a, b) {
  const kx = M_PER_DEG_LON * Math.cos(p[1] * RAD);
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - p[0]) * kx; const by = (b[1] - p[1]) * M_PER_DEG_LAT;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const qx = ax + t * dx; const qy = ay + t * dy;
  const heading = ((Math.atan2(dx, dy) / RAD) + 360) % 360;
  return { dist: Math.hypot(qx, qy), heading };
}

/** Références compatibles : l'une contient l'autre. */
const compatible = (a, b) => a.every((r) => b.includes(r)) || b.every((r) => a.includes(r));

/**
 * Voie retrouvée en un point : { cls, ref } ; 'ambiguous' ; ou null (aucune voie à 15 m et au bon cap).
 * @param {{ cells:Map }} index buildAxisIndex
 * @param {object[]} lines voies de la copie (mêmes indices que l'index)
 */
export function matchPoint(index, lines, p, heading, stats = null) {
  // Un segment est rangé dans toutes les cellules touchées par son emprise élargie : la cellule du point suffit.
  const cands = new Set();
  for (const seg of index.cells.get(cellOf(p[0], p[1])) ?? []) {
    if (stats) stats.segmentsTested += 1;
    const r = toSegment(p, seg.a, seg.b);
    if (r.dist > AXIS_MATCH.TOLERANCE_M || axisDiff(r.heading, heading) > AXIS_MATCH.MAX_HEADING_DEG) continue;
    cands.add(seg.li);
  }
  return cands.size ? resolve(lines, [...cands]) : null;
}

/** Candidats d'un point → { cls, ref } ou 'ambiguous'. */
function resolve(lines, lis) {
  const classes = new Set(lis.map((li) => lines[li].cls));
  if (classes.size > 1) return 'ambiguous';
  let best = [];
  for (const li of lis) {
    const refs = lines[li].refs;
    if (!refs.length) continue;
    if (!best.length) { best = refs; continue; }
    if (!compatible(best, refs)) return 'ambiguous';
    if (refs.length > best.length) best = refs;
  }
  return { cls: [...classes][0], ref: best.join(';') };
}

const keyOf = (r) => (r === null ? null : r === 'ambiguous' ? 'ambiguous' : `${r.cls}|${r.ref}`);

/**
 * Repli par la géométrie d'un itinéraire.
 * @param {{ coordinates:number[][], steps?:object[] }} route
 * @param {{ lines:object[] }|null} data copie lue (mergeAxesTiles)
 * @param {{ copyTolerance?:number|null }} opts simplification de la copie (index.json, champ tolerance)
 * @returns {{ status:'ok'|'disabled'|'none', cls:(number|null)[], ref:(string|null)[], amb:boolean[],
 *   km:{ matched:number, ambiguous:number, unnamed:number }, stats:{ samples:number, segmentsTested:number,
 *   segmentsIndexed:number } }|null}
 *   cls/ref par tronçon du tracé (i → i+1) : null si inconnu ; ref '' = voie retrouvée sans référence ; amb : tronçon
 *   ambigu (voies de classes ou de références incompatibles) ; distances en m ;
 *   null si le tracé est absent.
 */
export function matchRouteAxes(route, data, { copyTolerance = AXIS_MATCH.MAX_COPY_TOLERANCE_M } = {}) {
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const n = coords.length - 1;
  const cls = new Array(n).fill(null);
  const ref = new Array(n).fill(null);
  const amb = new Array(n).fill(false);
  const stats = { samples: 0, segmentsTested: 0, segmentsIndexed: 0 };
  const line = prepareLine(coords);
  const unnamed = unnamedSegments(route);
  let unnamedM = 0;
  for (let i = 0; i < n; i += 1) if (unnamed[i]) unnamedM += line.cum[i + 1] - line.cum[i];
  const km = { matched: 0, ambiguous: 0, unnamed: unnamedM };
  const out = { status: 'none', cls, ref, amb, km, stats };
  if (!isNum(copyTolerance) || copyTolerance > AXIS_MATCH.MAX_COPY_TOLERANCE_M) return { ...out, status: 'disabled' };
  if (!data?.lines?.length || !unnamedM) return out;
  const index = buildAxisIndex(data.lines, corridorCells(line));
  stats.segmentsIndexed = index.segments;

  // Points tous les 50 m sur les tronçons sans nom ni référence.
  const samples = [];
  const steps = Math.ceil(line.total / AXIS_MATCH.SAMPLE_M);
  for (let k = 0; k <= steps; k += 1) {
    const along = Math.min(line.total, k * AXIS_MATCH.SAMPLE_M);
    const at = pointAt(line, along);
    const i = at.segIndex;
    if (!unnamed[i]) { samples.push({ along, i, key: null, res: null, skip: true }); continue; }
    stats.samples += 1;
    const res = matchPoint(index, data.lines, at.point, segmentBearing(line, i), stats);
    samples.push({ along, i, key: keyOf(res), res, skip: false });
  }
  // Séries de même résultat de moins de 300 m écartées.
  let start = 0;
  for (let k = 1; k <= samples.length; k += 1) {
    if (k < samples.length && samples[k].key === samples[start].key && !samples[k].skip && !samples[start].skip) continue;
    const s0 = samples[start];
    const len = samples[k - 1].along - s0.along;
    if (!s0.skip && s0.key !== null && s0.key !== 'ambiguous' && len < AXIS_MATCH.MIN_RUN_M) {
      for (let j = start; j < k; j += 1) { samples[j].key = null; samples[j].res = null; }
    }
    start = k;
  }
  // Résultat par tronçon : tous ses points d'accord ; sans point (tronçon court), les points qui l'encadrent.
  const bySeg = new Map();
  for (const s of samples) {
    if (s.skip) continue;
    if (!bySeg.has(s.i)) bySeg.set(s.i, []);
    bySeg.get(s.i).push(s);
  }
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    if (!unnamed[i]) continue;
    const len = line.cum[i + 1] - line.cum[i];
    let list = bySeg.get(i);
    if (!list) {
      while (k < samples.length - 1 && samples[k + 1].along <= line.cum[i]) k += 1;
      const before = samples[k];
      const after = samples.find((s, j) => j > k && s.along >= line.cum[i + 1]);
      list = before && after && !before.skip && !after.skip ? [before, after] : [];
    }
    if (!list.length) continue;
    const keys = new Set(list.map((s) => s.key));
    if (keys.size !== 1) continue;
    const r = list[0].res;
    if (r === 'ambiguous') { km.ambiguous += len; amb[i] = true; continue; }
    if (!r) continue;
    cls[i] = r.cls;
    ref[i] = r.ref;
    if (r.ref) km.matched += len;
  }
  return { ...out, status: 'ok' };
}

// Un calcul par itinéraire et par copie (renderChoice redessine souvent les fiches).
const memo = new WeakMap();

/** matchRouteAxes mémorisé par itinéraire et par copie lue. */
export function geoRoadsFor(route, data, opts = {}) {
  if (!route || typeof route !== 'object') return null;
  const hit = memo.get(route);
  if (hit && hit.data === data && hit.tol === opts.copyTolerance) return hit.res;
  const res = matchRouteAxes(route, data, opts);
  memo.set(route, { data, tol: opts.copyTolerance, res });
  return res;
}

/**
 * Route retrouvée sur les tronçons [from, to) d'une étape (diagnostic, PR 3b) : références dans l'ordre du trajet
 * (« A 12, A 13 »), sinon « ambigu », sinon « inconnue » ; « non chargée » sans repli calculé.
 */
export function geoStepLabel(geo, from, to) {
  if (!geo || geo.status !== 'ok') return geo?.status === 'disabled' ? 'désactivé' : 'non chargée';
  const refs = [];
  let ambiguous = false;
  for (let i = Math.max(0, from); i < to && i < geo.ref.length; i += 1) {
    const r = geo.ref[i];
    if (typeof r === 'string' && r) {
      for (const x of r.split(';')) if (!refs.includes(x)) refs.push(x);
    } else if (geo.amb?.[i]) ambiguous = true;
  }
  if (refs.length) return refs.map((x) => x.replace(/^([A-Z]+)(\d)/, '$1 $2')).join(', ');
  return ambiguous ? 'ambigu' : 'inconnue';
}

const km1 = (m) => (m / 1000).toFixed(1).replace('.', ',');
const shortDate = (iso) => (typeof iso === 'string' ? iso.split('-').reverse().join('/') : '?');

/**
 * Ligne technique du diagnostic.
 * @param {{ status:string, updated?:string|null }} copy état de la copie (createTileCopy)
 * @param {object|null} geo matchRouteAxes
 */
export function axisTechText(copy, geo) {
  const head = 'Repli par la géométrie (axes OSM)';
  if (!copy || copy.status === 'idle' || copy.status === 'loading') return `${head} : chargement`;
  if (copy.status !== 'ok') return `${head} : données non chargées`;
  if (!geo) return `${head} : tracé absent`;
  if (geo.status === 'disabled') return `${head} : copie trop simplifiée, repli désactivé`;
  return `${head}, copie du ${shortDate(copy.updated)} : ${km1(geo.km.matched)} km retrouvés sur ${km1(geo.km.unnamed)} km `
    + `sans nom ni référence ; ${km1(geo.km.ambiguous)} km ambigus (inconnus)`;
}
