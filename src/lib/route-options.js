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
// Recommandé en code 2009 : diagnostic (sens inverse, point de passage, sans restrictions) dans le même budget,
// voir diagnose2009.

import { buildDirectionsRequest, buildRestrictions } from './ors-request.js';
import { parseAllDirections, haversine, NoRouteError, fuelEstimate, fuelCost, bboxOf } from './ors-response.js';
import { ERROR_KINDS, failedSegment, NO_ROUTE_BASE_TEXT } from './ors-errors.js';
import { pickRecommendedIndex, anShareText } from './road-class.js';
import { BLOCKED_TEXT } from './restrictions.js';
import { legLines } from './stops.js';
import { ORS_MAX_ALTERNATIVE_ROUTES, ORS_ALTERNATIVE_ROUTES_MAX_DISTANCE_M } from './config.js';
import {
  formatDistance, formatDuration, formatArrival, formatDurationDelta, formatDistanceDelta, formatEuros,
} from './format.js';

/** Message ajouté après un code 2009 quand le même trajet passe sans les restrictions du profil (jamais en voix). */
export const RESTRICTION_HINT_TEXT = 'Départ ou arrivée peut-être joignable seulement en franchissant une limite de poids, hauteur ou largeur de ton profil. Essaie un point plus accessible (appui long). La signalisation fait foi.';
/**
 * Message ajouté après un code 2009 quand le trajet échoue aussi sans les restrictions (ou que le profil n'en a pas) :
 * constat tablette v30, Metz (rue Coislin) → Nancy / Toul en 2009 alors que Nancy → Metz y arrive : point d'où le
 * camion ne peut pas repartir (sens unique, zone piétonne, sortie interdite, à vérifier). Jamais en voix.
 */
export const DEAD_END_HINT_TEXT = 'Départ ou arrivée peut-être dans une rue sans sortie possible pour le camion (sens unique, zone piétonne). Essaie un point plus accessible (appui long). La signalisation fait foi.';
/**
 * Phase 2f : code 2009 à l'aller alors que le trajet inverse (arrivée → départ, même profil) passe. Constat tablette
 * v35 à v37 : Metz centre (6.17963 49.11516) → Nancy / Toul en 2009, Nancy → Metz passe. Jamais en voix.
 */
export const START_NO_EXIT_TEXT = 'Le départ semble sans sortie pour un camion (sens unique, zone piétonne, sortie interdite) : le trajet inverse passe. Pose le départ sur une route voisine plus large (appui long). La signalisation fait foi.';
/**
 * Phase 2f : requête avec un point de passage au milieu, en échec sur le premier tronçon (départ) ou le second
 * (arrivée). Le point de passage est accroché à la route la plus proche sans garantie : formulé au conditionnel.
 */
export const START_UNREACHABLE_TEXT = 'Le départ semble isolé du reste du réseau pour ton camion (sens unique, zone piétonne, sortie interdite ou limite de gabarit). Pose le départ sur une route voisine plus large (appui long). La signalisation fait foi.';
export const END_UNREACHABLE_TEXT = "L'arrivée semble inaccessible à ton camion (sens unique, zone piétonne, accès interdit ou limite de gabarit). Pose l'arrivée sur une route voisine plus large (appui long). La signalisation fait foi.";

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
  /** Phase 2g : itinéraire de la préférence d'ORS quand un autre devient « Recommandé » (part A/N). */
  orsDefault: Object.freeze({ key: 'ors-default', label: 'Préférence ORS' }),
});

/** Note du « Recommandé » choisi pour sa part A/N (phase 2g) : jamais une garantie. */
/**
 * v43 : « Recommandé » n'est jamais un itinéraire qui traverse un tunnel dont l'interdiction est confirmée pour le
 * profil (classe Euro : texte officiel ou exploitant, euro.js ; ADR : catégorie du tunnel et code du chargement,
 * adr.js), si un autre itinéraire calculé n'en traverse pas. Aucune requête de plus. Statuts « à vérifier » et
 * « annoncée » : ne comptent pas. Ligne sur la fiche, jamais dite à voix haute.
 */
export const TUNNEL_AVOIDED_NOTE = "Recommandé parce qu'il ne traverse pas de tunnel interdit à ton profil, contrairement à un autre itinéraire calculé. La signalisation fait foi.";
export const ALL_TUNNELS_NOTE = "Tous les itinéraires calculés traversent un tunnel interdit à ton profil : choix habituel gardé, à vérifier avant le départ. La signalisation fait foi.";

export const AN_PREFERRED_NOTE = "Préféré pour sa part d'autoroute et de nationale. Une autoroute ou une nationale peut aussi avoir une limite : la signalisation fait foi.";

/**
 * Phase 2g : « Recommandé » = parmi les itinéraires calculés, la plus forte part A/N à 15 % de durée au plus du plus
 * rapide (pickRecommendedIndex, road-class.js). Le choisi passe en tête et prend le nom « Recommandé » (son ancien
 * nom en « aussi », sauf une simple alternative) ; la préférence d'ORS devient « Préférence ORS ». Clés et réglages de
 * requête inchangés (recalcul en guidage, partage). Sinon, liste inchangée.
 */
export function promoteRecommended(options, { forbidden = null } = {}) {
  const flags = Array.isArray(forbidden) && Array.isArray(options) ? options.map((_, k) => !!forbidden[k]) : null;
  const some = !!flags?.some(Boolean);
  const all = some && flags.every(Boolean);
  if (all) {
    // Tous traversent un tunnel interdit : choix actuel gardé, la fiche le dit en clair.
    const out = promoteRecommended(options);
    const [head, ...rest] = out;
    return [{ ...head, tunnelPick: 'all', note: [head.note, ALL_TUNNELS_NOTE].filter(Boolean).join(' ') }, ...rest];
  }
  const i = pickRecommendedIndex(options, { excluded: some ? flags : null });
  if (i <= 0) return options;
  const best = options[i];
  const ors = options[0];
  const also = best.key === VARIANTS.alternative.key ? best.also : [best.label, ...best.also];
  const byTunnel = some && flags[0];
  const promoted = {
    ...best, label: VARIANTS.recommended.label, also, promoted: true, ...(byTunnel ? { tunnelPick: 'avoided' } : {}),
    note: [best.note, byTunnel ? TUNNEL_AVOIDED_NOTE : AN_PREFERRED_NOTE].filter(Boolean).join(' '),
  };
  const demoted = { ...ors, key: VARIANTS.orsDefault.key, label: VARIANTS.orsDefault.label };
  return [promoted, demoted, ...options.filter((_, k) => k !== 0 && k !== i)];
}

/**
 * Échecs du Recommandé avec alternative_routes qui justifient de le redemander sans : limite de distance (2004),
 * paramètre refusé, erreur du serveur. Clé, quota, réseau, aucun itinéraire : inutile d'insister.
 */
const ALTERNATIVES_FALLBACK_KINDS = new Set([
  ERROR_KINDS.TOO_FAR, ERROR_KINDS.BAD_REQUEST, ERROR_KINDS.SERVER, ERROR_KINDS.UNKNOWN,
]);

/**
 * Échecs de la requête avec point de passage qui ne concluent rien sans rien interrompre : point de passage non
 * accroché (2010, ou erreur 2099 que RoutingRequest.java renvoie pour un point introuvable dans un tronçon).
 */
const VIA_INCONCLUSIVE_KINDS = new Set([ERROR_KINDS.POINT_NOT_FOUND, ERROR_KINDS.SERVER, ERROR_KINDS.UNKNOWN]);

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

/** Diagnostics d'un 2009 qui concluent sur le départ ou l'arrivée : message sans le conseil péages / ferries. */
export const PRECISE_HINTS = Object.freeze(new Set([
  'start-no-exit', 'start-unreachable', 'end-unreachable', 'stop-unreachable', 'point-no-exit',
]));

/**
 * v55 : code 2009 avec étapes. ORS s'arrête au premier tronçon impossible et le nomme (« between points N and N+1 »,
 * failedSegment) : phrase qui nomme les deux points du tronçon, sans requête de plus (l'un des deux est en cause,
 * sans savoir lequel : conditionnel). Jamais en voix.
 * @param {number} seg tronçon (1 = départ → étape 1)
 * @param {number} count nombre d'étapes
 */
export function stopUnreachableText(seg, count) {
  const name = (k) => (k === 0 ? 'le départ' : k === count + 1 ? "l'arrivée" : `l'étape ${k}`);
  return `Aucun itinéraire camion trouvé entre ${name(seg - 1)} et ${name(seg)} : l'un de ces deux points semble inaccessible ou sans sortie pour ton camion (sens unique, zone piétonne, accès interdit ou limite de gabarit). Déplace ou retire l'étape en cause. La signalisation fait foi.`;
}
/** v55 : avec étapes, le trajet inverse passe : un point (départ ou étape) semble sans sortie. Jamais en voix. */
export const POINT_NO_EXIT_TEXT = 'Le départ ou une étape semble sans sortie pour un camion (sens unique, zone piétonne, sortie interdite) : le trajet inverse passe. Déplace le point en cause sur une route voisine plus large. La signalisation fait foi.';

/**
 * Diagnostic d'un code 2009 (aucun itinéraire), phases 5h ter et 2f, dans le budget de 3 requêtes du calcul
 * (alternative_routes compris). Ajoute une précision au message de `err` ; aucun résultat n'est affiché ni guidé,
 * le profil n'est jamais changé et aucun point n'est déplacé : la signalisation fait foi.
 * (a) Trajet inverse (arrivée → départ), même profil : s'il passe, le départ semble sans sortie pour le camion.
 * (b) Sinon, point de passage au milieu du trajet (rayon d'accroche maximal du serveur, radiuses -1) : ORS s'arrête
 *     au premier tronçon impossible et le nomme (failedSegment) ; tronçon 1 → départ, tronçon 2 → arrivée.
 *     L'accroche du point de passage n'est pas garantie (route isolée possible) : messages au conditionnel ;
 *     point de passage non accroché (2010) ou tronçons tous possibles → rien de conclu, étape suivante.
 * (c) Sinon, si le budget le permet, sans les restrictions du profil : ORS accroche les points sur une voie permise
 *     au gabarit (ORSRouter.createSnapFilter) mais son test de sous-réseau ignore les limites de poids, hauteur ou
 *     largeur ; passe → limite de gabarit, échoue aussi → rue sans sortie. Profil sans restriction : la requête
 *     d'origine valait déjà ce diagnostic.
 * Diagnostic en échec pour une autre raison (quota, réseau) : message d'origine, raison dans err.diagnosticNote.
 * @returns {Promise<number>} nombre de requêtes du calcul après le diagnostic
 */
export async function diagnose2009({
  err, start, end, vehicle, avoidTolls, avoidFerries, send, requests, avoidPolygons = null, via = [],
}) {
  if (Array.isArray(via) && via.length) {
    return diagnoseWithStops({ err, start, end, vehicle, avoidTolls, avoidFerries, send, requests, avoidPolygons, via });
  }
  const hint = (kind, text) => {
    err.hint = kind;
    err.restrictionHint = kind === 'restrictions';
    // Phase 2g : diagnostic précis (départ ou arrivée en cause) → le conseil générique péages / ferries est retiré.
    const base = PRECISE_HINTS.has(kind) ? NO_ROUTE_BASE_TEXT : err.message;
    err.message = `${base ? `${base} ` : ''}${text}`;
  };
  const left = () => requests < ROUTE_OPTIONS.MAX_REQUESTS;
  /** Envoie une requête de diagnostic : { ok:true } | { ok:false, noRoute:boolean, kind, detail }. */
  const probe = async (params) => {
    requests += 1;
    try {
      // Phase 12b : mêmes zones évitées que le calcul (restrictions saisies) ; le sens inverse et le point de passage
      // les gardent aussi, sinon une restriction en cause passerait pour un départ sans sortie.
      parseAllDirections(await send(buildDirectionsRequest({ vehicle, avoidFerries, avoidTolls, avoidPolygons, ...params })));
      return { ok: true };
    } catch (e) {
      const noRoute = e?.code === 2009 || e instanceof NoRouteError;
      return { ok: false, noRoute, kind: errorKind(e), code: e?.code ?? null, detail: String(e?.detail || e?.message || '') };
    }
  };
  const interrupted = (r) => {
    err.diagnosticNote = `Diagnostic interrompu : ${FAILURE_REASONS[r.kind] ?? 'erreur du service'}.`;
  };

  // (a) Sens inverse.
  if (!left()) return requests;
  const back = await probe({ start: end, end: start });
  if (back.ok) { hint('start-no-exit', START_NO_EXIT_TEXT); return requests; }
  if (!back.noRoute) { interrupted(back); return requests; }

  // (b) Point de passage au milieu (moyenne des coordonnées : assez précis pour un repère, pas pour un guidage).
  if (!left()) return requests;
  const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const mp = await probe({ start, end, via: [mid], radiuses: [-1, -1, -1] });
  if (!mp.ok && mp.noRoute) {
    const seg = failedSegment(mp.detail);
    if (seg === 1) { hint('start-unreachable', START_UNREACHABLE_TEXT); return requests; }
    if (seg === 2) { hint('end-unreachable', END_UNREACHABLE_TEXT); return requests; }
  } else if (!mp.ok && !VIA_INCONCLUSIVE_KINDS.has(mp.kind)) {
    interrupted(mp);
    return requests;
  }

  // (c) Sans les restrictions du profil.
  if (!Object.keys(buildRestrictions(vehicle)).length) { hint('dead-end', DEAD_END_HINT_TEXT); return requests; }
  if (!left()) {
    err.diagnosticNote = 'Diagnostic sans conclusion (point de passage non accroché ou trajet possible par le milieu).';
    return requests;
  }
  const bare = await probe({ start, end, noRestrictions: true });
  if (bare.ok) hint('restrictions', RESTRICTION_HINT_TEXT);
  else if (bare.noRoute) hint('dead-end', DEAD_END_HINT_TEXT);
  else interrupted(bare);
  return requests;
}

/**
 * v55 : diagnostic d'un code 2009 avec étapes, même budget. Les étapes découpent déjà le trajet : le point de passage
 * au milieu (b) est remplacé par la lecture du tronçon en échec dans le message d'ORS (failedSegment, aucune
 * requête) : les deux points du tronçon sont nommés. Puis (a) sens inverse (liste complète inversée) et (c) sans les
 * restrictions du profil, avec tous les points.
 */
async function diagnoseWithStops({ err, start, end, vehicle, avoidTolls, avoidFerries, send, requests, avoidPolygons, via }) {
  const hint = (kind, text) => {
    err.hint = kind;
    err.restrictionHint = kind === 'restrictions';
    const base = PRECISE_HINTS.has(kind) ? NO_ROUTE_BASE_TEXT : err.message;
    err.message = `${base ? `${base} ` : ''}${text}`;
  };
  const left = () => requests < ROUTE_OPTIONS.MAX_REQUESTS;
  const probe = async (params) => {
    requests += 1;
    try {
      parseAllDirections(await send(buildDirectionsRequest({ vehicle, avoidFerries, avoidTolls, avoidPolygons, ...params })));
      return { ok: true };
    } catch (e) {
      const noRoute = e?.code === 2009 || e instanceof NoRouteError;
      return { ok: false, noRoute, kind: errorKind(e) };
    }
  };
  const interrupted = (r) => {
    err.diagnosticNote = `Diagnostic interrompu : ${FAILURE_REASONS[r.kind] ?? 'erreur du service'}.`;
  };

  // (b) Tronçon nommé par ORS dans le message d'erreur d'origine.
  const seg = failedSegment(String(err?.detail || err?.message || ''));
  if (seg !== null && seg >= 1 && seg <= via.length + 1) {
    hint('stop-unreachable', stopUnreachableText(seg, via.length));
    return requests;
  }

  // (a) Sens inverse, étapes à l'envers.
  if (!left()) return requests;
  const back = await probe({ start: end, end: start, via: [...via].reverse() });
  if (back.ok) { hint('point-no-exit', POINT_NO_EXIT_TEXT); return requests; }
  if (!back.noRoute) { interrupted(back); return requests; }

  // (c) Sans les restrictions du profil.
  if (!Object.keys(buildRestrictions(vehicle)).length) { hint('dead-end', DEAD_END_HINT_TEXT); return requests; }
  if (!left()) { err.diagnosticNote = 'Diagnostic sans conclusion.'; return requests; }
  const bare = await probe({ start, end, via, noRestrictions: true });
  if (bare.ok) hint('restrictions', RESTRICTION_HINT_TEXT);
  else if (bare.noRoute) hint('dead-end', DEAD_END_HINT_TEXT);
  else interrupted(bare);
  return requests;
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
export async function computeRouteOptions({
  start, end, vehicle, avoidTolls = false, avoidFerries = false, send, avoidPolygons = null, isForbidden = null, via = [],
}) {
  let requests = 0;
  // v55 : étapes (via) dans chaque requête ; jamais alternative_routes avec des étapes (2 points seulement).
  const stops = Array.isArray(via) ? via : [];
  const ask = async (variant, alternatives = 0) => {
    // avoidPolygons (phase 12b) gardé dans la requête : le recalcul en guidage évite les mêmes restrictions.
    const request = avoidPolygons ? { ...requestFor(variant, avoidTolls), avoidPolygons } : requestFor(variant, avoidTolls);
    const req = buildDirectionsRequest({
      start, end, vehicle, avoidFerries, avoidTolls: request.avoidTolls, preference: request.preference, alternatives,
      avoidPolygons, via: stops,
    });
    requests += 1;
    return { request, routes: parseAllDirections(await send(req)) };
  };

  let main = null;
  try {
    if (!stops.length && wantsAlternatives(start, end)) {
      try {
        main = await ask(VARIANTS.recommended, ROUTE_OPTIONS.TARGET_COUNT);
      } catch (err) {
        if (!ALTERNATIVES_FALLBACK_KINDS.has(errorKind(err))) throw err;
      }
    }
    if (!main) main = await ask(VARIANTS.recommended);
  } catch (err) {
    if (err?.code === 2009) {
      requests = await diagnose2009({ err, start, end, vehicle, avoidTolls, avoidFerries, send, requests, avoidPolygons, via: stops });
    }
    throw withBlockedHint(err, avoidPolygons);
  }

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
  // v43 : tunnel interdit confirmé pour le profil (isForbidden : route → booléen, calculé sans requête).
  const named = nameAlternatives(options);
  const forbidden = typeof isForbidden === 'function' ? named.map((o) => !!isForbidden(o.route)) : null;
  return { options: promoteRecommended(named, { forbidden }), failures, requests };
}

/**
 * Phase 12b : calcul en échec (2009 ou aucun itinéraire) alors que des restrictions saisies étaient évitées : phrase
 * ajoutée au conditionnel, sans requête de plus. Renvoie l'erreur.
 */
export function withBlockedHint(err, avoidPolygons) {
  const noRoute = err?.code === 2009 || errorKind(err) === ERROR_KINDS.NO_ROUTE;
  if (noRoute && avoidPolygons?.coordinates?.length && !err.restrictionsBlocked) {
    err.restrictionsBlocked = true;
    err.message = `${err.message ? `${err.message} ` : ''}${BLOCKED_TEXT}`;
  }
  return err;
}

/** Ligne discrète pour une variante non calculée. */
export function failureText(failure) {
  return `« ${failure.label} » non calculé : ${FAILURE_REASONS[failure.kind] ?? 'erreur du service'}.`;
}

/** Écart d'un itinéraire avec la référence (le Recommandé) : « +6 min, −12 km ». */
export function deltaText(route, reference) {
  return `${formatDurationDelta(route.duration - reference.duration)}, ${formatDistanceDelta(route.distance - reference.distance)}`;
}

/** Kilomètres à péage (« 0 km » sous le seuil, « inconnu » si ORS ne dit rien). */
export function tollText(m) {
  if (m === null || m === undefined) return 'inconnu';
  return m < ROUTE_OPTIONS.NO_TOLL_M ? '0 km' : formatDistance(m);
}

/**
 * Contenu d'une fiche d'itinéraire (textes prêts à afficher).
 * @param {object} option élément de computeRouteOptions().options
 * @param {object|null} reference option de référence (la première) ; écart vide pour elle-même
 * @param {{ vehicle:object, dieselPrice:number|null, now:Date, geo?:object|null }} ctx geo : repli par la géométrie
 *   de cet itinéraire (PR 3a, ligne « Autoroute et nationale » seulement ; ordre et « Recommandé » inchangés)
 */
export function describeOption(option, reference, { vehicle, dieselPrice = null, now = new Date(), stops = [], geo = null }) {
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
    an: anShareText(r, { geo }), // phase 2g ; PR 3a : repli par la géométrie une fois les cases chargées
    fuel,
    delta: reference && reference !== option ? deltaText(r, reference.route) : '',
    // v55 : une ligne par étape (heure d'arrivée, durée du tronçon), heures sans temps passé aux étapes.
    legs: legLines(r, optionStops(option, stops), now), // v76 : étapes de la fiche (points de passage réunis)
  };
}

/**
 * Réglages du guidage pour l'itinéraire choisi : le recalcul en route garde ceux de la variante
 * (« Plus court » → preference shortest, « Sans péage » → péages évités). Une alternative d'ORS ne peut pas être
 * redemandée : son recalcul est celui du Recommandé.
 */
export function guidanceParams(option, { start, end, avoidFerries = false, stops = [] }) {
  return {
    start, end, avoidFerries, avoidTolls: option.request.avoidTolls, preference: option.request.preference ?? null,
    avoidPolygons: option.request.avoidPolygons ?? null, // « Sans ZFE » (phase 5)
    // v55 : étapes (le recalcul garde celles qui ne sont pas atteintes) ; v76 : celles de la fiche si elle en a
    // (« Rocade Est » : points de passage techniques compris).
    stops: optionStops(option, stops),
  };
}

/** v76 : étapes d'une fiche : les siennes (« Rocade Est ») sinon celles du trajet. */
export function optionStops(option, stops = []) {
  if (Array.isArray(option?.stops)) return option.stops;
  return Array.isArray(stops) ? stops : [];
}

/**
 * v76 : itinéraire « Rocade Est » (lyon-bypass.js) : mêmes réglages que l'itinéraire choisi (aucun polygone ajouté),
 * étapes = celles du trajet + trois points de passage techniques ; note avec l'écart si le trajet s'allonge fort.
 */
export function rocadeOption(option, route, stops, note, { recommended = false } = {}) {
  // v77 : contournement automatique → « Recommandé » (en tête de liste), « Rocade Est » en « aussi ».
  return {
    key: 'rocade', label: recommended ? VARIANTS.recommended.label : 'Rocade Est', note, also: recommended ? ['Rocade Est'] : [],
    route, request: { ...option.request }, stops, ...(recommended ? { auto: true } : {}),
  };
}

/**
 * Itinéraire « Sans ZFE » (phase 5) : mêmes réglages que l'itinéraire choisi, ZFE interdites évitées
 * (options.avoid_polygons).
 */
export function noZfeOption(option, route, avoidPolygons, names) {
  return {
    key: 'nozfe', label: 'Sans ZFE', note: `Évite : ${names.join(', ')}.`, also: [], route,
    request: { ...option.request, avoidPolygons },
  };
}

/**
 * v48 : itinéraire de contournement (« Éviter le tunnel ») : une requête, comptée dans le budget de 3 requêtes du
 * calcul de départ ; code 2009 → mêmes diagnostics (diagnose2009, phases 2f / 5h ter, au conditionnel) avec le reste
 * du budget, et même précision « zone évitée » (withBlockedHint). Échec : erreur relancée, rien d'affiché ni de guidé.
 * @returns {Promise<{ route:object, requests:number }>}
 */
export async function computeAvoidRoute({
  start, end, vehicle, avoidTolls = false, avoidFerries = false, preference = null, avoidPolygons = null, send, via = [],
  diagnose = true,
}) {
  let requests = 1;
  try {
    const req = buildDirectionsRequest({ start, end, vehicle, avoidFerries, avoidTolls, preference, avoidPolygons, via });
    const routes = parseAllDirections(await send(req));
    return { route: routes[0], requests };
  } catch (err) {
    // v77 : contournement automatique (diagnose false) : exactement une requête, aucun diagnostic de plus.
    if (diagnose && err?.code === 2009) {
      requests = await diagnose2009({ err, start, end, vehicle, avoidTolls, avoidFerries, send, requests, avoidPolygons, via });
    }
    throw withBlockedHint(err, avoidPolygons);
  }
}

/**
 * Itinéraire « Contournement » (phase 5b) : mêmes réglages que l'itinéraire choisi, tunnels interdits au code du
 * véhicule évités (petits carrés options.avoid_polygons, ajoutés aux ZFE déjà évitées).
 */
export function noTunnelOption(option, route, avoidPolygons, names) {
  return {
    key: 'notunnel', label: 'Contournement', note: `Évite : ${names.join(', ')}. La signalisation fait foi.`, also: [], route,
    request: { ...option.request, avoidPolygons },
  };
}

/**
 * Itinéraire « Sans desserte » (phase 5d) : mêmes réglages que l'itinéraire choisi, routes réservées à la desserte
 * locale traversées en transit évitées (petits carrés options.avoid_polygons, ajoutés aux zones déjà évitées).
 */
export function noLocalOption(option, route, avoidPolygons) {
  return {
    key: 'nolocal', label: 'Sans desserte', note: 'Évite les routes réservées à la desserte locale traversées. La signalisation fait foi.',
    also: [], route, request: { ...option.request, avoidPolygons },
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
