// Contrôle camion TomTom (phase 12) : construction de la requête Calculate Route, lecture de la réponse, erreurs.
// Logique pure, aucun appel réseau (l'envoi est dans src/ui/api.js). ORS reste le moteur principal et le guidage :
// TomTom ne sert qu'à comparer, une requête au plus par calcul, jamais de nouvelle tentative automatique.
//
// Sources (vérifiées le 22/11/2026) :
// - Routing API v1 « Calculate Route » (TomTom Maps) :
//   https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route (« Last edit: 2026.08.07 »)
//   et le code du SDK web officiel @tomtom-international/web-sdk-services 6.25.0 (registry.npmjs.org) :
//   GET https://api.tomtom.com/routing/1/calculateRoute/{lat,lon:lat,lon}/json?key=…, clé en paramètre « key ».
//   L'API Orbis (v3) n'a pas de mode camion dans le SDK @tomtom-org/maps-sdk 1.0.0 : on reste en v1.
// - Paramètres camion : travelMode=truck, vehicleCommercial, vehicleHeight/Width/Length (m), vehicleWeight et
//   vehicleAxleWeight (kg), vehicleMaxSpeed (km/h), vehicleLoadType, vehicleAdrTunnelRestrictionCode (B, C, D, E),
//   avoid=tollRoads / avoid=ferries (répétable), routeType, traffic, sectionType. 0 = valeur ignorée par TomTom,
//   donc rien n'est envoyé pour une valeur vide. vehicleNumberOfAxles existe mais n'est pas envoyé (absent du profil).
// - Réponse : routes[0].summary.lengthInMeters / travelTimeInSeconds, routes[0].legs[].points[{latitude,longitude}],
//   routes[0].sections[] (startPointIndex, endPointIndex, sectionType, travelMode). Section TRAVEL_MODE en
//   travelMode « other » : TomTom n'a pas pu rester en mode camion à cet endroit. Aucun champ n'indique quelle
//   restriction a été évitée.
// - Erreurs (doc) : { formatVersion, detailedError:{ code, message } } ; 403 « Forbidden / Not authorized / Account
//   inactive », 429 trop de requêtes (5 par seconde pour Routing : docs.tomtom.com/platform/documentation/
//   api-best-practices/qps-limits), 500 aussi au délai de calcul ; erreurs de clé ou de quota en text/xml, hors format.
//   Clé factice le 22/11/2026 : HTTP 401 { detailedError:{ code:"Unauthorized" } } (401 absent de la doc).
// - Quota gratuit (docs.tomtom.com/pricing, 22/11/2026) : 20 000 requêtes Routing par mois, bloquées au-delà jusqu'au
//   cycle suivant. Attribution : « ©TomTom » (Copyright API). Conditions : docs.tomtom.com/legal/terms-and-conditions
//   §11.6.10 (comparaison avec un concurrent soumise à accord écrit) — phase 12 en attente, non activée.
// - CORS : api.tomtom.com répond Access-Control-Allow-Origin à l'origine du site (testé le 22/11/2026 avec
//   Origin: https://timgo211.github.io, GET et pré-requête OPTIONS) : appel direct depuis la PWA, sans relais.

import { TOMTOM_ROUTING_BASE } from './config.js';
import { effectiveCode } from './adr.js';

export const TOMTOM_ERRORS = Object.freeze({
  NO_KEY: 'no-key',
  INVALID_KEY: 'invalid-key',
  KEY_OR_QUOTA: 'key-or-quota',
  QUOTA: 'quota',
  BAD_REQUEST: 'bad-request',
  NO_ROUTE: 'no-route',
  SERVER: 'server',
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  PARSE: 'parse',
  UNKNOWN: 'unknown',
});

/** Raison courte, affichée dans « Contrôle TomTom indisponible : <raison> ». */
const REASONS = {
  'no-key': 'aucune clé TomTom',
  'invalid-key': 'clé TomTom refusée',
  'key-or-quota': 'clé refusée ou quota TomTom atteint',
  quota: 'trop de demandes en peu de temps',
  'bad-request': 'demande refusée par TomTom',
  'no-route': 'aucun trajet camion trouvé par TomTom',
  server: 'service TomTom en panne',
  offline: 'pas de réseau',
  timeout: 'délai dépassé',
  network: 'service TomTom injoignable',
  parse: 'réponse illisible',
  unknown: 'erreur du service',
};

export function tomtomReason(kind) {
  return REASONS[kind] ?? REASONS.unknown;
}

/** Erreur du contrôle TomTom : `kind` (TOMTOM_ERRORS), `status` HTTP, `detail` sans la clé. */
export class TomTomError extends Error {
  constructor(kind, { status = null, detail = '' } = {}) {
    super(tomtomReason(kind));
    this.name = 'TomTomError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** Remplace la clé dans un texte (message d'erreur, détail du serveur). */
export function redactKey(text, key) {
  let t = String(text ?? '');
  const k = String(key ?? '').trim();
  if (k.length >= 4) t = t.split(k).join('•••');
  return t.replace(/([?&]key=)[^&\s"']+/gi, '$1•••');
}

const pos = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const latLon = (p) => `${Number(p[1]).toFixed(6)},${Number(p[0]).toFixed(6)}`;

/**
 * Paramètres camion TomTom du profil actif (sans la clé).
 * @param {object} vehicle profil (activeVehicle) : height/width/length (m), weight/axleload (t), maxSpeed (km/h), ADR
 * @returns {[string,string][]}
 */
export function truckParams(vehicle) {
  const out = [['travelMode', 'truck'], ['vehicleCommercial', 'true']];
  const m = (name, v) => { if (pos(v) !== null) out.push([name, String(Math.round(v * 100) / 100)]); };
  m('vehicleHeight', vehicle?.height);
  m('vehicleWidth', vehicle?.width);
  m('vehicleLength', vehicle?.length);
  if (pos(vehicle?.weight) !== null) out.push(['vehicleWeight', String(Math.round(vehicle.weight * 1000))]);
  if (pos(vehicle?.axleload) !== null) out.push(['vehicleAxleWeight', String(Math.round(vehicle.axleload * 1000))]);
  if (pos(vehicle?.maxSpeed) !== null) out.push(['vehicleMaxSpeed', String(Math.round(vehicle.maxSpeed))]);
  if (vehicle?.hazmat) {
    // Classe 1 (explosifs) : valeur propre ; sinon matières dangereuses « générales » (valeurs de vehicleLoadType).
    out.push(['vehicleLoadType', String(vehicle.adrClass ?? '').startsWith('1') ? 'otherHazmatExplosive' : 'otherHazmatGeneral']);
    const code = effectiveCode(vehicle);
    if (['B', 'C', 'D', 'E'].includes(code)) out.push(['vehicleAdrTunnelRestrictionCode', code]);
  }
  return out;
}

/**
 * URL de la requête Calculate Route (GET). La clé est dans l'URL : cette URL n'est jamais journalisée ni affichée.
 * @param {{ key:string, start:number[], end:number[], vehicle:object, avoidTolls?:boolean, avoidFerries?:boolean }} p
 *   start, end en [longitude, latitude]
 */
export function buildTomTomRouteUrl({ key, start, end, vehicle, avoidTolls = false, avoidFerries = false }) {
  const q = new URLSearchParams();
  q.append('key', String(key ?? '').trim());
  q.append('routeType', 'fastest');
  q.append('traffic', 'false'); // vitesses habituelles : comparaison stable d'un jour à l'autre, comme ORS
  q.append('maxAlternatives', '0');
  q.append('sectionType', 'travelMode');
  for (const [k, v] of truckParams(vehicle)) q.append(k, v);
  if (avoidTolls) q.append('avoid', 'tollRoads');
  if (avoidFerries) q.append('avoid', 'ferries');
  return `${TOMTOM_ROUTING_BASE}/calculateRoute/${latLon(start)}:${latLon(end)}/json?${q.toString()}`;
}

/** Requête du bouton « Tester » : petit trajet camion fixe à Besançon (une seule requête). */
export function buildTomTomKeyTestUrl(key) {
  return buildTomTomRouteUrl({
    key, start: [6.0241, 47.2378], end: [6.0326, 47.2466], vehicle: { height: 4, width: 2.55, length: 16.5, weight: 44 },
  });
}

/**
 * Lit la réponse Calculate Route.
 * @returns {{ coordinates:number[][], distance:number, duration:number, otherSections:{start:number,end:number}[] }}
 * @throws {TomTomError} PARSE si illisible, NO_ROUTE si aucun trajet
 */
export function parseTomTomRoute(json) {
  if (!json || typeof json !== 'object') throw new TomTomError(TOMTOM_ERRORS.PARSE);
  const routes = Array.isArray(json.routes) ? json.routes : null;
  if (!routes) throw new TomTomError(TOMTOM_ERRORS.PARSE);
  if (!routes.length) throw new TomTomError(TOMTOM_ERRORS.NO_ROUTE);
  const r = routes[0];
  const coordinates = [];
  for (const leg of Array.isArray(r?.legs) ? r.legs : []) {
    for (const p of Array.isArray(leg?.points) ? leg.points : []) {
      const lat = Number(p?.latitude);
      const lon = Number(p?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      coordinates.push([lon, lat]);
    }
  }
  const distance = Number(r?.summary?.lengthInMeters);
  const duration = Number(r?.summary?.travelTimeInSeconds);
  if (coordinates.length < 2 || !Number.isFinite(distance) || !Number.isFinite(duration)) {
    throw new TomTomError(TOMTOM_ERRORS.PARSE);
  }
  const otherSections = (Array.isArray(r.sections) ? r.sections : [])
    .filter((s) => s?.sectionType === 'TRAVEL_MODE' && s?.travelMode === 'other'
      && Number.isInteger(s.startPointIndex) && Number.isInteger(s.endPointIndex))
    .map((s) => ({ start: s.startPointIndex, end: s.endPointIndex }));
  return { coordinates, distance, duration, otherSections };
}

/** Texte d'erreur renvoyé par TomTom (detailedError.message, error.description…), clé masquée. */
function bodyText(body, key) {
  if (!body) return '';
  if (typeof body === 'string') return redactKey(body.slice(0, 200), key);
  const d = body.detailedError ?? {};
  const t = d.message ?? body.error?.description ?? body.error?.message ?? body.message ?? '';
  const code = d.code ? `${d.code} : ` : '';
  return redactKey(`${code}${t}`.slice(0, 200), key);
}

/**
 * Classe un échec. Jamais de nouvelle tentative, quel que soit le type (403, 429 compris).
 * @param {{ status?:number, body?:any, offline?:boolean, timeout?:boolean, networkError?:boolean, noKey?:boolean }} p
 * @param {string} [key] masquée dans le détail
 */
export function classifyTomTomError({ status, body, offline = false, timeout = false, networkError = false, noKey = false } = {}, key = '') {
  const make = (kind) => new TomTomError(kind, { status: status ?? null, detail: bodyText(body, key) });
  if (noKey) return make(TOMTOM_ERRORS.NO_KEY);
  if (offline) return make(TOMTOM_ERRORS.OFFLINE);
  if (timeout) return make(TOMTOM_ERRORS.TIMEOUT);
  if (networkError) return make(TOMTOM_ERRORS.NETWORK);
  if (status === 401) return make(TOMTOM_ERRORS.INVALID_KEY);
  if (status === 403) return make(TOMTOM_ERRORS.KEY_OR_QUOTA);
  if (status === 429) return make(TOMTOM_ERRORS.QUOTA);
  if (status === 400) {
    // Aucun trajet possible pour ces paramètres : TomTom répond 400 avec « NO_ROUTE_FOUND » (code du SDK).
    if (/no_?route|cannot find a route|unable to find/i.test(bodyText(body, key))) return make(TOMTOM_ERRORS.NO_ROUTE);
    return make(TOMTOM_ERRORS.BAD_REQUEST);
  }
  if (typeof status === 'number' && status >= 500) return make(TOMTOM_ERRORS.SERVER);
  return make(TOMTOM_ERRORS.UNKNOWN);
}

/**
 * Résultat du bouton « Tester » de la clé TomTom.
 * @param {{ ok:boolean, kind?:string, status?:number|null }} r
 * @returns {{ level:'ok'|'warn'|'err', saveKey:boolean, message:string }}
 */
export function summarizeTomTomKeyTest(r) {
  if (r?.ok) return { level: 'ok', saveKey: true, message: 'Clé TomTom acceptée : le contrôle camion sera fait après chaque calcul.' };
  const http = typeof r?.status === 'number' && r.status > 0 ? ` (HTTP ${r.status})` : '';
  switch (r?.kind) {
    case TOMTOM_ERRORS.INVALID_KEY:
      return { level: 'err', saveKey: false, message: `Clé TomTom refusée${http}. Vérifie qu'elle est copiée en entier, sans espace.` };
    case TOMTOM_ERRORS.KEY_OR_QUOTA:
      return { level: 'err', saveKey: false, message: `Clé TomTom refusée ou quota atteint${http}. Vérifie la clé, ou réessaie plus tard.` };
    case TOMTOM_ERRORS.QUOTA:
      return { level: 'warn', saveKey: true, message: `Clé reconnue, mais trop de demandes en peu de temps${http} : réessaie dans une minute.` };
    default:
      return { level: 'warn', saveKey: false, message: `Test impossible : ${tomtomReason(r?.kind)}${http}. Réessaie plus tard.` };
  }
}
