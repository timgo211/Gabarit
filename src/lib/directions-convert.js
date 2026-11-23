// Copie des directions écrites sur les panneaux des bretelles d'OpenStreetMap dans data/directions-osm/ (phase 11b),
// côté Action (tools/osm-update.mjs). Logique pure, testée sous Node. Données © contributeurs OpenStreetMap, licence
// ODbL.
//
// Même méthode, mêmes cases et mêmes limites que data/vitesses-osm/ (extrait France de Geofabrik, étiquettes ajoutées
// au filtrage des ponts : un seul filtrage, un seul export ; 5 Mo par fichier, 40 Mo en tout ; jamais précachée).
// Gardé : bretelles highway=motorway_link ou trunk_link portant `destination` (direction écrite sur le panneau, par
// ex. « Metz;Nancy ») ou `destination:ref` (« A 31 »). Valeurs par voie (`destination:lanes`) seules : ignorées
// (direction d'une voie, pas de la bretelle). Sens : oneway=-1 → géométrie retournée ; oneway=no → drapeau « deux
// sens » (cap comparé modulo 180°) ; sinon sens de la voie (bretelle à sens unique par défaut).
// Wiki OSM (Key:destination, Key:destination:ref, Key:oneway, Tag:highway=motorway_link), lu le 23/11/2026.
//
// Format (lu par parseDirectionTile, src/lib/directions.js) : index.json (updated, countries, count, grid, tolerance,
// tiles) + une case E_N.json par degré : { t:[textes…], d:[[i_destination|-1, i_ref|-1, deux_sens, x0, y0, dx, dy,
// …]] } ; coordonnées entières en 1e-5 degré, écart au point précédent. Seuls les DIRECTIONS.KEEP_M premiers mètres
// de la bretelle sont gardés (le point de manœuvre est à son début).

import { simplifyLine } from './areas-osm.js';
import { tileKey } from './areas-osm-data.js';
import { haversine } from './nav-geo.js';
import { BRIDGES } from './bridges-convert.js';

export const DIRECTIONS = Object.freeze({
  DIR: './data/directions-osm/',
  INDEX_PATH: './data/directions-osm/index.json',
  REGIONS: BRIDGES.REGIONS,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 40 * 1024 * 1024,
  TOLERANCES_M: Object.freeze([3, 8, 20]),
  HIGHWAYS: Object.freeze(new Set(['motorway_link', 'trunk_link'])),
  /** Longueur gardée depuis le début de la bretelle (m). */
  KEEP_M: 300,
  MAX_TEXT: 80,
});

/** Étiquettes ajoutées au filtre osmium des ponts (voies seulement). */
export function osmiumDirectionsFilter() {
  return ['w/destination', 'w/destination:ref'];
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** « Metz;Nancy » → « Metz, Nancy » ; vide ou trop long → null. */
export function cleanDestination(text) {
  if (typeof text !== 'string') return null;
  const parts = text.split(';').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = parts.join(', ');
  return out && out.length <= DIRECTIONS.MAX_TEXT ? out : null;
}

function headPart(coords) {
  const out = [coords[0]];
  let d = 0;
  for (let i = 1; i < coords.length; i += 1) {
    d += haversine(coords[i - 1], coords[i]);
    out.push(coords[i]);
    if (d >= DIRECTIONS.KEEP_M) break;
  }
  return out;
}

/** Objet GeoJSON exporté par osmium → { dest, ref, bidir, coords } ou null. */
export function directionFromFeature(f) {
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!t || !/^w\d+$/.test(String(f?.id ?? '')) || !DIRECTIONS.HIGHWAYS.has(t.highway)) return null;
  if (f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const dest = cleanDestination(t.destination);
  const ref = cleanDestination(t['destination:ref']);
  if (!dest && !ref) return null;
  let coords = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (coords.length < 2) return null;
  const oneway = String(t.oneway ?? '').trim();
  if (oneway === '-1') coords = coords.slice().reverse();
  return { dest, ref, bidir: oneway === 'no', coords: headPart(coords) };
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
      if (!tiles.has(key)) tiles.set(key, { t: [], d: [], idx: new Map() });
      const tile = tiles.get(key);
      const ix = (s) => {
        if (!s) return -1;
        if (!tile.idx.has(s)) { tile.idx.set(s, tile.t.length); tile.t.push(s); }
        return tile.idx.get(s);
      };
      tile.d.push([ix(w.dest), ix(w.ref), w.bidir ? 1 : 0, ...line]);
    }
  }
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, t]) => [k, { t: t.t, d: t.d }]));
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
export function directionSizeProblem(sizes, maxTotal = DIRECTIONS.MAX_TOTAL_BYTES) {
  if (sizes.biggest[1] > DIRECTIONS.MAX_FILE_BYTES) return `case ${sizes.biggest[0]} de ${(sizes.biggest[1] / 1024 / 1024).toFixed(1)} Mo (plus de 5 Mo)`;
  if (sizes.total > maxTotal) return `total de ${(sizes.total / 1024 / 1024).toFixed(1)} Mo (plus de 40 Mo)`;
  return null;
}

/**
 * Bretelles à direction → contenu de data/directions-osm/ (3, 8 puis 20 m), sinon problème (rien n'est écrit).
 * @returns {{ index:object|null, tiles:Map|null, log:string[], sizes:object|null, problem:string|null }}
 */
export function convertDirections(list, { updated = null, grid = null, countries = [], maxTotal = DIRECTIONS.MAX_TOTAL_BYTES } = {}) {
  const log = [`Directions : ${list.length} bretelles (dont ${list.filter((w) => w.dest).length} avec destination, ${list.filter((w) => w.bidir).length} à deux sens).`];
  let problem = null;
  for (const tol of DIRECTIONS.TOLERANCES_M) {
    const res = build(list, tol);
    problem = directionSizeProblem(res.sizes, maxTotal);
    log.push(`Directions, simplification ${tol} m : ${(res.sizes.total / 1024 / 1024).toFixed(2)} Mo, plus grosse case ${res.sizes.biggest[0]} `
      + `(${(res.sizes.biggest[1] / 1024).toFixed(0)} Ko)${problem ? ` — ${problem}` : ''}.`);
    if (!problem) {
      const index = {
        source: 'OpenStreetMap (extraits Geofabrik) : bretelles motorway_link / trunk_link avec destination ou destination:ref',
        license: 'ODbL, © contributeurs OpenStreetMap',
        updated,
        countries,
        count: list.length,
        grid,
        tolerance: tol,
        tiles: Object.fromEntries([...res.tiles.entries()].map(([k, t]) => [k, t.d.length])),
      };
      return { index, tiles: res.tiles, log, sizes: res.sizes, problem: null };
    }
  }
  return { index: null, tiles: null, log, sizes: null, problem };
}
