// Copie des aires et parkings PL d'OpenStreetMap dans data/aires-osm/ (phase 9b). Logique pure, testée sous Node :
// - côté Action (tools/osm-update.mjs) : lecture des objets exportés par osmium, zone couverte d'après les contours
//   des extraits Geofabrik (.poly), découpage en cases de 1° ;
// - côté appli (src/ui/areas.js) : cases que le tracé touche, morceaux du tracé hors de la zone couverte (seuls
//   demandés à Overpass), lecture des cases.
//
// Pourquoi : la requête Overpass des aires échoue au-delà d'environ 500 km (mesuré sur 520 km, Paris → Lyon →
// Fréjus, novembre 2026). Même méthode que les tunnels ADR (src/lib/tunnels-convert.js) : extraits par pays de
// Geofabrik (download.geofabrik.de, licence ODbL), filtrés par osmium dans l'Action, placés sur le tracé sans réseau.
//
// Mêmes critères et mêmes identifiants que la version Overpass (src/lib/areas-osm.js, parseOverpass) :
// highway=rest_area, highway=services, amenity=parking avec hgv=yes/designated ou capacity:hgv ; identifiant
// « osm: » + type (n, w, r) + numéro OSM, pour que « Mon avis » enregistré reste associé à la même aire.
// Données © contributeurs OpenStreetMap, licence ODbL (attribution et date de la copie dans la note de source).

import { parseOverpass } from './areas-osm.js';

export const AREAS_DATA = Object.freeze({
  INDEX_PATH: './data/aires-osm/index.json',
  DIR: './data/aires-osm/',
  /** Grille de la zone couverte : cellules de 0,1°. */
  GRID_STEP: 0.1,
  /** Cases de données : 1° × 1°, nommées par leur coin sud-ouest (« 4_45.json »). */
  TILE_DEG: 1,
  /** Tracé lu tous les 500 m (un segment ORS peut faire plusieurs kilomètres sur autoroute). */
  SAMPLE_M: 500,
  /** Marge autour de chaque point lu pour choisir les cases (≥ rayon des parkings PL, 800 m). */
  MARGIN_M: 1000,
  /** Filtre osmium tags-filter des aires (aucun filtre hgv=* global : il prendrait toutes les routes). */
  OSMIUM_FILTER: Object.freeze(['nwr/highway=rest_area,services', 'nwr/amenity=parking', 'nwr/capacity:hgv']),
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;

// ───────── Action : objets exportés par osmium ─────────

/** Une ligne geojsonseq (osmium export, séparateur RS en tête) → objet GeoJSON, ou null. */
export function parseGeojsonLine(raw) {
  const line = String(raw ?? '').replace(/^\u001e/, '').trim();
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}

function eachCoord(geom, fn) {
  const walk = (c) => {
    if (!Array.isArray(c)) return;
    if (isNum(c[0]) && isNum(c[1])) fn(c[0], c[1]);
    else for (const x of c) walk(x);
  };
  walk(geom?.coordinates);
}

/** Aire à garder ? Mêmes critères que la requête Overpass (le filtre osmium prend tous les amenity=parking). */
export function isAreaTags(tags) {
  const t = tags ?? {};
  if (t.highway === 'rest_area' || t.highway === 'services') return true;
  return t.amenity === 'parking' && (/^(yes|designated)$/i.test(t.hgv ?? '') || /^[1-9][0-9]*$/.test(String(t['capacity:hgv'] ?? '').trim()));
}

/**
 * Objet GeoJSON exporté par osmium (--add-unique-id=type_id) → élément au format d'une réponse Overpass
 * « out center tags » (pour parseOverpass), ou null. Identifiants d'osmium : « n12 » nœud, « w34 » voie (ligne),
 * « a68 » surface tirée de la voie 34 (2 × id) et « a41 » surface tirée de la relation 20 (2 × id + 1).
 * Centre d'une voie ou d'une relation : milieu de l'emprise, comme « out center » d'Overpass.
 */
export function areaElementFromFeature(f) {
  const m = /^([nwa])(\d+)$/.exec(String(f?.id ?? ''));
  const tags = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !tags || !isAreaTags(tags)) return null;
  let n = Number(m[2]);
  let type = m[1] === 'n' ? 'node' : 'way';
  if (m[1] === 'a') {
    if (n % 2 === 1) { type = 'relation'; n = (n - 1) / 2; } else n /= 2;
  }
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  let w = Infinity; let s = Infinity; let e = -Infinity; let no = -Infinity;
  eachCoord(f.geometry, (x, y) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); no = Math.max(no, y); });
  if (!isNum(w) || !isNum(s) || !isNum(e) || !isNum(no)) return null;
  const lon = (w + e) / 2;
  const lat = (s + no) / 2;
  return type === 'node' ? { type, id: n, lat, lon, tags } : { type, id: n, center: { lat, lon }, tags };
}

/** Clé d'un élément (une voie fermée sort deux fois d'osmium : ligne « w » et surface « a ») ; id Overpass. */
export const elementKey = (e) => `${e.type[0]}${e.id}`;

// ───────── Action : zone couverte (contours .poly de Geofabrik) ─────────

/**
 * Fichier .poly (format Osmosis : nom, puis des sections « nom / lon lat … / END », « !nom » pour un trou, END final)
 * → { rings:[[lon, lat][]], bbox:[w, s, e, n] }. Point dedans : règle pair-impair sur tous les anneaux.
 */
export function parsePoly(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim());
  const rings = [];
  let i = 1; // première ligne : nom du fichier
  while (i < lines.length) {
    const head = lines[i];
    i += 1;
    if (!head) continue;
    if (head === 'END') break;
    const ring = [];
    while (i < lines.length && lines[i] !== 'END') {
      const [x, y] = lines[i].split(/\s+/).map(Number);
      if (isNum(x) && isNum(y)) ring.push([x, y]);
      i += 1;
    }
    i += 1;
    if (ring.length >= 3) rings.push(ring);
  }
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const r of rings) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return { rings, bbox: rings.length ? [w, s, e, n] : null };
}

function insidePoly(poly, x, y) {
  const [w, s, e, n] = poly.bbox;
  if (x < w || x > e || y < s || y > n) return false;
  let inside = false;
  for (const r of poly.rings) {
    for (let a = 0, b = r.length - 1; a < r.length; b = a, a += 1) {
      const [xa, ya] = r[a]; const [xb, yb] = r[b];
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
  }
  return inside;
}

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

/**
 * Grille de la zone couverte (cellules de 0,1°). Une cellule est couverte si elle et ses 8 voisines sont entièrement
 * dans les contours (4 coins et centre dedans) : une aire à 800 m d'un point couvert est forcément dans la copie.
 * @param {{ rings:number[][][], bbox:number[] }[]} polys contours des extraits (parsePoly)
 * @returns {{ lon0:number, lat0:number, step:number, cols:number, rows:number, bits:string, cells:number }}
 */
export function buildCoverage(polys, step = AREAS_DATA.GRID_STEP) {
  const ok = polys.filter((p) => p?.bbox);
  if (!ok.length) return { lon0: 0, lat0: 0, step, cols: 0, rows: 0, bits: '', cells: 0 };
  const r1 = (x) => Math.round(x * 10) / 10;
  const lon0 = r1(Math.floor(Math.min(...ok.map((p) => p.bbox[0])) / step) * step);
  const lat0 = r1(Math.floor(Math.min(...ok.map((p) => p.bbox[1])) / step) * step);
  const cols = Math.ceil((Math.max(...ok.map((p) => p.bbox[2])) - lon0) / step);
  const rows = Math.ceil((Math.max(...ok.map((p) => p.bbox[3])) - lat0) / step);
  const inside = (x, y) => ok.some((p) => insidePoly(p, x, y));
  const raw = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    const y0 = lat0 + r * step;
    for (let c = 0; c < cols; c += 1) {
      const x0 = lon0 + c * step;
      raw[r * cols + c] = inside(x0 + step / 2, y0 + step / 2) && inside(x0, y0) && inside(x0 + step, y0)
        && inside(x0, y0 + step) && inside(x0 + step, y0 + step) ? 1 : 0;
    }
  }
  const bytes = new Uint8Array(Math.ceil((cols * rows) / 8));
  let cells = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let all = true;
      for (let dr = -1; dr <= 1 && all; dr += 1) {
        for (let dc = -1; dc <= 1 && all; dc += 1) {
          const rr = r + dr; const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !raw[rr * cols + cc]) all = false;
        }
      }
      if (!all) continue;
      const k = r * cols + c;
      bytes[k >> 3] |= 1 << (k & 7);
      cells += 1;
    }
  }
  return { lon0, lat0, step, cols, rows, bits: toBase64(bytes), cells };
}

/** Test « point dans la zone couverte » d'après la grille (index.json). */
export function coverageTest(grid) {
  if (!grid?.cols || !grid?.rows || typeof grid.bits !== 'string') return () => false;
  let bytes;
  try {
    const s = atob(grid.bits);
    bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i);
  } catch {
    return () => false;
  }
  return (lon, lat) => {
    const c = Math.floor((lon - grid.lon0) / grid.step + 1e-9);
    const r = Math.floor((lat - grid.lat0) / grid.step + 1e-9);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
    const k = r * grid.cols + c;
    return ((bytes[k >> 3] ?? 0) >> (k & 7) & 1) === 1;
  };
}

// ───────── Format compact des cases ─────────

const SERVICE_CODES = Object.freeze({ toilets: 't', shower: 'd', food: 'r', fuel: 'c', water: 'e', wifi: 'w' });
const CODE_SERVICES = Object.freeze(Object.fromEntries(Object.entries(SERVICE_CODES).map(([k, v]) => [v, k])));
const KIND_CODES = Object.freeze({ rest_area: 'r', services: 's', parking: 'p' });
const CODE_KINDS = Object.freeze({ r: 'rest_area', s: 'services', p: 'parking' });
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const bool = (v) => (v === true ? 1 : v === false ? 0 : undefined);

/**
 * Aire (parseOverpass) → forme compacte : i identifiant sans « osm: », a identifiants rattachés, k type, x/y position,
 * n nom, c places PL, h réservé PL, f payant, p prix, g gardé, l éclairé, s services, o exploitant.
 */
export function compactArea(a) {
  const out = { i: a.id.replace(/^osm:/, ''), k: KIND_CODES[a.kind], x: r5(a.lon), y: r5(a.lat) };
  const extra = (a.ids ?? []).filter((x) => x !== a.id).map((x) => x.replace(/^osm:/, ''));
  if (extra.length) out.a = extra;
  if (a.name) out.n = a.name;
  if (a.hgvPlaces) out.c = a.hgvPlaces;
  if (a.hgvOnly) out.h = 1;
  for (const [k, v] of [['f', a.fee], ['g', a.secure], ['l', a.lit]]) if (bool(v) !== undefined) out[k] = bool(v);
  if (a.price) out.p = a.price;
  const s = (a.services ?? []).map((x) => SERVICE_CODES[x]).filter(Boolean).join('');
  if (s) out.s = s;
  if (a.operator) out.o = a.operator;
  return out;
}

const OSM_ID = /^[nwr][1-9][0-9]{0,15}$/;
const flag = (v) => (v === 1 ? true : v === 0 ? false : null);
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** Forme compacte → aire au format de parseOverpass (+ copy : date de la copie), ou null si illisible. */
export function expandArea(c, updated = null) {
  if (!c || typeof c !== 'object' || !OSM_ID.test(String(c.i)) || !CODE_KINDS[c.k]) return null;
  if (!isNum(c.x) || !isNum(c.y) || Math.abs(c.x) > 180 || Math.abs(c.y) > 90) return null;
  const id = `osm:${c.i}`;
  const ids = [id, ...(Array.isArray(c.a) ? c.a.filter((x) => OSM_ID.test(String(x))).map((x) => `osm:${x}`) : [])];
  const kind = CODE_KINDS[c.k];
  return {
    id, ids, source: 'osm', sources: ['osm'], kind,
    name: str(c.n, 80) ?? '',
    lon: c.x, lat: c.y,
    hgvPlaces: Number.isInteger(c.c) && c.c > 0 && c.c < 2000 ? c.c : null,
    hgvOnly: kind === 'parking' && c.h === 1,
    fee: flag(c.f), price: str(c.p, 60), secure: flag(c.g), lit: flag(c.l),
    services: [...new Set(String(c.s ?? '').split('').map((x) => CODE_SERVICES[x]).filter(Boolean))],
    road: null, direction: null, operator: str(c.o, 60),
    copy: updated,
  };
}

/** Nom de la case de 1° qui contient le point (coin sud-ouest). */
export const tileKey = (lon, lat) => `${Math.floor(lon)}_${Math.floor(lat)}`;
export const tilePath = (key) => `${AREAS_DATA.DIR}${key}.json`;

/**
 * Éléments OSM (areaElementFromFeature, sans doublon) → contenu de data/aires-osm/ : index.json et une case par
 * degré non vide.
 * @returns {{ index:object, tiles:Map<string,{ areas:object[] }>, log:string[] }}
 */
export function convertAreas(elements, { updated = null, grid = null, countries = [] } = {}) {
  const areas = parseOverpass({ elements });
  const tiles = new Map();
  const kinds = { rest_area: 0, services: 0, parking: 0 };
  for (const a of areas) {
    kinds[a.kind] += 1;
    const key = tileKey(a.lon, a.lat);
    if (!tiles.has(key)) tiles.set(key, { areas: [] });
    tiles.get(key).areas.push(compactArea(a));
  }
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const t of sorted.values()) t.areas.sort((x, y) => (x.i < y.i ? -1 : x.i > y.i ? 1 : 0));
  const index = {
    source: 'OpenStreetMap (extraits Geofabrik) : highway=rest_area, highway=services, amenity=parking + hgv=yes/designated ou capacity:hgv',
    license: 'ODbL, © contributeurs OpenStreetMap',
    updated,
    countries,
    count: areas.length,
    grid,
    tiles: Object.fromEntries([...sorted.entries()].map(([k, t]) => [k, t.areas.length])),
  };
  const log = [`${areas.length} aires (repos : ${kinds.rest_area}, service : ${kinds.services}, parkings PL : ${kinds.parking}) dans ${sorted.size} cases de 1°.`];
  return { index, tiles: sorted, log };
}

// ───────── Appli : lecture ─────────

/** index.json → { updated, grid, tiles, count } ; null si absent, vide ou illisible. */
export function parseIndex(json) {
  const g = json?.grid;
  if (!g || ![g.lon0, g.lat0, g.step].every(isNum) || !Number.isInteger(g.cols) || !Number.isInteger(g.rows)
    || !(g.step > 0) || typeof g.bits !== 'string') return null;
  const tiles = json.tiles && typeof json.tiles === 'object' && !Array.isArray(json.tiles) ? json.tiles : null;
  if (!tiles || !Object.keys(tiles).length || !(json.count > 0)) return null;
  const updated = typeof json.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.updated) ? json.updated : null;
  return { updated, grid: g, tiles, count: json.count, inside: coverageTest(g) };
}

/** Case → aires (expandArea) ; null si illisible. */
export function parseTile(json, updated = null) {
  if (!Array.isArray(json?.areas)) return null;
  return json.areas.map((c) => expandArea(c, updated)).filter(Boolean);
}

/** Points du tracé tous les `step` mètres (extrémités des segments comprises). */
export function samplePoints(coords, step = AREAS_DATA.SAMPLE_M) {
  const out = [];
  const pts = Array.isArray(coords) ? coords : [];
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    if (!isNum(p?.[0]) || !isNum(p?.[1])) continue;
    const q = out[out.length - 1];
    if (q) {
      const kx = Math.cos(((p[1] + q[1]) / 2) * RAD) * 111320;
      const d = Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * 110540);
      const n = Math.ceil(d / step);
      for (let k = 1; k < n; k += 1) out.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
    }
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * Ce qu'il faut lire pour un tracé : cases de la copie (seulement celles qui contiennent des aires) autour des
 * points couverts, et morceaux du tracé hors de la zone couverte (pour une seule requête Overpass).
 * @param {number[][]} coords tracé [lon, lat] (combineRoutes pour plusieurs itinéraires)
 * @param {{ inside:(lon:number, lat:number)=>boolean, tiles:Object<string,number> }} index parseIndex
 * @returns {{ tiles:string[], uncovered:number[][][], points:number, coveredPoints:number }}
 */
export function routePlan(coords, index) {
  const pts = samplePoints(coords);
  const tiles = new Set();
  const uncovered = [];
  let run = null;
  let covered = 0;
  const dLat = AREAS_DATA.MARGIN_M / 110540;
  pts.forEach((p, i) => {
    if (index.inside(p[0], p[1])) {
      covered += 1;
      const dLon = AREAS_DATA.MARGIN_M / (111320 * Math.max(0.1, Math.cos(p[1] * RAD)));
      for (const x of [p[0] - dLon, p[0] + dLon]) for (const y of [p[1] - dLat, p[1] + dLat]) tiles.add(tileKey(x, y));
      if (run) { run.push(p); uncovered.push(run); run = null; }
      return;
    }
    if (!run) run = i > 0 ? [pts[i - 1]] : [];
    run.push(p);
  });
  if (run) {
    if (run.length === 1 && pts.length > 1) run.unshift(pts[pts.length - 2]);
    if (run.length >= 2) uncovered.push(run);
  }
  return {
    tiles: [...tiles].filter((k) => Object.hasOwn(index.tiles, k)).sort(),
    uncovered, points: pts.length, coveredPoints: covered,
  };
}

/** Aires de la copie + aires Overpass (morceaux hors copie) sans doublon (même identifiant OSM). */
export function mergeOsmSources(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const a of Array.isArray(list) ? list : []) {
      const ids = a?.ids ?? [a?.id];
      if (!a?.id || ids.some((x) => seen.has(x))) continue;
      for (const x of ids) seen.add(x);
      out.push(a);
    }
  }
  return out;
}

/** « 01/12/2026 » d'après « 2026-12-01 ». */
export function copyDateText(updated) {
  return typeof updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updated) ? updated.split('-').reverse().join('/') : null;
}
