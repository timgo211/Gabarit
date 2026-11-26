// Limites de poids le long de l'itinéraire (phase 12a bis), d'après la copie data/poids-osm/ (weight-convert.js).
// Logique pure. Constat (23/11/2026) : le graphe d'ORS est en retard sur OpenStreetMap (tronçon 531802661 à 3,8 m
// dans l'extrait du 21/11, alors qu'ORS y fait passer un camion de 4 m) ; une limite de poids récente peut de même
// manquer au calcul. Non confirmé = « à vérifier », jamais dit à voix haute, rien dans le guidage (Code de la route
// art. R412-6-2) ; la signalisation fait foi.
//
// Règle comparée : panneau B13, accès interdit aux véhicules dont le poids total autorisé en charge excède la valeur
// indiquée (arrêté du 24 novembre 1967 relatif à la signalisation des routes et autoroutes ; Instruction
// interministérielle sur la signalisation routière) : tronçon signalé si sa limite est strictement inférieure au
// PTAC du profil (« excède »). Le PTAC du profil n'est pas le poids réel du chargement.
//
// Méthode (comme le réseau des taxes PL, hgv-tolls-geo.js) : un point du tracé tous les WEIGHT.SAMPLE_M ; il touche
// un tronçon s'il en est à WEIGHT.TOLERANCE_M (15 m) au plus avec un écart de cap d'au plus WEIGHT.MAX_HEADING_DEG,
// mesuré modulo 180° (l'ordre des nœuds OSM ne dit pas le sens de circulation), et seulement si sa projection tombe
// sur le segment (pas au-delà du bout d'un tronçon). Le cap écarte les croisements : une
// route qui coupe le tracé n'est jamais comptée, même à 0 m. Un passage compte s'il suit le tronçon sur
// WEIGHT.MIN_RUN_M au moins, ou sur WEIGHT.MIN_SHARE de la longueur d'un tronçon plus court (pont, petite rue) :
// une route qui rejoint le tracé en biais sur quelques mètres n'est pas comptée.

import { prepareLine, pointAt, segmentBearing, bearing, haversine } from './nav-geo.js';
import { axisDiff } from './hgv-tolls-geo.js';

export const WEIGHT = Object.freeze({
  SAMPLE_M: 5,
  TOLERANCE_M: 15,
  MAX_HEADING_DEG: 30,
  MIN_RUN_M: 25,
  MIN_SHARE: 0.6,
  /** Deux points touchés séparés de plus de 15 m (5 m × 3) : deux passages. */
  MAX_GAP_M: 15,
  /** Lignes affichées sur la fiche au plus (puis « +N »). */
  MAX_SHOWN: 5,
  CELL_DEG: 0.005,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;
const fmtT = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

/** Texte de la fiche (consigne de la phase 12a bis). */
export function weightText(limit, local = false) {
  return `Limite de poids de ${fmtT(limit)} t d'après OpenStreetMap${local ? ' (desserte locale possible)' : ''}, que le calcul n'a peut-être pas prise en compte : à vérifier. La signalisation fait foi.`;
}

/** Ligne en 1e-5° et écarts à partir de arr[start] ; aussi lue par dialog-limits.js (phase 12c). */
export function decodeLine(arr, start) {
  const out = [];
  let x = 0; let y = 0;
  for (let i = start; i + 1 < arr.length; i += 2) {
    if (!Number.isInteger(arr[i]) || !Number.isInteger(arr[i + 1])) return null;
    x += arr[i]; y += arr[i + 1];
    out.push([x / 1e5, y / 1e5]);
  }
  return out.length >= 2 ? out : null;
}

/** Case de data/poids-osm/ → { ways:[{ id, limit, local, coords }] } ; null si illisible. */
export function parseWeightTile(json) {
  if (!json || !Array.isArray(json.w)) return null;
  const ways = [];
  for (const r of json.w) {
    if (!Array.isArray(r) || !Number.isInteger(r[0]) || !isNum(r[1]) || r[1] <= 0) continue;
    const coords = decodeLine(r, 3);
    if (coords) ways.push({ id: r[0], limit: r[1], local: r[2] === 1, coords });
  }
  return { ways };
}

/** Plusieurs cases (un tronçon à cheval sur deux cases y est deux fois) → une seule liste, sans doublon. */
export function mergeWeightTiles(tiles) {
  const m = new Map();
  for (const t of tiles ?? []) for (const w of t?.ways ?? []) m.set(w.id, w);
  return { ways: [...m.values()] };
}

function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i += 1) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/** Index des segments des tronçons (cases de WEIGHT.CELL_DEG) ; aussi utilisé par speed-limit.js (phase 11a). */
export function indexSegments(ways) {
  const cells = new Map();
  const C = WEIGHT.CELL_DEG;
  for (const w of ways) {
    for (let i = 1; i < w.coords.length; i += 1) {
      const a = w.coords[i - 1]; const b = w.coords[i];
      const s = { a, b, way: w, axis: bearing(a, b) };
      const x0 = Math.floor(Math.min(a[0], b[0]) / C); const x1 = Math.floor(Math.max(a[0], b[0]) / C);
      const y0 = Math.floor(Math.min(a[1], b[1]) / C); const y1 = Math.floor(Math.max(a[1], b[1]) / C);
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          const k = `${x}_${y}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(s);
        }
      }
    }
  }
  return cells;
}

/**
 * Distance (m) de p au segment [a, b] quand sa projection tombe sur le segment (extrémités comprises), sinon Infinity :
 * un point au-delà du bout d'un tronçon n'est pas « sur » lui (sinon chaque passage serait allongé de 15 m à chaque
 * bout, et une route qui touche le tracé sur 8 m compterait pour 38 m).
 */
export function distToSegment(p, a, b) {
  const kx = Math.cos(p[1] * RAD) * 111320; const ky = 110540;
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx; const by = (b[1] - p[1]) * ky;
  const dx = bx - ax; const dy = by - ay;
  const L = dx * dx + dy * dy;
  if (!L) return Infinity;
  const t = -(ax * dx + ay * dy) / L;
  if (t < 0 || t > 1) return Infinity;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Tronçons touchés par un point (distance ≤ 15 m, cap compatible modulo 180°). */
function waysAt(cells, p, heading) {
  const C = WEIGHT.CELL_DEG;
  const cx = Math.floor(p[0] / C); const cy = Math.floor(p[1] / C);
  const hit = new Set();
  for (let x = cx - 1; x <= cx + 1; x += 1) {
    for (let y = cy - 1; y <= cy + 1; y += 1) {
      for (const s of cells.get(`${x}_${y}`) ?? []) {
        if (hit.has(s.way)) continue;
        if (distToSegment(p, s.a, s.b) > WEIGHT.TOLERANCE_M) continue;
        if (axisDiff(heading, s.axis) > WEIGHT.MAX_HEADING_DEG) continue;
        hit.add(s.way);
      }
    }
  }
  return hit;
}

/**
 * Passages du tracé sur des tronçons suivis (point tous les 5 m à ≤ 15 m, cap compatible à 30° près modulo 180° :
 * jamais un croisement ; trous de 15 m tolérés ; passage ≥ 25 m ou ≥ 60 % du tronçon). Partagé par les limites de
 * poids OSM (12a bis) et les limites DiaLog (12c).
 * @param {number[][]} coords tracé [lon, lat]
 * @param {{ coords:number[][] }[]} ways
 * @returns {{ line:object, runs:{ way:object, enter:number, exit:number }[] }}
 */
export function followedRuns(coords, ways) {
  const lengths = new Map(ways.map((w) => [w, lineLength(w.coords)]));
  const cells = indexSegments(ways);
  const line = prepareLine(coords);
  const N = Math.max(1, Math.ceil(line.total / WEIGHT.SAMPLE_M));
  const open = new Map(); // tronçon → { enter, exit }
  const runs = [];
  const close = (w, r) => {
    const len = r.exit - r.enter + WEIGHT.SAMPLE_M; // chaque point compte pour 5 m de tracé
    const need = Math.min(WEIGHT.MIN_RUN_M, WEIGHT.MIN_SHARE * lengths.get(w));
    if (len >= need) runs.push({ way: w, enter: r.enter, exit: r.exit });
  };
  for (let k = 0; k <= N; k += 1) {
    const along = Math.min(line.total, k * (line.total / N));
    const at = pointAt(line, along);
    const hit = waysAt(cells, at.point, segmentBearing(line, at.segIndex ?? 0));
    for (const w of hit) {
      const r = open.get(w);
      if (r && along - r.exit <= WEIGHT.MAX_GAP_M) r.exit = along;
      else {
        if (r) close(w, r);
        open.set(w, { enter: along, exit: along });
      }
    }
    for (const [w, r] of open) {
      if (!hit.has(w) && along - r.exit > WEIGHT.MAX_GAP_M) { close(w, r); open.delete(w); }
    }
  }
  for (const [w, r] of open) close(w, r);
  return { line, runs };
}

/**
 * Tronçons à limite de poids inférieure au PTAC, suivis par l'itinéraire.
 * @param {{ coordinates:number[][] }} route
 * @param {{ ways:object[] }} data mergeWeightTiles
 * @param {{ ptac?:number|null }} opts PTAC du profil (t)
 * @returns {{ items:{ id:number, limit:number, local:boolean, point:number[], along:number, length:number,
 *   text:string }[], counts:{ shown:number, local:number, aboveOk:number } }}
 *   point : milieu du passage sur le tracé [lon, lat] (repère, « Éviter ce passage ») ; along : m depuis le départ ;
 *   items dans l'ordre du trajet ; aboveOk : tronçons proches dont la limite admet le PTAC
 */
export function weightsAlongRoute(route, data, { ptac = null } = {}) {
  const counts = { shown: 0, local: 0, aboveOk: 0 };
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !data?.ways?.length || !isNum(ptac) || ptac <= 0) return { items: [], counts };
  const low = data.ways.filter((w) => w.limit < ptac);
  counts.aboveOk = data.ways.length - low.length;
  if (!low.length) return { items: [], counts };
  const { line, runs } = followedRuns(coords, low);
  // Tronçons voisins de même limite mis bout à bout (rue découpée en plusieurs chemins OSM) : un seul passage.
  runs.sort((x, y) => x.enter - y.enter);
  const merged = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && r.enter - last.exit <= WEIGHT.MAX_GAP_M && last.limit === r.way.limit && last.local === r.way.local) {
      last.exit = Math.max(last.exit, r.exit);
      continue;
    }
    merged.push({ id: r.way.id, limit: r.way.limit, local: r.way.local, enter: r.enter, exit: r.exit });
  }
  const items = merged.map((m) => {
    const mid = pointAt(line, (m.enter + m.exit) / 2).point;
    return {
      id: m.id, limit: m.limit, local: m.local, along: m.enter, length: Math.round(m.exit - m.enter),
      point: [Math.round(mid[0] * 1e6) / 1e6, Math.round(mid[1] * 1e6) / 1e6], text: weightText(m.limit, m.local),
    };
  });
  counts.shown = items.length;
  counts.local = items.filter((i) => i.local).length;
  return { items, counts };
}

/** Lignes de la fiche : 5 au plus, puis « +N limites de poids à vérifier ». */
export function weightLines(items) {
  const shown = (items ?? []).slice(0, WEIGHT.MAX_SHOWN).map((it) => ({
    level: 'warn', sev: 'check', text: `${it.text} (km ${Math.round(it.along / 1000)})`,
  }));
  const more = (items?.length ?? 0) - shown.length;
  if (more > 0) shown.push({ level: 'warn', sev: 'check', text: `+${more} limite${more > 1 ? 's' : ''} de poids à vérifier (voir la carte).` });
  return shown;
}

export const WEIGHT_UNAVAILABLE_TEXT = 'Limites de poids : données non chargées (copie OpenStreetMap absente ou illisible). La signalisation fait foi.';
export const WEIGHT_UNCOVERED_TEXT = 'Limites de poids : une partie du trajet est hors de la copie OpenStreetMap (France seulement). La signalisation fait foi.';

/**
 * Réglementation de la fiche (phase 12a bis) : lignes « à vérifier », résumé, ligne technique et repères de la carte.
 * @param {object} route
 * @param {{ vehicle?:object, weights?:{ status:string, data:object, uncovered?:boolean }|null, enabled?:boolean }} ctx
 * @returns {{ lines:object[], short:string[], items:object[], counts:object|null, tech:string }}
 */
export function weightRules(route, { vehicle = null, weights = null, enabled = true } = {}) {
  const out = { lines: [], short: [], items: [], counts: null, tech: '' };
  if (!enabled) { out.tech = 'Limites de poids : signalement désactivé dans Réglages'; return out; }
  if (!weights || weights.status === 'idle' || weights.status === 'loading') { out.tech = 'Limites de poids : copie en cours de lecture'; return out; }
  if (weights.status !== 'ok') {
    out.lines.push({ level: 'info', sev: 'check', text: WEIGHT_UNAVAILABLE_TEXT }); // v84 : donnée manquante = à vérifier
    out.tech = 'Limites de poids : données non chargées';
    return out;
  }
  const res = weightsAlongRoute(route, weights.data, { ptac: vehicle?.weight ?? null });
  out.items = res.items;
  out.counts = res.counts;
  out.tech = `Limites de poids : ${res.items.length}`;
  out.lines.push(...weightLines(res.items));
  if (weights.uncovered) out.lines.push({ level: 'info', sev: 'check', text: WEIGHT_UNCOVERED_TEXT });
  if (res.items.length) out.short.push(`${res.items.length} limite${res.items.length > 1 ? 's' : ''} de poids à vérifier`);
  return out;
}
