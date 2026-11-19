// Point d'entrée : état, stockage, service worker, assemblage des écrans.

import { $, showMessage } from './ui/dom.js';
import { createStore, memoryStorage, activeVehicle, addTrip } from './lib/store.js';
import { createThemeController } from './ui/theme.js';
import { createMap } from './ui/map.js';
import { createRouteForm } from './ui/route-form.js';
import { renderRouteChoice, revealSelectedCard } from './ui/summary.js';
import { createSettings } from './ui/settings.js';
import { createVehicles } from './ui/vehicles.js';
import { fetchRouteOptions } from './ui/api.js';
import { guidanceParams, reroutedOption } from './lib/route-options.js';
import { createVoice } from './ui/voice.js';
import { createWakeLock } from './ui/wake-lock.js';
import { createNavigation } from './ui/navigation.js';
import { createLayerSwitch } from './ui/layer-switch.js';
import { createShare } from './ui/share.js';
import {
  decodeRouteLink, findVariantIndex, SHARED_ROUTE_TEXT, SHARED_ROUTE_NO_KEY_TEXT, VARIANT_MISSING_TEXT,
} from './lib/share.js';

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
const notesNode = $('#route-notes');
const navStartBtn = $('#btn-nav-start');
/**
 * Itinéraires proposés au dernier calcul (sert au guidage et à la simulation) :
 * { options, failures, selected, vehicle, start, end, avoidTolls, avoidFerries, fromLabel, toLabel, startIsMyPosition }.
 */
let choice = null;
/** Dernière position GPS connue [lon, lat] (partage « Ma position »). */
let myPosition = null;
/** Lien de partage reçu : variante à présélectionner au prochain calcul vers la même arrivée. */
let pendingShared = null;

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
const setSetting = (patch) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
// Fond « Plan / Satellite » (à l'arrêt) : choix mémorisé dans les réglages.
const layerSwitch = createLayerSwitch({
  root: $('#layer-switch'),
  message: $('#layer-message'),
  initial: data.settings.mapLayer,
  onChange: (layer) => { setSetting({ mapLayer: layer }); map?.setLayer(layer); },
});
map = createMap($('#map'), $('#map-fallback'), theme.theme, {
  layer: data.settings.mapLayer,
  onLayerView: (view) => layerSwitch.render(view),
});
window.addEventListener('resize', () => map.resize());

// Guidage : voix, écran allumé, navigation (GPS réel ou simulation)
const voice = createVoice({ enabled: data.settings.voice });
let navigation = null;
const wakeLock = createWakeLock((active) => navigation?.setScreenStatus(active));
navigation = createNavigation({
  map,
  voice,
  wakeLock,
  getApiKey: () => store.getApiKey(),
  onVoiceToggle: (on) => setSetting({ voice: on }),
  onSimSpeedChange: (kmh) => setSetting({ simSpeed: kmh }),
  // Recalcul en route (GPS réel) : les autres itinéraires partaient de l'ancien départ, il ne reste que le nouveau.
  onRouteChange: (route) => {
    if (!choice) return;
    choice = {
      ...choice, options: [reroutedOption(choice.options[choice.selected], route)], failures: [], selected: 0,
      start: route.coordinates[0], startIsMyPosition: true, // recalcul depuis la position GPS
    };
    renderChoice();
  },
  onEnd: (message) => {
    if (choice) map.showRoutes(choice.options.map((o) => o.route), choice.selected);
    if (message) showMessage(messageNode, message);
  },
});

function renderChoice() {
  if (!choice) return;
  renderRouteChoice(summaryNode, notesNode, { choice, dieselPrice: data.settings.dieselPrice, onSelect: selectRoute });
}

/** Choix d'un itinéraire (fiche ou tracé touché), à l'arrêt seulement : l'écran de guidage masque tout ça. */
function selectRoute(index) {
  if (!choice || navigation.active || index === choice.selected || !choice.options[index]) return;
  choice = { ...choice, selected: index };
  map.selectRoute(index);
  renderChoice();
  revealSelectedCard(summaryNode);
}
map.onRoutePick(selectRoute);

function startGuidance(simulate = null) {
  if (!choice) return 'Calcule d\'abord un itinéraire (bouton « Calculer l\'itinéraire »).';
  const option = choice.options[choice.selected];
  showMessage(messageNode, '');
  navigation.start({
    route: option.route,
    vehicle: choice.vehicle,
    // Le recalcul en route garde les réglages de l'itinéraire choisi (plus court, sans péage…).
    params: guidanceParams(option, choice),
    simulate,
  });
  return null;
}
navStartBtn.addEventListener('click', () => startGuidance(null));

// Écrans
const settings = createSettings({
  store,
  getData: () => data,
  onDataReplaced: (d) => { update(() => d); theme.setMode(d.settings.theme); voice.setEnabled(d.settings.voice); },
  onThemeChange: (mode) => { setSetting({ theme: mode }); theme.setMode(mode); },
  onVoiceChange: (on) => { setSetting({ voice: on }); voice.setEnabled(on); },
  onTestVoice: () => {
    if (!voice.supported) return 'Synthèse vocale indisponible sur ce navigateur (essaie Chrome).';
    voice.speak('Dans 500 mètres, tournez à droite.', { interrupt: true, force: true });
    const name = voice.voiceName ? ` (${voice.voiceName})` : '';
    return `Tu dois entendre « Dans 500 mètres, tournez à droite »${name}.${voice.enabled ? '' : ' Annonces coupées pendant le guidage.'}`;
  },
  onSimSpeedChange: (kmh) => setSetting({ simSpeed: kmh }),
  onSimulate: () => startGuidance({ speedKmh: data.settings.simSpeed }),
  onDieselPriceChange: (price) => { setSetting({ dieselPrice: price }); renderChoice(); },
});
createVehicles({ getData: () => data, update });

const form = createRouteForm({
  getApiKey: () => store.getApiKey(),
  initial: data.settings,
  onOptionsChange: (o) => update((d) => ({ ...d, settings: { ...d.settings, ...o } })),
  onPosition: (lonlat) => { myPosition = lonlat; map.setMyPosition(lonlat); },
  onError: (err) => showMessage(messageNode, errorText(err)),
  onSubmit: async (p) => {
    const vehicle = activeVehicle(data);
    showMessage(messageNode, '');
    form.setBusy(true);
    try {
      const { options, failures } = await fetchRouteOptions({ apiKey: store.getApiKey(), vehicle, ...p });
      // Lien partagé : la variante choisie par l'expéditeur est présélectionnée (choix modifiable à l'arrêt).
      let selected = 0;
      const shared = pendingShared;
      pendingShared = null;
      if (shared && shared.end[0] === p.end[0] && shared.end[1] === p.end[1] && shared.variant !== 'recommended') {
        const i = findVariantIndex(options, shared.variant);
        if (i >= 0) selected = i;
        else showMessage(messageNode, VARIANT_MISSING_TEXT, 'info');
      }
      choice = {
        options, failures, selected, vehicle, start: p.start, end: p.end,
        avoidTolls: p.avoidTolls, avoidFerries: p.avoidFerries, fromLabel: p.fromLabel, toLabel: p.toLabel,
        startIsMyPosition: p.startIsMyPosition,
      };
      // Fiches d'abord : le panneau grandit et la carte rétrécit ; le cadrage se fait ensuite sur la bonne taille.
      renderChoice();
      navStartBtn.hidden = false;
      map.showRoutes(options.map((o) => o.route), selected);
      const route = options[0].route;
      update((d) => addTrip(d, {
        date: new Date().toISOString(), from: p.fromLabel, to: p.toLabel, vehicleId: vehicle.id,
        distance: route.distance, duration: route.duration, tollDistance: route.tollDistance,
      }));
    } catch (err) {
      summaryNode.hidden = true;
      notesNode.hidden = true;
      navStartBtn.hidden = true;
      choice = null;
      showMessage(messageNode, errorText(err) || 'Erreur inattendue pendant le calcul.');
    } finally {
      form.setBusy(false);
    }
  },
});

createShare({ getChoice: () => choice, getMyPosition: () => myPosition });

/**
 * Lien de partage reçu (# de l'URL) : formulaire pré-rempli, jamais de calcul ni de guidage automatique.
 * Le # est effacé ensuite (un rechargement ne le resert pas). Aucun texte reçu n'est inséré en HTML.
 */
function readSharedLink() {
  const result = decodeRouteLink(window.location.hash);
  if (!result) return;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    // history indisponible : sans conséquence
  }
  if (navigation.active) return; // aucune saisie pendant le guidage
  if (!result.ok) { showMessage(messageNode, result.error); return; }
  const shared = result.route;
  form.prefill(shared);
  pendingShared = { end: [shared.to.lon, shared.to.lat], variant: shared.variant };
  showMessage(messageNode, store.getApiKey() ? SHARED_ROUTE_TEXT : SHARED_ROUTE_NO_KEY_TEXT, 'info');
}

refreshHeader();
if (!store.getApiKey()) {
  showMessage(messageNode, 'Bienvenue ! Commence par saisir ta clé OpenRouteService dans Réglages (⚙).', 'info');
}
readSharedLink();
window.addEventListener('hashchange', readSharedLink);
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
