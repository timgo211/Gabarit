// Zones à faibles émissions (phase 5) : lecture de data/zfe.json, passage de l'itinéraire dans les ZFE, interdiction
// selon la vignette Crit'Air du profil, polygones à éviter (ORS), textes. Logique pure.
//
// Source : Base nationale consolidée des zones à faibles émissions (BNZFE), transport.data.gouv.fr / data.gouv.fr
// (jeu « base-nationale-consolidee-des-zones-a-faibles-emissions » : aires.geojson et voies.geojson), licence
// indiquée sur data.gouv.fr : ODbL (Open Database License) — la copie convertie data/zfe.json est sous la même
// licence, source citée dans l'appli. Schéma etalab « Zone à Faibles Emissions » (github.com/etalab/schema-zfe,
// schema.json, version 0.8.2) :
// - pl_critair (poids lourds > 3,5 t), vul_critair (utilitaires légers) : « Vignette CRITAIR à partir de laquelle la
//   circulation n'est pas autorisée. Par exemple V4 signifie que les véhicules CRITAIR 4, CRITAIR 5 et sans vignettes
//   ne sont pas autorisés à circuler. L'ordre des vignettes est le suivant : EL, V1, V2, V3, V4, V5, NC. »
// - pl_horaires… : « jours et horaires de restriction au format 'opening hours' d'OpenStreetMap ».
// - « la valeur null peut être utilisé pour indiqué que l'information n'est pas pertinente » (README) : pas de
//   restriction pour cette catégorie.
// - Mode d'emploi (README) : « Les règles affectant les tronçons routiers priment donc sur les règles affectant une
//   zone. Si plusieurs aires réglementées venaient à être superposées […] on devra interpréter la dernière zone comme
//   étant celle qui prime sur toutes les autres ». Un tronçon (voies.geojson) prime toujours sur une aire.
// La suppression des ZFE votée en avril 2026 (loi de simplification de la vie économique) a été censurée par le
// Conseil constitutionnel (décision n° 2026-903 DC du 21 mai 2026) : les ZFE restent en vigueur selon leurs arrêtés.

import { haversine } from './nav-geo.js';
import { sampleRoute } from './route-samples.js';
import { isHoliday } from './holidays.js';

export const ZFE = Object.freeze({
  DATA_PATH: './data/zfe.json',
  /** Ordre du schéma etalab : EL (électrique) est le moins restreint, NC (sans vignette) le plus. */
  ORDER: Object.freeze(['EL', 'V1', 'V2', 'V3', 'V4', 'V5', 'NC']),
  /** Écart entre deux points du tracé examinés (m). */
  SAMPLE_M: 100,
  /** Deux passages dans la même zone séparés de moins de 1 km : un seul passage. */
  MERGE_GAP_M: 1000,
  /** Le tracé suit un tronçon spécial (voies.geojson) s'il en passe à moins de 20 m. */
  VOIE_M: 20,
  /** PTAC au-delà duquel les règles « poids lourds » s'appliquent (schéma : « Poids lourds (>3,5t) »). */
  PL_WEIGHT_T: 3.5,
  /** Annonce vocale en guidage, une fois, vers 5 km avant l'entrée dans une ZFE interdite. */
  ANNOUNCE_M: 5000,
  ANNOUNCE_MIN_M: 500,
  /** Bandeau du guidage à moins de 20 km. */
  BANNER_M: 20000,
  SOURCE: 'Base nationale des ZFE (transport.data.gouv.fr, licence ODbL)',
  /**
   * API publique d'ORS (giscience.github.io/openrouteservice/hosted-api-restrictions, « Directions restrictions ») :
   * « Maximum Distance (with avoid areas) 150 km », « Avoid polygon area 200 km² », « Avoid polygon extent (height or
   * width) 20 km ». La distance est mesurée à vol d'oiseau entre les points (ors-api, RoutingService.java,
   * calculateTotalDistance) ; aire et étendue par polygone (ApiService.java, validateAreaLimits, projection de
   * Mollweide). Une ZFE plus grande est découpée en carrés de 12 km (144 km², marge pour la projection).
   */
  AVOID_MAX_DISTANCE_M: 150000,
  AVOID_TILE_M: 12000,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;

// ───────── Vignette ─────────

/** Vignette du profil (« 0 » à « 5 », « NC ») → code du schéma (EL, V1… V5, NC). Crit'Air 0 = électrique / hydrogène. */
export function critairCode(value) {
  const v = String(value ?? 'NC');
  if (v === '0') return 'EL';
  if (/^[1-5]$/.test(v)) return `V${v}`;
  return 'NC';
}

/** Catégorie du schéma pour ce profil : « pl » au-delà de 3,5 t de PTAC, sinon « vul ». */
export const categoryOf = (vehicle) => (typeof vehicle?.weight === 'number' && vehicle.weight > ZFE.PL_WEIGHT_T ? 'pl' : 'vul');

/** Le véhicule est-il interdit par ce seuil ? null : pas de restriction. */
export function bannedBy(threshold, vehicleCritair) {
  const t = ZFE.ORDER.indexOf(threshold);
  if (t < 0) return false;
  return ZFE.ORDER.indexOf(critairCode(vehicleCritair)) >= t;
}

/** « Crit'Air 3, 4, 5 et non classés interdits » pour un seuil. */
export function thresholdText(threshold) {
  const i = ZFE.ORDER.indexOf(threshold);
  if (i < 0) return 'aucune restriction';
  if (threshold === 'NC') return 'véhicules sans vignette (non classés) interdits';
  const list = ZFE.ORDER.slice(i, 6).map((c) => (c === 'EL' ? '0' : c.slice(1)));
  return `Crit'Air ${list.join(', ')} et non classés interdits`;
}

// ───────── Horaires (format opening_hours d'OpenStreetMap, sous-ensemble) ─────────

const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDays(text) {
  const days = new Set();
  for (const part of text.split(',')) {
    const m = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part.trim());
    if (!m) return null;
    const a = DAY_CODES.indexOf(m[1]);
    const b = m[2] ? DAY_CODES.indexOf(m[2]) : a;
    for (let d = a, k = 0; k < 7; d = (d + 1) % 7, k += 1) { days.add(d); if (d === b) break; }
  }
  return days;
}

function parseRanges(text) {
  const out = [];
  for (const part of text.split(',')) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!m) return null;
    const from = Number(m[1]) * 60 + Number(m[2]);
    let to = Number(m[3]) * 60 + Number(m[4]);
    if (to === 0 && from === 0) to = 1440; // « 00:00-00:00 » : toute la journée
    if (to === 23 * 60 + 59) to = 1440; // « 00:00-23:59 » : toute la journée
    if (from > 1440 || to > 1440) return null;
    if (to > from) out.push([from, to]);
    else out.push([from, 1440], [0, to]); // plage qui passe minuit
  }
  return out;
}

/**
 * Lit les horaires d'une restriction. Formats vus dans la BNZFE : « 24/7 », « Mo-Su 00:00-24:00; PH off »,
 * « Mo-Su : 00:00-00:00 », « Mo-Fr 07:00-9:00,16:00-19:00 », « Mo-Su 00:00-24:00; May 1 off ».
 * @returns {{ always:boolean, rules:{ days:Set<number>, ranges:number[][] }[], holidaysOff:boolean, datesOff:string[] }|null}
 *   null : horaires illisibles ou absents (restriction supposée permanente, texte brut affiché « à vérifier »)
 */
export function parseHours(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const out = { always: false, rules: [], holidaysOff: false, datesOff: [] };
  for (const raw of text.split(';')) {
    const part = raw.trim().replace(/\s*:\s+/, ' ');
    if (!part) continue;
    if (part === '24/7') { out.always = true; continue; }
    if (/^PH off$/i.test(part)) { out.holidaysOff = true; continue; }
    const off = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) off$/.exec(part);
    if (off) { out.datesOff.push(`${String(MONTHS.indexOf(off[1]) + 1).padStart(2, '0')}-${off[2].padStart(2, '0')}`); continue; }
    const m = /^([A-Za-z,-]+)\s+([\d:,\s-]+)$/.exec(part);
    if (!m) return null;
    const days = parseDays(m[1]);
    const ranges = parseRanges(m[2].replace(/\s/g, ''));
    if (!days || !ranges) return null;
    out.rules.push({ days, ranges });
  }
  if (!out.always && !out.rules.length) return null;
  return out;
}

/** La restriction s'applique-t-elle à cet instant ? (horaires illisibles : oui, par prudence) */
export function hoursActive(hours, date) {
  if (!hours) return true;
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (hours.datesOff.includes(md)) return false;
  if (hours.holidaysOff && isHoliday(date)) return false;
  if (hours.always) return true;
  const min = date.getHours() * 60 + date.getMinutes();
  return hours.rules.some((r) => r.days.has(date.getDay()) && r.ranges.some(([a, b]) => min >= a && min < b));
}

/** Horaires en français : « tous les jours, 24 h/24 », « lun.–ven. 7 h–9 h, 16 h–19 h, sauf jours fériés ». */
export function hoursText(hours, raw) {
  if (!hours) return raw ? `horaires « ${raw} » (à vérifier)` : 'horaires non précisés (à vérifier)';
  const FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const hm = (m) => `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
  const parts = [];
  if (hours.always) parts.push('tous les jours, 24 h/24');
  for (const r of hours.rules) {
    const all = r.ranges.length === 1 && r.ranges[0][0] === 0 && r.ranges[0][1] === 1440;
    const days = r.days.size === 7 ? 'tous les jours' : [1, 2, 3, 4, 5, 6, 0].filter((d) => r.days.has(d)).map((d) => FR[d]).join(' ');
    parts.push(`${days}${all ? ', 24 h/24' : ` ${r.ranges.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(', ')}`}`);
  }
  let t = parts.join(' ; ');
  if (hours.holidaysOff) t += ', sauf jours fériés';
  if (hours.datesOff.length) t += `, sauf le ${hours.datesOff.map((d) => `${Number(d.slice(3))}/${Number(d.slice(0, 2))}`).join(', ')}`;
  return t;
}

// ───────── Données (data/zfe.json, écrit par tools/zfe-update.mjs) ─────────

const CRITAIR_SET = new Set(ZFE.ORDER);
const cleanCritair = (x) => (CRITAIR_SET.has(x) ? x : null);
const cleanText = (x, max = 200) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
/** Lien http(s) seulement (le texte vient d'un fichier de données : jamais de javascript:). */
export function safeUrl(x) {
  if (typeof x !== 'string') return null;
  try {
    const u = new URL(x.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

function bboxOfRings(rings) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

const isRing = (r) => Array.isArray(r) && r.length >= 4 && r.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));

function cleanRule(r) {
  const critair = cleanCritair(r?.critair);
  const raw = cleanText(r?.hours, 120);
  return { critair, hoursRaw: raw, hours: parseHours(raw) };
}

/**
 * Lit data/zfe.json. Zones : polygones (chaque polygone = [contour, trous…]) ; voies : lignes.
 * @returns {{ updated:string|null, zones:object[], voies:object[] }}
 */
export function parseZfeData(json) {
  const zones = [];
  const voies = [];
  for (const z of Array.isArray(json?.zones) ? json.zones : []) {
    const polygons = (Array.isArray(z?.polygons) ? z.polygons : [])
      .map((p) => (Array.isArray(p) ? p.filter(isRing) : []))
      .filter((p) => p.length);
    if (!polygons.length || !isDate(z.start)) continue;
    zones.push({
      id: cleanText(z.id, 80), name: cleanText(z.name, 120) || 'ZFE', start: z.start, end: isDate(z.end) ? z.end : null,
      pl: cleanRule(z.pl), vul: cleanRule(z.vul), url: safeUrl(z.url), info: safeUrl(z.info),
      polygons, bbox: bboxOfRings(polygons.map((p) => p[0])),
    });
  }
  for (const v of Array.isArray(json?.voies) ? json.voies : []) {
    const lines = (Array.isArray(v?.lines) ? v.lines : []).filter((l) => Array.isArray(l) && l.length >= 2 && l.every((p) => isNum(p?.[0]) && isNum(p?.[1])));
    if (!lines.length || !isDate(v.start)) continue;
    voies.push({
      start: v.start, end: isDate(v.end) ? v.end : null, pl: cleanRule(v.pl), vul: cleanRule(v.vul), url: safeUrl(v.url),
      lines, bbox: bboxOfRings(lines),
    });
  }
  return { updated: typeof json?.updated === 'string' ? json.updated : null, zones, voies };
}

/** Index par cases de 0,01° (≈ 1 km) des segments des tronçons spéciaux. */
function indexVoies(voies) {
  const grid = new Map();
  voies.forEach((v, vi) => {
    for (const line of v.lines) {
      for (let i = 0; i < line.length - 1; i += 1) {
        const [a, b] = [line[i], line[i + 1]];
        const x0 = Math.floor(Math.min(a[0], b[0]) * 100);
        const x1 = Math.floor(Math.max(a[0], b[0]) * 100);
        const y0 = Math.floor(Math.min(a[1], b[1]) * 100);
        const y1 = Math.floor(Math.max(a[1], b[1]) * 100);
        for (let x = x0; x <= x1; x += 1) {
          for (let y = y0; y <= y1; y += 1) {
            const k = `${x}:${y}`;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push([vi, a, b]);
          }
        }
      }
    }
  });
  return grid;
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point dans une zone (contour sans les trous) ? */
export function inZone(p, zone) {
  const [w, s, e, n] = zone.bbox;
  if (p[0] < w || p[0] > e || p[1] < s || p[1] > n) return false;
  return zone.polygons.some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h)));
}

function distToSegment(p, a, b) {
  const kx = Math.cos(p[1] * RAD) * 6371008.8 * RAD;
  const ky = 6371008.8 * RAD;
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - a[0]) * kx; const dy = (b[1] - a[1]) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inForce = (x, day) => x.start <= day && (!x.end || day <= x.end);

/**
 * Règle qui s'applique en un point à une date : tronçon spécial le plus récent (dans le fichier) qui passe à moins de
 * 20 m, sinon la zone en vigueur qui contient le point (la plus récente, puis la dernière du fichier).
 * @returns {{ zone:object|null, voie:object|null, rule:object }|null}
 */
function ruleAt(p, date, data, grid, category) {
  const day = dayOf(date);
  // Zones superposées : la plus récemment entrée en vigueur (étapes successives d'une même ZFE publiées chacune avec
  // leur date de début, ex. Aix-Marseille 2022 V5 puis 2023 V4, ou commune plus stricte dans une métropole), puis la
  // dernière du fichier (README du schéma : « on devra interpréter la dernière zone comme étant celle qui prime »).
  let zone = null;
  for (const z of data.zones) if (inForce(z, day) && inZone(p, z) && (!zone || z.start >= zone.start)) zone = z;
  if (!zone) return null;
  const k = `${Math.floor(p[0] * 100)}:${Math.floor(p[1] * 100)}`;
  let best = -1;
  for (const [vi, a, b] of grid.get(k) ?? []) {
    if (vi > best && inForce(data.voies[vi], day) && distToSegment(p, a, b) <= ZFE.VOIE_M) best = vi;
  }
  const voie = best >= 0 ? data.voies[best] : null;
  return { zone, voie, rule: (voie ?? zone)[category] };
}

/**
 * Passages de l'itinéraire dans les ZFE, d'après l'heure de passage estimée.
 * @param {object} route itinéraire (parseDirections)
 * @param {{ data:{zones,voies}, vehicle:object, departure?:Date, elapsed?:(t:number)=>number }} ctx elapsed : pauses comprises
 * @returns {{ id, name, enter:number, exit:number, time:Date, banned:boolean, critair:string|null,
 *   hours:object|null, hoursRaw:string, onVoie:boolean, url:string|null, zone:object }[]}
 *   enter / exit : distances depuis le départ (m) ; banned : interdit au véhicule pendant au moins une partie du
 *   passage (hors tronçons sans restriction) ; destination : le passage finit à l'arrivée
 */
export function zfeAlongRoute(route, { data, vehicle, departure = new Date(), elapsed = (t) => t }) {
  if (!data?.zones?.length) return [];
  data.grid ??= indexVoies(data.voies);
  const category = categoryOf(vehicle);
  const samples = sampleRoute(route, ZFE.SAMPLE_M);
  const out = [];
  let cur = null;
  const total = samples.length ? samples[samples.length - 1].along : 0;
  for (const sm of samples) {
    const date = new Date(departure.getTime() + elapsed(sm.time) * 1000);
    const hit = ruleAt(sm.lonlat, date, data, data.grid, category);
    if (!hit) { cur = null; continue; }
    const banned = bannedBy(hit.rule.critair, vehicle?.critair) && hoursActive(hit.rule.hours, date);
    // Sortie de moins de 1 km (tracé qui longe la limite) : même passage.
    const last = out[out.length - 1];
    if (!cur && last && last.zone === hit.zone && sm.along - last.exit <= ZFE.MERGE_GAP_M) cur = last;
    if (!cur || cur.zone !== hit.zone) {
      cur = {
        id: hit.zone.id, name: hit.zone.name, zone: hit.zone, enter: sm.along, exit: sm.along, time: date,
        banned: false, firstBanned: null, critair: hit.zone[category].critair, hours: hit.zone[category].hours,
        hoursRaw: hit.zone[category].hoursRaw, onVoie: false, url: hit.zone.url ?? hit.zone.info, destination: false,
      };
      out.push(cur);
    }
    cur.exit = sm.along;
    if (hit.voie) cur.onVoie = true;
    if (banned && !cur.banned) { cur.banned = true; cur.firstBanned = sm.along; cur.time = date; }
  }
  for (const p of out) p.destination = total - p.exit < ZFE.SAMPLE_M;
  return out;
}

// ───────── Éviter la ZFE (options.avoid_polygons d'ORS) ─────────

/** Découpe d'un contour par un rectangle (Sutherland-Hodgman ; contour concave : arêtes doubles sur le bord, sans gêne). */
function clipRing(ring, [w, s, e, n]) {
  const edges = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + (b[1] - a[1]) * (w - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + (b[1] - a[1]) * (e - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + (b[0] - a[0]) * (n - a[1]) / (b[1] - a[1]), n]],
  ];
  let pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  for (const [inside, cut] of edges) {
    const input = pts;
    pts = [];
    for (let i = 0; i < input.length; i += 1) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) pts.push(cut(prev, cur));
        pts.push(cur);
      } else if (inside(prev)) pts.push(cut(prev, cur));
    }
    if (!pts.length) return null;
  }
  if (pts.length < 3) return null;
  const r = pts.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
  r.push(r[0]);
  return r;
}

/** Simplification de Douglas-Peucker (tolérance en m). */
function simplify(points, tol) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1; let idx = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = points.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : points;
}

/** Étendue d'un contour (m) : largeur et hauteur. */
function extentM(ring) {
  const [w, s, e, n] = bboxOfRings([ring]);
  const mid = (s + n) / 2;
  return { width: haversine([w, mid], [e, mid]), height: haversine([w, s], [w, n]) };
}

/**
 * MultiPolygon GeoJSON à éviter pour ces zones, ou la raison pour laquelle ORS le refuserait.
 * @param {object[]} zones zones (passages interdits)
 * @param {{ start:number[], end:number[] }} trip
 * @returns {{ ok:true, geometry:object, tiles:number }|{ ok:false, reason:'distance'|'start'|'end'|'none', text:string }}
 */
export function avoidPolygonsFor(zones, { start, end }) {
  const list = (zones ?? []).filter(Boolean);
  if (!list.length) return { ok: false, reason: 'none', text: 'Aucune ZFE interdite sur cet itinéraire.' };
  if (haversine(start, end) > ZFE.AVOID_MAX_DISTANCE_M) {
    return {
      ok: false, reason: 'distance',
      text: 'Éviter la ZFE : impossible pour ce trajet. OpenRouteService (service gratuit) ne contourne une zone que si le départ et l\'arrivée sont à 150 km au plus à vol d\'oiseau. Ajoute une étape à moins de 150 km de la ZFE ou contourne-la par la signalisation.',
    };
  }
  for (const z of list) {
    if (inZone(start, z)) return { ok: false, reason: 'start', text: `Éviter la ZFE : impossible, le départ est dans la ZFE ${z.name}.` };
    if (inZone(end, z)) return { ok: false, reason: 'end', text: `Éviter la ZFE : impossible, l'arrivée est dans la ZFE ${z.name}. Vérifie les dérogations (livraisons) dans l'arrêté.` };
  }
  const polygons = [];
  const tile = ZFE.AVOID_TILE_M;
  for (const z of list) {
    for (const [outer] of z.polygons) {
      const ring = simplify(outer, 30);
      const { width, height } = extentM(ring);
      if (width <= tile && height <= tile) { polygons.push([ring.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])]); continue; }
      const [w, s, e, n] = bboxOfRings([ring]);
      const nx = Math.ceil(width / tile);
      const ny = Math.ceil(height / tile);
      for (let i = 0; i < nx; i += 1) {
        for (let j = 0; j < ny; j += 1) {
          const box = [w + ((e - w) * i) / nx, s + ((n - s) * j) / ny, w + ((e - w) * (i + 1)) / nx, s + ((n - s) * (j + 1)) / ny];
          const part = clipRing(ring, box);
          if (part) polygons.push([part]);
        }
      }
    }
  }
  return { ok: true, geometry: { type: 'MultiPolygon', coordinates: polygons }, tiles: polygons.length };
}

/**
 * Recalcul en guidage d'un itinéraire « Sans ZFE » : zones gardées seulement si la position et l'arrivée sont à
 * 150 km au plus à vol d'oiseau (limite de l'API publique d'ORS) ; sinon recalcul sans elles (l'alerte ZFE reste).
 */
export function avoidForReroute(avoidPolygons, from, end) {
  if (!avoidPolygons || !Array.isArray(from) || !Array.isArray(end)) return null;
  return haversine(from, end) <= ZFE.AVOID_MAX_DISTANCE_M ? avoidPolygons : null;
}

// ───────── Textes ─────────

const km = (m) => `km ${Math.round(m / 1000)}`;

/** Ligne de la fiche d'itinéraire pour un passage interdit. */
export function describeZfePassage(p, vehicle) {
  const own = critairCode(vehicle?.critair);
  const mine = own === 'NC' ? 'votre véhicule : non classé' : `votre véhicule : Crit'Air ${own === 'EL' ? '0' : own.slice(1)}`;
  const where = p.destination ? `arrivée dans la zone (${km(p.enter)})` : `${km(p.enter)} → ${km(p.exit)}`;
  return `ZFE ${p.name} interdite : ${thresholdText(p.critair)} (${categoryOf(vehicle) === 'pl' ? 'poids lourds' : 'utilitaires'}, ${hoursText(p.hours, p.hoursRaw)}) — ${mine}. ${where}.`;
}

/** Ligne de la fiche pour une ZFE traversée sans interdiction pour ce véhicule (à cette heure). */
export function describeZfeAllowed(p) {
  return `ZFE ${p.name} traversée : autorisée pour votre véhicule à l'heure prévue (${p.critair ? thresholdText(p.critair) : 'aucune restriction'}).`;
}

export function zfeAnnounceText(p, distance) {
  const d = distance >= 1000 ? `${Math.round(distance / 1000)} kilomètres` : `${Math.round(distance / 100) * 100} mètres`;
  return `Attention, zone à faibles émissions ${p.name} dans ${d}, interdite à votre véhicule.`;
}

/** Bandeau du guidage : « ZFE Métropole de Lyon dans 4,2 km : interdite ». */
export function zfeBannerText(p, distance) {
  const d = distance >= 1000 ? `${(Math.round(distance / 100) / 10).toString().replace('.', ',')} km` : `${Math.round(distance)} m`;
  return distance > 0 ? `ZFE ${p.name} dans ${d} : interdite à ce véhicule` : `Dans la ZFE ${p.name} : interdite à ce véhicule`;
}

/**
 * Guidage : prochaine ZFE interdite devant le véhicule, annonce une fois sous 5 km (pas sous 500 m).
 * @param {object[]} passages zfeAlongRoute (passages interdits seulement comptés)
 * @returns {{ view:{ name:string, distance:number, text:string }|null, speak:string|null, announced:object }}
 */
export function guidanceZfe(passages, along, announced = {}) {
  const next = (passages ?? []).find((p) => p.banned && p.exit >= along);
  if (!next) return { view: null, speak: null, announced };
  const at = next.firstBanned ?? next.enter;
  const distance = Math.max(0, at - along);
  if (distance > ZFE.BANNER_M) return { view: null, speak: null, announced };
  const key = `${next.id}:${Math.round(at)}`;
  let speak = null;
  const out = { ...announced };
  if (!out[key] && distance <= ZFE.ANNOUNCE_M && distance >= ZFE.ANNOUNCE_MIN_M) {
    out[key] = true;
    speak = zfeAnnounceText(next, distance);
  }
  return { view: { name: next.name, distance, text: zfeBannerText(next, distance) }, speak, announced: out };
}
