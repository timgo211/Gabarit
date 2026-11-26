// Contournement automatique par tronçons (v79, PR C du plan « contournement automatique des interdictions ») :
// interdictions connues hors Lyon (route-bans.js) sur le Recommandé. Logique pure, sans DOM ni réseau (requêtes
// injectées par app.js), testée sous Node.
//
// Limites de l'API publique d'ORS (lues le 25/11/2026) :
// - page « restrictions » (openrouteservice.org/restrictions → giscience.github.io/openrouteservice/
//   hosted-api-restrictions) : « Distance (with avoid areas) 150 km », « Avoid polygon area 200 km² », « Avoid polygon
//   extent (height or width) 20 km », « Route waypoints 50 » ;
// - ors-api, RoutingService.java, calculateTotalDistance : distance = somme des distances à vol d'oiseau entre points
//   successifs (jamais la longueur de la route) ; ApiService.java, validateAreaLimits : aire et étendue contrôlées
//   polygone par polygone.
//
// Méthode (un seul tronçon avec zone évitée par interdiction, jamais de découpage tous les 150 km) :
// 1. sur le tracé du Recommandé, entrée et sortie de la section (points de la copie à 15 m, cap ≤ 30°) ;
// 2. A = 15 km avant l'entrée, B = 15 km après la sortie, pris sur ce tracé (bon sens de marche par construction ;
//    départ / arrivée s'ils sont plus près) ; A → B doit faire 150 km au plus à vol d'oiseau ;
// 3. une requête A → B avec un carré de 80 m sur chaque point de la section (≈ 0,006 km² chacun, très loin des
//    200 km² / 20 km) ;
// 4. points de passage pris au milieu du détour de ce tronçon (sommets à plus de 200 m du tracé initial, à 2 km au
//    moins de la section) : 1, ou 2 pour un détour de plus de 20 km ; A et B ne sont jamais gardés ;
// 5. requête finale départ → arrivée avec ces points de passage, sans zone ajoutée (donc sans limite de 150 km) : un
//    seul tracé d'ORS (étapes, durées, extras cohérents), aucun raccord cousu à la main ;
// 6. points sensibles relancés sur le tracé final : la section encore là, ou un demi-tour (consigne ORS type 9) à
//    1 km d'un point de passage → échec, jamais proposé. Le recalcul en guidage garde les points de passage (`via`).
// Demi-tour au départ de A : sans effet sur le tracé final (A n'y est pas). `continue_straight` d'ORS : non envoyé
// (effet sur driving-hgv non vérifié).

import { sensitivePointsAlongRoute, sensitiveRules, SENSITIVE } from './sensitive-points.js';
import { squareAround } from './adr.js';
import { pointAt, routeBans } from './route-bans.js';
import { STOPS } from './stops.js';
import { crowPath } from './stops.js';
import { prepareLine, locateOnLine } from './nav-geo.js';
import { formatDuration, formatDistanceDelta, formatDurationDelta } from './format.js';

export const DETOUR = Object.freeze({
  CUT_M: 15000,
  EDGE_M: 2000,
  SQUARE_M: 80,
  OFF_ROUTE_M: 200,
  VIA_GAP_M: 2000,
  LONG_DETOUR_M: 20000,
  UTURN_NEAR_M: 1000,
  UTURN_TYPE: 9, // ORS : consigne « demi-tour »
  LOOP_NEAR_M: 150,
  LOOP_GAP_M: 2000,
  LOOP_STEP_M: 50,
  MAX_CROW_M: 150000,
  VIA_LABEL: 'Contournement (point de passage)',
  OPTION_KEY: 'detour',
  PENDING_TEXT: 'Calcul du contournement de l\'interdiction…',
  FAIL_REASONS: Object.freeze({
    span: 'section introuvable sur le tracé',
    far: 'tronçon de plus de 150 km à vol d\'oiseau (limite d\'OpenRouteService avec zone évitée)',
    request: 'calcul impossible',
    nodetour: 'aucun détour trouvé autour de la section',
    full: 'trop d\'étapes pour ajouter les points de passage',
    still: 'le contournement passe encore par la section',
    uturn: 'demi-tour à un point de passage',
  }),
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPt = (p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]);
const RAD = Math.PI / 180;
const KY = 110540;
const kxAt = (lat) => Math.cos(lat * RAD) * 111320;
const dist = (a, b) => Math.hypot((b[0] - a[0]) * kxAt((a[1] + b[1]) / 2), (b[1] - a[1]) * KY);

/** Points de la copie d'une section (par son identifiant). */
export function sectionPoints(copy, id) {
  const si = (copy?.meta?.sections ?? []).findIndex((s) => s?.id === id);
  if (si < 0) return [];
  return (copy?.data?.points ?? []).filter((p) => p.section === si && isPt(p.point));
}

/** Entrée et sortie (m depuis le départ) de la section sur le tracé, ou null. */
export function sectionSpan(route, points, { geo = null } = {}) {
  // Chaque point compté à part (le regroupement par section n'en garderait qu'un).
  const one = points.map((p) => ({ ...p, type: SENSITIVE.TYPES.TUNNEL, section: -1 }));
  const hits = sensitivePointsAlongRoute(route, { points: one }, { geo });
  if (!hits.length) return null;
  return { from: hits[0].along, to: hits[hits.length - 1].along };
}

/** Longueur du tracé (m). */
function lengthOf(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i += 1) d += dist(coords[i - 1], coords[i]);
  return d;
}

/** Points A et B du tronçon : 15 km avant et après la section, ou départ / arrivée s'ils sont plus près. */
export function cutPoints(route, span) {
  const c = route?.coordinates;
  if (!Array.isArray(c) || c.length < 2 || !span) return null;
  const total = lengthOf(c);
  const aAt = span.from - DETOUR.CUT_M;
  const bAt = span.to + DETOUR.CUT_M;
  const a = aAt <= DETOUR.EDGE_M ? c[0] : pointAt(c, aAt);
  const b = bAt >= total - DETOUR.EDGE_M ? c[c.length - 1] : pointAt(c, bAt);
  if (!isPt(a) || !isPt(b)) return null;
  return { a, b, crow: crowPath([a, b]) };
}

/** Zone à éviter : un carré de 80 m sur chaque point de la section (MultiPolygon GeoJSON). */
export function sectionSquares(points) {
  return { type: 'MultiPolygon', coordinates: points.map((p) => [squareAround(p.point, DETOUR.SQUARE_M)]) };
}

/**
 * Points de passage du détour : sommets du tronçon à plus de 200 m du tracé initial, plus longue suite, à 2 km au
 * moins de tout point de la section ; milieu (1 point) ou tiers (2 points au-delà de 20 km de détour).
 * @returns {number[][]} points [lon, lat], dans l'ordre de marche
 */
export function detourVias(initial, leg, points) {
  const lc = leg?.coordinates;
  if (!Array.isArray(lc) || lc.length < 2 || !Array.isArray(initial?.coordinates) || initial.coordinates.length < 2) return [];
  const line = prepareLine(initial.coordinates);
  const off = lc.map((p) => locateOnLine(line, p).distance > DETOUR.OFF_ROUTE_M);
  let best = null; let start = -1;
  for (let i = 0; i <= lc.length; i += 1) {
    if (i < lc.length && off[i]) { if (start < 0) start = i; continue; }
    if (start >= 0) {
      const run = lc.slice(start, i);
      const len = lengthOf(run);
      if (!best || len > best.len) best = { run, len };
      start = -1;
    }
  }
  if (!best || best.run.length < 1) return [];
  const cum = [0];
  for (let i = 1; i < best.run.length; i += 1) cum.push(cum[i - 1] + dist(best.run[i - 1], best.run[i]));
  const at = (f) => best.run[Math.max(0, cum.findIndex((x) => x >= cum[cum.length - 1] * f))];
  const picks = best.len > DETOUR.LONG_DETOUR_M ? [at(1 / 3), at(2 / 3)] : [at(0.5)];
  const sec = points.map((p) => p.point);
  return picks.filter((p, i, all) => isPt(p) && all.indexOf(p) === i && sec.every((q) => dist(p, q) >= DETOUR.VIA_GAP_M));
}

/**
 * Demi-tour à un point de passage : consigne ORS type 9 à 1 km, ou boucle (le tracé repasse à 150 m du point après
 * s'en être éloigné de plus de 2 km le long du tracé : point accroché sur l'autre chaussée, demi-tour par un échangeur
 * sans consigne 9).
 */
export function uturnNear(route, vias) {
  const c = route?.coordinates ?? [];
  for (const st of route?.steps ?? []) {
    if (st?.type !== DETOUR.UTURN_TYPE || !st.wayPoints) continue;
    const p = c[st.wayPoints[0]];
    if (isPt(p) && vias.some((v) => dist(p, [v.lon, v.lat]) <= DETOUR.UTURN_NEAR_M)) return true;
  }
  return vias.some((v) => passesTwice(c, [v.lon, v.lat]));
}

/** Le tracé passe-t-il deux fois près du point (à 150 m, passages séparés de plus de 2 km le long du tracé) ? */
export function passesTwice(coords, p) {
  if (!Array.isArray(coords) || coords.length < 2 || !isPt(p)) return false;
  let cum = 0; let first = null;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]; const b = coords[i];
    const d = dist(a, b);
    const n = Math.max(1, Math.ceil(d / DETOUR.LOOP_STEP_M));
    for (let k = 0; k <= n; k += 1) {
      const t = k / n;
      const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      if (dist(q, p) > DETOUR.LOOP_NEAR_M) continue;
      const at = cum + t * d;
      if (first === null) first = at; else if (at - first > DETOUR.LOOP_GAP_M) return true;
    }
    cum += d;
  }
  return false;
}

const viaStop = (p) => ({ label: DETOUR.VIA_LABEL, lon: p[0], lat: p[1], via: true });

/**
 * Étapes du trajet final : étapes de la fiche (points `via` de la rocade compris) + points du détour, rangés selon leur
 * place sur le tracé initial (alongOf).
 */
export function withDetourStops(stops, vias, alongOf) {
  const list = Array.isArray(stops) ? [...stops] : [];
  for (const p of vias) {
    const s = viaStop(p);
    const at = alongOf(p);
    const i = list.findIndex((x) => alongOf([x.lon, x.lat]) > at);
    if (i < 0) list.push(s); else list.splice(i, 0, s);
  }
  return list;
}

/**
 * Tronçons à demander pour les interdictions actives du Recommandé.
 * @returns {{ ok:true, legs:{ id:string, a:number[], b:number[], avoid:object, points:object[] }[] }|{ ok:false, id:string, reason:string }}
 */
export function detourLegs(route, bans, copy, { geo = null } = {}) {
  const legs = [];
  for (const b of bans ?? []) {
    const points = sectionPoints(copy, b.id);
    const span = points.length ? sectionSpan(route, points, { geo }) : null;
    if (!span) return { ok: false, id: b.id, reason: 'span' };
    const cut = cutPoints(route, span);
    if (!cut) return { ok: false, id: b.id, reason: 'span' };
    if (cut.crow > DETOUR.MAX_CROW_M) return { ok: false, id: b.id, reason: 'far' };
    legs.push({ id: b.id, a: cut.a, b: cut.b, avoid: sectionSquares(points), points });
  }
  return { ok: true, legs };
}

/** Écart avec le trajet direct (toujours affiché, sans seuil). */
export function detourCost(orig, alt) {
  if (!isNum(orig?.duration) || !isNum(alt?.duration) || !isNum(orig?.distance) || !isNum(alt?.distance)) return '';
  const dd = alt.distance - orig.distance;
  const dt = alt.duration - orig.duration;
  return dd >= 0 && dt >= 0
    ? `Allonge de ${Math.round(dd / 1000)} km / ${formatDuration(dt)} par rapport au trajet direct.`
    : `Écart avec le trajet direct : ${formatDistanceDelta(dd)}, ${formatDurationDelta(dt)}.`;
}

/** Note de la fiche « Recommandé » du contournement. */
export function detourNote(bans, cost, extra = '') {
  const names = bans.map((b) => b.label).join(' ; ');
  const sources = [...new Set(bans.map((b) => b.source))].join(' ');
  return [`Contournement appliqué : ${names} (interdiction connue, évitée). À vérifier. La signalisation fait foi. ${sources}`, cost, extra]
    .filter(Boolean).join(' ');
}

/** Raison courte d'un échec (fiche rouge). */
export function detourFailText(reason) {
  return `Contournement automatique impossible : ${DETOUR.FAIL_REASONS[reason] ?? DETOUR.FAIL_REASONS.request}.`;
}

/**
 * Contournement complet (requêtes injectées) : un tronçon par interdiction (fetchLeg(a, b, avoid)), puis le trajet
 * final (fetchFinal(stops)) ; vérifications : section encore traversée, demi-tour à un point de passage.
 * @param {{ route:object, bans:object[], copy:object, vehicle:object, stops:object[], geo?:object|null,
 *   fetchLeg:(a:number[], b:number[], avoid:object)=>Promise<object>, fetchFinal:(stops:object[])=>Promise<object> }} p
 * @returns {Promise<{ ok:true, route:object, stops:object[], requests:number }|{ ok:false, reason:string, requests:number, error?:Error }>}
 */
export async function planDetour({ route, bans, copy, vehicle, stops = [], geo = null, fetchLeg, fetchFinal }) {
  let requests = 0;
  const plan = detourLegs(route, bans, copy, { geo });
  if (!plan.ok) return { ok: false, reason: plan.reason, requests };
  const vias = [];
  for (const leg of plan.legs) {
    let legRoute;
    try { requests += 1; legRoute = await fetchLeg(leg.a, leg.b, leg.avoid); } catch (error) { return { ok: false, reason: 'request', requests, error }; }
    const found = detourVias(route, legRoute, leg.points);
    if (!found.length) return { ok: false, reason: 'nodetour', requests };
    vias.push(...found);
  }
  let line = null;
  try { line = prepareLine(route.coordinates); } catch { line = null; }
  const alongOf = (p) => (line ? locateOnLine(line, p).along : 0);
  const list = withDetourStops(stops, vias, alongOf);
  if (list.length > STOPS.MAX) return { ok: false, reason: 'full', requests };
  let final;
  try { requests += 1; final = await fetchFinal(list); } catch (error) { return { ok: false, reason: 'request', requests, error }; }
  const ids = new Set(bans.map((b) => b.id));
  const again = routeBans(final, sensitiveRules(final, { vehicle, copy }).items, copy?.meta?.sections ?? [], { vehicle });
  if (again.some((b) => ids.has(b.id))) return { ok: false, reason: 'still', requests };
  if (uturnNear(final, list.filter((s) => s.via === true && s.label === DETOUR.VIA_LABEL))) return { ok: false, reason: 'uturn', requests };
  return { ok: true, route: final, stops: list, requests };
}

/** États gardés par la mémoire v53 (`choice.banAuto`) ; 'pending' jamais gardé (refait à la reprise). */
export const DETOUR_STATES = Object.freeze(['done', 'failed', 'declared', 'off']);

/**
 * Zone évitée du tronçon : carrés de la section + zones déjà évitées par la fiche (ZFE, tunnel, desserte), en un seul
 * MultiPolygon (le tronçon A → B reste sous 150 km à vol d'oiseau).
 */
export function legAvoid(squares, had) {
  const extra = had?.type === 'Polygon' ? [had.coordinates] : had?.type === 'MultiPolygon' ? had.coordinates : [];
  return { type: 'MultiPolygon', coordinates: [...squares.coordinates, ...extra] };
}

/** Fiche « Recommandé » du contournement (clé `detour`, ses étapes, interdictions évitées pour la question desserte). */
export function detourOption(option, route, stops, note, bans, label = 'Recommandé') {
  return {
    key: DETOUR.OPTION_KEY, label, note, also: ['Contournement'], route, request: { ...option.request }, stops, auto: true,
    avoided: bans.map((b) => ({ id: b.id, label: b.label, local: b.local, source: b.source })),
  };
}

/**
 * Remplacement : contournement en tête, fiches qui passent par une interdiction contournée retirées (rocade de Lyon
 * comprise si elle y passe), les autres gardées. Fiche choisie retirée → contournement choisi (`replaced` si le
 * chauffeur l'avait touchée).
 */
export function applyDetour({ options, crosses, detour, selected = 0, manual = false }) {
  const list = Array.isArray(options) ? options : [];
  const keep = list.map((o, i) => !crosses?.[i] && o?.key !== DETOUR.OPTION_KEY);
  const out = [detour, ...list.filter((_, i) => keep[i])];
  const was = list[selected];
  if (was && keep[selected]) return { options: out, selected: out.indexOf(was), replaced: false, hidden: list.filter((_, i) => !keep[i]) };
  return { options: out, selected: 0, replaced: !!manual && !!was, hidden: list.filter((_, i) => !keep[i]) };
}

/** Desserte déclarée (« Oui ») pour toutes les zones contournées à desserte possible : trajet direct à remettre. */
export function allDeclared(avoided, answers) {
  const list = Array.isArray(avoided) ? avoided : [];
  return list.length > 0 && list.every((b) => b.local && answers?.[b.id] === true);
}
