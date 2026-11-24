// Copie des voies de circulation à flèches au sol d'OpenStreetMap dans data/voies-osm/ (phase 11d), côté Action
// (tools/osm-update.mjs). Logique pure, testée sous Node. Données © contributeurs OpenStreetMap, licence ODbL.
//
// Même méthode, mêmes cases et mêmes limites que data/directions-osm/ (extrait France de Geofabrik, étiquettes ajoutées
// au filtrage des ponts : un seul filtrage, un seul export ; 5 Mo par fichier, 40 Mo en tout ; jamais précachée ;
// trop gros → rien n'est écrit, l'ancienne copie reste).
//
// Étiquettes (wiki OSM Key:turn, Key:lanes, Key:oneway, Tag:junction=roundabout, lus le 24/11/2026) :
// - `turn:lanes` = une valeur par voie, de gauche à droite dans le sens de la voie OSM, séparées par « | » ; plusieurs
//   flèches d'une même voie séparées par « ; » (« left|through;right ») ; `none` ou vide = voie sans flèche.
// - Voie à double sens : `turn:lanes:forward` (sens du dessin) et `turn:lanes:backward` (sens inverse), avec
//   `lanes:forward` / `lanes:backward` pour le nombre de voies de chaque sens.
// - `highway=motorway` et `motorway_link` sont à sens unique sans `oneway` (Key:oneway, « implied »).
//
// Règles (jamais de voie inventée) : seules les voies dont le nombre de valeurs est égal au nombre de voies déclaré
// sont gardées. Ignorées, avec un compteur par motif dans le journal : rond-point (`junction=roundabout|circular`),
// `oneway=-1` ou autre sens particulier, `turn:lanes` sans suffixe sur une voie à double sens, nombre de voies absent
// ou illisible, nombre différent, valeur `none` ou vide (compteur à part pour juger la couverture), valeur inconnue.
//
// Format (lu par parseLaneTile, src/lib/lanes.js, PR C) : index.json (source, license, updated, countries, count,
// grid, tolerance, tiles) + une case E_N.json par degré : { t:[textes turn:lanes…], v:[[i_turn, n, x0, y0, dx, dy,
// …]] } ; coordonnées entières en 1e-5 degré, écart au point précédent. Chaque ligne suit le sens de roulage et FINIT
// au carrefour où les flèches servent : seuls les LANES.KEEP_M derniers mètres sont gardés.

import { simplifyLine } from './areas-osm.js';
import { tileKey } from './areas-osm-data.js';
import { haversine } from './nav-geo.js';
import { BRIDGES } from './bridges-convert.js';

export const LANES = Object.freeze({
  DIR: './data/voies-osm/',
  INDEX_PATH: './data/voies-osm/index.json',
  REGIONS: BRIDGES.REGIONS,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 40 * 1024 * 1024,
  /** Lignes GeoJSON de l'export lues pour les voies : au-delà, plus rien n'est gardé et rien n'est écrit. */
  MAX_SOURCE_BYTES: 1024 * 1024 * 1024,
  TOLERANCES_M: Object.freeze([3, 8, 20]),
  HIGHWAYS: Object.freeze(new Set([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  ])),
  /** À sens unique sans `oneway` (wiki OSM Key:oneway). */
  IMPLIED_ONEWAY: Object.freeze(new Set(['motorway', 'motorway_link'])),
  VALUES: Object.freeze(new Set([
    'left', 'slight_left', 'sharp_left', 'through', 'right', 'slight_right', 'sharp_right', 'reverse',
    'merge_to_left', 'merge_to_right',
  ])),
  /** Longueur gardée avant le carrefour (m). */
  KEEP_M: 200,
  MAX_LANES: 16,
  MAX_TEXT: 160,
});

/** Motifs de refus, dans l'ordre du journal. */
export const LANE_SKIPS = Object.freeze({
  highway: 'type de voie non gardé',
  roundabout: 'rond-point',
  oneway: 'oneway=-1 ou sens particulier',
  nosuffix: 'turn:lanes sans suffixe à double sens',
  lanes: 'nombre de voies absent ou illisible',
  count: 'nombre de valeurs différent du nombre de voies',
  none: 'valeur none ou vide',
  value: 'valeur inconnue',
  geometry: 'géométrie illisible',
});

/** Étiquettes ajoutées au filtre osmium des ponts. */
export function osmiumLanesFilter() {
  return ['w/turn:lanes', 'w/turn:lanes:forward', 'w/turn:lanes:backward'];
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** « 2 » → 2 ; absent, nul, trop grand ou illisible → null. */
export function laneCount(text) {
  const v = String(text ?? '').trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= LANES.MAX_LANES ? n : null;
}

/**
 * Texte turn:lanes + nombre de voies → { ok:true, text, lanes:[[valeurs]] } ou { ok:false, reason } (LANE_SKIPS).
 * @param {string} text
 * @param {number|null} n
 */
export function parseTurnLanes(text, n) {
  if (typeof text !== 'string') return { ok: false, reason: 'value' };
  if (!Number.isInteger(n)) return { ok: false, reason: 'lanes' };
  const raw = text.split('|');
  if (raw.length !== n) return { ok: false, reason: 'count' };
  const lanes = raw.map((l) => l.split(';').map((p) => p.trim()));
  if (lanes.some((l) => l.some((p) => p === '' || p === 'none'))) return { ok: false, reason: 'none' };
  if (lanes.some((l) => l.some((p) => !LANES.VALUES.has(p)))) return { ok: false, reason: 'value' };
  const out = lanes.map((l) => l.join(';')).join('|');
  if (out.length > LANES.MAX_TEXT) return { ok: false, reason: 'value' };
  return { ok: true, text: out, lanes };
}

/** Derniers LANES.KEEP_M mètres d'une ligne (le carrefour est à sa fin). */
function tailPart(coords) {
  const out = [coords[coords.length - 1]];
  let d = 0;
  for (let i = coords.length - 2; i >= 0; i -= 1) {
    d += haversine(coords[i + 1], coords[i]);
    out.unshift(coords[i]);
    if (d >= LANES.KEEP_M) break;
  }
  return out;
}

/**
 * Objet GeoJSON exporté par osmium → { lines:[{ kind:'oneway'|'forward'|'backward', turn, n, coords }],
 * skips:[motif…] } ; null si ce n'est pas une voie portant turn:lanes, turn:lanes:forward ou turn:lanes:backward.
 */
export function lanesFromFeature(f) {
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!t || !/^w\d+$/.test(String(f?.id ?? ''))) return null;
  const keys = ['turn:lanes', 'turn:lanes:forward', 'turn:lanes:backward'].filter((k) => typeof t[k] === 'string');
  if (!keys.length) return null;
  const skip = (reason) => ({ lines: [], skips: keys.map(() => reason) });
  if (!LANES.HIGHWAYS.has(t.highway)) return skip('highway');
  if (t.junction === 'roundabout' || t.junction === 'circular') return skip('roundabout');
  const coords = f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)
    ? f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])) : [];
  if (coords.length < 2) return skip('geometry');
  const ow = String(t.oneway ?? '').trim();
  let oneway;
  if (ow === 'yes' || ow === '1' || ow === 'true') oneway = true;
  else if (ow === 'no' || ow === '0' || ow === 'false') oneway = false;
  else if (ow === '') oneway = LANES.IMPLIED_ONEWAY.has(t.highway);
  else return skip('oneway'); // -1, reversible, alternating… : sens ambigu
  const lines = []; const skips = [];
  const add = (kind, key, countKey, line) => {
    if (typeof t[key] !== 'string') return;
    const res = parseTurnLanes(t[key], laneCount(t[countKey]));
    if (!res.ok) { skips.push(res.reason); return; }
    lines.push({ kind, turn: res.text, n: res.lanes.length, coords: tailPart(line) });
  };
  if (oneway) {
    add('oneway', 'turn:lanes', 'lanes', coords);
    // :forward / :backward sur une voie à sens unique : jamais devinés.
    for (const k of ['turn:lanes:forward', 'turn:lanes:backward']) if (typeof t[k] === 'string') skips.push('nosuffix');
  } else {
    if (typeof t['turn:lanes'] === 'string') skips.push('nosuffix');
    add('forward', 'turn:lanes:forward', 'lanes:forward', coords);
    add('backward', 'turn:lanes:backward', 'lanes:backward', coords.slice().reverse());
  }
  return { lines, skips };
}

/** Compteurs vides des motifs de refus. */
export function emptyLaneSkips() {
  return Object.fromEntries(Object.keys(LANE_SKIPS).map((k) => [k, 0]));
}

/** Lignes du journal : volume lu dans l'export et motifs de refus (compteur « none » à part). */
export function laneSkipLog(skips) {
  const s = { ...emptyLaneSkips(), ...(skips ?? {}) };
  const others = Object.entries(LANE_SKIPS).filter(([k]) => k !== 'none' && s[k]).map(([k, label]) => `${label} ${s[k]}`);
  return [
    `Voies ignorées à cause de « none » ou d'une valeur vide : ${s.none}.`,
    `Voies ignorées pour un autre motif : ${others.length ? others.join(', ') : 'aucune'}.`,
  ];
}

/** Volume lu dans l'export au-delà du plafond ? Sinon null. */
export function laneSourceProblem(bytes, max = LANES.MAX_SOURCE_BYTES) {
  return bytes > max ? `lignes de l'export pour les voies : ${(bytes / 1024 / 1024).toFixed(0)} Mo (plus de ${(max / 1024 / 1024).toFixed(0)} Mo)` : null;
}

function encodeLine(coords, tolerance) {
  const out = [];
  let px = 0; let py = 0;
  for (const [lon, lat] of simplifyLine(coords, tolerance)) {
    const x = Math.round(lon * 1e5); const y = Math.round(lat * 1e5);
    out.push(x - px, y - py);
    px = x; py = y;
  }
  return out;
}

function build(list, tolerance) {
  const tiles = new Map();
  for (const w of list) {
    const line = encodeLine(w.coords, tolerance);
    for (const key of new Set(w.coords.map(([lon, lat]) => tileKey(lon, lat)))) {
      if (!tiles.has(key)) tiles.set(key, { t: [], v: [], idx: new Map() });
      const tile = tiles.get(key);
      if (!tile.idx.has(w.turn)) { tile.idx.set(w.turn, tile.t.length); tile.t.push(w.turn); }
      tile.v.push([tile.idx.get(w.turn), w.n, ...line]);
    }
  }
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, t]) => [k, { t: t.t, v: t.v }]));
  let total = 0;
  let biggest = ['', 0];
  for (const [k, t] of sorted) {
    const n = Buffer.byteLength(`${JSON.stringify(t)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [k, n];
  }
  return { tiles: sorted, sizes: { total, biggest } };
}

/** Taille dans les limites (fichiers ≤ 5 Mo, total ≤ 40 Mo) ? Sinon le texte du journal. */
export function laneSizeProblem(sizes, maxTotal = LANES.MAX_TOTAL_BYTES) {
  if (sizes.biggest[1] > LANES.MAX_FILE_BYTES) return `case ${sizes.biggest[0]} de ${(sizes.biggest[1] / 1024 / 1024).toFixed(1)} Mo (plus de 5 Mo)`;
  if (sizes.total > maxTotal) return `total de ${(sizes.total / 1024 / 1024).toFixed(1)} Mo (plus de ${(maxTotal / 1024 / 1024).toFixed(0)} Mo)`;
  return null;
}

/**
 * Lignes de voies → contenu de data/voies-osm/ (3, 8 puis 20 m), sinon problème (rien n'est écrit).
 * @returns {{ index:object|null, tiles:Map|null, log:string[], sizes:object|null, problem:string|null }}
 */
export function convertLanes(list, { updated = null, grid = null, countries = [], maxTotal = LANES.MAX_TOTAL_BYTES } = {}) {
  const by = (k) => list.filter((w) => w.kind === k).length;
  const log = [`Voies : ${list.length} lignes gardées (${by('oneway')} sens unique, ${by('forward')} forward, ${by('backward')} backward).`];
  let problem = null;
  for (const tol of LANES.TOLERANCES_M) {
    const res = build(list, tol);
    problem = laneSizeProblem(res.sizes, maxTotal);
    log.push(`Voies, simplification ${tol} m : ${(res.sizes.total / 1024 / 1024).toFixed(2)} Mo, plus grosse case ${res.sizes.biggest[0]} `
      + `(${(res.sizes.biggest[1] / 1024).toFixed(0)} Ko)${problem ? ` — ${problem}` : ''}.`);
    if (!problem) {
      const index = {
        source: 'OpenStreetMap (extraits Geofabrik) : voies avec turn:lanes (+ lanes), turn:lanes:forward (+ lanes:forward) ou turn:lanes:backward (+ lanes:backward), hors ronds-points',
        license: 'ODbL, © contributeurs OpenStreetMap',
        updated,
        countries,
        count: list.length,
        grid,
        tolerance: tol,
        tiles: Object.fromEntries([...res.tiles.entries()].map(([k, t]) => [k, t.v.length])),
      };
      return { index, tiles: res.tiles, log, sizes: res.sizes, problem: null };
    }
  }
  return { index: null, tiles: null, log, sizes: null, problem };
}
