// Appels réseau vers ORS / Pelias. Ne journalise jamais la clé ni les URL qui la contiennent.

import {
  buildDirectionsRequest, directionsHeaders, buildAutocompleteUrl, peliasHeaders, parseAutocomplete, buildKeyTestRequest,
} from '../lib/ors-request.js';
import { parseDirections, NoRouteError } from '../lib/ors-response.js';
import { classifyError, ERROR_KINDS, messageFor } from '../lib/ors-errors.js';
import { computeRouteOptions, computeAvoidRoute, withBlockedHint } from '../lib/route-options.js';

/** Erreur portant un message déjà traduit pour l'utilisateur. */
export class ApiError extends Error {
  constructor({ kind, message, detail, status, code }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.detail = detail ?? '';
    this.status = status ?? null;
    this.code = code ?? null; // code d'erreur ORS (2009, 2010…), affiché en petit sous le message
  }
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(url, init, timeoutMs) {
  if (!navigator.onLine) throw new ApiError(classifyError({ offline: true }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  if (init.signal) init.signal.addEventListener('abort', () => ctrl.abort('cancel'), { once: true });
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
  } catch (err) {
    if (init.signal?.aborted) throw err; // annulé par l'appelant (frappe suivante)
    if (ctrl.signal.aborted) throw new ApiError(classifyError({ timeout: true }));
    throw new ApiError(classifyError({ networkError: true, offline: !navigator.onLine }));
  } finally {
    clearTimeout(timer);
  }
  const body = await readJson(res);
  if (!res.ok) throw new ApiError({ ...classifyError({ status: res.status, body }), status: res.status });
  return body;
}

function requireKey(apiKey) {
  if (!apiKey) throw new ApiError(classifyError({ noKey: true }));
}

function noRouteError() {
  return new ApiError({ kind: ERROR_KINDS.NO_ROUTE, message: messageFor(ERROR_KINDS.NO_ROUTE) });
}

/** Envoie une requête d'itinéraire construite par ors-request.js ; renvoie le JSON d'ORS. */
function postDirections(apiKey, req) {
  return request(req.url, { method: req.method, headers: directionsHeaders(apiKey), body: JSON.stringify(req.body) }, 45000);
}

/**
 * Calcule un itinéraire camion (recalcul en guidage, « Éviter la ZFE »). preference : celle de la variante choisie
 * (null = recommandé) ; avoidPolygons : zones à éviter (GeoJSON).
 * @returns route analysée (voir parseDirections).
 */
export async function fetchRoute({
  apiKey, start, end, vehicle, avoidTolls, avoidFerries, preference = null, avoidPolygons = null, via = [],
}) {
  requireKey(apiKey);
  // v55 : étapes (via) entre le départ et l'arrivée, dans la même requête.
  const req = buildDirectionsRequest({ start, end, vehicle, avoidTolls, avoidFerries, preference, avoidPolygons, via });
  const json = await postDirections(apiKey, req);
  try {
    return parseDirections(json);
  } catch (err) {
    if (err instanceof NoRouteError) throw noRouteError();
    throw err;
  }
}

/**
 * Itinéraires proposés au calcul (Recommandé + alternatives ou variantes, 3 requêtes au plus) : voir route-options.js.
 * @returns {{ options:object[], failures:object[], requests:number }}
 */
export async function fetchRouteOptions({
  apiKey, start, end, vehicle, avoidTolls, avoidFerries, avoidPolygons = null, isForbidden = null, via = [],
}) {
  requireKey(apiKey);
  try {
    return await computeRouteOptions({
      start, end, vehicle, avoidTolls, avoidFerries, avoidPolygons, isForbidden, via, send: (req) => postDirections(apiKey, req),
    });
  } catch (err) {
    // Phase 12b : restrictions saisies évitées → « Une restriction saisie bloque peut-être le seul passage. »
    if (err instanceof NoRouteError) throw withBlockedHint(noRouteError(), avoidPolygons);
    throw err;
  }
}

/**
 * v48 : contournement d'un tunnel interdit (« Éviter le tunnel ») : même budget et mêmes diagnostics d'échec que le
 * calcul de départ (computeAvoidRoute, route-options.js).
 * @returns route analysée (voir parseDirections).
 */
export async function fetchAvoidRoute({
  apiKey, start, end, vehicle, avoidTolls, avoidFerries, preference = null, avoidPolygons = null, via = [], diagnose = true,
}) {
  requireKey(apiKey);
  try {
    const { route } = await computeAvoidRoute({
      start, end, vehicle, avoidTolls, avoidFerries, preference, avoidPolygons, via, diagnose, send: (req) => postDirections(apiKey, req),
    });
    return route;
  } catch (err) {
    if (err instanceof NoRouteError) throw withBlockedHint(noRouteError(), avoidPolygons);
    throw err;
  }
}

// Pelias : clé dans l'en-tête Authorization. Si le navigateur bloque cet en-tête (erreur réseau,
// typiquement CORS), on retente une fois avec la clé dans l'URL et on retient la méthode qui marche.
let peliasKeyInQuery = false;

async function pelias({ apiKey, text, focus, size, signal, endpoint }) {
  const send = (keyInQuery) => request(
    buildAutocompleteUrl({ apiKey, keyInQuery, text, focus, size, endpoint }),
    { method: 'GET', headers: keyInQuery ? { Accept: 'application/json' } : peliasHeaders(apiKey), signal },
    15000,
  );
  try {
    return await send(peliasKeyInQuery);
  } catch (err) {
    if (peliasKeyInQuery || !(err instanceof ApiError) || err.kind !== ERROR_KINDS.NETWORK) throw err;
    const json = await send(true);
    peliasKeyInQuery = true;
    return json;
  }
}

/** Suggestions d'adresses (/autocomplete) ; v62 : endpoint 'search' pour un texte validé sans choix. */
export async function fetchSuggestions({ apiKey, text, focus, signal, endpoint = 'autocomplete' }) {
  requireKey(apiKey);
  return parseAutocomplete(await pelias({ apiKey, text, focus, signal, endpoint }));
}

function outcome(err) {
  if (err instanceof ApiError) return { ok: false, kind: err.kind, status: err.status, detail: err.detail };
  return { ok: false, kind: ERROR_KINDS.UNKNOWN, detail: String(err?.message ?? '') };
}

/**
 * Teste la clé sur les deux services : un petit itinéraire (service principal) et une recherche d'adresse.
 * @returns {{ directions:object, geocode:object }} voir summarizeKeyTest
 */
export async function testKey(apiKey) {
  requireKey(apiKey);
  const req = buildKeyTestRequest();
  const [directions, geocode] = await Promise.all([
    request(req.url, { method: req.method, headers: directionsHeaders(apiKey), body: JSON.stringify(req.body) }, 20000)
      .then(() => ({ ok: true }), outcome),
    pelias({ apiKey, text: 'Lyon', size: 1 }).then(() => ({ ok: true }), outcome),
  ]);
  return { directions, geocode };
}
