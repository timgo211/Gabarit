// Itinéraires alternatifs (phase 2b) : quelles requêtes envoyer, noms, doublons, écarts avec le Recommandé,
// contenu des fiches, choix du tracé touché sur la carte. Logique pure : l'envoi des requêtes est injecté (send),
// aucun appel réseau ici.
//
// Doc ORS (GIScience/openrouteservice, lue sur raw.githubusercontent.com ; limites aussi dans config.js) :
// - alternative_routes = { target_count, weight_factor (1,4 par défaut), share_factor (0,6 par défaut) }
//   (ors-api/.../requests/routing/RouteRequestAlternativeRoutes.java), target_count ≤ 3, 2 points seulement ;
// - au-delà de 100 km à vol d'oiseau entre départ et arrivée, ORS refuse alternative_routes (erreur 2004) ;
// - preference = fastest | shortest | recommended (défaut).
// Quota gratuit HeiGIT : 2 000 itinéraires/jour, 40/min → au plus 3 requêtes par calcul.
//
// Déroulé d'un calcul :
// 1. Recommandé (préférence par défaut d'ORS), avec alternative_routes si le trajet fait 100 km ou moins à vol d'oiseau ;
// 2. si ORS ne renvoie qu'un itinéraire : variantes « Plus court » et « Sans péage » en parallèle
//    (« Plus rapide » à la place de « Sans péage » quand les péages sont déjà évités ou que le Recommandé n'en a pas) ;
// 3. doublons (tracés quasi identiques) supprimés ; le Recommandé reste toujours la référence des écarts.

import { buildDirectionsRequest } from './ors-request.js';
import { parseAllDirections, haversine, NoRouteError, fuelEstimate, fuelCost, bboxOf } from './ors-response.js';
import { ERROR_KINDS } from './ors-errors.js';
import { ORS_MAX_ALTERNATIVE_ROUTES, ORS_ALTERNATIVE_ROUTES_MAX_DISTANCE_M } from './config.js';
import {
  formatDistance, formatDuration, formatArrival, formatDurationDelta, formatDistanceDelta, formatEuros,
} from './format.js';

export const ROUTE_OPTIONS = Object.freeze({
  /** Itinéraires demandés à alternative_routes (principal compris). */
  TARGET_COUNT: ORS_MAX_ALTERNATIVE_ROUTES,
  /** alternative_routes seulement jusqu'à cette distance à vol d'oiseau (m). */
  ALTERNATIVES_MAX_CROW_M: ORS_ALTERNATIVE_ROUTES_MAX_DISTANCE_M,
  /** Requêtes ORS au plus par calcul (quota gratuit). */
  MAX_REQUESTS: 3,
  /** Quasi identiques : moins de 2 % de chaque tracé hors de l'autre… */
  DUPLICATE_MAX_DIFF_SHARE: 0.02,
  /** …et au plus 1 km d'écart de péage (sinon le choix compte pour le portefeuille). */
  DUPLICATE_MAX_TOLL_DIFF_M: 1000,
  /** En dessous, « Sans péage » ne servirait à rien : le Recommandé n'a pas de péage. */
  NO_TOLL_M: 50,
});

/** Variantes : réglages de la requête (et du recalcul en guidage) et nom affiché. */
export const VARIANTS = Object.freeze({
  recommended: Object.freeze({ key: 'recommended', label: 'Recommandé' }),
  alternative: Object.freeze({ key: 'alternative', label: 'Alternative' }), // renommée « Alternative 2 », « 3 »…
  shortest: Object.freeze({
    key: 'shortest', label: 'Plus court', preference: 'shortest', note: 'Peut emprunter des routes secondaires',
  }),
  noToll: Object.freeze({ key: 'no-toll', label: 'Sans péage', avoidTolls: true }),
  fastest: Object.freeze({ key: 'fastest', label: 'Plus rapide', preference: 'fastest' }),
});

/**
 * Échecs du Recommandé avec alternative_routes qui justifient de le redemander sans : limite de distance (2004),
 * paramètre refusé, erreur du serveur. Clé, quota, réseau, aucun itinéraire : inutile d'insister.
 */
const ALTERNATIVES_FALLBACK_KINDS = new Set([
  ERROR_KINDS.TOO_FAR, ERROR_KINDS.BAD_REQUEST, ERROR_KINDS.SERVER, ERROR_KINDS.UNKNOWN,
]);

/** Raison courte d'une variante non calculée (affichée discrètement sous les fiches). */
const FAILURE_REASONS = {
  [ERROR_KINDS.DAILY_QUOTA]: 'quota du jour atteint',
  [ERROR_KINDS.KEY_OR_QUOTA]: 'quota du jour atteint', // la clé vient de marcher pour le Recommandé
  [ERROR_KINDS.QUOTA]: 'trop de demandes en une minute',
  [ERROR_KINDS.NO_ROUTE]: 'aucun itinéraire autorisé pour ce gabarit',
  [ERROR_KINDS.TIMEOUT]: 'délai dépassé',
  [ERROR_KINDS.OFFLINE]: 'pas de réseau',
  [ERROR_KINDS.NETWORK]: 'service injoignable',
};

/** Type d'erreur (ERROR_KINDS) d'un échec de requête ou de lecture. */
export function errorKind(err) {
  if (err instanceof NoRouteError) return ERROR_KINDS.NO_ROUTE;
  return typeof err?.kind === 'string' ? err.kind : ERROR_KINDS.UNKNOWN;
}

/** Vrai si ORS accepte alternative_routes pour ce trajet (≤ 100 km à vol d'oiseau, comme le mesure ORS). */
export function wantsAlternatives(start, end) {
  return haversine(start, end) <= ROUTE_OPTIONS.ALTERNATIVES_MAX_CROW_M;
}

/** Réglages de requête d'une variante, en partant des choix de l'utilisateur (éviter péages coché ou non). */
export function requestFor(variant, avoidTolls = false) {
  return { preference: variant.preference ?? null, avoidTolls: variant.avoidTolls === true || avoidTolls === true };
}

/**
 * Variantes à calculer quand ORS n'a renvoyé que le Recommandé.
 * « Sans péage » est remplacé par « Plus rapide » s'il ne peut rien changer (péages déjà évités, Recommandé sans péage).
 * @param {{ avoidTolls?:boolean, reference?:{ tollDistance:number|null }|null, budget:number }} p
 */
export function planVariants({ avoidTolls = false, reference = null, budget }) {
  const tollFree = typeof reference?.tollDistance === 'number' && reference.tollDistance < ROUTE_OPTIONS.NO_TOLL_M;
  const second = avoidTolls || tollFree ? VARIANTS.fastest : VARIANTS.noToll;
  return [VARIANTS.shortest, second].slice(0, Math.max(0, budget));
}

function makeOption(variant, route, request) {
  return { key: variant.key, label: variant.label, note: variant.note ?? '', also: [], route, request };
}

/** Longueur des tronçons de `line` (m). */
function lineLength(line) {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += haversine(line[i - 1], line[i]);
  return total;
}

const vertexKey = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

/**
 * Part (0 à 1) de la longueur de `a` qui suit aussi `b`. Deux itinéraires calculés sur le même réseau ont exactement
 * les mêmes points là où ils empruntent les mêmes routes : un tronçon de a est commun si ses deux extrémités sont des
 * points de b (arrondis à 1e-5°, ≈ 1 m).
 */
export function sharedShare(a, b) {
  if (!Array.isArray(a) || a.length < 2) return 1;
  const keys = new Set((b ?? []).map(vertexKey));
  let shared = 0;
  let total = 0;
  let prevIn = keys.has(vertexKey(a[0]));
  for (let i = 1; i < a.length; i += 1) {
    const d = haversine(a[i - 1], a[i]);
    const inB = keys.has(vertexKey(a[i]));
    total += d;
    if (prevIn && inB) shared += d;
    prevIn = inB;
  }
  return total > 0 ? shared / total : 1;
}

/** Tracés quasi identiques (même choix pour le chauffeur) : voir ROUTE_OPTIONS.DUPLICATE_*. */
export function isNearDuplicate(a, b) {
  const max = ROUTE_OPTIONS.DUPLICATE_MAX_DIFF_SHARE;
  if (1 - sharedShare(a.coordinates, b.coordinates) > max) return false;
  if (1 - sharedShare(b.coordinates, a.coordinates) > max) return false;
  const ta = a.tollDistance;
  const tb = b.tollDistance;
  if (typeof ta === 'number' && typeof tb === 'number' && Math.abs(ta - tb) > ROUTE_OPTIONS.DUPLICATE_MAX_TOLL_DIFF_M) {
    return false;
  }
  return true;
}

/**
 * Supprime les doublons en gardant le premier ; le nom du doublon est ajouté à `also` du gardé
 * (« Recommandé (aussi : Plus court) »), sauf pour une simple « Alternative ».
 */
export function dedupeOptions(options) {
  const kept = [];
  for (const o of options) {
    const twin = kept.find((k) => isNearDuplicate(k.route, o.route));
    if (twin) {
      if (o.key !== VARIANTS.alternative.key && !twin.also.includes(o.label)) twin.also.push(o.label);
    } else {
      kept.push({ ...o, also: [...o.also] });
    }
  }
  return kept;
}

/** Les alternatives d'ORS prennent leur rang dans la liste : « Alternative 2 », « Alternative 3 ». */
export function nameAlternatives(options) {
  return options.map((o, i) => (o.key === VARIANTS.alternative.key ? { ...o, label: `Alternative ${i + 1}` } : o));
}

/**
 * Calcule les itinéraires proposés (3 requêtes au plus).
 * @param {{ start:number[], end:number[], vehicle:object, avoidTolls?:boolean, avoidFerries?:boolean,
 *   send:(req:{url:string,method:string,body:object})=>Promise<object> }} p
 *   send envoie la requête et renvoie le JSON d'ORS, ou rejette avec une erreur portant `kind` (ERROR_KINDS).
 * @returns {Promise<{ options:{key:string,label:string,note:string,also:string[],route:object,
 *   request:{preference:string|null,avoidTolls:boolean}}[], failures:{key:string,label:string,kind:string}[], requests:number }>}
 *   options[0] est toujours le Recommandé. S'il échoue, l'erreur est relancée telle quelle (message existant).
 */
export async function computeRouteOptions({ start, end, vehicle, avoidTolls = false, avoidFerries = false, send }) {
  let requests = 0;
  const ask = async (variant, alternatives = 0) => {
    const request = requestFor(variant, avoidTolls);
    const req = buildDirectionsRequest({
      start, end, vehicle, avoidFerries, avoidTolls: request.avoidTolls, preference: request.preference, alternatives,
    });
    requests += 1;
    return { request, routes: parseAllDirections(await send(req)) };
  };

  let main = null;
  if (wantsAlternatives(start, end)) {
    try {
      main = await ask(VARIANTS.recommended, ROUTE_OPTIONS.TARGET_COUNT);
    } catch (err) {
      if (!ALTERNATIVES_FALLBACK_KINDS.has(errorKind(err))) throw err;
    }
  }
  if (!main) main = await ask(VARIANTS.recommended);

  let options = dedupeOptions(
    main.routes.map((route, i) => makeOption(i === 0 ? VARIANTS.recommended : VARIANTS.alternative, route, main.request)),
  );
  const failures = [];
  if (options.length < 2) {
    // Un seul itinéraire (ou des alternatives quasi identiques) : variantes en parallèle avec le reste du budget.
    const plan = planVariants({ avoidTolls, reference: options[0].route, budget: ROUTE_OPTIONS.MAX_REQUESTS - requests });
    const results = await Promise.allSettled(plan.map((v) => ask(v)));
    results.forEach((r, i) => {
      const v = plan[i];
      if (r.status === 'fulfilled') options.push(makeOption(v, r.value.routes[0], r.value.request));
      else failures.push({ key: v.key, label: v.label, kind: errorKind(r.reason) });
    });
    options = dedupeOptions(options);
  }
  return { options: nameAlternatives(options), failures, requests };
}

/** Ligne discrète pour une variante non calculée. */
export function failureText(failure) {
  return `« ${failure.label} » non calculé : ${FAILURE_REASONS[failure.kind] ?? 'erreur du service'}.`;
}

/** Écart d'un itinéraire avec la référence (le Recommandé) : « +6 min, −12 km ». */
export function deltaText(route, reference) {
  return `${formatDurationDelta(route.duration - reference.duration)}, ${formatDistanceDelta(route.distance - reference.distance)}`;
}

function tollText(m) {
  if (m === null || m === undefined) return 'inconnu';
  return m < ROUTE_OPTIONS.NO_TOLL_M ? '0 km' : formatDistance(m);
}

/**
 * Contenu d'une fiche d'itinéraire (textes prêts à afficher).
 * @param {object} option élément de computeRouteOptions().options
 * @param {object|null} reference option de référence (la première) ; écart vide pour elle-même
 * @param {{ vehicle:object, dieselPrice:number|null, now:Date }} ctx
 */
export function describeOption(option, reference, { vehicle, dieselPrice = null, now = new Date() }) {
  const r = option.route;
  const liters = fuelEstimate(r.distance, vehicle?.consumption);
  const cost = fuelCost(liters, dieselPrice);
  let fuel = '';
  if (liters !== null) {
    fuel = `Gazole : ≈ ${Math.round(liters)} L${cost !== null ? ` · ≈ ${formatEuros(cost)}` : ''}`;
  }
  return {
    name: option.label,
    also: option.also.length ? `aussi : ${option.also.join(', ')}` : '',
    note: option.note,
    duration: formatDuration(r.duration),
    distance: formatDistance(r.distance),
    arrival: `Arrivée : ${formatArrival(now, r.duration)}`,
    toll: `Péage : ${tollText(r.tollDistance)}`,
    fuel,
    delta: reference && reference !== option ? deltaText(r, reference.route) : '',
  };
}

/**
 * Réglages du guidage pour l'itinéraire choisi : le recalcul en route garde ceux de la variante
 * (« Plus court » → preference shortest, « Sans péage » → péages évités). Une alternative d'ORS ne peut pas être
 * redemandée : son recalcul est celui du Recommandé.
 */
export function guidanceParams(option, { start, end, avoidFerries = false }) {
  return {
    start, end, avoidFerries, avoidTolls: option.request.avoidTolls, preference: option.request.preference ?? null,
  };
}

/** Après un recalcul en route, les alternatives (parties de l'ancien départ) sont dépassées : il ne reste que lui. */
export function reroutedOption(option, route) {
  return { key: 'rerouted', label: 'Recalculé en route', note: '', also: [], route, request: option.request };
}

/** Emprise commune à plusieurs itinéraires (pour tous les voir sur la carte), ou null. */
export function routesBbox(routes) {
  let out = null;
  for (const r of routes ?? []) {
    const b = Array.isArray(r?.bbox) && r.bbox.length === 4 ? r.bbox : bboxOf(r?.coordinates);
    if (!b) continue;
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : [...b];
  }
  return out;
}

/**
 * Tracé à sélectionner quand on touche la carte : `hits` = indices des tracés sous le doigt.
 * Sur un tronçon commun, chaque toucher passe au tracé suivant ; null = rien à changer.
 */
export function pickRouteAt(hits, selected) {
  const ids = [...new Set((hits ?? []).filter(Number.isInteger))].sort((x, y) => x - y);
  const others = ids.filter((i) => i !== selected);
  if (!others.length) return null;
  return others.find((i) => i > selected) ?? others[0];
}
