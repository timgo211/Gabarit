// Appels réseau vers ORS / Pelias. Ne journalise jamais la clé ni les URL qui la contiennent.

import { buildDirectionsRequest, directionsHeaders, buildAutocompleteUrl, parseAutocomplete } from '../lib/ors-request.js';
import { parseDirections, NoRouteError } from '../lib/ors-response.js';
import { classifyError, ERROR_KINDS, messageFor } from '../lib/ors-errors.js';

/** Erreur portant un message déjà traduit pour l'utilisateur. */
export class ApiError extends Error {
  constructor({ kind, message, detail }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.detail = detail ?? '';
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
  if (!res.ok) throw new ApiError(classifyError({ status: res.status, body }));
  return body;
}

function requireKey(apiKey) {
  if (!apiKey) throw new ApiError(classifyError({ noKey: true }));
}

/** Calcule l'itinéraire camion. @returns route analysée (voir parseDirections). */
export async function fetchRoute({ apiKey, start, end, vehicle, avoidTolls, avoidFerries }) {
  requireKey(apiKey);
  const req = buildDirectionsRequest({ start, end, vehicle, avoidTolls, avoidFerries });
  const json = await request(req.url, {
    method: req.method,
    headers: directionsHeaders(apiKey),
    body: JSON.stringify(req.body),
  }, 45000);
  try {
    return parseDirections(json);
  } catch (err) {
    if (err instanceof NoRouteError) {
      throw new ApiError({ kind: ERROR_KINDS.NO_ROUTE, message: messageFor(ERROR_KINDS.NO_ROUTE) });
    }
    throw err;
  }
}

/** Suggestions d'adresses. */
export async function fetchSuggestions({ apiKey, text, focus, signal }) {
  requireKey(apiKey);
  const json = await request(buildAutocompleteUrl({ apiKey, text, focus }), { method: 'GET', signal }, 15000);
  return parseAutocomplete(json);
}

/** Teste la clé avec une petite requête de géocodage. */
export async function testKey(apiKey) {
  requireKey(apiKey);
  await request(buildAutocompleteUrl({ apiKey, text: 'Lyon', size: 1 }), { method: 'GET' }, 15000);
  return true;
}
