// Classe de route de chaque tronçon d'un itinéraire (phase 2g) : autoroute (A), nationale (N) ou autre
// (départementales, routes communales, inconnu), et part en km sur autoroute + nationale (« part A/N »).
// Logique pure. Les départementales cachent le plus de ponts bas et de limites de poids non référencés dans
// OpenStreetMap ; une autoroute ou une nationale peut aussi avoir une limite : la signalisation fait foi.
//
// Sources (doc ORS lue le 22/11/2026 sur raw.githubusercontent.com, GIScience/openrouteservice,
// docs/api-reference/endpoints/directions/extra-info/) — extras demandés dans la même requête (aucune de plus) :
// - waycategory (bits) : 1 = « Highway » = highway=motorway, motorway_link ; 2 = péage ; 4 = escaliers ; 8 = ferry ;
//   16 = gué. Seul critère fiable de l'autoroute.
// - waytype : 1 = « State Road » = primary, primary_link, motorway, motorway_link, trunk, trunk_link ; 2 = « Road »
//   (secondary, tertiary…) ; 3 = « Street »… En France, beaucoup de départementales sont « primary » : waytype seul
//   ne distingue pas une nationale d'une départementale.
// - osmid : non disponible pour driving-hgv.
// Nationale : waytype 1 ET référence « N » dans le nom de l'étape ORS (« name, ref » des étiquettes OSM, voir
// route-diagnostic.js). Étape sans nom ni référence : « inconnue », jamais comptée comme nationale (l'autoroute,
// lue par waycategory, reste comptée).

import { haversine } from './nav-geo.js';
import { roadRefs } from './route-samples.js';

export const ROUTE_PREF = Object.freeze({
  /** « Recommandé » : durée au plus 15 % au-dessus de l'itinéraire le plus rapide. */
  MAX_SLOWER_SHARE: 0.15,
  /** Au-delà de 30 % de km sans nom ni référence, la part A/N est inconnue (ordre d'ORS gardé). */
  MAX_UNKNOWN_SHARE: 0.30,
});

export const ROAD_CLASS = Object.freeze({ MOTORWAY: 'A', NATIONAL: 'N', OTHER: 'autre' });

const WAYCATEGORY_MOTORWAY = 1;
const WAYTYPE_STATE_ROAD = 1;

/** values [[début, fin, valeur]] d'un extra ORS, ou null s'il est absent ou illisible. */
function extraValues(extras, key) {
  const v = extras?.[key]?.values;
  if (!Array.isArray(v)) return null;
  for (const r of v) {
    if (!Array.isArray(r) || r.length < 3 || !Number.isInteger(r[0]) || !Number.isInteger(r[1])) return null;
  }
  return v.map((r) => [r[0], r[1], Number(r[2])]);
}

/**
 * Extras utiles à la classe de route, gardés dans l'itinéraire lu (parseFeature).
 * @returns {{ waycategory:number[][], waytype:number[][]|null }|null} null si waycategory est absent
 */
export function parseRoadExtras(extras) {
  const waycategory = extraValues(extras, 'waycategory');
  if (!waycategory) return null;
  return { waycategory, waytype: extraValues(extras, 'waytype') };
}

/** Valeur par tronçon (i → i+1) d'un extra, tableau de longueur n (null si non couvert). */
function perSegment(values, n) {
  const out = new Array(n).fill(null);
  for (const [from, to, value] of values ?? []) {
    for (let i = Math.max(0, from); i < to && i < n; i += 1) out[i] = value;
  }
  return out;
}

/** Étape sans nom ni référence lisible (ORS renvoie « - » ou rien). */
const stepUnnamed = (s) => {
  const named = typeof s?.name === 'string' && s.name.trim() !== '' && s.name.trim() !== '-';
  return !named && !roadRefs(s?.name).length;
};

/**
 * Tronçons (i → i+1) d'une étape sans nom ni référence ; un tronçon hors de toute étape compte comme sans nom.
 * @returns {boolean[]} longueur coordinates.length - 1
 */
export function unnamedSegments(route) {
  const n = Math.max(0, (route?.coordinates?.length ?? 0) - 1);
  const out = new Array(n).fill(true);
  for (const s of route?.steps ?? []) {
    if (!Array.isArray(s?.wayPoints)) continue;
    const u = stepUnnamed(s);
    for (let i = Math.max(0, s.wayPoints[0]); i < s.wayPoints[1] && i < n; i += 1) out[i] = u;
  }
  return out;
}

/**
 * Classe de chaque tronçon du tracé (i → i+1) et étape sans nom ni référence.
 * PR 3a : `geo` (repli par la géométrie, axis-match.js) donne la référence des tronçons sans nom ni référence, comme si
 * l'étape la portait (un tronçon nommé par ORS n'est jamais réécrit) ; l'autoroute reste lue par waycategory seul.
 * Sans `geo` : calcul d'origine (choix du « Recommandé », jamais le repli).
 * @param {{ coordinates:number[][], steps?:object[], roadExtras?:object|null }} route
 * @param {{ geo?:{ ref:(string|null)[] }|null }} [opts]
 * @returns {{ classes:string[], unknown:boolean[], fromGeo:boolean[] }|null} null si les extras manquent
 */
export function segmentClasses(route, { geo = null } = {}) {
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !route.roadExtras) return null;
  const n = coords.length - 1;
  const cat = perSegment(route.roadExtras.waycategory, n);
  const type = perSegment(route.roadExtras.waytype, n);
  const national = new Array(n).fill(false);
  const unknown = unnamedSegments(route);
  const fromGeo = new Array(n).fill(false);
  for (const s of route.steps ?? []) {
    if (!Array.isArray(s?.wayPoints)) continue;
    const isN = roadRefs(s.name).some((r) => /^N\d/.test(r));
    for (let i = Math.max(0, s.wayPoints[0]); i < s.wayPoints[1] && i < n; i += 1) national[i] = isN;
  }
  if (Array.isArray(geo?.ref)) {
    for (let i = 0; i < n; i += 1) {
      const r = geo.ref[i];
      if (!unknown[i] || typeof r !== 'string' || !r) continue;
      unknown[i] = false;
      fromGeo[i] = true;
      national[i] = r.split(';').some((x) => /^N\d/.test(x));
    }
  }
  const classes = new Array(n);
  for (let i = 0; i < n; i += 1) {
    if ((cat[i] ?? 0) & WAYCATEGORY_MOTORWAY) classes[i] = ROAD_CLASS.MOTORWAY;
    else if (type[i] === WAYTYPE_STATE_ROAD && national[i] && !unknown[i]) classes[i] = ROAD_CLASS.NATIONAL;
    else classes[i] = ROAD_CLASS.OTHER;
  }
  return { classes, unknown, fromGeo };
}

/**
 * Km par classe et part A/N d'un itinéraire.
 * @param {{ geo?:object|null }} [opts] repli par la géométrie (diagnostic seulement, jamais le « Recommandé »)
 * @returns {{ total:number, motorway:number, national:number, other:number, unknown:number, geo:number,
 *   share:number|null }|null}
 *   distances en m (geo : km retrouvés par la géométrie) ; share (0 à 1) null si plus de MAX_UNKNOWN_SHARE de km inconnus ; null si extras absents
 */
export function roadStats(route, { geo = null } = {}) {
  const seg = segmentClasses(route, { geo });
  if (!seg) return null;
  const c = route.coordinates;
  const out = { total: 0, motorway: 0, national: 0, other: 0, unknown: 0, geo: 0, share: null };
  for (let i = 0; i < seg.classes.length; i += 1) {
    const d = haversine(c[i], c[i + 1]);
    out.total += d;
    if (seg.unknown[i]) out.unknown += d;
    if (seg.fromGeo[i]) out.geo += d;
    if (seg.classes[i] === ROAD_CLASS.MOTORWAY) out.motorway += d;
    else if (seg.classes[i] === ROAD_CLASS.NATIONAL) out.national += d;
    else out.other += d;
  }
  if (out.total > 0 && out.unknown / out.total <= ROUTE_PREF.MAX_UNKNOWN_SHARE) {
    out.share = (out.motorway + out.national) / out.total;
  }
  return out;
}

/** Part A/N (0 à 1), ou null (extras absents, trop de km inconnus). */
export function anShare(route) {
  return roadStats(route)?.share ?? null;
}

/** Classe de la route au tronçon `index` du tracé (pour les ponts, phase 12a) ; null si inconnue. */
export function classAt(route, index, seg = segmentClasses(route)) {
  if (!seg || !Number.isInteger(index) || index < 0 || index >= seg.classes.length) return null;
  return seg.classes[index];
}

/** Part A/N en pourcentage entier (comparaisons et affichage). */
export const sharePercent = (share) => Math.round(share * 100);

/** Ligne de la fiche : « Autoroute et nationale : 82 % » (« inconnue » sans extras ou trop de km sans nom). */
export function anShareText(route) {
  const s = anShare(route);
  return `Autoroute et nationale : ${s === null ? 'inconnue' : `${sharePercent(s)} %`}`;
}

/**
 * Indice de l'itinéraire « Recommandé » parmi ceux déjà calculés : plus forte part A/N dont la durée ne dépasse pas
 * celle du plus rapide de plus de MAX_SLOWER_SHARE ; égalité (même pourcentage) → le plus rapide, puis l'ordre.
 * Péages hors calcul. Part inconnue du premier (préférence d'ORS) → 0 (ordre gardé) ; autres parts inconnues : écartées.
 * @param {{ route:{ duration:number } }[]} options
 */
export function pickRecommendedIndex(options, { excluded = null } = {}) {
  if (!Array.isArray(options) || !options.length) return 0;
  // Phase v43 : itinéraires écartés (tunnel interdit confirmé pour le profil) ; le choix se fait parmi les autres,
  // dans l'ordre d'ORS, avec les mêmes règles (15 % du plus rapide d'entre eux, part A/N). Tous écartés : 0.
  const allowed = options.map((_, i) => i).filter((i) => !excluded?.[i]);
  if (!allowed.length) return 0;
  const first = allowed[0];
  if (allowed.length < 2) return first;
  const shares = options.map((o) => anShare(o.route));
  if (shares[first] === null) return first;
  const fastest = Math.min(...allowed.map((i) => options[i].route.duration));
  const limit = fastest * (1 + ROUTE_PREF.MAX_SLOWER_SHARE);
  let best = -1;
  for (const i of allowed) {
    const o = options[i];
    if (shares[i] === null || o.route.duration > limit) continue;
    if (best < 0) { best = i; continue; }
    const a = sharePercent(shares[i]);
    const b = sharePercent(shares[best]);
    if (a > b || (a === b && o.route.duration < options[best].route.duration)) best = i;
  }
  return best < 0 ? first : best;
}

/**
 * Ligne du diagnostic du trajet : « Classes de route : A 52,1 km, N 10,0 km, autre 8,3 km, inconnus 0,0 km ; part A/N 88 % ».
 * PR 3a : avec `geo`, deuxième ligne avec le repli par la géométrie (le « Recommandé » ne le lit pas).
 */
export function roadStatsText(route, { geo = null } = {}) {
  const s = roadStats(route);
  if (!s) return 'Classes de route (waycategory, waytype) : absentes';
  const km = (m) => (m / 1000).toFixed(1).replace('.', ',');
  const shareText = (x) => (x.share === null ? `inconnue (plus de ${sharePercent(ROUTE_PREF.MAX_UNKNOWN_SHARE)} % de km sans nom ni référence)` : `${sharePercent(x.share)} %`);
  const base = `Classes de route : A ${km(s.motorway)} km, N ${km(s.national)} km, autre ${km(s.other)} km ; km inconnus (étapes sans nom ni référence) ${km(s.unknown)} km ; part A/N ${shareText(s)}`;
  if (!geo || geo.status !== 'ok') return base;
  const g = roadStats(route, { geo });
  return `${base}\nAvec le repli par la géométrie (à vérifier, choix du Recommandé inchangé) : A ${km(g.motorway)} km, N ${km(g.national)} km, autre ${km(g.other)} km ; km inconnus ${km(g.unknown)} km, dont ${km(g.geo)} km retrouvés ; part A/N ${shareText(g)}`;
}
