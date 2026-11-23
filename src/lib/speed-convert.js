// Copie des limitations de vitesse d'OpenStreetMap dans data/vitesses-osm/ (phase 11a), côté Action
// (tools/osm-update.mjs). Logique pure, testée sous Node. Données © contributeurs OpenStreetMap, licence ODbL.
//
// ORS ne donne aucune limite de vitesse dans extra_info (doc ORS lue le 23/11/2026 :
// docs/api-reference/endpoints/directions/extra-info : steepness, suitability, surface, waycategory, waytype,
// tollways, traildifficulty, osmid, roadaccessrestrictions, countryinfo, green, noise ; osmid pour le profil
// wheelchair seulement) : copie mensuelle, même méthode et mêmes cases que data/ponts-osm/ et data/poids-osm/
// (extrait France de Geofabrik, étiquettes ajoutées au filtrage des ponts : un seul filtrage, un seul export).
//
// Gardé : voies highway=motorway, trunk, primary, secondary, tertiary et leurs bretelles (*_link, classées comme la
// route parente) portant maxspeed:hgv ou maxspeed en km/h. Valeur lisible : entier seul (« 50 », « 50 km/h ») de
// SPEEDS.MIN_KMH à SPEEDS.MAX_KMH ; ignorées : « none », « signals », « walk », valeurs de type « FR:urban », mph,
// listes « 50;70 ». Sens : :forward / :backward présents → la plus basse des deux (le sens de circulation n'est pas
// gardé : jamais une limite trop haute) ; un seul sens lisible sans valeur commune → ignorée. maxspeed:hgv
// prioritaire (limite propre aux poids lourds). Drapeau « conditions » : maxspeed:conditional, :wet, :trailer,
// :variable, :seasonal, :lanes… (et leurs variantes :hgv) ; la valeur conditionnelle elle-même n'est jamais lue, la
// limite de base reste affichée mais n'est jamais dite (« à vérifier »).
// Wiki OSM (Key:maxspeed, Key:maxspeed:hgv, Conditional restrictions, Forward & backward, left & right), lu le
// 23/11/2026.
//
// Format (lu par parseSpeedTile, src/lib/speed-limit.js) : index.json (updated, countries, count, grid, tolerance,
// mode « complet » | « réduit », tiles) + une case E_N.json par degré : { s:[[limite, drapeaux, classe, x0, y0, dx,
// dy, …]] } ; drapeaux : 1 = maxspeed:hgv, 2 = conditions ; classe : 0 autoroute, 1 voie rapide (trunk), 2 primaire,
// 3 secondaire, 4 tertiaire ; coordonnées entières en 1e-5 degré, écart au point précédent. Voies voisines de même
// limite, drapeaux et classe mises bout à bout (moins de points répétés).
// Taille (consigne de la phase 11a) : 5 Mo par fichier, 40 Mo en tout au plus. Simplification 3, 8 puis 20 m ; si la
// copie complète dépasse, copie réduite : maxspeed:hgv et voies dont la limite est sous la règle générale PL de leur
// type de route (speed-rules.js : les autres limites seraient de toute façon plafonnées par la règle) ; au-delà,
// data/vitesses-osm/ n'est pas modifié.

import { simplifyLine } from './areas-osm.js';
import { tileKey } from './areas-osm-data.js';
import { BRIDGES } from './bridges-convert.js';
import { reducedThreshold } from './speed-rules.js';

export const SPEEDS = Object.freeze({
  DIR: './data/vitesses-osm/',
  INDEX_PATH: './data/vitesses-osm/index.json',
  REGIONS: BRIDGES.REGIONS,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 40 * 1024 * 1024,
  TOLERANCES_M: Object.freeze([3, 8, 20]),
  MIN_KMH: 5,
  MAX_KMH: 140,
  /** Classe gardée (index) par valeur highway. */
  CLASSES: Object.freeze({
    motorway: 0, motorway_link: 0, trunk: 1, trunk_link: 1, primary: 2, primary_link: 2,
    secondary: 3, secondary_link: 3, tertiary: 4, tertiary_link: 4,
  }),
  FLAG_HGV: 1,
  FLAG_COND: 2,
});

/** Étiquettes ajoutées au filtre osmium des ponts (voies seulement). */
export function osmiumSpeedsFilter() {
  return ['w/maxspeed', 'w/maxspeed:hgv'];
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** Limite en km/h d'une étiquette : « 50 », « 50 km/h », « 50kmh » ; null si illisible. */
export function parseKmh(text) {
  const m = /^\s*(\d{1,3})\s*(km\/h|kmh|kph)?\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  const v = Number(m[1]);
  return v >= SPEEDS.MIN_KMH && v <= SPEEDS.MAX_KMH ? v : null;
}

/** Valeur d'une clé (maxspeed ou maxspeed:hgv) avec ses sens : la plus basse ; null si illisible ou un sens inconnu. */
export function limitOf(t, key) {
  const base = present(t[key]) ? parseKmh(t[key]) : null;
  if (present(t[key]) && base === null) return null;
  const fw = present(t[`${key}:forward`]) ? parseKmh(t[`${key}:forward`]) : undefined;
  const bw = present(t[`${key}:backward`]) ? parseKmh(t[`${key}:backward`]) : undefined;
  if (fw === null || bw === null) return null;
  if (fw === undefined && bw === undefined) return base;
  const f = fw ?? base; const b = bw ?? base;
  if (f === null || b === null) return null;
  return Math.min(f, b);
}

const COND = /^maxspeed(:hgv)?:(conditional|wet|trailer|variable|seasonal|lanes|night|snow|fog)(:|$)/;

/**
 * Objet GeoJSON exporté par osmium → { limit, hgv, cond, cls, coords } ou null (pas une route gardée, pas de limite
 * lisible).
 */
export function speedFromFeature(f) {
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!t || !/^w\d+$/.test(String(f?.id ?? ''))) return null;
  const cls = SPEEDS.CLASSES[t.highway];
  if (cls === undefined) return null;
  if (f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const hgvLimit = limitOf(t, 'maxspeed:hgv');
  const limit = hgvLimit ?? limitOf(t, 'maxspeed');
  if (limit === null) return null;
  const coords = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (coords.length < 2) return null;
  const cond = Object.keys(t).some((k) => COND.test(k) && present(t[k]));
  return { limit, hgv: hgvLimit !== null, cond, cls, coords };
}

const sameAttr = (a, b) => a.limit === b.limit && a.hgv === b.hgv && a.cond === b.cond && a.cls === b.cls;
const ptKey = (p) => `${Math.round(p[0] * 1e7)}_${Math.round(p[1] * 1e7)}`;

/**
 * Voies de mêmes attributs qui se touchent par un bout (rue découpée en plusieurs chemins OSM) mises bout à bout, dans
 * un sens ou dans l'autre (le sens de la voie n'est pas gardé). Seulement là où exactement deux voies se touchent.
 */
export function chainWays(ways) {
  const ends = new Map();
  const add = (k, w) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(w); };
  for (const w of ways) { add(ptKey(w.coords[0]), w); add(ptKey(w.coords.at(-1)), w); }
  const used = new Set();
  const out = [];
  const partner = (w, k) => {
    const l = ends.get(k);
    if (!l || l.length !== 2) return null;
    const free = l.filter((x) => !used.has(x));
    return free.length === 1 && sameAttr(free[0], w) ? free[0] : null;
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
    out.push({ ...w, coords });
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

const keysOf = (coords) => [...new Set(coords.map(([lon, lat]) => tileKey(lon, lat)))];

function build(ways, tolerance) {
  const tiles = new Map();
  for (const w of ways) {
    const line = encodeLine(w.coords, tolerance);
    const flags = (w.hgv ? SPEEDS.FLAG_HGV : 0) | (w.cond ? SPEEDS.FLAG_COND : 0);
    for (const key of keysOf(w.coords)) {
      if (!tiles.has(key)) tiles.set(key, { s: [] });
      tiles.get(key).s.push([w.limit, flags, w.cls, ...line]);
    }
  }
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
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
export function speedSizeProblem(sizes, maxTotal = SPEEDS.MAX_TOTAL_BYTES) {
  if (sizes.biggest[1] > SPEEDS.MAX_FILE_BYTES) return `case ${sizes.biggest[0]} de ${(sizes.biggest[1] / 1024 / 1024).toFixed(1)} Mo (plus de 5 Mo)`;
  if (sizes.total > maxTotal) return `total de ${(sizes.total / 1024 / 1024).toFixed(1)} Mo (plus de 40 Mo)`;
  return null;
}

/** Copie réduite : maxspeed:hgv, et limites sous la règle générale PL du type de route (France). */
export function reduceWays(ways, fr = undefined) {
  return ways.filter((w) => {
    if (w.hgv) return true;
    const th = reducedThreshold('FR', w.cls, fr);
    return th !== null && w.limit < th;
  });
}

/**
 * Voies à limite de vitesse → contenu de data/vitesses-osm/ : copie complète (3, 8 puis 20 m), sinon réduite (3, 8 puis
 * 20 m), sinon problème (rien n'est écrit).
 * @returns {{ index:object|null, tiles:Map<string,object>|null, log:string[], sizes:object|null, problem:string|null }}
 */
export function convertSpeeds(ways, { updated = null, grid = null, countries = [], fr = undefined, maxTotal = SPEEDS.MAX_TOTAL_BYTES } = {}) {
  const log = [];
  const hgv = ways.filter((w) => w.hgv).length;
  const cond = ways.filter((w) => w.cond).length;
  log.push(`Limites de vitesse : ${ways.length} voies (dont ${hgv} maxspeed:hgv, ${cond} avec conditions).`);
  const tries = [['complet', ways]];
  const reduced = reduceWays(ways, fr);
  tries.push(['réduit', reduced]);
  let problem = null;
  for (const [mode, list] of tries) {
    const chained = chainWays(list);
    if (mode === 'réduit') log.push(`Copie réduite : ${list.length} voies (maxspeed:hgv ou limite sous la règle générale PL).`);
    for (const tol of SPEEDS.TOLERANCES_M) {
      const res = build(chained, tol);
      problem = speedSizeProblem(res.sizes, maxTotal);
      log.push(`Limites de vitesse (${mode}), ${chained.length} lignes, simplification ${tol} m : ${(res.sizes.total / 1024 / 1024).toFixed(2)} Mo, `
        + `plus grosse case ${res.sizes.biggest[0]} (${(res.sizes.biggest[1] / 1024).toFixed(0)} Ko)${problem ? ` — ${problem}` : ''}.`);
      if (!problem) {
        const index = {
          source: 'OpenStreetMap (extraits Geofabrik) : voies motorway à tertiary (et bretelles) avec maxspeed:hgv ou maxspeed en km/h ; drapeau conditions : maxspeed:conditional, :wet, :trailer…',
          license: 'ODbL, © contributeurs OpenStreetMap',
          updated,
          countries,
          count: list.length,
          grid,
          tolerance: tol,
          mode,
          tiles: Object.fromEntries([...res.tiles.entries()].map(([k, t]) => [k, t.s.length])),
        };
        return { index, tiles: res.tiles, log, sizes: res.sizes, problem: null };
      }
    }
  }
  return { index: null, tiles: null, log, sizes: null, problem };
}
