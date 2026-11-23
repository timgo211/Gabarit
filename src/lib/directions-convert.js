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
//
// v53 (sorties) : nœuds highway=motorway_junction (numéro `ref`, nom `name`, sinon `exit_to`) dans `j:[[i_ref|-1,
// i_nom|-1, x, y]]` (coordonnées entières absolues en 1e-5 degré) et, pour chaque ligne de `d`, `e:[[i_junction:ref|-1,
// i_exit_to|-1]]` (même ordre ; absent = aucun). Un lecteur d'avant ignore `j` et `e` : la copie reste lisible.
// Bretelle gardée aussi si elle n'a que `junction:ref` ou `exit_to` (sans direction : jamais de « direction X »).
// Wiki OSM Tag:highway=motorway_junction, Key:junction:ref, Key:exit_to, lus le 23/11/2026 (journal de l'Action
// « Textes officiels ») : le nœud de sortie porte le numéro (`ref`) et le nom de l'échangeur (`name`) ; `exit_to`
// (déconseillé au profit de `destination` sur la bretelle) donne la destination indiquée.

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
  /** Numéro de sortie (v53) : 8 caractères au plus. */
  MAX_REF: 8,
});

/** Étiquettes ajoutées au filtre osmium des ponts (bretelles, puis nœuds de sortie, v53). */
export function osmiumDirectionsFilter() {
  return ['w/destination', 'w/destination:ref', 'w/junction:ref', 'w/exit_to', 'n/highway=motorway_junction'];
}

/** Numéro de sortie : court, sans retour à la ligne (« 12 », « 34a ») ; sinon null. */
export function cleanExitRef(text) {
  if (typeof text !== 'string') return null;
  const v = text.split(';')[0].replace(/\s+/g, ' ').trim();
  return v && v.length <= DIRECTIONS.MAX_REF ? v : null;
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

/**
 * Objet GeoJSON exporté par osmium → bretelle { dest, ref, exitRef, exitTo, bidir, coords }, nœud de sortie
 * { junction:true, ref, name, at } (v53), ou null.
 */
export function directionFromFeature(f) {
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (t && /^n\d+$/.test(String(f?.id ?? '')) && t.highway === 'motorway_junction') {
    const at = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (!Array.isArray(at) || !isNum(at[0]) || !isNum(at[1])) return null;
    const ref = cleanExitRef(t.ref);
    const name = cleanDestination(t.name) ?? cleanDestination(t.exit_to);
    if (!ref && !name) return null;
    return { junction: true, ref, name, at: [at[0], at[1]] };
  }
  if (!t || !/^w\d+$/.test(String(f?.id ?? '')) || !DIRECTIONS.HIGHWAYS.has(t.highway)) return null;
  if (f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const dest = cleanDestination(t.destination);
  const ref = cleanDestination(t['destination:ref']);
  const exitRef = cleanExitRef(t['junction:ref']);
  const exitTo = cleanDestination(t.exit_to);
  if (!dest && !ref && !exitRef && !exitTo) return null;
  let coords = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (coords.length < 2) return null;
  const oneway = String(t.oneway ?? '').trim();
  if (oneway === '-1') coords = coords.slice().reverse();
  return { dest, ref, exitRef, exitTo, bidir: oneway === 'no', coords: headPart(coords) };
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
  const tileOf = (key) => {
    if (!tiles.has(key)) tiles.set(key, { t: [], d: [], e: [], j: [], idx: new Map() });
    const tile = tiles.get(key);
    const ix = (s) => {
      if (!s) return -1;
      if (!tile.idx.has(s)) { tile.idx.set(s, tile.t.length); tile.t.push(s); }
      return tile.idx.get(s);
    };
    return { tile, ix };
  };
  for (const w of list) {
    if (w.junction) {
      const { tile, ix } = tileOf(tileKey(w.at[0], w.at[1]));
      tile.j.push([ix(w.ref), ix(w.name), Math.round(w.at[0] * 1e5), Math.round(w.at[1] * 1e5)]);
      continue;
    }
    const line = encodeLine(w.coords, tolerance);
    for (const key of new Set(w.coords.map(([lon, lat]) => tileKey(lon, lat)))) {
      const { tile, ix } = tileOf(key);
      tile.d.push([ix(w.dest), ix(w.ref), w.bidir ? 1 : 0, ...line]);
      tile.e.push([ix(w.exitRef), ix(w.exitTo)]);
    }
  }
  const out = (t) => {
    const o = { t: t.t, d: t.d };
    if (t.e.some(([a, b]) => a >= 0 || b >= 0)) o.e = t.e;
    if (t.j.length) o.j = t.j;
    return o;
  };
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, t]) => [k, out(t)]));
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
  const links = list.filter((w) => !w.junction);
  const log = [`Directions : ${links.length} bretelles (dont ${links.filter((w) => w.dest).length} avec destination, ${links.filter((w) => w.bidir).length} à deux sens, ${links.filter((w) => w.exitRef || w.exitTo).length} avec junction:ref ou exit_to), ${list.length - links.length} nœuds de sortie.`];
  let problem = null;
  for (const tol of DIRECTIONS.TOLERANCES_M) {
    const res = build(list, tol);
    problem = directionSizeProblem(res.sizes, maxTotal);
    log.push(`Directions, simplification ${tol} m : ${(res.sizes.total / 1024 / 1024).toFixed(2)} Mo, plus grosse case ${res.sizes.biggest[0]} `
      + `(${(res.sizes.biggest[1] / 1024).toFixed(0)} Ko)${problem ? ` — ${problem}` : ''}.`);
    if (!problem) {
      const index = {
        source: 'OpenStreetMap (extraits Geofabrik) : bretelles motorway_link / trunk_link avec destination, destination:ref, junction:ref ou exit_to ; nœuds highway=motorway_junction (ref, name, exit_to)',
        license: 'ODbL, © contributeurs OpenStreetMap',
        updated,
        countries,
        count: links.length,
        junctions: list.length - links.length,
        grid,
        tolerance: tol,
        tiles: Object.fromEntries([...res.tiles.entries()].map(([k, t]) => [k, t.d.length])),
      };
      return { index, tiles: res.tiles, log, sizes: res.sizes, problem: null };
    }
  }
  return { index: null, tiles: null, log, sizes: null, problem };
}
