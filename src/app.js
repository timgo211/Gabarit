// Point d'entrée : état, stockage, service worker, assemblage des écrans.

import { $, showMessage } from './ui/dom.js';
import { createStore, memoryStorage, activeVehicle, addTrip } from './lib/store.js';
import { createThemeController } from './ui/theme.js';
import { createMap } from './ui/map.js';
import { createRouteForm } from './ui/route-form.js';
import { renderRouteChoice, revealSelectedCard } from './ui/summary.js';
import { createSettings } from './ui/settings.js';
import { createVehicles } from './ui/vehicles.js';
import { fetchRouteOptions, fetchRoute } from './ui/api.js';
import { guidanceParams, reroutedOption, noZfeOption } from './lib/route-options.js';
import { ZFE, parseZfeData, avoidPolygonsFor } from './lib/zfe.js';
import { routeRules, rulesSourceText } from './lib/route-rules.js';
import { createVoice } from './ui/voice.js';
import { createWakeLock } from './ui/wake-lock.js';
import { createNavigation } from './ui/navigation.js';
import { createLayerSwitch } from './ui/layer-switch.js';
import { createShare } from './ui/share.js';
import {
  decodeRouteLink, findVariantIndex, SHARED_ROUTE_TEXT, SHARED_ROUTE_NO_KEY_TEXT, VARIANT_MISSING_TEXT,
} from './lib/share.js';
import { arrowColors } from './lib/prefs.js';
import { coordsLabel } from './lib/coords.js';
import { canDuckMedia } from './ui/voice.js';
import { createAreas } from './ui/areas.js';
import { createWeather } from './ui/weather.js';
import { loadDriving, saveDriving, emptyDriving } from './lib/driving-time.js';

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

const storage = pickStorage();
const store = createStore(storage);
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
let navigation = null;
/** Couleur de la flèche du camion (phase 7c) : choix de Réglages, « auto » selon le thème. */
function applyArrowColor(t = theme?.theme) {
  const c = arrowColors(data.settings.arrowColor, t);
  document.documentElement.style.setProperty('--arrow-fill', c.fill);
  document.documentElement.style.setProperty('--arrow-stroke', c.stroke);
}
const theme = createThemeController((t) => { map?.setTheme(t); applyArrowColor(t); });
applyArrowColor();
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
  onLayerView: (view) => { layerSwitch.render(view); navigation?.setLayerView(view); },
});
window.addEventListener('resize', () => map.resize());

// Guidage : voix, écran allumé, navigation (GPS réel ou simulation)
const voice = createVoice({
  enabled: data.settings.voice, name: data.settings.voiceName, rate: data.settings.voiceRate, volume: data.settings.voiceVolume,
});
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
    areas.reroute(route); // mêmes aires replacées sur le nouvel itinéraire, sans requête
  },
  onAreaOpen: (id) => areas.openSheet(id),
  onView: () => areas.refreshDrive(),
  // Temps de conduite (phase 5) : décompte gardé sur l'appareil, hors des données exportées.
  onDriving: (d) => saveDriving(storage, d),
  onEnd: (message) => {
    map.setLayer(data.settings.mapLayer); // le satellite du guidage n'est pas mémorisé
    if (choice) map.showRoutes(choice.options.map((o) => o.route), choice.selected);
    if (message) showMessage(messageNode, message);
  },
});

// Aires et parkings PL du trajet (phase 9).
const areas = createAreas({
  map,
  storage,
  getData: () => data,
  update,
  getDrive: () => ({ navigating: navigation.active, speedKmh: navigation.speedKmh }),
  getRoute: () => (choice ? choice.options[choice.selected]?.route ?? null : null),
  onPool: (pool) => navigation.setAreas(pool),
});

// Vent fort (phase 5) : une requête Open-Meteo par calcul ; prévisions placées sur l'itinéraire choisi.
const weather = createWeather({
  storage,
  onChange: (w) => {
    if (w.status === 'ok') navigation.setWind(w.forecast);
    renderChoice();
  },
});

// ───────── Réglementation (phase 5) : ZFE (data/zfe.json) et interdictions PL ─────────
/** ZFE lues (parseZfeData), null tant qu'elles ne sont pas arrivées ou si le fichier est illisible. */
let zfeData = null;
let zfeFailed = false;
let avoidBusy = false;
fetch(ZFE.DATA_PATH, { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    zfeData = j ? parseZfeData(j) : null;
    zfeFailed = !zfeData;
  })
  .catch(() => { zfeFailed = true; })
  .finally(() => renderChoice());

/** Vent : prévisions, état de la requête et seuil de Réglages. */
function windCtx() {
  return { status: weather.status, forecast: weather.forecast, threshold: data.settings.windGust };
}

/**
 * Réglementation déjà calculée par itinéraire (même minute de départ, mêmes données, même décompte de conduite) :
 * un toucher ne recalcule rien.
 */
const rulesCache = new WeakMap();
function rulesOf(route, vehicle, departure) {
  const minute = Math.floor(departure.getTime() / 60000);
  const hit = rulesCache.get(route);
  const w = windCtx();
  const sig = `${w.status}:${w.threshold}`;
  const driving = loadDriving(storage);
  const dsig = JSON.stringify([driving.at, driving.sinceBreak, driving.day, driving.mode, driving.stopWork]);
  if (hit && hit.minute === minute && hit.zfe === zfeData && hit.vehicle === vehicle && hit.forecast === w.forecast
    && hit.sig === sig && hit.dsig === dsig) return hit.rules;
  const rules = routeRules(route, { vehicle, departure, zfe: zfeData, driving, wind: w });
  rulesCache.set(route, { minute, zfe: zfeData, vehicle, forecast: w.forecast, sig, dsig, rules });
  return rules;
}

/** Réglementation de chaque itinéraire proposé, d'après l'heure de départ (maintenant). */
function choiceRules() {
  if (!choice) return null;
  const departure = new Date();
  return choice.options.map((o) => {
    const r = { ...rulesOf(o.route, choice.vehicle, departure) };
    r.lines = [...r.lines];
    if (zfeFailed) r.lines.unshift({ level: 'info', text: 'Zones à faibles émissions indisponibles (fichier non chargé) : vérifie la signalisation.' });
    return r;
  });
}

/** Contours des ZFE traversées par l'itinéraire choisi (rouge : interdite au véhicule). */
function showZfeOnMap(rules) {
  const passages = rules?.[choice?.selected ?? 0]?.passages ?? [];
  const seen = new Map();
  for (const p of passages) {
    const prev = seen.get(p.zone);
    seen.set(p.zone, { name: p.name, banned: p.banned || !!prev?.banned, polygons: p.zone.polygons });
  }
  map.showZfe([...seen.values()]);
}

/**
 * « Éviter la ZFE » (à l'arrêt) : une requête ORS avec les ZFE interdites en options.avoid_polygons, mêmes réglages
 * que l'itinéraire choisi. Limites de l'API publique (150 km à vol d'oiseau…) : message clair, pas de requête.
 */
async function avoidZfe() {
  if (!choice || navigation.active || avoidBusy) return;
  const option = choice.options[choice.selected];
  const rules = rulesOf(option.route, choice.vehicle, new Date());
  const zones = [...new Set(rules.banned.map((p) => p.zone))];
  const plan = avoidPolygonsFor(zones, { start: choice.start, end: choice.end });
  if (!plan.ok) { showMessage(messageNode, plan.text); return; }
  avoidBusy = true;
  renderChoice();
  showMessage(messageNode, '');
  try {
    const route = await fetchRoute({
      apiKey: store.getApiKey(), vehicle: choice.vehicle, start: choice.start, end: choice.end,
      avoidTolls: option.request.avoidTolls, avoidFerries: choice.avoidFerries, preference: option.request.preference ?? null,
      avoidPolygons: plan.geometry,
    });
    if (!choice || navigation.active) return;
    const nz = noZfeOption(option, route, plan.geometry, zones.map((z) => z.name));
    const options = [...choice.options.filter((o) => o.key !== 'nozfe'), nz];
    choice = { ...choice, options, selected: options.length - 1 };
    map.showRoutes(options.map((o) => o.route), choice.selected);
    areas.select(route); // aires déjà trouvées replacées (la requête Overpass couvrait les premiers itinéraires)
    const still = rulesOf(route, choice.vehicle, new Date()).banned;
    if (still.length) showMessage(messageNode, `L'itinéraire « Sans ZFE » passe encore par : ${still.map((p) => p.name).join(', ')}.`, 'info');
  } catch (err) {
    showMessage(messageNode, `Éviter la ZFE : ${errorText(err) || 'calcul impossible.'}`);
  } finally {
    avoidBusy = false;
    renderChoice();
  }
}

function renderChoice() {
  if (!choice) return;
  const rules = choiceRules();
  renderRouteChoice(summaryNode, notesNode, {
    choice, dieselPrice: data.settings.dieselPrice, onSelect: selectRoute,
    rules, rulesSource: rulesSourceText(zfeData), onAvoidZfe: avoidZfe, avoidBusy,
    windCredit: weather.status === 'ok',
  });
  showZfeOnMap(rules);
}

/** Choix d'un itinéraire (fiche ou tracé touché), à l'arrêt seulement : l'écran de guidage masque tout ça. */
function selectRoute(index) {
  if (!choice || navigation.active || index === choice.selected || !choice.options[index]) return;
  choice = { ...choice, selected: index };
  map.selectRoute(index);
  renderChoice();
  areas.select(choice.options[index].route);
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
    areas: areas.pool,
    announceAreas: data.settings.areaVoice,
    rules: { vehicle: choice.vehicle, zfe: zfeData, voice: data.settings.ruleVoice },
    driving: loadDriving(storage),
    driveVoice: data.settings.driveVoice,
    wind: weather.forecast,
    windGust: data.settings.windGust,
    windVoice: data.settings.windVoice,
  });
  return null;
}
navStartBtn.addEventListener('click', () => startGuidance(null));

// Écrans
const settings = createSettings({
  store,
  getData: () => data,
  onDataReplaced: (d) => {
    update(() => d);
    theme.setMode(d.settings.theme);
    voice.setEnabled(d.settings.voice);
    voice.setOptions({ name: d.settings.voiceName, rate: d.settings.voiceRate, volume: d.settings.voiceVolume });
    applyArrowColor();
  },
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
  getVoices: () => voice.voices(),
  onVoicesChanged: (cb) => voice.onVoicesChanged(cb),
  canDuckMedia,
  onVoiceOptions: (o) => {
    voice.setOptions(o);
    setSetting({ voiceName: o.name, voiceRate: o.rate, voiceVolume: o.volume });
  },
  onArrowColor: (c) => { setSetting({ arrowColor: c }); applyArrowColor(); },
  onAreaVoiceChange: (on) => setSetting({ areaVoice: on }),
  onRuleVoiceChange: (on) => setSetting({ ruleVoice: on }),
  onDriveVoiceChange: (on) => setSetting({ driveVoice: on }),
  onWindVoiceChange: (on) => setSetting({ windVoice: on }),
  onWindGustChange: (g) => { setSetting({ windGust: g }); renderChoice(); },
  onDrivingReset: () => { saveDriving(storage, emptyDriving()); renderChoice(); },
});
createVehicles({ getData: () => data, update });

const form = createRouteForm({
  getApiKey: () => store.getApiKey(),
  initial: data.settings,
  onOptionsChange: (o) => update((d) => ({ ...d, settings: { ...d.settings, ...o } })),
  onPosition: (lonlat) => { myPosition = lonlat; map.setMyPosition(lonlat); },
  onError: (err) => showMessage(messageNode, errorText(err)),
  // Saisie dans un champ : le point choisi par appui long est oublié, son repère retiré.
  onEdit: (which) => map.clearPin(which === 'to' ? 'pinTo' : 'pinFrom'),
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
      areas.load(choice); // une requête Overpass pour tous les itinéraires proposés, sans bloquer le calcul
      weather.load(options.map((o) => o.route)); // une requête Open-Meteo, sans bloquer non plus
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
      areas.clear();
      weather.clear();
      map.showZfe([]);
      showMessage(messageNode, errorText(err) || 'Erreur inattendue pendant le calcul.');
    } finally {
      form.setBusy(false);
    }
  },
});

createShare({ getChoice: () => choice, getMyPosition: () => myPosition });

/**
 * Appui long sur la carte (phase 8, à l'arrêt) : « Aller ici » ou « Partir d'ici » remplit le champ, sans rien
 * calculer (le conducteur touche ensuite « Calculer l'itinéraire »). Panneau fixe en bas de l'écran (toujours entier,
 * même quand la carte est petite sur un téléphone) et repère sur la carte.
 */
const pressSheet = $('#press-sheet');
let pressPlace = null;
function closePress() {
  pressSheet.hidden = true;
  pressPlace = null;
  map.clearPin();
}
map.onLongPress((lonlat) => {
  if (navigation.active) return;
  pressPlace = { lon: lonlat[0], lat: lonlat[1], label: coordsLabel({ lon: lonlat[0], lat: lonlat[1] }) };
  $('#press-coords').textContent = `Point choisi : ${pressPlace.label}`;
  pressSheet.hidden = false;
  map.showPin(lonlat);
});
map.onMapTap(() => { if (!pressSheet.hidden) closePress(); });
const usePress = (which) => () => {
  if (!pressPlace) return;
  const place = pressPlace;
  closePress();
  form.setPlace(which, place);
  map.showPin([place.lon, place.lat], which === 'to' ? 'pinTo' : 'pinFrom'); // repère gardé jusqu'à une saisie
  showMessage(messageNode, which === 'to'
    ? `Arrivée : ${place.label}. Touche « Calculer l'itinéraire ».`
    : `Départ : ${place.label}.`, 'info');
};
$('#btn-press-to').addEventListener('click', usePress('to'));
$('#btn-press-from').addEventListener('click', usePress('from'));
$('#btn-press-close').addEventListener('click', closePress);

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
