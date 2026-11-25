// Copie des autoroutes, voies rapides et routes primaires d'OpenStreetMap avec leur numéro (`ref`) dans
// data/axes-osm/, côté Action « Audit OSM » (tools/audit-osm.mjs, même téléchargement Geofabrik que l'audit). Logique
// pure, testée sous Node. Données © contributeurs OpenStreetMap, licence ODbL.
//
// But : retrouver la route (A/N et numéro) d'un tracé ORS par la géométrie quand ORS renvoie de longues étapes sans
// nom ni référence (étude docs/etude-osm-axes.md, section 5 : étape commencée sur une bretelle sans `name` ni `ref`).
// Lu par le repli de la PR 3 (pas encore codé) ; rien dans l'appli ne lit cette copie pour l'instant. Jamais précachée.
//
// Gardé : voies highway=motorway, trunk, primary et leurs bretelles (*_link, classées comme la route parente ; `ref`
// souvent absent sur les bretelles : -1). `ref` normalisé (« A 13 » → « A13 », plusieurs références « A 35;E 25 » →
// « A35;E25 », normalizeRefs de hgv-tolls-geo.js). Wiki OSM Key:highway, Key:ref, lu le 25/11/2026 : en France, `ref`
// d'une voie = numéro de la route (« A 13 », « N 154 »).
//
// Format : index.json (source, license, updated, countries, count, km par classe, tolerance, grid de la zone couverte
// comme data/ponts-osm/, tiles : cases non vides et leur nombre de lignes) + une case E_N.json par degré (coin sud-ouest
// de chaque point : une voie à cheval sur deux cases est écrite dans les deux) :
// { r:[références…], a:[[i_ref|-1, classe, x0, y0, dx, dy, …]] } ; classe 0 autoroute, 1 voie rapide (trunk),
// 2 primaire ; coordonnées entières en 1e-5 degré, écart au point précédent. Voies voisines de même classe et même
// référence mises bout à bout.
// Taille (consigne de la PR 2) : 5 Mo par fichier, 30 Mo en tout. Simplification 3, 8 puis 20 m ; au-delà, rien
// n'est écrit (ancienne copie gardée) et le journal donne les chiffres par classe : jamais de coupe silencieuse.

import { simplifyLine } from './areas-osm.js';
import { tileKey } from './areas-osm-data.js';
import { normalizeRefs } from './hgv-tolls-geo.js';
import { haversine } from './nav-geo.js';

export const AXES = Object.freeze({
  DIR: './data/axes-osm/',
  INDEX_PATH: './data/axes-osm/index.json',
  /** highway → classe (bretelles classées comme la route parente). */
  CLASSES: Object.freeze({
    motorway: 0, motorway_link: 0, trunk: 1, trunk_link: 1, primary: 2, primary_link: 2,
  }),
  CLASS_NAMES: Object.freeze(['autoroute', 'voie rapide', 'primaire']),
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 30 * 1024 * 1024,
  TOLERANCES_M: Object.freeze([3, 8, 20]),
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Références d'une étiquette `ref` OSM, normalisées et jointes (« A 35;E 25 » → « A35;E25 »), ou ''. */
export function axisRef(text) {
  return normalizeRefs(typeof text === 'string' ? text : '').join(';');
}

/**
 * Objet GeoJSON exporté par osmium (--add-unique-id=type_id) → { id, cls, ref, coords } ou null (pas une voie d'axe).
 */
export function axisFromFeature(f) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !t) return null;
  const cls = AXES.CLASSES[t.highway];
  if (cls === undefined) return null;
  if (f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const coords = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (coords.length < 2) return null;
  return { id: Number(m[1]), cls, ref: axisRef(t.ref), coords };
}

const ptKey = (p) => `${Math.round(p[0] * 1e7)}_${Math.round(p[1] * 1e7)}`;
const same = (a, b) => a.cls === b.cls && a.ref === b.ref;

/**
 * Voies de même classe et même référence qui se touchent par un bout mises bout à bout (dans un sens ou dans l'autre),
 * seulement là où exactement deux voies se touchent (même règle que chainWays de speed-convert.js).
 */
export function chainAxes(ways) {
  const ends = new Map();
  const add = (k, w) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(w); };
  for (const w of ways) { add(ptKey(w.coords[0]), w); add(ptKey(w.coords.at(-1)), w); }
  const used = new Set();
  const out = [];
  const partner = (w, k) => {
    const l = ends.get(k);
    if (!l || l.length !== 2) return null;
    const free = l.filter((x) => !used.has(x));
    return free.length === 1 && same(free[0], w) ? free[0] : null;
  };
  for (const w of ways) {
    if (used.has(w)) continue;
    used.add(w);
    let coords = w.coords.slice();
    for (;;) {
      const o = partner(w, ptKey(coords.at(-1)));
      if (!o) break;
      used.add(o);
      const oc = ptKey(o.coords[0]) === ptKey(coords.at(-1)) ? o.coords : o.coords.slice().reverse();
      coords = coords.concat(oc.slice(1));
    }
    for (;;) {
      const o = partner(w, ptKey(coords[0]));
      if (!o) break;
      used.add(o);
      const oc = ptKey(o.coords.at(-1)) === ptKey(coords[0]) ? o.coords : o.coords.slice().reverse();
      coords = oc.slice(0, -1).concat(coords);
    }
    out.push({ cls: w.cls, ref: w.ref, coords });
  }
  return out;
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

function lengthM(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i += 1) d += haversine(coords[i - 1], coords[i]);
  return d;
}

function build(lines, tolerance) {
  const tiles = new Map();
  const perClass = [0, 0, 0];
  for (const l of lines) {
    const enc = encodeLine(l.coords, tolerance);
    for (const key of new Set(l.coords.map(([lon, lat]) => tileKey(lon, lat)))) {
      if (!tiles.has(key)) tiles.set(key, { refs: new Map(), a: [] });
      const t = tiles.get(key);
      let i = -1;
      if (l.ref) {
        if (!t.refs.has(l.ref)) t.refs.set(l.ref, t.refs.size);
        i = t.refs.get(l.ref);
      }
      t.a.push([i, l.cls, ...enc]);
    }
  }
  const sorted = new Map();
  let total = 0;
  let biggest = ['', 0];
  for (const key of [...tiles.keys()].sort()) {
    const t = tiles.get(key);
    const tile = { r: [...t.refs.keys()], a: t.a };
    const n = Buffer.byteLength(`${JSON.stringify(tile)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [key, n];
    sorted.set(key, tile);
  }
  // Octets par classe (journal : quelle classe pèse le plus si la copie dépasse).
  for (const tile of sorted.values()) for (const x of tile.a) perClass[x[1]] += JSON.stringify(x).length + 1;
  return { tiles: sorted, sizes: { total, biggest, perClass } };
}

/** Taille dans les limites (fichiers ≤ 5 Mo, total ≤ 30 Mo) ? Sinon le texte du journal. */
export function axesSizeProblem(sizes, { maxFile = AXES.MAX_FILE_BYTES, maxTotal = AXES.MAX_TOTAL_BYTES } = {}) {
  const mo = (n) => (n / 1024 / 1024).toFixed(1);
  if (sizes.biggest[1] > maxFile) return `case ${sizes.biggest[0]} de ${mo(sizes.biggest[1])} Mo (plus de ${mo(maxFile)} Mo)`;
  if (sizes.total > maxTotal) return `total de ${mo(sizes.total)} Mo (plus de ${mo(maxTotal)} Mo)`;
  return null;
}

/**
 * Voies d'axe (sans doublon) → contenu de data/axes-osm/ : simplification à 3 m, puis 8 m, puis 20 m si la copie
 * dépasse ; toujours trop grosse → problem (rien à écrire), journal avec les octets par classe.
 * @returns {{ index:object|null, tiles:Map<string,object>|null, log:string[], sizes:object, problem:string|null }}
 */
export function convertAxes(ways, { updated = null, grid = null, countries = [], limits = {} } = {}) {
  const log = [];
  const km = [0, 0, 0];
  for (const w of ways) km[w.cls] += lengthM(w.coords) / 1000;
  const lines = chainAxes(ways);
  const withRef = ways.filter((w) => w.ref).length;
  log.push(`Axes : ${ways.length} voies (${withRef} avec référence), ${lines.length} lignes après mise bout à bout ; `
    + `${AXES.CLASS_NAMES.map((n, i) => `${n} ${Math.round(km[i])} km`).join(', ')}.`);
  let res = null;
  let problem = null;
  let tolerance = null;
  for (const tol of AXES.TOLERANCES_M) {
    res = build(lines, tol);
    tolerance = tol;
    problem = axesSizeProblem(res.sizes, limits);
    log.push(`Axes, simplification ${tol} m : ${(res.sizes.total / 1024 / 1024).toFixed(2)} Mo, plus grosse case `
      + `${res.sizes.biggest[0]} (${(res.sizes.biggest[1] / 1024).toFixed(0)} Ko) ; par classe : `
      + `${AXES.CLASS_NAMES.map((n, i) => `${n} ${(res.sizes.perClass[i] / 1024 / 1024).toFixed(2)} Mo`).join(', ')}`
      + `${problem ? ` — ${problem}` : ''}.`);
    if (!problem) break;
  }
  if (problem) {
    log.push(`⚠ data/axes-osm/ non modifié : ${problem} même simplifié à ${tolerance} m (aucune classe retirée, aucune `
      + 'copie partielle ; ancienne copie gardée).');
    return { index: null, tiles: null, log, sizes: res.sizes, problem };
  }
  const index = {
    source: 'OpenStreetMap (extrait Geofabrik), autoroutes, voies rapides et routes primaires avec leur numéro',
    license: 'ODbL — © contributeurs OpenStreetMap',
    updated,
    countries,
    count: lines.length,
    km: Object.fromEntries(AXES.CLASS_NAMES.map((n, i) => [n, Math.round(km[i])])),
    tolerance,
    grid,
    tiles: Object.fromEntries([...res.tiles.entries()].map(([k, t]) => [k, t.a.length])),
  };
  return { index, tiles: res.tiles, log, sizes: res.sizes, problem: null };
}

/** Case lue (PR 3) : { refs, lines:[{ ref, cls, coords:[[lon, lat]…] }] } ; null si illisible. */
export function parseAxesTile(json) {
  if (!json || !Array.isArray(json.r) || !Array.isArray(json.a)) return null;
  const lines = [];
  for (const row of json.a) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [i, cls, ...d] = row;
    const coords = [];
    let x = 0; let y = 0;
    for (let k = 0; k + 1 < d.length; k += 2) { x += d[k]; y += d[k + 1]; coords.push([x / 1e5, y / 1e5]); }
    lines.push({ ref: i >= 0 ? String(json.r[i] ?? '') : '', cls, coords });
  }
  return { refs: json.r.slice(), lines };
}
