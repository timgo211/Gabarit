// Vent fort (phase 5, PR B) : une requête Open-Meteo (GET) par calcul d'itinéraire, pour tous les itinéraires
// proposés. Résultat gardé sur l'appareil (src/lib/wind.js, localStorage, 3 h), jamais dans le cache du service
// worker (autre domaine : sw-routing.js ne le met jamais en cache). Échec : « Météo indisponible », jamais bloquant.

import { WIND, windPoints, windUrl, parseWind, windKey, createWindCache } from '../lib/wind.js';

/**
 * @param {{ storage:Storage, onChange:(w:{ status:'idle'|'loading'|'ok'|'failed', forecast:object|null })=>void }} ctx
 */
export function createWeather(ctx) {
  const cache = createWindCache(ctx.storage);
  let current = { status: 'idle', forecast: null };
  let seq = 0;

  function set(w) {
    current = w;
    ctx.onChange?.(w);
  }

  /** Nouveau calcul : prévisions pour les points de tous les itinéraires proposés. */
  async function load(routes) {
    const id = ++seq;
    const points = windPoints(routes);
    if (!points.length) { set({ status: 'failed', forecast: null }); return; }
    const key = windKey(points);
    const hit = cache.get(key);
    if (hit) { set({ status: 'ok', forecast: hit }); return; }
    set({ status: 'loading', forecast: null });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WIND.TIMEOUT_MS);
    try {
      if (!navigator.onLine) throw new Error('hors ligne');
      const res = await fetch(windUrl(points), { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const forecast = parseWind(await res.json(), points);
      if (!forecast) throw new Error('réponse illisible');
      if (id !== seq) return; // un autre calcul a commencé entre-temps
      cache.set(key, forecast);
      set({ status: 'ok', forecast });
    } catch {
      if (id === seq) set({ status: 'failed', forecast: null });
    } finally {
      clearTimeout(timer);
    }
  }

  function clear() {
    seq += 1;
    set({ status: 'idle', forecast: null });
  }

  return {
    load,
    clear,
    get status() { return current.status; },
    get forecast() { return current.forecast; },
  };
}
