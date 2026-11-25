// « Contourner par la rocade Est » (v76) : Lyon seulement, sections lyon-a6 et lyon-a7 des points sensibles (PR 3b).
// Logique pure, sans DOM.
//
// Règle et sources (lues le 25/11/2026, texte des PDF, aucune OCR) :
// - Bison Futé, dépliant « interdictions » 2020 (bison-fute.gouv.fr/IMG/pdf/FR_12015-7_depliant_interdiction2020_
//   DEF_print.pdf), zone Sud-Est : « A7 et A6 (25 km) : interdites aux plus de 7,5 t entre Ternay (69) et Limonest
//   Dardilly (69) - sauf desserte locale. » ;
// - Assemblée nationale, question orale n° 146 (13e législature, M. Patrice Verchère, JO du 29/01/2008 p. 628, réponse
//   du 30/01/2008 p. 557) : « le trafic des poids lourds en transit sur l'axe nord-sud est détourné par la rocade est de
//   Lyon. Bien que ce détournement soit signalisé sur l'A6, à Anse, et sur l'A7, à Chasse-sur-Rhône… ». Phrase du
//   député, de 2008 (arrêtés depuis remplacés par DDT_SST_2019_01_02) : toujours « à vérifier ».
// - Desserte locale : contour IGN Admin Express COG 2026 de la Métropole de Lyon (data/contours-ign.json, clé
//   metropoleLyon, Licence Ouverte), choisi par le propriétaire ; départ, arrivée ou étape dedans → pas de bouton.
//
// Points de passage (jamais une coordonnée tapée : sommets des voies de data/axes-osm/, © contributeurs OSM, ODbL) :
// chaîne A46 (nord, vers Anse) → N346 (est) → A46 (sud, vers Ternay / Chasse), constatée dans la copie ; trois points :
// - P-nord : sommet d'une voie A46 à 3 km au moins de toute voie A6, le plus proche des points de lyon-a6 ;
// - P-milieu : sommet d'une voie N346, le plus à l'est ;
// - P-sud : sommet d'une voie A46 à 3 km au moins de toute voie A7, le plus proche des points de lyon-a7 ;
// chacun sur la chaussée du sens de marche : segment au cap ≤ 30° (modulo 180°) du sens voulu (sud ou nord) ET
// chaussée opposée de même référence trouvée à sa gauche (circulation à droite) ; sinon pas de bouton (ORS ferait un
// demi-tour). La copie met des voies bout à bout et peut les retourner : le sens de dessin n'est jamais lu.
// Ordre : nord→sud = [P-nord, P-milieu, P-sud] ; sud→nord = l'inverse.
//
// Jamais d'étape ajoutée sans appui ; à l'arrêt seulement ; rien dans le guidage ni la voix ; « à vérifier ».

import { inRing } from './hgv-tolls-geo.js';
import { STOPS } from './stops.js';
import { formatDuration } from './format.js';

export const LYON_BYPASS = Object.freeze({
  SECTIONS: Object.freeze(['lyon-a6', 'lyon-a7']),
  NORTH_REF: 'A46',
  MIDDLE_REF: 'N346',
  SOUTH_REF: 'A46',
  /** Écart minimum (m) entre P-nord et l'A6, entre P-sud et l'A7 (hors des échangeurs d'Anse et de Ternay). */
  JUNCTION_GAP_M: 3000,
  MAX_HEADING_DEG: 30,
  /** Chaussée opposée cherchée entre 8 et 80 m, parallèle (≤ 30°). */
  PARALLEL_MIN_M: 8,
  PARALLEL_MAX_M: 80,
  LONGER_SHARE: 0.30,
  LONGER_M: 60000,
  VIA_COUNT: 3,
  VIA_LABEL: 'Rocade Est (point de passage)',
  BUTTON_TEXT: '⛔ Contourner par la rocade Est',
  BUTTON_PARKED_TEXT: '⛔ Contourner par la rocade Est (à l\'arrêt)',
  BUSY_TEXT: 'Calcul du contournement…',
  PARKED_TEXT: 'Contourner par la rocade Est : disponible à l\'arrêt seulement (vitesse inconnue ou en mouvement).',
  OPTION_LABEL: 'Rocade Est',
  /** Contour de la Métropole de Lyon (Action « Contours IGN », clé metropoleLyon), lu à la demande. */
  CONTOUR_PATH: './data/contours-ign.json',
  ZONES_DROPPED_TEXT: 'Zones évitées (ZFE, restrictions) non envoyées : plus de 150 km à vol d\'oiseau avec les points de passage. À vérifier.',
});

export const LYON_RULE_TEXT = 'Lyon, A6 et A7 entre Limonest et Ternay : interdit aux plus de 7,5 t en transit, sauf desserte locale. '
  + 'À vérifier. La signalisation fait foi. Sources : Bison Futé, dépliant des interdictions 2020 ; arrêté DDT_SST_2019_01_02 '
  + '(préfet du Rhône, Métropole de Lyon) ; contournement par la rocade Est signalé à Anse (A6) et à Chasse-sur-Rhône (A7) '
  + 'selon la question n° 146 de l\'Assemblée nationale, JO du 29/01/2008 (à vérifier).';
export const LYON_REASON_TEXTS = Object.freeze({
  local: 'Départ, arrivée ou étape dans la Métropole de Lyon (contour IGN Admin Express) : desserte locale possible, aucun contournement proposé.',
  metro: 'Contour de la Métropole de Lyon non chargé : aucun contournement proposé.',
  points: 'Points de passage de la rocade Est introuvables dans la copie des axes OpenStreetMap (chaussée au bon cap) : aucun contournement proposé.',
  full: `Contournement par la rocade Est : 3 points de passage à ajouter. ${STOPS.FULL_TEXT}`,
  applied: 'Itinéraire par la rocade Est (3 points de passage). À vérifier. La signalisation fait foi.',
});
export const LYON_STILL_TEXT = 'Le contournement passe encore par une section interdite (Lyon, A6 ou A7). À vérifier. La signalisation fait foi.';

const RAD = Math.PI / 180;
const KY = 110540;
const kxAt = (lat) => Math.cos(lat * RAD) * 111320;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPt = (p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]);

/** Distance (m) en projection locale. */
function dist(a, b) {
  return Math.hypot((b[0] - a[0]) * kxAt((a[1] + b[1]) / 2), (b[1] - a[1]) * KY);
}
/** Cap (0–360) de a vers b. */
function heading(a, b) {
  const dx = (b[0] - a[0]) * kxAt((a[1] + b[1]) / 2); const dy = (b[1] - a[1]) * KY;
  return ((Math.atan2(dx, dy) / RAD) + 360) % 360;
}
/** Écart d'angle modulo 180° (0–90). */
function axisDiff(a, b) {
  const d = Math.abs(((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
}
/** Écart d'angle (0–180). */
function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

const hasRef = (line, ref) => (Array.isArray(line?.refs) ? line.refs.includes(ref) : String(line?.ref ?? '').split(';').includes(ref));

/** Segments [a, b, cap] des voies d'une référence. */
function segmentsOf(lines, ref) {
  const out = [];
  for (const l of lines) {
    if (!hasRef(l, ref) || !Array.isArray(l.coords)) continue;
    for (let i = 1; i < l.coords.length; i += 1) {
      const a = l.coords[i - 1]; const b = l.coords[i];
      if (isPt(a) && isPt(b) && dist(a, b) > 0) out.push({ a, b, h: heading(a, b) });
    }
  }
  return out;
}

/** Distance du point p au segment ab (m) et cap du segment. */
function toSegment(p, a, b) {
  const kx = kxAt(p[1]);
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * KY;
  const bx = (b[0] - p[0]) * kx; const by = (b[1] - p[1]) * KY;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return { dist: Math.hypot(ax + t * dx, ay + t * dy), x: ax + t * dx, y: ay + t * dy };
}

/**
 * Sommets possibles d'une référence pour un sens de marche (cap voulu `want` : 180 = vers le sud, 0 = vers le nord) :
 * segment au cap ≤ 30° modulo 180°, chaussée opposée (même référence, parallèle, 8 à 80 m) à gauche du sens de marche.
 * @returns {number[][]} sommets [lon, lat]
 */
export function carriagewayPoints(lines, ref, want) {
  const segs = segmentsOf(lines ?? [], ref);
  const out = [];
  for (const s of segs) {
    if (axisDiff(s.h, want) > LYON_BYPASS.MAX_HEADING_DEG) continue;
    const travel = angleDiff(s.h, want) <= 90 ? s.h : (s.h + 180) % 360; // sens de marche le long du segment
    const p = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    let opposite = null;
    for (const o of segs) {
      if (o === s || axisDiff(o.h, s.h) > LYON_BYPASS.MAX_HEADING_DEG) continue;
      const r = toSegment(p, o.a, o.b);
      if (r.dist < LYON_BYPASS.PARALLEL_MIN_M || r.dist > LYON_BYPASS.PARALLEL_MAX_M) continue;
      if (!opposite || r.dist < opposite.dist) opposite = r;
    }
    if (!opposite) continue;
    const tx = Math.sin(travel * RAD); const ty = Math.cos(travel * RAD);
    const cross = tx * opposite.y - ty * opposite.x; // > 0 : chaussée opposée à gauche
    if (cross > 0) out.push(s.a);
  }
  return out;
}

/** Points des sections lyon-a6 / lyon-a7 de la copie des points sensibles (pour s'en rapprocher). */
function sectionPoints(sensitive, id) {
  const sections = sensitive?.meta?.sections ?? [];
  const idx = sections.findIndex((s) => s?.id === id);
  if (idx < 0) return [];
  return (sensitive?.data?.points ?? []).filter((p) => p.section === idx && isPt(p.point)).map((p) => p.point);
}

const farFrom = (p, segs, m) => segs.every((s) => toSegment(p, s.a, s.b).dist >= m);
function nearest(cands, targets) {
  let best = null; let bd = Infinity;
  for (const c of cands) {
    for (const t of targets) {
      const d = dist(c, t);
      if (d < bd) { bd = d; best = c; }
    }
  }
  return best;
}

/**
 * Les trois points de passage pour un sens (`dir` : 'south' = nord→sud, 'north' = sud→nord), dans l'ordre de marche ;
 * null si l'un manque ou si l'ordre de la chaîne n'est pas vérifié (point milieu plus à l'est que les deux autres).
 */
export function rocadePoints(lines, sensitive, dir) {
  const want = dir === 'south' ? 180 : 0;
  const a6 = sectionPoints(sensitive, 'lyon-a6');
  const a7 = sectionPoints(sensitive, 'lyon-a7');
  if (!a6.length || !a7.length) return null;
  const segA6 = segmentsOf(lines, 'A6');
  const segA7 = segmentsOf(lines, 'A7');
  const north = nearest(carriagewayPoints(lines, LYON_BYPASS.NORTH_REF, want)
    .filter((p) => farFrom(p, segA6, LYON_BYPASS.JUNCTION_GAP_M)), a6);
  const south = nearest(carriagewayPoints(lines, LYON_BYPASS.SOUTH_REF, want)
    .filter((p) => farFrom(p, segA7, LYON_BYPASS.JUNCTION_GAP_M)), a7);
  const mids = carriagewayPoints(lines, LYON_BYPASS.MIDDLE_REF, want);
  let middle = null;
  for (const p of mids) if (!middle || p[0] > middle[0]) middle = p;
  if (!north || !south || !middle || north === south) return null;
  if (!(middle[0] > north[0] && middle[0] > south[0])) return null;
  const chain = [north, middle, south];
  return dir === 'south' ? chain : chain.reverse();
}

const viaStop = (p) => ({ label: LYON_BYPASS.VIA_LABEL, lon: p[0], lat: p[1], via: true });

/** Un point dans le contour (anneaux extérieurs) ? */
export function inMetro(p, rings) {
  return isPt(p) && Array.isArray(rings) && rings.some((r) => Array.isArray(r) && r.length >= 4 && inRing(p, r));
}

/**
 * Plan du contournement pour un itinéraire.
 * @param {object} route itinéraire (parseDirections)
 * @param {{ items:object[], sensitive:object|null, axes:object|null, metro:{ status:string, rings:number[][][]|null }|null,
 *   start:number[]|null, end:number[]|null, stops:object[] }} ctx items : points sensibles concernés par le profil
 *   (sensitiveRules, déjà filtrés par concernsVehicle) ; sensitive / axes : copies lues (createTileCopy)
 * @returns {{ concerned:boolean, ok:boolean, applied:boolean, reason:string|null, dir:string|null, via:object[],
 *   lines:{ level:string, text:string }[] }}
 */
export function lyonBypassPlan(route, {
  items = [], sensitive = null, axes = null, metro = null, start = null, end = null, stops = [],
} = {}) {
  const out = { concerned: false, ok: false, applied: false, reason: null, dir: null, via: [], lines: [] };
  const sections = sensitive?.meta?.sections ?? [];
  const hits = (items ?? [])
    .map((it) => ({ id: sections[it.section]?.id, along: it.along }))
    .filter((h) => LYON_BYPASS.SECTIONS.includes(h.id));
  const list = Array.isArray(stops) ? stops : [];
  const applied = list.some((s) => s?.via === true);
  if (!hits.length) {
    if (applied) out.lines.push({ level: 'info', text: LYON_REASON_TEXTS.applied });
    out.applied = applied;
    return out;
  }
  out.concerned = true;
  out.applied = applied;
  const a6 = hits.find((h) => h.id === 'lyon-a6');
  const a7 = hits.find((h) => h.id === 'lyon-a7');
  const coords = route?.coordinates ?? [];
  const from = isPt(start) ? start : coords[0];
  const to = isPt(end) ? end : coords.at(-1);
  if (a6 && a7) out.dir = a6.along < a7.along ? 'south' : 'north';
  else if (isPt(from) && isPt(to)) out.dir = from[1] > to[1] ? 'south' : 'north';
  const fail = (reason) => {
    out.reason = reason;
    out.lines.push({ level: 'warn', text: `${LYON_RULE_TEXT} ${LYON_REASON_TEXTS[reason]}` });
    return out;
  };
  if (applied) return fail('applied');
  if (metro?.status !== 'ok' || !Array.isArray(metro.rings) || !metro.rings.length) return fail('metro');
  const own = [from, to, ...list.filter((s) => s?.via !== true).map((s) => [s.lon, s.lat])];
  if (own.some((p) => inMetro(p, metro.rings))) return fail('local');
  if (list.length + LYON_BYPASS.VIA_COUNT > STOPS.MAX) return fail('full');
  if (axes?.status !== 'ok' || !out.dir) return fail('points');
  const pts = rocadePoints(axes.data?.lines ?? [], sensitive, out.dir);
  if (!pts) return fail('points');
  out.ok = true;
  out.via = pts.map(viaStop);
  out.lines.push({ level: 'warn', text: LYON_RULE_TEXT });
  return out;
}

/**
 * Étapes du contournement : les trois points rangés parmi les étapes de l'utilisateur selon leur place sur le tracé
 * (même règle que insertStopByRoute : ordre du tracé), toujours dans l'ordre de marche entre eux.
 */
export function withBypassStops(stops, via, alongOf) {
  const list = (Array.isArray(stops) ? stops : []).filter((s) => s?.via !== true);
  const at = list.map((s) => alongOf([s.lon, s.lat]));
  const first = alongOf([via[0].lon, via[0].lat]);
  let i = at.findIndex((a) => a > first);
  if (i < 0) i = list.length;
  return [...list.slice(0, i), ...via, ...list.slice(i)];
}

/**
 * Écart du contournement : « Allonge de X km / Y min » si la durée dépasse de plus de 30 % ou la distance de plus de
 * 60 km celles de l'itinéraire de départ ; sinon null.
 */
export function bypassCost(orig, alt) {
  if (!isNum(orig?.duration) || !isNum(alt?.duration) || !isNum(orig?.distance) || !isNum(alt?.distance)) return null;
  const dd = alt.distance - orig.distance;
  const dt = alt.duration - orig.duration;
  const longer = (orig.duration > 0 && dt > orig.duration * LYON_BYPASS.LONGER_SHARE) || dd > LYON_BYPASS.LONGER_M;
  if (!longer) return null;
  return { distance: dd, duration: dt, text: `Allonge de ${Math.round(Math.max(0, dd) / 1000)} km / ${formatDuration(Math.max(0, dt))} par rapport à l'itinéraire de départ. À vérifier.` };
}

/** Note de la fiche « Rocade Est ». */
export function bypassNote(cost) {
  return [LYON_REASON_TEXTS.applied, cost?.text].filter(Boolean).join(' ');
}
