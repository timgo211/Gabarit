// Copie des voies à accès conditionnel d'OpenStreetMap dans data/acces-osm/ (phase 5d), côté Action
// (tools/osm-update.mjs). Logique pure, testée sous Node.
//
// Même téléchargement Geofabrik, même filtrage osmium et même export que les tunnels ADR et les aires PL : les
// étiquettes ci-dessous sont ajoutées au filtre (OSMIUM_FILTER) ; chaque ligne exportée passe aussi ici. Gardé :
// routes carrossables (HIGHWAYS) portant une restriction conditionnelle qui peut concerner un PL (une condition
// « yes @ … » seule, ou masquée par une étiquette sans condition plus précise — hgv=yes devant access:conditional —,
// ne restreint jamais rien : retirée). Données © contributeurs OpenStreetMap, licence ODbL.
//
// Format (lu par parseAccessTile, src/lib/access-conditional.js) : index.json (updated, countries, count, grid de
// la zone couverte comme data/aires-osm/, tiles : cases non vides et leur nombre de voies) + une case E_N.json par
// degré (coin sud-ouest du premier point de la voie) : { t:[étiquettes…], n:[noms…], w:[[id, i_t, i_n, x0, y0, dx,
// dy, …]] }, coordonnées entières en 1e-5 degré (≈ 1 m), écart au point précédent, voie simplifiée à 3 m près.

import { simplifyLine } from './areas-osm.js';
import { ACCESS, wayRestrictions } from './access-conditional.js';
import { tileKey } from './areas-osm-data.js';

const DIRS = ['', ':forward', ':backward'];

export const ACCESS_CONVERT = Object.freeze({
  /** Clés conditionnelles lues (moyens de transport dans l'ordre de priorité, poids limité), par sens. */
  CONDITIONAL_KEYS: Object.freeze([...ACCESS.MODES, 'maxweight'].flatMap((m) => DIRS.map((d) => `${m}${d}:conditional`))),
  /** Étiquettes gardées en plus : accès sans condition (priorité), sens unique. */
  BASE_KEYS: Object.freeze([...ACCESS.MODES.flatMap((m) => DIRS.map((d) => `${m}${d}`)), 'oneway']),
  /** Routes où un PL peut passer (pas de chemins, pistes, voies de service). */
  HIGHWAYS: Object.freeze(new Set([
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'road',
  ])),
  TOLERANCE_M: 3,
});

/** Filtre osmium tags-filter : une expression par clé (voies seulement). */
export function osmiumAccessFilter() {
  return ACCESS_CONVERT.CONDITIONAL_KEYS.map((k) => `w/${k}`);
}

/** La voie peut-elle restreindre un PL (dans un sens au moins) ? Conditions non lues gardées (comptées « à vérifier »). */
export function canRestrict(tags) {
  for (const dir of [null, 'forward', 'backward']) {
    const r = wayRestrictions(tags, { vehicle: null, dir });
    if (r.restrictive.length || r.unknown) return true;
  }
  return false;
}

/**
 * Objet GeoJSON exporté par osmium (--add-unique-id=type_id) → voie à accès conditionnel { id, name, tags, coords },
 * ou null.
 */
export function accessElementFromFeature(f) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const all = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !all || f?.geometry?.type !== 'LineString' || !ACCESS_CONVERT.HIGHWAYS.has(all.highway)) return null;
  if (!ACCESS_CONVERT.CONDITIONAL_KEYS.some((k) => Object.hasOwn(all, k))) return null;
  const tags = {};
  for (const k of [...ACCESS_CONVERT.CONDITIONAL_KEYS, ...ACCESS_CONVERT.BASE_KEYS]) {
    if (typeof all[k] === 'string' && all[k].trim()) tags[k] = all[k].trim().slice(0, 300);
  }
  if (!canRestrict(tags)) return null;
  const coords = f.geometry.coordinates.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (coords.length < 2) return null;
  const name = [all.ref, all.name].filter((x) => typeof x === 'string' && x.trim()).join(' ').slice(0, 80);
  return { id: Number(m[1]), name, tags, coords };
}

/** Voie → [id, i_t, i_n, x0, y0, dx, dy, …] (tables partagées de la case). */
function encodeWay(w, tagTable, nameTable) {
  const key = JSON.stringify(Object.fromEntries(Object.entries(w.tags).sort(([a], [b]) => (a < b ? -1 : 1))));
  if (!tagTable.map.has(key)) { tagTable.map.set(key, tagTable.list.length); tagTable.list.push(JSON.parse(key)); }
  if (!nameTable.map.has(w.name)) { nameTable.map.set(w.name, nameTable.list.length); nameTable.list.push(w.name); }
  const line = simplifyLine(w.coords, ACCESS_CONVERT.TOLERANCE_M);
  const out = [w.id, tagTable.map.get(key), nameTable.map.get(w.name)];
  let px = 0; let py = 0;
  for (const [lon, lat] of line) {
    const x = Math.round(lon * 1e5); const y = Math.round(lat * 1e5);
    out.push(x - px, y - py);
    px = x; py = y;
  }
  return out;
}

/**
 * Voies (accessElementFromFeature, sans doublon) → contenu de data/acces-osm/.
 * @returns {{ index:object, tiles:Map<string,object>, log:string[] }}
 */
export function convertAccess(ways, { updated = null, grid = null, countries = [] } = {}) {
  const groups = new Map();
  const keys = {};
  for (const w of ways) {
    const k = tileKey(w.coords[0][0], w.coords[0][1]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
    for (const t of Object.keys(w.tags)) if (t.endsWith(':conditional')) keys[t] = (keys[t] ?? 0) + 1;
  }
  const tiles = new Map();
  for (const k of [...groups.keys()].sort()) {
    const list = groups.get(k).sort((a, b) => a.id - b.id);
    const t = { list: [], map: new Map() };
    const n = { list: [], map: new Map() };
    const w = list.map((x) => encodeWay(x, t, n));
    tiles.set(k, { t: t.list, n: n.list, w });
  }
  const index = {
    source: 'OpenStreetMap (extraits Geofabrik) : hgv / motor_vehicle / vehicle / access / maxweight:conditional sur les routes carrossables',
    license: 'ODbL, © contributeurs OpenStreetMap',
    updated,
    countries,
    count: ways.length,
    grid,
    tiles: Object.fromEntries([...tiles.entries()].map(([k, x]) => [k, x.w.length])),
  };
  const log = [`${ways.length} voies à accès conditionnel dans ${tiles.size} cases de 1° (${Object.entries(keys).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} : ${v}`).join(', ')}).`];
  return { index, tiles, log };
}
