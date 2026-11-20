// Prévision du vent le long du trajet (phase 5, PR B) : une requête Open-Meteo par calcul pour tous les itinéraires
// proposés, puis au plus une par heure pendant le guidage. Les points, l'adresse et la lecture viennent de
// src/lib/wind.js ; ici, seulement le réseau. Résultat gardé 1 h sur l'appareil (localStorage), jamais dans le cache
// du service worker (sw-routing.js : domaine extérieur, réseau seulement).

import { WIND, windPoints, buildWindUrl, parseWind, createWindCache } from '../lib/wind.js';

/** Une requête GET (délai 20 s) ; erreur si HTTP en échec ou réponse illisible. */
async function ask(url, count, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WIND.CLIENT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!parseWind(json, count)) throw new Error('réponse illisible');
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * @param {{ storage:Storage, onChange:()=>void }} ctx onChange : prévision arrivée ou en échec (fiches à refaire)
 */
export function createWeather(ctx) {
  const cache = createWindCache(ctx.storage);
  /** { routes, points, plan, forecast, failed, at } ou null. */
  let current = null;
  let request = null;

  /**
   * Prévision pour ces itinéraires (calcul, ou itinéraire suivi en guidage).
   * @returns {Promise<object|null>} état (voir current)
   */
  async function load(routes) {
    request?.abort();
    const { points, plan } = windPoints(routes);
    if (!points.length) { current = null; return null; }
    const url = buildWindUrl(points);
    const state = { routes, points, plan, forecast: null, failed: false, at: Date.now() };
    current = state;
    const hit = cache.get(url);
    if (hit) {
      state.forecast = parseWind(hit, points.length);
      ctx.onChange?.();
      return state;
    }
    const ctrl = new AbortController();
    request = ctrl;
    try {
      const json = await ask(url, points.length, ctrl.signal);
      cache.set(url, json);
      state.forecast = parseWind(json, points.length);
    } catch {
      if (ctrl.signal.aborted && current !== state) return null;
      state.failed = true;
    } finally {
      if (request === ctrl) request = null;
    }
    if (current === state) ctx.onChange?.();
    return current === state ? state : null;
  }

  return {
    load,
    get current() {
      return current;
    },
    /** En cours de requête ? */
    get busy() {
      return !!request;
    },
    clear() {
      request?.abort();
      request = null;
      current = null;
    },
  };
}
