// Ponts sans hauteur connue au-dessus de l'itinéraire (phase 12a), d'après la copie data/ponts-osm/ (bridges-convert.js).
// Logique pure. ORS ne connaît que les hauteurs d'OpenStreetMap portées par la route empruntée (maxheight) : un pont
// sans maxheight sur la route du dessous passe pour libre. Constat : Besançon → Luxeuil-les-Bains (Semi 44 t, H 4 m),
// pont ferroviaire de Colombier (3,8 m, chemin OSM 243477938) sans maxheight. Non confirmé = « à vérifier », jamais
// dit à voix haute, rien dans le guidage (Code de la route art. R412-6-2) ; la signalisation fait foi.
//
// Méthode : croisement en X d'un segment du tracé avec un segment du pont (intersection franche, angle d'au moins
// BRIDGE.MIN_ANGLE_DEG) ; jamais quand le tracé roule sur le pont (tracé à moins de BRIDGE.ON_BRIDGE_M du pont 15 m
// avant ou après le croisement : sur le pont, en montant ou en descendant). Ignoré si une hauteur est connue sous le pont (tronçon maxheight à moins de
// BRIDGE.KNOWN_NEAR_M du croisement) plus haute que le véhicule ; au plus celle du véhicule : signalé (graphe d'ORS
// plus ancien que l'étiquette). Classe de la route dessous (road-class.js, phase 2g) : autre = priorité haute,
// nationale = moyenne, autoroute = jamais signalée (comptée dans la ligne technique). Pont portant lui-même une hauteur
// lisible inférieure ou égale à celle du véhicule : signalé en priorité haute (ORS ne la lit pas sur la route dessous).

import { segmentClasses, ROAD_CLASS } from './road-class.js';

export const BRIDGE = Object.freeze({
  MIN_ANGLE_DEG: 20,
  ON_BRIDGE_M: 4,
  KNOWN_NEAR_M: 40,
  /** Lignes affichées sur la fiche au plus (puis « +N »). */
  MAX_SHOWN: 5,
  /** Taille de la grille de l'index spatial (degrés). */
  CELL_DEG: 0.01,
  TEXT: "Passage sous un pont dont la hauteur n'est pas renseignée dans OpenStreetMap : à vérifier. La signalisation fait foi.",
});

const RAD = Math.PI / 180;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** « Passage sous un pont signalé à 3,8 m dans OpenStreetMap… » (hauteur portée par le pont lui-même). */
export function lowBridgeText(h) {
  return `Passage sous un pont signalé à ${String(h).replace('.', ',')} m dans OpenStreetMap, hauteur que le calcul ne prend pas en compte : à vérifier. La signalisation fait foi.`;
}

function decodeLine(arr, start) {
  const out = [];
  let x = 0; let y = 0;
  for (let i = start; i + 1 < arr.length; i += 2) {
    if (!Number.isInteger(arr[i]) || !Number.isInteger(arr[i + 1])) return null;
    x += arr[i]; y += arr[i + 1];
    out.push([x / 1e5, y / 1e5]);
  }
  return out.length >= 2 ? out : null;
}

/** Case de data/ponts-osm/ → { bridges, clearances } ; null si illisible. */
export function parseBridgeTile(json) {
  if (!json || !Array.isArray(json.b) || !Array.isArray(json.h) || !Array.isArray(json.n) || !Array.isArray(json.c)) return null;
  const bridges = [];
  for (const r of json.b) {
    if (!Array.isArray(r) || !Number.isInteger(r[0])) continue;
    const coords = decodeLine(r, 5);
    if (!coords) continue;
    bridges.push({
      id: r[0], kind: r[1] === 1 ? 'rail' : 'road', cls: String(json.c[r[2]] ?? ''),
      height: typeof r[3] === 'string' && r[3] ? r[3] : null, name: String(json.n[r[4]] ?? ''), coords,
    });
  }
  const clearances = [];
  for (const r of json.h) {
    if (!Array.isArray(r) || !Number.isInteger(r[0])) continue;
    const coords = decodeLine(r, 2);
    if (coords) clearances.push({ id: r[0], height: String(r[1] ?? ''), coords });
  }
  return { bridges, clearances };
}

/** Plusieurs cases (un pont à cheval sur deux cases y est deux fois) → une seule liste, sans doublon. */
export function mergeBridgeTiles(tiles) {
  const b = new Map(); const h = new Map();
  for (const t of tiles ?? []) {
    for (const x of t?.bridges ?? []) b.set(x.id, x);
    for (const x of t?.clearances ?? []) h.set(x.id, x);
  }
  return { bridges: [...b.values()], clearances: [...h.values()] };
}

/** Hauteur en mètres d'une étiquette OSM (« 3.8 », « 3,8 m ») ; null si illisible (pieds, « default », « none »). */
export function parseHeight(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(m)?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return v > 0 && v < 20 ? v : null;
}

// Plan local (m) autour d'une latitude.
const kxAt = (lat) => Math.cos(lat * RAD) * 111320;
const KY = 110540;

/** Intersection franche de [a,b] et [c,d] (plan local) : { t, u, angle } ou null. */
function crossing(a, b, c, d, kx) {
  const r = [(b[0] - a[0]) * kx, (b[1] - a[1]) * KY];
  const s = [(d[0] - c[0]) * kx, (d[1] - c[1]) * KY];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const q = [(c[0] - a[0]) * kx, (c[1] - a[1]) * KY];
  const t = (q[0] * s[1] - q[1] * s[0]) / den;
  const u = (q[0] * r[1] - q[1] * r[0]) / den;
  // Croisement sur un point du tracé : compté une fois (t dans [0, 1[) ; sur un nœud du pont : u dans [0, 1].
  if (t < 0 || t >= 1 || u < 0 || u > 1) return null;
  const sin = Math.abs(den) / (Math.hypot(...r) * Math.hypot(...s));
  return { t, u, angle: Math.asin(Math.min(1, sin)) / RAD };
}

/** Distance (m) d'un point à une ligne. */
function distToLine(p, line) {
  const kx = kxAt(p[1]);
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]; const b = line[i];
    const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * KY;
    const bx = (b[0] - p[0]) * kx; const by = (b[1] - p[1]) * KY;
    const dx = bx - ax; const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Index spatial : cellule de CELL_DEG → objets dont l'emprise la touche. */
function buildIndex(items) {
  const grid = new Map();
  const c = BRIDGE.CELL_DEG;
  for (const it of items) {
    let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
    for (const [x, y] of it.coords) { w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y); }
    for (let i = Math.floor(w / c); i <= Math.floor(e / c); i += 1) {
      for (let j = Math.floor(s / c); j <= Math.floor(n / c); j += 1) {
        const k = `${i}:${j}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(it);
      }
    }
  }
  return grid;
}

function near(grid, w, s, e, n) {
  const c = BRIDGE.CELL_DEG;
  const out = new Set();
  for (let i = Math.floor(w / c); i <= Math.floor(e / c); i += 1) {
    for (let j = Math.floor(s / c); j <= Math.floor(n / c); j += 1) {
      for (const it of grid.get(`${i}:${j}`) ?? []) out.add(it);
    }
  }
  return out;
}

/** Point du tracé à `d` m avant (d < 0) ou après le croisement, sur le segment i ou ses voisins. */
function pointAround(coords, i, t, d) {
  const seg = (k) => {
    const a = coords[k]; const b = coords[k + 1];
    return Math.hypot((b[0] - a[0]) * kxAt(a[1]), (b[1] - a[1]) * KY);
  };
  let k = i; let pos = t * seg(i) + d;
  while (pos < 0 && k > 0) { k -= 1; pos += seg(k); }
  while (pos > seg(k) && k < coords.length - 2) { pos -= seg(k); k += 1; }
  const len = seg(k) || 1;
  const f = Math.max(0, Math.min(1, pos / len));
  const a = coords[k]; const b = coords[k + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * Ponts sans hauteur connue au-dessus d'un itinéraire.
 * @param {{ coordinates:number[][], steps?:object[], roadExtras?:object|null }} route
 * @param {{ bridges:object[], clearances:object[] }} data mergeBridgeTiles
 * @param {{ vehicleHeight?:number|null }} opts
 * @returns {{ items:{ id:number, kind:string, name:string, level:'high'|'medium', roadClass:string|null,
 *   point:number[], along:number, index:number, text:string }[], counts:{ high:number, medium:number, motorway:number,
 *   knownBelow:number, knownOk:number } }}
 *   point : croisement exact tracé × pont [lon, lat] (repère, « Éviter ce passage » de la phase 12b) ; along : m depuis
 *   le départ ; items triés haute puis moyenne, puis dans l'ordre du trajet
 */
export function bridgesAlongRoute(route, data, { vehicleHeight = null } = {}) {
  const counts = { high: 0, medium: 0, motorway: 0, knownBelow: 0, knownOk: 0 };
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !data?.bridges?.length) return { items: [], counts };
  const bridgeGrid = buildIndex(data.bridges);
  const clearGrid = buildIndex(data.clearances ?? []);
  const seg = segmentClasses(route);
  const items = [];
  const seen = [];
  let along = 0;
  for (let i = 0; i + 1 < coords.length; i += 1) {
    const a = coords[i]; const b = coords[i + 1];
    const kx = kxAt(a[1]);
    const segLen = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * KY);
    const cands = near(bridgeGrid, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
    for (const br of cands) {
      for (let j = 1; j < br.coords.length; j += 1) {
        const x = crossing(a, b, br.coords[j - 1], br.coords[j], kx);
        if (!x || x.angle < BRIDGE.MIN_ANGLE_DEG) continue;
        const p = [a[0] + (b[0] - a[0]) * x.t, a[1] + (b[1] - a[1]) * x.t];
        // Tracé sur le pont (ou qui y monte, en descend) : à 15 m avant ou après le croisement, le tracé est encore
        // collé au pont. Un vrai passage dessous (angle ≥ 20°) s'en écarte d'au moins 15 × sin 20° ≈ 5,1 m.
        const before = pointAround(coords, i, x.t, -15);
        const after = pointAround(coords, i, x.t, 15);
        if (distToLine(before, br.coords) < BRIDGE.ON_BRIDGE_M || distToLine(after, br.coords) < BRIDGE.ON_BRIDGE_M) continue;
        const at = along + x.t * segLen;
        if (seen.some((s) => s.id === br.id && Math.abs(s.at - at) < 50)) continue;
        seen.push({ id: br.id, at });
        let own = parseHeight(br.height);
        if (own !== null && isNum(vehicleHeight) && vehicleHeight < own) { counts.knownOk += 1; continue; }
        // Hauteur connue dessous (tronçon maxheight à moins de 40 m). Elle n'écarte le pont que si elle dépasse celle du
        // véhicule : ORS a calculé un passage qu'elle interdirait, son graphe est donc plus ancien que l'étiquette
        // (constat 23/11/2026 : chemin 531802661 à 3,8 m sous le pont 243477938 dans l'extrait du 21/11/2026, alors
        // qu'ORS y fait passer un camion de 4 m) → signalé en priorité haute avec cette hauteur, « à vérifier ».
        const dLat = BRIDGE.KNOWN_NEAR_M / KY; const dLon = BRIDGE.KNOWN_NEAR_M / kx;
        const below = [...near(clearGrid, p[0] - dLon, p[1] - dLat, p[0] + dLon, p[1] + dLat)]
          .filter((c) => distToLine(p, c.coords) <= BRIDGE.KNOWN_NEAR_M);
        if (below.length && own === null) {
          const hs = below.map((c) => parseHeight(c.height));
          const low = hs.filter((h) => h !== null && !(isNum(vehicleHeight) && vehicleHeight < h));
          if (!low.length) { counts.knownBelow += 1; continue; }
          own = Math.min(...low);
        }
        const roadClass = seg ? seg.classes[i] : null;
        let level;
        if (own !== null) level = 'high'; // hauteur du pont lisible, au plus celle du véhicule (ou véhicule sans hauteur)
        else if (roadClass === ROAD_CLASS.MOTORWAY) { counts.motorway += 1; continue; }
        else level = roadClass === ROAD_CLASS.NATIONAL ? 'medium' : 'high';
        counts[level] += 1;
        items.push({
          id: br.id, kind: br.kind, name: br.name, level, roadClass,
          point: [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6], along: at, index: i,
          text: own !== null ? lowBridgeText(own) : BRIDGE.TEXT,
        });
      }
    }
    along += segLen;
  }
  items.sort((x, y) => (x.level === y.level ? x.along - y.along : x.level === 'high' ? -1 : 1));
  return { items, counts };
}

/** Lignes de la fiche : 5 au plus, puis « +N ponts à vérifier ». */
export function bridgeLines(items) {
  const km = (m) => `km ${Math.round(m / 1000)}`;
  const shown = (items ?? []).slice(0, BRIDGE.MAX_SHOWN).map((it) => ({
    level: 'warn',
    text: `${it.text} (${km(it.along)}${it.name ? `, ${it.name}` : ''}${it.kind === 'rail' ? ', pont ferroviaire' : ''} ; priorité ${it.level === 'high' ? 'haute' : 'moyenne'})`,
  }));
  const more = (items?.length ?? 0) - shown.length;
  if (more > 0) shown.push({ level: 'warn', text: `+${more} pont${more > 1 ? 's' : ''} à vérifier (voir la carte).` });
  return shown;
}

/** Ligne technique du diagnostic du trajet. */
export function bridgeTechText(res) {
  const c = res?.counts ?? { high: 0, medium: 0, motorway: 0 };
  return `Ponts sans hauteur : ${c.high + c.medium} (haute ${c.high}, moyenne ${c.medium}, autoroutes ignorées ${c.motorway})`;
}

export const BRIDGE_UNAVAILABLE_TEXT = 'Ponts sans hauteur : données non chargées (copie OpenStreetMap absente ou illisible). La signalisation fait foi.';
export const BRIDGE_UNCOVERED_TEXT = 'Ponts sans hauteur : une partie du trajet est hors de la copie OpenStreetMap (France seulement). La signalisation fait foi.';

/**
 * Réglementation de la fiche (phase 12a) : lignes « à vérifier », résumé, ligne technique et repères de la carte.
 * @param {object} route
 * @param {{ vehicle?:object, bridges?:{ status:string, data:object, uncovered?:boolean }|null, enabled?:boolean }} ctx
 * @returns {{ lines:object[], short:string[], items:object[], counts:object|null, tech:string }}
 */
export function bridgeRules(route, { vehicle = null, bridges = null, enabled = true } = {}) {
  const out = { lines: [], short: [], items: [], counts: null, tech: '' };
  if (!enabled) { out.tech = 'Ponts sans hauteur : signalement désactivé dans Réglages'; return out; }
  if (!bridges || bridges.status === 'idle' || bridges.status === 'loading') { out.tech = 'Ponts sans hauteur : copie en cours de lecture'; return out; }
  if (bridges.status !== 'ok') {
    out.lines.push({ level: 'info', text: BRIDGE_UNAVAILABLE_TEXT });
    out.tech = 'Ponts sans hauteur : données non chargées';
    return out;
  }
  const res = bridgesAlongRoute(route, bridges.data, { vehicleHeight: vehicle?.height ?? null });
  out.items = res.items;
  out.counts = res.counts;
  out.tech = bridgeTechText(res);
  out.lines.push(...bridgeLines(res.items));
  if (bridges.uncovered) out.lines.push({ level: 'info', text: BRIDGE_UNCOVERED_TEXT });
  if (res.items.length) out.short.push(`${res.items.length} pont${res.items.length > 1 ? 's' : ''} à vérifier`);
  return out;
}
