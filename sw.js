// Service worker de Gabarit (module ES). Chemins relatifs à l'emplacement de ce fichier.
// Interface : network-first (la tablette reçoit toujours la dernière version, cache en secours hors ligne).
// Requêtes vers d'autres domaines (itinéraires, géocodage, aires, tuiles, styles de carte) : jamais mises en cache
// (voir src/lib/sw-routing.js). Requêtes POST (aires OpenStreetMap) : jamais interceptées.
// ⚠️ Incrémenter VERSION à chaque modification des fichiers listés ci-dessous.

import { cacheStrategy, MAPLIBRE_ASSETS } from './src/lib/sw-routing.js';

const VERSION = 'v12';
const CACHE = `gabarit-${VERSION}`;

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/styles.css',
  './src/app.js',
  './src/lib/areas-avis.js',
  './src/lib/areas-cache.js',
  './src/lib/areas-official.js',
  './src/lib/areas-osm.js',
  './src/lib/areas-route.js',
  './src/lib/config.js',
  './src/lib/coords.js',
  './src/lib/format.js',
  './src/lib/map-layers.js',
  './src/lib/nav-anim.js',
  './src/lib/nav-geo.js',
  './src/lib/nav-guidance.js',
  './src/lib/nav-sim.js',
  './src/lib/navigation.js',
  './src/lib/ors-errors.js',
  './src/lib/ors-request.js',
  './src/lib/ors-response.js',
  './src/lib/prefs.js',
  './src/lib/route-options.js',
  './src/lib/share.js',
  './src/lib/store.js',
  './src/lib/sw-routing.js',
  './src/lib/theme.js',
  './src/lib/vehicle.js',
  './src/ui/api.js',
  './src/ui/areas.js',
  './src/ui/dom.js',
  './src/ui/layer-switch.js',
  './src/ui/map.js',
  './src/ui/nav-icon.js',
  './src/ui/navigation.js',
  './src/ui/route-form.js',
  './src/ui/settings.js',
  './src/ui/share.js',
  './src/ui/summary.js',
  './src/ui/theme.js',
  './src/ui/vehicles.js',
  './src/ui/voice.js',
  './src/ui/wake-lock.js',
].map((p) => new URL(p, self.location).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' : ignore le cache HTTP pour récupérer la version réellement publiée.
    await cache.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' })));
    // MapLibre : best effort (ne bloque pas l'installation si unpkg est injoignable).
    await Promise.all(MAPLIBRE_ASSETS.map((u) => cache.add(new Request(u, { mode: 'cors' })).catch(() => {})));
  })());
  // Pas de skipWaiting automatique : l'appli affiche « Nouvelle version disponible ».
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('gabarit-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache : revalide auprès de GitHub Pages (ETag) au lieu de servir une copie HTTP périmée.
    const response = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page = await cache.match(new URL('./index.html', self.location).href);
      if (page) return page;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = cacheStrategy(request.method, request.url, self.location.origin);
  if (strategy === 'bypass') return; // le navigateur gère la requête, sans cache
  event.respondWith(strategy === 'cache-first' ? cacheFirst(request) : networkFirst(request));
});
