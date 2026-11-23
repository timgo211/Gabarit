// Limitation de vitesse PL le long de l'itinéraire (phase 11a), d'après la copie data/vitesses-osm/
// (speed-convert.js) et les règles générales PL (speed-rules.js). Logique pure, calculée UNE fois par itinéraire
// (et à chaque recalcul ou nouvelle case lue), jamais à chaque position : le guidage lit ensuite la limite par
// distance parcourue (limitAt, curseur qui avance).
//
// Limite d'un tronçon : maxspeed:hgv s'il existe ; sinon maxspeed plafonné par la règle générale PL du type de route
// quand elle est connue et vérifiée (un 130 d'autoroute devient la limite PL de la règle) ; règle inconnue ou non
// vérifiée → inconnue (jamais une limite inventée, jamais une limite de voiture affichée à un PL). Véhicule de PTAC
// ≤ 3,5 t : maxspeed sans plafond (règles PL non applicables), maxspeed:hgv ignoré. Une limite en agglomération
// n'est jamais déduite d'une règle générale : seule l'étiquette de la voie la donne.
// Source gardée : 'osm' (étiquette de la voie, éventuellement maxspeed:hgv) ou 'rule' (valeur de la règle
// générale, plus basse que l'étiquette). La voix ne dit « Limite X » que pour 'osm' sans conditions.
//
// Méthode (comme les limites de poids, weight-check.js) : un point du tracé tous les SPEED.SAMPLE_M ; voie OSM à
// SPEED.TOLERANCE_M au plus, projection sur le segment, écart de cap ≤ SPEED.MAX_HEADING_DEG modulo 180° (jamais une
// route qui croise) ; plusieurs voies : la plus proche, puis la plus basse à SPEED.TIE_M près. Passage de moins de
// SPEED.MIN_RUN_M : inconnu (carrefour, bretelle effleurée). Copie absente, case manquante, hors zone : inconnue.

import { prepareLine, pointAt, segmentBearing } from './nav-geo.js';
import { axisDiff } from './hgv-tolls-geo.js';
import { indexSegments, distToSegment, WEIGHT } from './weight-check.js';
import { countriesAlongRoute } from './countries.js';
import { generalLimit } from './speed-rules.js';

export const SPEED = Object.freeze({
  SAMPLE_M: 5,
  TOLERANCE_M: 15,
  MAX_HEADING_DEG: 30,
  TIE_M: 3,
  MIN_RUN_M: 25,
  /** Au-dessus de 3,5 t de PTAC : poids lourd (règles PL et maxspeed:hgv). */
  HGV_OVER_T: 3.5,
});

export const SPEED_TEXT = Object.freeze({
  SETTINGS: "Limites d'après OpenStreetMap et règles générales : la signalisation fait foi.",
  COND: 'Certaines limites ont des conditions (pluie, horaires, remorque) non lues : à vérifier.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

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

/** Case de data/vitesses-osm/ → { ways:[{ key, limit, hgv, cond, cls, coords }] } ; null si illisible. */
export function parseSpeedTile(json) {
  if (!json || !Array.isArray(json.s)) return null;
  const ways = [];
  for (const r of json.s) {
    if (!Array.isArray(r) || !Number.isInteger(r[0]) || r[0] <= 0 || !Number.isInteger(r[1]) || !Number.isInteger(r[2])) continue;
    if (r[2] < 0 || r[2] > 4) continue;
    const coords = decodeLine(r, 3);
    if (!coords) continue;
    ways.push({
      key: `${r[0]}|${r[1]}|${r[2]}|${r.slice(3, 5).join(',')}|${r.length}`,
      limit: r[0], hgv: (r[1] & 1) === 1, cond: (r[1] & 2) === 2, cls: r[2], coords,
    });
  }
  return { ways };
}

/** Plusieurs cases (une ligne à cheval sur deux cases y est deux fois, à l'identique) → une seule liste. */
export function mergeSpeedTiles(tiles) {
  const m = new Map();
  for (const t of tiles ?? []) for (const w of t?.ways ?? []) m.set(w.key, w);
  return { ways: [...m.values()] };
}

/**
 * Limite d'une voie pour le véhicule : { kmh, source:'osm'|'rule', cond } ou null (inconnue).
 * @param {{ limit:number, hgv:boolean, cond:boolean, cls:number }} way
 * @param {string|null} country code du pays (countryinfo d'ORS)
 */
export function wayLimit(way, country, vehicle, countries = null, fr = undefined) {
  const ptac = isNum(vehicle?.weight) ? vehicle.weight : null;
  if (ptac === null) return null;
  if (ptac <= SPEED.HGV_OVER_T) return way.hgv ? null : { kmh: way.limit, source: 'osm', cond: way.cond };
  const rule = generalLimit({ country, cls: way.cls, vehicle, countries, fr });
  // Règle inconnue : seule l'étiquette maxspeed:hgv (propre aux PL) compte ; jamais avec des matières dangereuses
  // (leur limite peut être plus basse que celle des autres PL).
  if (rule === null) return way.hgv && vehicle.hazmat !== true ? { kmh: way.limit, source: 'osm', cond: way.cond } : null;
  if (way.limit <= rule.kmh) return { kmh: way.limit, source: 'osm', cond: way.cond };
  return { kmh: rule.kmh, source: 'rule', cond: way.cond };
}

/** Voie retenue en un point : la plus proche (cap compatible), puis la plus basse à SPEED.TIE_M près. */
function wayAt(cells, p, heading) {
  const C = WEIGHT.CELL_DEG;
  const cx = Math.floor(p[0] / C); const cy = Math.floor(p[1] / C);
  const hits = [];
  for (let x = cx - 1; x <= cx + 1; x += 1) {
    for (let y = cy - 1; y <= cy + 1; y += 1) {
      for (const s of cells.get(`${x}_${y}`) ?? []) {
        const d = distToSegment(p, s.a, s.b);
        if (d > SPEED.TOLERANCE_M) continue;
        if (axisDiff(heading, s.axis) > SPEED.MAX_HEADING_DEG) continue;
        hits.push({ way: s.way, d });
      }
    }
  }
  if (!hits.length) return null;
  const dmin = Math.min(...hits.map((h) => h.d));
  return hits.filter((h) => h.d <= dmin + SPEED.TIE_M).map((h) => h.way);
}

/**
 * Limites le long du tracé.
 * @param {{ coordinates:number[][], countries?:object[] }} route
 * @param {{ ways:object[] }|null} data mergeSpeedTiles
 * @param {{ vehicle?:object, countries?:Map|null, fr?:object }} opts fr : règles françaises (tests ; FR_SPEED_RULES sinon)
 * @returns {{ intervals:{ from:number, to:number, kmh:number, source:string, cond:boolean }[], total:number,
 *   coverage:number, osmShare:number, ruleShare:number, condShare:number }}
 *   parts en fraction de la longueur du tracé (0 à 1) ; intervalles triés, sans chevauchement
 */
export function speedLimitsAlongRoute(route, data, { vehicle = null, countries = null, fr = undefined } = {}) {
  const coords = route?.coordinates;
  const empty = { intervals: [], total: 0, coverage: 0, osmShare: 0, ruleShare: 0, condShare: 0 };
  if (!Array.isArray(coords) || coords.length < 2) return empty;
  const line = prepareLine(coords);
  const out = { ...empty, total: line.total };
  if (!data?.ways?.length || !line.total) return out;
  const cells = indexSegments(data.ways);
  const ctry = countriesAlongRoute(route);
  const countryAt = (al) => (ctry.ok ? ctry.segments.find((x) => al >= x.enter && al <= x.exit)?.code ?? null : null);
  const N = Math.max(1, Math.ceil(line.total / SPEED.SAMPLE_M));
  const step = line.total / N;
  const raw = [];
  let cur = null;
  for (let k = 0; k <= N; k += 1) {
    const along = Math.min(line.total, k * step);
    const at = pointAt(line, along);
    const ways = wayAt(cells, at.point, segmentBearing(line, at.segIndex ?? 0));
    let lim = null;
    if (ways) {
      const country = countryAt(along);
      const vals = ways.map((w) => wayLimit(w, country, vehicle, countries, fr));
      // Une voie candidate de limite inconnue : le point reste inconnu (jamais la valeur d'une voisine plus haute).
      if (vals.every(Boolean)) lim = vals.reduce((a, b) => (b.kmh < a.kmh ? b : a));
      if (lim) lim = { ...lim, cond: vals.some((v) => v.cond) };
    }
    const same = cur && lim && cur.kmh === lim.kmh && cur.source === lim.source && cur.cond === lim.cond;
    if (same) { cur.to = Math.min(line.total, along + step / 2); continue; }
    if (cur) raw.push(cur);
    cur = lim ? { from: Math.max(0, along - step / 2), to: Math.min(line.total, along + step / 2), ...lim } : null;
  }
  if (cur) raw.push(cur);
  out.intervals = raw.filter((r) => r.to - r.from >= SPEED.MIN_RUN_M);
  const len = (f) => Math.min(1, out.intervals.filter(f).reduce((s, r) => s + (r.to - r.from), 0) / line.total);
  out.coverage = len(() => true);
  out.osmShare = len((r) => r.source === 'osm');
  out.ruleShare = len((r) => r.source === 'rule');
  out.condShare = len((r) => r.cond);
  return out;
}

/**
 * Limite à une distance parcourue : { limit:{ kmh, source, cond }|null, cursor } ; le curseur (index d'intervalle)
 * avance avec la position (O(1) en moyenne), recule seulement si la position recule.
 */
export function limitAt(limits, along, cursor = 0) {
  const list = limits?.intervals;
  if (!Array.isArray(list) || !list.length || !isNum(along)) return { limit: null, cursor: 0 };
  let i = Number.isInteger(cursor) && cursor >= 0 && cursor < list.length ? cursor : 0;
  while (i > 0 && along < list[i].from) i -= 1;
  while (i < list.length - 1 && along >= list[i].to) i += 1;
  const r = list[i];
  const limit = along >= r.from && along < r.to ? { kmh: r.kmh, source: r.source, cond: r.cond } : null;
  return { limit, cursor: i };
}

const pct = (x) => Math.round(x * 100);

/**
 * Fiche et diagnostic (phase 11a) : ligne de la fiche d'itinéraire (couverture), note « conditions à vérifier »,
 * ligne technique du diagnostic.
 * @param {object} route
 * @param {{ vehicle?:object, speeds?:{ status:string, data:object, uncovered?:boolean, updated?:string|null }|null,
 *   countries?:Map|null }} ctx
 * @returns {{ card:string, lines:object[], tech:string, limits:object|null }}
 */
export function speedRules(route, { vehicle = null, speeds = null, countries = null, fr = undefined } = {}) {
  const out = { card: '', lines: [], tech: '', limits: null };
  if (!speeds || speeds.status === 'idle' || speeds.status === 'loading') {
    out.tech = 'Limites de vitesse : copie en cours de lecture';
    return out;
  }
  if (speeds.status !== 'ok') {
    out.card = 'Limites de vitesse connues : inconnues (copie OpenStreetMap absente)';
    out.tech = 'Limites de vitesse : copie data/vitesses-osm absente ou illisible, couverture 0 %';
    return out;
  }
  const res = speedLimitsAlongRoute(route, speeds.data, { vehicle, countries, fr });
  out.limits = res;
  const c = pct(res.coverage);
  out.card = c > 0 ? `Limites de vitesse connues : ${c} % du trajet` : 'Limites de vitesse connues : inconnues';
  if (res.condShare > 0) out.lines.push({ level: 'info', text: SPEED_TEXT.COND });
  out.tech = `Limites de vitesse : ${c} % (OSM ${pct(res.osmShare)} %, plafonnées par règle générale ${pct(res.ruleShare)} %, `
    + `conditions ${pct(res.condShare)} %)${speeds.uncovered ? ' ; trajet en partie hors copie (France seulement)' : ''}`
    + `${speeds.updated ? ` ; copie du ${speeds.updated}` : ''}`;
  return out;
}
