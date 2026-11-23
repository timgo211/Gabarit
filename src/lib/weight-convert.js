// Copie des limites de poids d'OpenStreetMap dans data/poids-osm/ (phase 12a bis), côté Action (tools/osm-update.mjs).
// Logique pure, testée sous Node. Données © contributeurs OpenStreetMap, licence ODbL.
//
// Même méthode et mêmes cases que data/ponts-osm/ (bridges-convert.js) : extrait France de Geofabrik, même filtrage
// osmium à part (les étiquettes de poids sont ajoutées au filtre des ponts : un seul filtrage, un seul export), cases de
// 1° (coin sud-ouest de chaque point), index.json avec la zone couverte. Gardé : tronçons routiers (hors chemins
// piétons et cyclables, comme les ponts) portant maxweight ou maxweight:hgv en tonnes ; valeurs illisibles ignorées
// (unités autres que la tonne : « st » (tonne courte), « lbs », « cwt » ; « none », « default », « unsigned »…).
// maxweight:hgv prioritaire sur maxweight (limite propre aux poids lourds). Drapeau « desserte possible » si
// hgv=destination|delivery (le passage peut être permis pour livrer) ou si maxweight:conditional existe (exception
// horaire ou de desserte, lue par la phase 5d) : la limite reste affichée, « desserte locale possible ».
// Wiki OSM (Key:maxweight, Key:maxweight:hgv, Key:hgv, Conditional restrictions), lu le 23/11/2026 ; en France, le
// panneau B13 interdit l'accès aux véhicules dont le poids total autorisé en charge excède la valeur indiquée
// (arrêté du 24 novembre 1967 relatif à la signalisation des routes et autoroutes, Instruction interministérielle
// sur la signalisation routière, 3e partie) : la limite se compare au PTAC du profil (weight-check.js).
//
// Format (lu par parseWeightTile, src/lib/weight-check.js) : index.json (updated, countries, count, grid, tolerance,
// tiles) + une case E_N.json par degré : { w:[[id, limite_t, drapeau, x0, y0, dx, dy, …]] } ; drapeau 1 = desserte
// possible ; coordonnées entières en 1e-5 degré, écart au point précédent.
// Taille (consigne de la phase 12a bis) : 5 Mo par fichier, 30 Mo en tout au plus. La géométrie est simplifiée à 3 m ;
// si la copie dépasse, elle est refaite à 8 m puis à 20 m (WEIGHTS.TOLERANCES_M) : un tronçon garde ses extrémités,
// l'écart de 20 m reste couvert par la comparaison au tracé (15 m + cap). Au-delà : data/poids-osm/ non modifié.

import { simplifyLine } from './areas-osm.js';
import { tileKey } from './areas-osm-data.js';
import { BRIDGES } from './bridges-convert.js';

export const WEIGHTS = Object.freeze({
  DIR: './data/poids-osm/',
  INDEX_PATH: './data/poids-osm/index.json',
  REGIONS: BRIDGES.REGIONS,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 30 * 1024 * 1024,
  /** Simplifications essayées dans l'ordre (m) jusqu'à tenir dans les limites de taille. */
  TOLERANCES_M: Object.freeze([3, 8, 20]),
  /** Limites lisibles (t) : en dehors, valeur ignorée (faute de frappe, kg sans unité). */
  MIN_T: 1,
  MAX_T: 100,
  /** Chemin OSM du constat (Rue du Viaduc, Colombier) : étiquettes écrites dans le journal de l'Action. */
  PROBE_WAY: 190520091,
});

/** Étiquettes ajoutées au filtre osmium des ponts (voies seulement). */
export function osmiumWeightsFilter() {
  return ['w/maxweight', 'w/maxweight:hgv'];
}

/**
 * Limite en tonnes d'une étiquette OSM : « 3.5 », « 3,5 », « 3.5 t », « 12t » ; null si illisible (autre unité,
 * plusieurs valeurs, « none », hors de 1 à 100 t).
 */
export function parseTonnes(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(t)?\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return Number.isFinite(v) && v >= WEIGHTS.MIN_T && v <= WEIGHTS.MAX_T ? Math.round(v * 100) / 100 : null;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Objet GeoJSON exporté par osmium (--add-unique-id=type_id) → { id, limit, local, coords } ou null (pas une route,
 * pas de limite lisible).
 */
export function weightFromFeature(f) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !t || typeof t.highway !== 'string' || !t.highway || BRIDGES.EXCLUDED_HIGHWAYS.has(t.highway)) return null;
  if (f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const hgv = parseTonnes(t['maxweight:hgv']);
  const limit = hgv ?? parseTonnes(t.maxweight);
  if (limit === null) return null;
  const coords = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (coords.length < 2) return null;
  const local = /^(destination|delivery)$/i.test(String(t.hgv ?? '').trim())
    || (typeof t['maxweight:conditional'] === 'string' && t['maxweight:conditional'].trim() !== '')
    || (typeof t['maxweight:hgv:conditional'] === 'string' && t['maxweight:hgv:conditional'].trim() !== '');
  return { id: Number(m[1]), limit, local, coords };
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
    for (const key of keysOf(w.coords)) {
      if (!tiles.has(key)) tiles.set(key, { w: [] });
      tiles.get(key).w.push([w.id, w.limit, w.local ? 1 : 0, ...line]);
    }
  }
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, t]) => {
    t.w.sort((x, y) => x[0] - y[0]);
    return [k, t];
  }));
  let total = 0;
  let biggest = ['', 0];
  for (const [k, t] of sorted) {
    const n = Buffer.byteLength(`${JSON.stringify(t)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [k, n];
  }
  return { tiles: sorted, sizes: { total, biggest } };
}

/** Taille dans les limites (fichiers ≤ 5 Mo, total ≤ 30 Mo) ? Sinon le texte du journal. */
export function weightSizeProblem(sizes) {
  if (sizes.biggest[1] > WEIGHTS.MAX_FILE_BYTES) return `case ${sizes.biggest[0]} de ${(sizes.biggest[1] / 1024 / 1024).toFixed(1)} Mo (plus de 5 Mo)`;
  if (sizes.total > WEIGHTS.MAX_TOTAL_BYTES) return `total de ${(sizes.total / 1024 / 1024).toFixed(1)} Mo (plus de 30 Mo)`;
  return null;
}

/**
 * Tronçons à limite de poids (sans doublon) → contenu de data/poids-osm/ : simplification à 3 m, puis 8 m, puis 20 m
 * si la copie dépasse les limites de taille.
 * @returns {{ index:object, tiles:Map<string,object>, log:string[], sizes:object, problem:string|null }}
 */
export function convertWeights(ways, { updated = null, grid = null, countries = [] } = {}) {
  const log = [];
  let res = null;
  let problem = null;
  let tolerance = null;
  for (const tol of WEIGHTS.TOLERANCES_M) {
    res = build(ways, tol);
    tolerance = tol;
    problem = weightSizeProblem(res.sizes);
    log.push(`Limites de poids, simplification ${tol} m : ${(res.sizes.total / 1024 / 1024).toFixed(2)} Mo, `
      + `plus grosse case ${res.sizes.biggest[0]} (${(res.sizes.biggest[1] / 1024).toFixed(0)} Ko)${problem ? ` — ${problem}` : ''}.`);
    if (!problem) break;
  }
  const local = ways.filter((w) => w.local).length;
  log.unshift(`Limites de poids : ${ways.length} tronçons (dont ${local} « desserte possible »), ${res.tiles.size} cases de 1°.`);
  const index = {
    source: 'OpenStreetMap (extraits Geofabrik) : voies maxweight / maxweight:hgv en tonnes (hors piétons et cycles) ; drapeau desserte : hgv=destination|delivery ou maxweight:conditional',
    license: 'ODbL, © contributeurs OpenStreetMap',
    updated,
    countries,
    count: ways.length,
    grid,
    tolerance,
    tiles: Object.fromEntries([...res.tiles.entries()].map(([k, t]) => [k, t.w.length])),
  };
  return { index, tiles: res.tiles, log, sizes: res.sizes, problem };
}

/** Ligne du journal pour le chemin du constat (Rue du Viaduc, Colombier) : étiquettes utiles, ou absence. */
export function probeLog(feature) {
  if (!feature) return `Chemin ${WEIGHTS.PROBE_WAY} (Rue du Viaduc, Colombier) : absent du filtrage (aucune étiquette maxweight, maxweight:hgv, bridge ou maxheight).`;
  const t = feature.properties ?? {};
  const keys = ['name', 'highway', 'maxweight', 'maxweight:hgv', 'maxweight:conditional', 'hgv', 'maxheight', 'bridge'];
  const tags = keys.filter((k) => t[k] !== undefined).map((k) => `${k}=${String(t[k]).slice(0, 60)}`).join(' ; ');
  return `Chemin ${WEIGHTS.PROBE_WAY} (Rue du Viaduc, Colombier) : ${tags || 'aucune étiquette utile'}.`;
}
