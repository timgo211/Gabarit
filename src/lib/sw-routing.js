// Stratégie de cache du service worker, en fonction pure (testable).
// - 'network-first' : fichiers de l'appli (même origine) → réseau, cache en secours hors ligne.
// - 'cache-first'   : MapLibre épinglé sur unpkg (URL versionnée, immuable).
// - 'bypass'        : tout le reste (API ORS/Pelias, tuiles, styles de carte…) → jamais mis en cache.

export const MAPLIBRE_ASSETS = [
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
];

/**
 * @param {string} method  méthode HTTP
 * @param {string} url     URL absolue de la requête
 * @param {string} appOrigin  origine du service worker (self.location.origin)
 * @returns {'network-first'|'cache-first'|'bypass'}
 */
export function cacheStrategy(method, url, appOrigin) {
  if (method !== 'GET') return 'bypass';
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'bypass';
  }
  if (MAPLIBRE_ASSETS.includes(u.href)) return 'cache-first';
  if (u.origin !== appOrigin) return 'bypass';
  // Données dynamiques éventuelles servies par l'appli (data/*.json, phase 5) : réseau aussi.
  return 'network-first';
}
