// Copie des ponts d'OpenStreetMap dans data/ponts-osm/ (phase 12a), côté Action (tools/osm-update.mjs). Logique pure,
// testée sous Node. Données © contributeurs OpenStreetMap, licence ODbL.
//
// Même téléchargement Geofabrik que les tunnels, aires et voies (un seul par pays) ; filtrage osmium à part (comme le
// réseau des taxes PL) pour les pays de BRIDGES.REGIONS seulement : les ponts de toute l'Europe ne tiennent pas dans
// la limite de taille (BRIDGES.MAX_FILE_BYTES, MAX_TOTAL_BYTES). Gardé :
// (1) ponts (bridge=yes ou viaduct, layer absent ou ≥ 1) portant une route carrossable ou une voie ferrée, hors
//     passerelles piétonnes et cyclables : id, type (route / rail), classe (highway / railway), maxheight ou
//     maxheight:physical s'ils existent, nom, référence, géométrie simplifiée (3 m) en 1e-5 degré (5 décimales) ;
//     ponts de moins de BRIDGES.MIN_LENGTH_M écartés (buses et ponceaux au-dessus d'un ruisseau : aucune route dessous) ;
// (2) tronçons routiers portant maxheight ou maxheight:physical (hauteur connue sous un pont, prise en compte par ORS).
// Wiki OSM (Key:bridge, Key:layer, Key:maxheight, Key:maxheight:physical), lu le 22/11/2026.
//
// Format (lu par parseBridgeTile, src/lib/bridge-check.js) : index.json (updated, countries, count, grid de la zone
// couverte comme data/aires-osm/, tiles : cases non vides et leur nombre d'objets) + une case E_N.json par degré (coin
// sud-ouest de chaque point : un pont à cheval sur deux cases est écrit dans les deux) :
// { n:[noms…], b:[[id, type, i_classe, hauteur|null, i_nom, x0, y0, dx, dy, …]], h:[[id, hauteur, x0, y0, dx, dy, …]],
//   c:[classes…] } ; type 0 = route, 1 = rail ; coordonnées entières en 1e-5 degré, écart au point précédent.

import { simplifyLine } from './areas-osm.js';
import { tileKey } from './areas-osm-data.js';
import { haversine } from './nav-geo.js';

export const BRIDGES = Object.freeze({
  DIR: './data/ponts-osm/',
  INDEX_PATH: './data/ponts-osm/index.json',
  /** Pays copiés (extraits Geofabrik) ; autres pays seulement si la taille le permet (journal de l'Action). */
  REGIONS: Object.freeze(['europe/france']),
  /** Limites de taille (consigne de la phase 12a) : au-delà, data/ponts-osm/ n'est pas modifié. */
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 60 * 1024 * 1024,
  MIN_LENGTH_M: 6,
  TOLERANCE_M: 3,
  /** Passerelles piétonnes et cyclables, chemins (consigne de la phase 12a : écartés). */
  EXCLUDED_HIGHWAYS: Object.freeze(new Set([
    'footway', 'cycleway', 'path', 'pedestrian', 'steps', 'bridleway', 'corridor', 'platform', 'proposed', 'construction',
    'elevator', 'via_ferrata',
  ])),
  RAILWAYS: Object.freeze(new Set([
    'rail', 'light_rail', 'narrow_gauge', 'subway', 'tram', 'monorail', 'funicular', 'preserved', 'disused', 'miniature',
  ])),
});

/** Filtre osmium tags-filter (voies seulement). */
export function osmiumBridgesFilter() {
  return ['w/bridge=yes,viaduct', 'w/maxheight', 'w/maxheight:physical'];
}

const str = (x, n) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : '');
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** layer d'OSM : absent → pont au-dessus du sol (1) ; illisible → 1 ; « -1 », « 0 » → écarté. */
export function bridgeLayer(tags) {
  const raw = tags?.layer;
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = Number(String(raw).split(';')[0].trim());
  return Number.isFinite(n) ? n : 1;
}

/** Hauteur portée par une voie (maxheight:physical prioritaire, puis maxheight), texte d'OSM, ou ''. */
export function heightTag(tags) {
  return str(tags?.['maxheight:physical'], 20) || str(tags?.maxheight, 20);
}

function lineCoords(f) {
  if (f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const c = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  return c.length >= 2 ? c : null;
}

function length(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i += 1) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/**
 * Objet GeoJSON exporté par osmium (--add-unique-id=type_id) → pont { id, kind:'road'|'rail', cls, height, name,
 * coords } ou null.
 */
export function bridgeFromFeature(f) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !t || (t.bridge !== 'yes' && t.bridge !== 'viaduct')) return null;
  if (bridgeLayer(t) < 1) return null;
  let kind = null;
  let cls = '';
  if (typeof t.highway === 'string' && t.highway && !BRIDGES.EXCLUDED_HIGHWAYS.has(t.highway)) { kind = 'road'; cls = t.highway; }
  else if (typeof t.railway === 'string' && BRIDGES.RAILWAYS.has(t.railway)) { kind = 'rail'; cls = t.railway; }
  if (!kind) return null;
  const coords = lineCoords(f);
  if (!coords || length(coords) < BRIDGES.MIN_LENGTH_M) return null;
  const name = [str(t.name, 60), str(t.ref, 20)].filter(Boolean).join(', ');
  return { id: Number(m[1]), kind, cls: cls.slice(0, 20), height: heightTag(t) || null, name, coords };
}

/** Tronçon routier portant une hauteur (sous un pont, un portique…) → { id, height, coords } ou null. */
export function clearanceFromFeature(f) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !t || typeof t.highway !== 'string' || BRIDGES.EXCLUDED_HIGHWAYS.has(t.highway)) return null;
  // maxheight porté par un pont : hauteur pour la circulation sur le pont (gardée avec le pont), pas sous lui.
  if (t.bridge === 'yes' || t.bridge === 'viaduct') return null;
  const height = heightTag(t);
  if (!height) return null;
  const coords = lineCoords(f);
  return coords ? { id: Number(m[1]), height, coords } : null;
}

function encodeLine(coords) {
  const out = [];
  let px = 0; let py = 0;
  for (const [lon, lat] of simplifyLine(coords, BRIDGES.TOLERANCE_M)) {
    const x = Math.round(lon * 1e5); const y = Math.round(lat * 1e5);
    out.push(x - px, y - py);
    px = x; py = y;
  }
  return out;
}

/** Cases de 1° touchées par les points d'une ligne. */
function keysOf(coords) {
  return [...new Set(coords.map(([lon, lat]) => tileKey(lon, lat)))];
}

/**
 * Ponts et tronçons à hauteur (sans doublon) → contenu de data/ponts-osm/.
 * @returns {{ index:object, tiles:Map<string,object>, log:string[], sizes:{ total:number, biggest:[string,number] } }}
 */
export function convertBridges(bridges, clearances, { updated = null, grid = null, countries = [] } = {}) {
  const tiles = new Map();
  const tile = (key) => {
    if (!tiles.has(key)) tiles.set(key, { n: [''], nm: new Map([['', 0]]), c: [], cm: new Map(), b: [], h: [] });
    return tiles.get(key);
  };
  const stats = { road: 0, rail: 0, withHeight: 0 };
  for (const b of bridges) {
    stats[b.kind] += 1;
    if (b.height) stats.withHeight += 1;
    const line = encodeLine(b.coords);
    for (const key of keysOf(b.coords)) {
      const t = tile(key);
      if (!t.nm.has(b.name)) { t.nm.set(b.name, t.n.length); t.n.push(b.name); }
      if (!t.cm.has(b.cls)) { t.cm.set(b.cls, t.c.length); t.c.push(b.cls); }
      t.b.push([b.id, b.kind === 'rail' ? 1 : 0, t.cm.get(b.cls), b.height, t.nm.get(b.name), ...line]);
    }
  }
  for (const w of clearances) {
    const line = encodeLine(w.coords);
    for (const key of keysOf(w.coords)) tile(key).h.push([w.id, w.height, ...line]);
  }
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, t]) => {
    t.b.sort((x, y) => x[0] - y[0]);
    t.h.sort((x, y) => x[0] - y[0]);
    return [k, { n: t.n, c: t.c, b: t.b, h: t.h }];
  }));
  let total = 0;
  let biggest = ['', 0];
  for (const [k, t] of sorted) {
    const n = Buffer.byteLength(`${JSON.stringify(t)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [k, n];
  }
  const index = {
    source: 'OpenStreetMap (extraits Geofabrik) : bridge=yes|viaduct (routes et voies ferrées, hors piétons et cycles, layer ≥ 1) ; voies maxheight / maxheight:physical',
    license: 'ODbL, © contributeurs OpenStreetMap',
    updated,
    countries,
    count: bridges.length + clearances.length,
    grid,
    tiles: Object.fromEntries([...sorted.entries()].map(([k, t]) => [k, t.b.length + t.h.length])),
  };
  const log = [
    `Ponts : ${bridges.length} (routes ${stats.road}, rail ${stats.rail}, dont ${stats.withHeight} avec hauteur), `
    + `${clearances.length} tronçons à hauteur connue, ${sorted.size} cases de 1° ; `
    + `${(total / 1024 / 1024).toFixed(2)} Mo, plus grosse case ${biggest[0]} (${(biggest[1] / 1024).toFixed(0)} Ko).`,
  ];
  return { index, tiles: sorted, log, sizes: { total, biggest } };
}

/** Taille dans les limites (fichiers ≤ 5 Mo, total ≤ 60 Mo) ? Sinon le texte du journal. */
export function sizeProblem(sizes) {
  if (sizes.biggest[1] > BRIDGES.MAX_FILE_BYTES) return `case ${sizes.biggest[0]} de ${(sizes.biggest[1] / 1024 / 1024).toFixed(1)} Mo (plus de 5 Mo)`;
  if (sizes.total > BRIDGES.MAX_TOTAL_BYTES) return `total de ${(sizes.total / 1024 / 1024).toFixed(1)} Mo (plus de 60 Mo)`;
  return null;
}
