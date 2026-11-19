// Point d'entrée : état, stockage, service worker, assemblage des écrans.

import { $, showMessage } from './ui/dom.js';
import { createStore, memoryStorage, activeVehicle, addTrip } from './lib/store.js';
import { createThemeController } from './ui/theme.js';
import { createMap } from './ui/map.js';
import { createRouteForm } from './ui/route-form.js';
import { renderSummary } from './ui/summary.js';
import { createSettings } from './ui/settings.js';
import { createVehicles } from './ui/vehicles.js';
import { fetchRoute } from './ui/api.js';

function pickStorage() {
  try {
    const k = 'gabarit.__test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return memoryStorage(); // navigation privée stricte : rien n'est gardé
  }
}

const store = createStore(pickStorage());
let data = store.load();
const messageNode = $('#message');
const summaryNode = $('#summary');

function update(fn) {
  data = fn(data);
  store.save(data);
  refreshHeader();
}

function refreshHeader() {
  $('#active-vehicle-name').textContent = activeVehicle(data)?.name ?? '—';
}

function errorText(err) {
  if (!err) return '';
  return typeof err === 'string' ? err : err.message;
}

// Thème + carte
let map = null;
const theme = createThemeController((t) => map?.setTheme(t));
theme.setMode(data.settings.theme);
map = createMap($('#map'), $('#map-fallback'), theme.theme);
window.addEventListener('resize', () => map.resize());

// Écrans
const settings = createSettings({
  store,
  getData: () => data,
  onDataReplaced: (d) => { update(() => d); theme.setMode(d.settings.theme); },
  onThemeChange: (mode) => { update((d) => ({ ...d, settings: { ...d.settings, theme: mode } })); theme.setMode(mode); },
});
createVehicles({ getData: () => data, update });

const form = createRouteForm({
  getApiKey: () => store.getApiKey(),
  initial: data.settings,
  onOptionsChange: (o) => update((d) => ({ ...d, settings: { ...d.settings, ...o } })),
  onPosition: (lonlat) => map.setMyPosition(lonlat),
  onError: (err) => showMessage(messageNode, errorText(err)),
  onSubmit: async (p) => {
    const vehicle = activeVehicle(data);
    showMessage(messageNode, '');
    form.setBusy(true);
    try {
      const route = await fetchRoute({ apiKey: store.getApiKey(), vehicle, ...p });
      map.showRoute(route.coordinates, route.bbox);
      renderSummary(summaryNode, { route, vehicle, toLabel: p.toLabel, avoidTolls: p.avoidTolls, avoidFerries: p.avoidFerries });
      update((d) => addTrip(d, {
        date: new Date().toISOString(), from: p.fromLabel, to: p.toLabel, vehicleId: vehicle.id,
        distance: route.distance, duration: route.duration, tollDistance: route.tollDistance,
      }));
    } catch (err) {
      summaryNode.hidden = true;
      showMessage(messageNode, errorText(err) || 'Erreur inattendue pendant le calcul.');
    } finally {
      form.setBusy(false);
    }
  },
});

refreshHeader();
if (!store.getApiKey()) {
  showMessage(messageNode, 'Bienvenue ! Commence par saisir ta clé OpenRouteService dans Réglages (⚙).', 'info');
}
window.addEventListener('offline', () => showMessage(messageNode, 'Hors ligne : le calcul d\'itinéraire a besoin du réseau.'));
window.addEventListener('online', () => showMessage(messageNode, ''));

// Stockage persistant (évite que le navigateur efface les données)
(async () => {
  if (!navigator.storage?.persist) { settings.setPersistStatus('Stockage persistant non disponible sur ce navigateur.'); return; }
  const already = await navigator.storage.persisted();
  const ok = already || await navigator.storage.persist();
  settings.setPersistStatus(ok
    ? 'Stockage persistant activé : le navigateur ne videra pas ces données.'
    : 'Stockage persistant refusé par le navigateur : installe l\'appli et exporte régulièrement tes données.');
})();

// Service worker + bandeau « Nouvelle version »
if ('serviceWorker' in navigator) {
  const banner = $('#update-banner');
  const hadController = !!navigator.serviceWorker.controller; // pas de rechargement à la 1re installation
  let reloading = false;
  const offerUpdate = (worker) => {
    banner.hidden = false;
    banner.onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { type: 'module', scope: './' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
    // Vérifie les mises à jour au retour sur l'appli.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}
