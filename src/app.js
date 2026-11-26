// Point d'entrée : état, stockage, service worker, assemblage des écrans.

import { $, el, showMessage } from './ui/dom.js';
import { createStore, memoryStorage, activeVehicle, addTrip } from './lib/store.js';
import { createThemeController } from './ui/theme.js';
import { createMap } from './ui/map.js';
import { createRouteForm, attachAutocomplete, recentPlaces, setRecentEditGuard, setSavedPlaces } from './ui/route-form.js';
import { createSavedPlaces } from './ui/saved-places.js';
import { recentEditAllowed } from './lib/recent-places.js';
import { stopPoints, insertStopByRoute, shownStopPoints } from './lib/stops.js';
import { renderRouteChoice, revealSelectedCard } from './ui/summary.js';
import { createSettings } from './ui/settings.js';
import { createVehicles } from './ui/vehicles.js';
import { fetchRouteOptions, fetchRoute, fetchAvoidRoute } from './ui/api.js';
import { createPlanPark } from './ui/plan-park.js';
import {
  guidanceParams, reroutedOption, noZfeOption, noTunnelOption, noLocalOption, optionStops, rocadeOption,
} from './lib/route-options.js';
import {
  LYON_BYPASS, LYON_STILL_TEXT, lyonBypassPlan, withBypassStops, bypassCost, bypassNote,
  LYON_AUTO, autoBypassStart, autoCost, autoNote, applyAutoBypass,
} from './lib/lyon-bypass.js';
import {
  BANS, routeBans, activeBans, localQuestions, declaredText, confirmText, avoidingBansText, rangeCoords, pointAt as pointAlong,
} from './lib/route-bans.js';
import {
  DETOUR, planDetour, detourNote, detourCost, detourFailText, detourOption, applyDetour, allDeclared, legAvoid,
} from './lib/ban-detour.js';
import { prepareLine, locateOnLine } from './lib/nav-geo.js';
import { avoidLocalFor } from './lib/access-local.js';
import { plageShort } from './lib/access-conditional.js';
import { createAccess } from './ui/access.js';
import { createBridges, createTileCopy } from './ui/bridges.js';
import { AXES } from './lib/axes-convert.js';
import { parseAxesTile, mergeAxesTiles } from './lib/axis-match.js';
import { SENSITIVE, parseSensitiveTile, mergeSensitiveTiles, parseSensitiveSections } from './lib/sensitive-points.js';
import { createWeightLimits } from './ui/weight-limits.js';
import { createSpeedLimits } from './ui/speed-limits.js';
import { createDirections } from './ui/directions.js';
import { createPlaces } from './ui/places.js';
import { createLanes } from './ui/lanes.js';
import { createRestrictions } from './ui/restrictions.js';
import { createReports } from './ui/reports.js';
import { reportLabel, reportStatus } from './lib/reports.js';
import { restrictionsForTrip, restrictionLines, mergeAvoid } from './lib/restrictions.js';
import { createWinter } from './ui/winter.js';
import { TOLLS, parseTollData } from './lib/hgv-tolls.js';
import { TOLLS_GEO, parseTollNetwork } from './lib/hgv-tolls-geo.js';
import { serviceDetailText } from './lib/ors-errors.js';
import {
  ADR, parseTunnelData, effectiveCode, avoidTunnelsFor, avoidingOptionsText, tunnelName, avoidTunnelAllowed, AVOID_PARKED_TEXT,
} from './lib/adr.js';
import { ZFE, parseZfeData, avoidPolygonsFor, avoidForReroute } from './lib/zfe.js';
import { routeRules, rulesSourceText, confirmedTunnelBans } from './lib/route-rules.js';
import { COUNTRY_RULES, countryDataPath, parseCountryData } from './lib/country-rules.js';
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
import { placeAlongRoute } from './lib/areas-route.js';
import { loadDriving, saveDriving, emptyDriving } from './lib/driving-time.js';
import { buildSave, checkSave, restoredChoice, saveKey, shouldSave, RESUME_QUESTION } from './lib/route-save.js';
import { createRouteStore } from './ui/route-save.js';
import { createHistoryStore } from './ui/trip-history.js';
import { createHistoryPanel } from './ui/history.js';
import { buildTrip } from './lib/trip-history.js';
import { FUEL, lazyLoader, toggleFuelStation } from './lib/fuel-stations.js';

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
const fuelBtn = $('#btn-fuel'); // phase 4 : carburant sur le trajet
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
let reportsUi = null; // phase 3a (créé plus bas, après la carte)
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
  nightLevel: data.settings.nightMapLevel, // phase 2d : luminosité de la carte la nuit
  vehicleIcon: data.settings.vehicleIcon, // v45 : flèche ou camion
  onLayerView: (view) => { layerSwitch.render(view); navigation?.setLayerView(view); },
});
window.addEventListener('resize', () => map.resize());

// v62 : panneau de préparation repliable par sa poignée (carte seule) ; état gardé dans les réglages. Un champ qui
// prend le focus (message « Choisis l'arrivée… ») le rouvre.
const panelGrip = $('#btn-panel-grip');
function applyPanel(collapsed) {
  $('.app').classList.toggle('panel-collapsed', collapsed);
  panelGrip.setAttribute('aria-expanded', String(!collapsed));
  $('#panel-grip-text').textContent = collapsed ? "Afficher l'itinéraire" : "Masquer l'itinéraire";
  requestAnimationFrame(() => map.resize());
}
function setPanelCollapsed(collapsed) {
  if (collapsed === data.settings.panelCollapsed) return;
  setSetting({ panelCollapsed: collapsed });
  applyPanel(collapsed);
}
panelGrip.addEventListener('click', () => setPanelCollapsed(!data.settings.panelCollapsed));
$('#panel-body').addEventListener('focusin', () => setPanelCollapsed(false));
applyPanel(data.settings.panelCollapsed);

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
  onRouteChange: (route, stops = []) => {
    if (!choice) return;
    const left = Array.isArray(stops) ? stops : [];
    // v76 : points de passage techniques (« Rocade Est ») gardés par la fiche recalculée, jamais comptés comme étapes.
    const rerouted = reroutedOption(choice.options[choice.selected], route);
    choice = {
      ...choice, options: [left.some((x) => x.via === true) ? { ...rerouted, stops: left } : rerouted], failures: [], selected: 0,
      start: route.coordinates[0], startIsMyPosition: true, // recalcul depuis la position GPS
      stops: left.filter((x) => x.via !== true), // v55 : étapes non atteintes, celles du nouveau tracé
    };
    renderChoice();
    areas.reroute(route); // mêmes aires replacées sur le nouvel itinéraire, sans requête
    access.extend(route); // phase 5d : cases de data/acces-osm/ manquantes pour le nouveau tracé
    bridges.extend(route); // phase 12a : cases de data/ponts-osm/ manquantes
    axes.extend(route); // PR 3a : cases de data/axes-osm/ manquantes
    sensitive.extend(route); // PR 3b : cases de data/points-sensibles/ manquantes
    weightLimits.extend(route); // phase 12a bis : cases de data/poids-osm/ manquantes
    speedLimits.extend(route); // phase 11a : cases de data/vitesses-osm/ manquantes
    directions.extend(route); // phase 11b : cases de data/directions-osm/ manquantes
    places.extend(route); // phase 11c : cases de data/lieux-osm/ manquantes
    lanes.extend(route); // phase 11d : cases de data/voies-osm/ manquantes
    winter.extend(route); // phase 5f : cases de data/hiver/ manquantes
  },
  onAreaOpen: (id) => areas.openSheet(id),
  areaFacts: (id) => areas.shortFacts(id),
  onView: () => { areas.refreshDrive(); saveRoute(); },
  // v53 : sauvegarde de l'itinéraire effacée à l'arrivée et quand le guidage est quitté (✕ puis « Quitter »).
  onArrived: (trip) => { forgetRoute(); recordTrip(trip); },
  onStopReached: () => saveRoute({ force: true }), // v55 : étapes atteintes gardées (progress.nextStop)
  onQuit: () => forgetRoute(),
  // v44 : « Autres itinéraires » à l'arrêt ; le choix se ferme dès que le véhicule roule (R412-6-2).
  onAlternatives: (from) => openAlternatives(from),
  onParkChange: (parked) => {
    if (!parked) { closeAlternatives('moving'); closeFuel('moving'); reportsUi?.close(); } // phase 3a : fiche fermée en roulant
    reportsUi?.render();
  },
  // Phase 3a : « Signaler » (un appui) ; le moteur pose le repère, la liste est gardée sur l'appareil.
  getReports: () => data.reports ?? [],
  setReports: (list) => saveReports(list, { fromGuidance: true }),
  onFuel: (from) => openFuel(from), // phase 4 : à l'arrêt seulement
  // Mode nuit automatique (phase 2c) : lever et coucher du soleil à la position du guidage, revue toutes les 5 min.
  onPosition: (lonlat) => theme.setPosition(lonlat, { throttle: true }),
  // Temps de conduite (phase 5) : décompte gardé sur l'appareil, hors des données exportées.
  onDriving: (d) => saveDriving(storage, d),
  onEnd: (message) => {
    saveRoute({ force: true }); // v53 : arrêt sans arrivée ni « Quitter » (GPS absent…) : itinéraire gardé en préparation
    closeAlternatives(); // v44
    reportsUi?.close(); // phase 3a
    map.setLayer(data.settings.mapLayer); // le satellite du guidage n'est pas mémorisé
    if (choice) map.showRoutes(choice.options.map((o) => o.route), choice.selected);
    map.showStops(choice ? stopPoints(choice.stops) : []);
    if (message) showMessage(messageNode, message);
  },
});

// Aires et parkings PL du trajet (phase 9).
const areas = createAreas({
  map,
  storage,
  getData: () => data,
  update,
  // Phase 6 : parked (« Ma note » à l'arrêt seulement) : parkedState en guidage, relevés GPS hors guidage.
  getDrive: () => ({ navigating: navigation.active, speedKmh: navigation.speedKmh, parked: navigation.active ? navigation.parked : !!planPark?.parked }),
  getRoute: () => (choice ? choice.options[choice.selected]?.route ?? null : null),
  onNavPick: (id) => navigation.pickArea(id), // phase 2d : repère touché en guidage
  onPool: (pool) => {
    navigation.setAreas(pool);
    renderChoice(); // pause conseillée replacée sur une aire du trajet
  },
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

// ───────── Tunnels ADR (phase 5b) : data/tunnels-adr.json, chargé seulement pour un véhicule ADR avec code tunnel ─────────
/** { status:'idle'|'loading'|'ok'|'failed', data } ; absent, illisible ou vide → 'failed' (alerte indisponible). */
let tunnels = { status: 'idle', data: null };
let tunnelBusy = false;
let tunnelsPromise = Promise.resolve();
/** Lecture du fichier des tunnels ; la promesse se résout quand il est lu (ou en échec), jamais en erreur. */
function ensureTunnels(vehicle) {
  if (!effectiveCode(vehicle) || tunnels.status === 'loading' || tunnels.status === 'ok') return tunnelsPromise;
  tunnels = { status: 'loading', data: null };
  tunnelsPromise = fetch(ADR.DATA_PATH, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const data = j ? parseTunnelData(j) : null;
      tunnels = data?.ok ? { status: 'ok', data } : { status: 'failed', data: null };
    })
    .catch(() => { tunnels = { status: 'failed', data: null }; })
    .finally(() => {
      navigation.setTunnels(tunnels.status === 'ok' ? tunnels.data : null);
      renderChoice();
    });
  return tunnelsPromise;
}

/**
 * v43 : « Recommandé » jamais par un tunnel interdit confirmé pour le profil (ADR, classe Euro) si un autre itinéraire
 * calculé l'évite. Fichier des tunnels ADR lu avant le classement (fichier local) ; calcul sans requête.
 */
const tunnelBanCheck = (vehicle) => (route) => confirmedTunnelBans(route, { vehicle, tunnels }).length > 0;

// ───────── Accès (phase 5d) : data/acces-osm/, cases touchées par les itinéraires proposés ─────────
let localBusy = false;
const access = createAccess({
  onChange: (st) => {
    navigation.setAccess(st.status === 'ok' ? st.ways : null);
    renderChoice();
  },
});

// ───────── Ponts sans hauteur connue (phase 12a) : data/ponts-osm/, cases touchées par les itinéraires proposés ─────────
const bridges = createBridges({ onChange: () => renderChoice() });
// Repli par la géométrie (PR 3a) : data/axes-osm/ (Action « Audit OSM »), cases touchées par les itinéraires proposés,
// jamais précachées ; références retrouvées pour les étapes ORS sans nom (règles de la fiche seulement, jamais dites).
const axes = createTileCopy({
  indexPath: AXES.INDEX_PATH, dir: AXES.DIR, parse: parseAxesTile, merge: mergeAxesTiles, empty: Object.freeze({ lines: [] }),
  meta: (j) => ({ tolerance: typeof j?.tolerance === 'number' ? j.tolerance : null }),
  onChange: () => renderChoice(),
});
// Points sensibles (PR 3b) : data/points-sensibles/ (fiches de l'audit OSM), cases touchées, jamais précachées ;
// fiche et carte à l'arrêt seulement, jamais dits.
const sensitive = createTileCopy({
  indexPath: SENSITIVE.INDEX_PATH, dir: SENSITIVE.DIR, parse: parseSensitiveTile, merge: mergeSensitiveTiles,
  empty: Object.freeze({ points: [] }), meta: (j) => ({ sections: parseSensitiveSections(j) }),
  onChange: () => renderChoice(),
});
// Limites de poids d'OSM (phase 12a bis) : data/poids-osm/, mêmes cases que les ponts.
const weightLimits = createWeightLimits({ onChange: () => renderChoice() });
// Limitations de vitesse (phase 11a) : fiche, puis guidage (cases arrivées après « Démarrer » ou au recalcul).
const speedLimits = createSpeedLimits({
  onChange: (st) => {
    renderChoice();
    if (navigation?.active) navigation.setSpeeds(st.status === 'ok' ? st.data : null);
  },
});
// Directions des panneaux (phase 11b) : consignes du guidage seulement (cases arrivées après « Démarrer » ou au recalcul).
const directions = createDirections({
  onChange: (st) => { if (navigation?.active) navigation.setDirections(st.status === 'ok' ? st.data : null); },
});
// Lieux « vers X » (phase 11c) : consignes du guidage seulement, affichés, jamais dits ; copie vide → rien.
const places = createPlaces({
  onChange: (st) => { if (navigation?.active) navigation.setPlaces(st.status === 'ok' ? st.data : null); },
});
// Voies à prendre (phase 11d) : rangée sous « Puis » pendant le guidage, jamais dite ; copie vide → rien.
const lanes = createLanes({
  onChange: (st) => { if (navigation?.active) navigation.setLanes(st.status === 'ok' ? st.data : null); },
});
// Repère touché (à l'arrêt) : texte du pont ou de la limite de poids, jamais dit à voix haute.
map.onBridgePick((key) => {
  if (!choice || navigation.active) return;
  const rules = rulesOf(choice.options[choice.selected].route, choice.vehicle, new Date());
  const it = (rules.bridges?.items ?? []).find((x) => bridgeKey(x) === key);
  if (it) { restrictionsUi.openBridge(it); return; } // phase 12b : texte, aide et « Éviter ce passage »
  const w = (rules.weightLimits?.items ?? []).find((x) => weightKey(x) === key);
  if (w) { restrictionsUi.openWeight(w); return; } // phase 12a bis : restriction de poids au point du tracé
  const sp = (rules.sensitive?.items ?? []).find((x) => sensitiveKey(x) === key);
  if (sp) showMessage(messageNode, sp.text, 'info'); // PR 3b : texte du point sensible, jamais dit
});
// Mes restrictions (phase 12b) : Réglages et panneau du repère de pont ; ajout à l'arrêt seulement.
const restrictionsUi = createRestrictions({
  getList: () => data.restrictions ?? [],
  setList: (list) => update((d) => ({ ...d, restrictions: list })),
  getCenter: () => map.center(),
  getDrive: () => ({ navigating: navigation.active, parked: navigation.parked }),
});
// ───────── Phase 3a : mes signalements (fiche du repère, Réglages, repères sur la carte) ─────────
// Modification à l'arrêt confirmé seulement : en guidage parkedState du moteur, hors guidage relevés GPS (plan-park.js)
// tant que la fiche ou Réglages est ouvert ; vitesse inconnue, GPS refusé = en mouvement (boutons grisés).
let settingsOpen = false;
const reportPark = createPlanPark({ onChange: () => reportsUi?.render() });
function syncReportPark() { reportPark.watch(!navigation.active && (settingsOpen || !!reportsUi?.isOpen)); }
function showReportMarkers() {
  map.showReports((data.reports ?? []).map((r) => ({
    id: r.id, lonlat: [r.lon, r.lat], confirmed: r.confirmed === true, label: `Signalement : ${reportLabel(r)} (${reportStatus(r)})`,
  })));
}
function saveReports(list, { fromGuidance = false } = {}) {
  update((d) => ({ ...d, reports: list }));
  if (!fromGuidance && navigation.active) navigation.setReports(data.reports);
  showReportMarkers();
  reportsUi?.render();
}
reportsUi = createReports({
  getList: () => data.reports ?? [],
  setList: (list) => saveReports(list),
  getParked: () => (navigation.active ? navigation.parked : reportPark.parked),
  onOpenChange: () => syncReportPark(),
});
// Repère touché : fiche (en guidage, seulement à l'arrêt ; en roulant, un message bref).
map.onReportPick((id) => {
  if (navigation.active && !navigation.parked) { navigation.notify('Disponible à l\'arrêt'); return; }
  reportsUi.open(id);
});
showReportMarkers();
const bridgeKey = (it) => `${it.id}@${Math.round(it.along)}`;
const weightKey = (it) => `w${it.id}@${Math.round(it.along)}`;
const sensitiveKey = (it) => `s${it.type}:${it.way}@${Math.round(it.along)}`; // PR 3b

// ───────── Équipements d'hiver (phase 5f) : data/hiver/, cases traversées par les itinéraires proposés ─────────
const winter = createWinter({ onChange: () => renderChoice() });

// ───────── Pays voisins (phase 5c) : data/pays/XX.json, petits fichiers mis en cache (lisibles hors ligne) ─────────
/** code → { status:'loading'|'ok'|'failed', data } ; nouvelle Map à chaque arrivée (cache des règles invalidé). */
let countries = new Map(COUNTRY_RULES.FILES.map((c) => [c, { status: 'loading', data: null }]));
for (const code of COUNTRY_RULES.FILES) {
  fetch(countryDataPath(code), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => parseCountryData(j))
    .catch(() => null)
    .then((d) => {
      countries = new Map(countries);
      countries.set(code, d && d.code === code ? { status: 'ok', data: d } : { status: 'failed', data: null });
      navigation?.setCountries?.(countries);
      renderChoice();
    });
}

// ───────── Taxes PL régionales (phase 5h) : data/taxes-pl.json, petit fichier mis en cache (lisible hors ligne) ─────────
// Phase 5h ter : réseau taxé en géométrie (data/taxes-pl-osm.json, copie OSM de l'Action, hors APP_FILES) ; absent ou
// illisible → network null, repérage par les noms d'étape.
let tolls = { status: 'loading', data: null, network: null };
// v76 : contour de la Métropole de Lyon (« Contourner par la rocade Est », loadMetro) et plans déjà calculés.
let metro = { status: 'idle', rings: null };
const bypassCache = new WeakMap();
const readJson = (path, parse) => fetch(path, { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => parse(j))
  .catch(() => null);
Promise.all([readJson(TOLLS.PATH, parseTollData), readJson(TOLLS_GEO.PATH, parseTollNetwork)])
  .then(([d, network]) => {
    tolls = d ? { status: 'ok', data: d, network } : { status: 'failed', data: null, network: null };
    renderChoice();
  });

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
  const pool = areas.pool;
  const tun = tunnels;
  const ctry = countries;
  const acc = access.state;
  const win = winter.state;
  const tol = tolls;
  const brg = bridges.state;
  const bw = data.settings.bridgeWarnings !== false;
  const wl = weightLimits.state;
  const ww = data.settings.weightWarnings !== false;
  const spd = speedLimits.state;
  const ax = axes.state;
  const sn = sensitive.state;
  if (hit && hit.ax === ax && hit.sn === sn && hit.spd === spd && hit.wl === wl && hit.ww === ww && hit.brg === brg && hit.bw === bw && hit.minute === minute && hit.zfe === zfeData && hit.vehicle === vehicle && hit.forecast === w.forecast
    && hit.sig === sig && hit.dsig === dsig && hit.pool === pool && hit.tun === tun && hit.ctry === ctry && hit.acc === acc && hit.win === win && hit.tol === tol) return hit.rules;
  // Aires du trajet (phase 9) : la pause conseillée est proposée sur une aire du bon sens.
  const placed = pool.length ? placeAlongRoute(pool, route) : [];
  const rules = routeRules(route, {
    vehicle, departure, zfe: zfeData, driving, wind: w, areas: placed, tunnels: tun, countries: ctry, access: acc, winter: win, tolls: tol,
    bridges: brg, bridgeWarnings: bw, weightLimits: wl, weightWarnings: ww, speeds: spd, axes: ax, sensitive: sn,
  });
  rulesCache.set(route, { ax, sn, spd, minute, zfe: zfeData, vehicle, forecast: w.forecast, sig, dsig, pool, tun, ctry, acc, win, tol, brg, bw, wl, ww, rules });
  return rules;
}

/** Réglementation de chaque itinéraire proposé, d'après l'heure de départ (maintenant). */
function choiceRules(c = choice) {
  if (!c) return null;
  const departure = new Date();
  const list = c.options.map((o) => {
    const r = { ...rulesOf(o.route, c.vehicle, departure) };
    r.lines = [...r.lines];
    if (zfeFailed) r.lines.unshift({ level: 'info', text: 'Zones à faibles émissions indisponibles (fichier non chargé) : vérifie la signalisation.' });
    // Phase 12b : « Évite N restrictions saisies par toi », trajet trop long pour ORS, passage proche (à vérifier).
    const rl = restrictionLines(o.route, c.restr);
    if (rl.length) {
      r.lines.unshift(...rl);
      r.short = [...r.short, ...rl.filter((l) => l.level === 'warn').map(() => 'Restriction saisie à vérifier').slice(0, 1)];
    }
    // v76 : Lyon (lyon-a6 / lyon-a7) : ligne de la règle et plan du contournement par la rocade Est.
    r.lyonBypass = bypassOf(o, c, r);
    if (r.lyonBypass.concerned) loadMetro();
    if (r.lyonBypass.lines.length) r.lines.unshift(...r.lyonBypass.lines);
    // v77 : contournement automatique en échec (ou Recommandé hors de Lyon et cette fiche par Lyon) : fiche en rouge,
    // confirmation avant le départ. Réglage désactivé : comportement v76 (rien de rouge).
    r.lyonBanned = autoBypassOn() && r.lyonBypass.concerned && r.lyonBypass.reason !== 'local'
      && (c.lyonAuto === 'failed' || c.lyonAuto === 'none');
    if (r.lyonBanned) {
      const why = c.lyonAuto === 'failed' ? LYON_AUTO.FAIL_REASONS[c.lyonAutoReason] : '';
      r.lines.unshift({ level: 'warn', text: why ? `${LYON_AUTO.BANNED_TEXT} (${why}.)` : LYON_AUTO.BANNED_TEXT });
    }
    // v78 : autres interdictions connues (route-bans.js) : fiche rouge, confirmation, question « desserte locale ».
    // v81 : plage km = points de la copie ∪ plages « Accès PL limité » qui touchent la section (même zone que le
    // contournement) ; ces plages et la ligne « Point sensible » de la section ne sont plus répétées.
    const bans = autoBypassOn() ? routeBans(o.route, r.sensitive?.items ?? [], sensitive.state.meta?.sections ?? [], {
      vehicle: c.vehicle, copy: sensitive.state.status === 'ok' ? sensitive.state : null, plages: r.conditional ?? [],
    }) : [];
    const active = activeBans(bans, c.localAnswers);
    r.bans = active;
    r.localQuestions = localQuestions(bans, c.localAnswers);
    // v79 : fiche du contournement : question « desserte locale » des zones contournées (« Oui » remet le direct).
    if (o.key === DETOUR.OPTION_KEY && Array.isArray(o.avoided)) r.localQuestions = [...r.localQuestions, ...localQuestions(o.avoided, c.localAnswers)];
    const absorbed = new Set(active.flatMap((b) => b.plages ?? []));
    const sectionsShown = new Set(bans.map((b) => b.section));
    if (absorbed.size || sectionsShown.size) {
      const drop = new Map();
      for (const p of absorbed) { const t = plageShort(p); drop.set(t, (drop.get(t) ?? 0) + 1); }
      r.short = r.short.filter((t) => { const n = drop.get(t) ?? 0; if (!n) return true; drop.set(t, n - 1); return false; });
      r.lines = r.lines.filter((l) => !(l.plage && absorbed.has(l.plage)) && !(Number.isInteger(l.section) && sectionsShown.has(l.section)));
    }
    r.banFail = active.length && c.banAuto === 'failed' ? detourFailText(c.banAutoReason) : '';
    if (r.banFail) r.lines.unshift({ level: 'warn', text: r.banFail });
    for (const b of bans) if (!active.includes(b)) r.lines.unshift({ level: 'info', text: declaredText(b) });
    for (const b of [...active].reverse()) r.lines.unshift({ level: 'warn', text: b.text });
    r.blocked = r.lyonBanned || active.length > 0; // (r.banned = passages ZFE interdits, ne pas confondre)
    // v81 : une ligne courte par section sur la fiche (plus le texte générique), Lyon compris.
    r.bannedLines = [...(r.lyonBanned ? [LYON_AUTO.BANNED_SHORT] : []), ...active.map((b) => b.short)];
    r.bannedShort = r.bannedLines[0] ?? `${BANS.SHORT_TEXT}, à vérifier`;
    // v81 : état du contournement automatique pour le diagnostic du trajet (cause exacte d'un échec).
    r.detourDiag = c.banAuto || active.length
      ? { state: DETOUR_STATE_TEXT[c.banAuto] ?? 'non lancé', reason: c.banAuto === 'failed' ? c.banAutoReason ?? null : null, trace: c.banTrace ?? null }
      : null;
    r.confirmText = !active.length ? LYON_AUTO.CONFIRM_TEXT
      : confirmText([...(r.lyonBanned ? [{ label: 'Lyon, A6 et A7' }] : []), ...active]);
    return r;
  });
  // v81 : fiche rouge : autre fiche calculée sans interdiction ni autre rouge indiquée (jamais promue).
  const cards = c.options.map((o, i) => ({
    label: o.label, blocked: !!list[i].blocked, bans: list[i].bans ?? [], duration: o.route?.duration, distance: o.route?.distance,
    clean: !list[i].banned?.length && !list[i].forbiddenTunnels?.length && !list[i].lyonBanned,
  }));
  list.forEach((r, i) => { r.banAvoid = avoidingBansText(cards, i); });
  // Tunnel interdit : les autres itinéraires proposés qui l'évitent sont indiqués (choix à l'arrêt, d'un toucher).
  const counts = c.options.map((o, i) => ({ label: o.label, forbidden: list[i].forbiddenTunnels?.length ?? 0 }));
  list.forEach((r, i) => {
    const hint = avoidingOptionsText(counts, i);
    if (hint) {
      const at = r.lines.findLastIndex((l) => l.level === 'warn' && r.forbiddenTunnels.some((p) => l.text.startsWith(tunnelName(p))));
      r.lines.splice(at + 1, 0, { level: 'warn', text: hint });
    }
  });
  return list;
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

/** v76 : fiche dérivée d'une fiche qui a ses propres étapes (« Rocade Est ») : elle les garde. */
const keepStops = (from, option) => (Array.isArray(from?.stops) ? { ...option, stops: from.stops } : option);

/**
 * « Éviter la ZFE » (à l'arrêt) : une requête ORS avec les ZFE interdites en options.avoid_polygons, mêmes réglages
 * que l'itinéraire choisi. Limites de l'API publique (150 km à vol d'oiseau…) : message clair, pas de requête.
 */
async function avoidZfe() {
  if (!choice || navigation.active || avoidBusy) return;
  const option = choice.options[choice.selected];
  const rules = rulesOf(option.route, choice.vehicle, new Date());
  const zones = [...new Set(rules.banned.map((p) => p.zone))];
  const plan = avoidPolygonsFor(zones, { start: choice.start, end: choice.end, stops: optionStops(option, choice.stops) });
  if (!plan.ok) { showMessage(messageNode, plan.text); return; }
  avoidBusy = true;
  renderChoice();
  showMessage(messageNode, '');
  try {
    const route = await fetchRoute({
      apiKey: store.getApiKey(), vehicle: choice.vehicle, start: choice.start, end: choice.end,
      avoidTolls: option.request.avoidTolls, avoidFerries: choice.avoidFerries, preference: option.request.preference ?? null,
      avoidPolygons: mergeAvoid(option.request.avoidPolygons, plan.geometry), // phase 12b : restrictions gardées
      via: stopPoints(optionStops(option, choice.stops)),
    });
    if (!choice || navigation.active) return;
    const nz = keepStops(option, noZfeOption(option, route, mergeAvoid(option.request.avoidPolygons, plan.geometry), zones.map((z) => z.name)));
    const options = [...choice.options.filter((o) => o.key !== 'nozfe'), nz];
    choice = { ...choice, options, selected: options.length - 1 };
    map.showRoutes(options.map((o) => o.route), choice.selected);
    areas.select(route); // aires déjà trouvées replacées (la requête Overpass couvrait les premiers itinéraires)
    access.extend(route);
    bridges.extend(route);
    axes.extend(route);
    sensitive.extend(route);
    weightLimits.extend(route);
    speedLimits.extend(route);
    directions.extend(route);
    places.extend(route);
    lanes.extend(route);
    winter.extend(route);
    const still = rulesOf(route, choice.vehicle, new Date()).banned;
    if (still.length) showMessage(messageNode, `L'itinéraire « Sans ZFE » passe encore par : ${still.map((p) => p.name).join(', ')}.`, 'info');
  } catch (err) {
    showMessage(messageNode, `Éviter la ZFE : ${errorText(err) || 'calcul impossible.'}`);
  } finally {
    avoidBusy = false;
    renderChoice();
  }
}

/**
 * v48 : « à l'arrêt » hors guidage pour « Éviter le tunnel » (relevés GPS seulement tant que la fiche propose le
 * bouton ; vitesse inconnue = en mouvement, bouton grisé).
 */
const planPark = createPlanPark({
  onChange: (parked) => {
    if (!parked && !navigation.active) closeFuel('moving');
    renderChoice();
    areas.refreshDrive(); // v56 : « Ma note » grisée / active selon l'arrêt
  },
});
const tunnelAllowed = () => avoidTunnelAllowed({ guiding: navigation.active, parked: planPark.parked });

/**
 * « Éviter le tunnel » (à l'arrêt seulement) : une requête ORS avec un petit carré sur chaque tunnel interdit au code
 * ADR du véhicule ou à sa classe Euro (v48, phase 5g : verdict confirmé ou exploitant), options.avoid_polygons ajouté
 * aux ZFE déjà évitées, mêmes réglages que l'itinéraire choisi. Même budget et mêmes diagnostics d'échec que le départ
 * (fetchAvoidRoute) ; échec : message, rien d'affiché ni de guidé. Jamais dit à voix haute.
 */
async function avoidTunnel() {
  if (!choice || navigation.active || tunnelBusy) return;
  if (!tunnelAllowed()) { showMessage(messageNode, AVOID_PARKED_TEXT, 'info'); return; }
  const option = choice.options[choice.selected];
  const forbidden = rulesOf(option.route, choice.vehicle, new Date()).avoidableTunnels ?? [];
  const plan = avoidTunnelsFor(forbidden, {
    start: choice.start, end: choice.end, existing: option.request.avoidPolygons ?? null, stops: optionStops(option, choice.stops),
  });
  if (!plan.ok) { showMessage(messageNode, plan.text); return; }
  tunnelBusy = true;
  renderChoice();
  showMessage(messageNode, '');
  try {
    const route = await fetchAvoidRoute({
      apiKey: store.getApiKey(), vehicle: choice.vehicle, start: choice.start, end: choice.end,
      avoidTolls: option.request.avoidTolls, avoidFerries: choice.avoidFerries, preference: option.request.preference ?? null,
      avoidPolygons: plan.geometry, via: stopPoints(optionStops(option, choice.stops)),
    });
    if (!choice || navigation.active) return;
    const names = [...new Set(forbidden.map(tunnelName))];
    const nt = keepStops(option, noTunnelOption(option, route, plan.geometry, names));
    const options = [...choice.options.filter((o) => o.key !== 'notunnel'), nt];
    choice = { ...choice, options, selected: options.length - 1 };
    map.showRoutes(options.map((o) => o.route), choice.selected);
    areas.select(route);
    access.extend(route);
    bridges.extend(route);
    axes.extend(route);
    sensitive.extend(route);
    weightLimits.extend(route);
    speedLimits.extend(route);
    directions.extend(route);
    places.extend(route);
    lanes.extend(route);
    winter.extend(route);
    const still = rulesOf(route, choice.vehicle, new Date()).avoidableTunnels ?? [];
    if (still.length) showMessage(messageNode, `Le contournement passe encore par : ${[...new Set(still.map(tunnelName))].join(', ')}. La signalisation fait foi.`, 'info');
  } catch (err) {
    showMessage(messageNode, `Éviter le tunnel : ${errorText(err) || 'calcul impossible.'}`);
  } finally {
    tunnelBusy = false;
    renderChoice();
  }
}

/**
 * « Éviter la desserte locale » (à l'arrêt, phase 5d) : une requête ORS avec un petit carré sur chaque route réservée
 * à la desserte locale traversée en transit (options.avoid_polygons, ajouté aux zones déjà évitées).
 */
async function avoidLocal() {
  if (!choice || navigation.active || localBusy) return;
  const option = choice.options[choice.selected];
  const transit = rulesOf(option.route, choice.vehicle, new Date()).localTransit ?? [];
  const plan = avoidLocalFor(transit, {
    start: choice.start, end: choice.end, existing: option.request.avoidPolygons ?? null, stops: optionStops(option, choice.stops),
  });
  if (!plan.ok) { showMessage(messageNode, plan.text); return; }
  localBusy = true;
  renderChoice();
  showMessage(messageNode, '');
  try {
    const route = await fetchRoute({
      apiKey: store.getApiKey(), vehicle: choice.vehicle, start: choice.start, end: choice.end,
      avoidTolls: option.request.avoidTolls, avoidFerries: choice.avoidFerries, preference: option.request.preference ?? null,
      avoidPolygons: plan.geometry, via: stopPoints(optionStops(option, choice.stops)),
    });
    if (!choice || navigation.active) return;
    const nl = keepStops(option, noLocalOption(option, route, plan.geometry));
    const options = [...choice.options.filter((o) => o.key !== 'nolocal'), nl];
    choice = { ...choice, options, selected: options.length - 1 };
    map.showRoutes(options.map((o) => o.route), choice.selected);
    areas.select(route);
    access.extend(route);
    bridges.extend(route);
    axes.extend(route);
    sensitive.extend(route);
    weightLimits.extend(route);
    speedLimits.extend(route);
    directions.extend(route);
    places.extend(route);
    lanes.extend(route);
    winter.extend(route);
    const still = rulesOf(route, choice.vehicle, new Date()).localTransit ?? [];
    if (still.length) showMessage(messageNode, `L'itinéraire « Sans desserte » traverse encore une route réservée à la desserte locale (km ${still.map((p) => Math.round(p.enter / 1000)).join(', ')}). La signalisation fait foi.`, 'info');
  } catch (err) {
    showMessage(messageNode, `Éviter la desserte locale : ${errorText(err) || 'calcul impossible.'}`);
  } finally {
    localBusy = false;
    renderChoice();
  }
}

// ───────── « Contourner par la rocade Est » (v76, lyon-bypass.js) : Lyon, sections lyon-a6 / lyon-a7 ─────────
// Contour de la Métropole de Lyon (data/contours-ign.json, clé metropoleLyon, IGN Admin Express, Licence Ouverte) :
// lu à la demande, la première fois qu'un itinéraire passe par une de ces sections ; jamais précaché.
function loadMetro() {
  if (metro.status !== 'idle') return;
  metro = { status: 'loading', rings: null };
  readJson(LYON_BYPASS.CONTOUR_PATH, (j) => (Array.isArray(j?.metropoleLyon) && j.metropoleLyon.length ? j.metropoleLyon : null))
    .then((rings) => {
      metro = rings ? { status: 'ok', rings } : { status: 'failed', rings: null };
      renderChoice();
    });
}
/** Plan par itinéraire, recalculé seulement si une donnée lue ou les étapes changent (cache : bypassCache). */
function bypassOf(option, c, rules) {
  const stops = optionStops(option, c.stops);
  const hit = bypassCache.get(option.route);
  const key = [sensitive.state, axes.state, metro, stops, c.vehicle, rules.sensitive];
  if (hit && hit.key.every((x, i) => x === key[i])) return hit.plan;
  const plan = lyonBypassPlan(option.route, {
    items: rules.sensitive?.items ?? [], sensitive: sensitive.state, axes: axes.state, metro, start: c.start, end: c.end, stops,
  });
  bypassCache.set(option.route, { key, plan });
  return plan;
}

/**
 * Appui sur « Contourner par la rocade Est » (à l'arrêt seulement, hors guidage, comme « Éviter le tunnel ») : trois
 * points de passage ajoutés aux étapes de la fiche choisie, une requête ORS avec tous les points (règle v55, budget
 * de 3, jamais alternative_routes), aucun polygone ajouté. Échec : message, itinéraire inchangé. Jamais dit.
 */
let bypassBusy = false;
async function bypassLyon() {
  if (!choice || navigation.active || bypassBusy) return;
  if (!tunnelAllowed()) { showMessage(messageNode, LYON_BYPASS.PARKED_TEXT, 'info'); return; }
  const option = choice.options[choice.selected];
  const plan = choiceRules()?.[choice.selected]?.lyonBypass;
  if (!plan?.ok) return;
  bypassBusy = true;
  renderChoice();
  showMessage(messageNode, '');
  try {
    const { route, stops, avoidPolygons, had } = await requestBypass(option, plan, { diagnose: true });
    if (!choice || navigation.active) return;
    const note = [bypassNote(bypassCost(option.route, route)), had && !avoidPolygons ? LYON_BYPASS.ZONES_DROPPED_TEXT : '']
      .filter(Boolean).join(' ');
    const ro = { ...rocadeOption(option, route, stops, note), request: { ...option.request, avoidPolygons } };
    const options = [...choice.options.filter((o) => o.key !== 'rocade'), ro];
    // v77 : appui réussi (réessai après un échec automatique) : plus de fiche rouge pour la rocade trouvée.
    choice = { ...choice, options, selected: options.length - 1, ...(choice.lyonAuto === 'failed' ? { lyonAuto: 'none' } : {}) };
    map.showRoutes(options.map((o) => o.route), choice.selected);
    extendRoute(route);
    // Points sensibles relancés sur le nouveau tracé : encore une section interdite → message.
    if (choiceRules()?.[choice.selected]?.lyonBypass?.concerned) showMessage(messageNode, LYON_STILL_TEXT, 'info');
  } catch (err) {
    showMessage(messageNode, `Contourner par la rocade Est : ${errorText(err) || 'calcul impossible.'}`);
  } finally {
    bypassBusy = false;
    renderChoice();
  }
}

/** Copies du trajet (cases data/…) complétées pour un nouveau tracé, aires replacées. */
function extendRoute(route) {
  areas.select(route);
  access.extend(route);
  bridges.extend(route);
  axes.extend(route);
  sensitive.extend(route);
  weightLimits.extend(route);
  speedLimits.extend(route);
  directions.extend(route);
  places.extend(route);
  lanes.extend(route);
  winter.extend(route);
}

/**
 * Une requête ORS avec les trois points de passage de la rocade (bouton v76 et contournement automatique v77) :
 * étapes de la fiche gardées, zones évitées gardées si ORS les accepte encore (150 km à vol d'oiseau, points de passage
 * compris), sinon non envoyées. `diagnose` false (automatique) : exactement une requête.
 */
async function requestBypass(option, plan, { diagnose }) {
  let line = null;
  try { line = prepareLine(option.route.coordinates); } catch { line = null; }
  const alongOf = (p) => (line ? locateOnLine(line, p).along : 0);
  const stops = withBypassStops(optionStops(option, choice.stops), plan.via, alongOf);
  const had = option.request.avoidPolygons ?? null;
  const avoidPolygons = avoidForReroute(had, choice.start, choice.end, stopPoints(stops));
  const route = await fetchAvoidRoute({
    apiKey: store.getApiKey(), vehicle: choice.vehicle, start: choice.start, end: choice.end,
    avoidTolls: option.request.avoidTolls, avoidFerries: choice.avoidFerries, preference: option.request.preference ?? null,
    avoidPolygons, via: stopPoints(stops), diagnose,
  });
  return { route, stops, avoidPolygons, had };
}

// ───────── v77 : contournement automatique (Réglages › « Contournement automatique des interdictions ») ─────────
// Lyon seulement : plan du Recommandé d'ORS (options[0]) `ok` → une requête ORS de plus (à part du budget de 3, sans
// diagnostic), une seule fois par calcul (choice.lyonAuto, gardé par la mémoire v53). Jamais dit, rien dans le guidage.
const autoBypassOn = () => data.settings.autoBypass !== false;
let autoSeq = 0; // identifiant du calcul en cours : compteur, jamais l'horloge
/** @returns {boolean} vrai si l'état a changé (la fiche vient d'être redessinée). */
function maybeAutoBypass(rules) {
  if (!choice || navigation.active || !autoBypassOn() || choice.lyonAuto) return false;
  if (sensitive.state.status !== 'ok') return false; // points sensibles pas encore lus (ou absents : rien n'est décidé)
  const decision = autoBypassStart(rules?.[0]?.lyonBypass, { metroStatus: metro.status, axesStatus: axes.state.status });
  if (decision === 'wait') return false;
  if (decision === 'none') {
    // Recommandé hors de Lyon : une autre fiche par Lyon est marquée en rouge (aucune requête).
    if (rules?.some((r) => r.lyonBypass?.concerned && r.lyonBypass.reason !== 'local')) choice.lyonAuto = 'none';
    else return false;
  } else if (decision === 'run') {
    choice.lyonAuto = 'pending';
    runAutoBypass(rules[0].lyonBypass);
  } else if (typeof decision === 'object') {
    choice.lyonAuto = 'failed';
    choice.lyonAutoReason = decision.fail;
  } else {
    choice.lyonAuto = decision; // 'local' | 'done'
  }
  renderChoice();
  saveRoute({ force: true });
  return true;
}
async function runAutoBypass(plan) {
  const id = ++autoSeq;
  choice.autoId = id;
  const option = choice.options[0];
  const fail = (reason, err = null) => {
    if (!choice || choice.autoId !== id) return;
    choice = { ...choice, lyonAuto: 'failed', lyonAutoReason: reason };
    if (err) showMessage(messageNode, `Contournement de Lyon : ${errorText(err) || 'calcul impossible.'}`, 'info', serviceDetailText(err, store.getApiKey() ?? ''));
    renderChoice();
    saveRoute({ force: true });
  };
  let res;
  try {
    res = await requestBypass(option, plan, { diagnose: false });
  } catch (err) {
    fail('request', err);
    return;
  }
  if (!choice || choice.autoId !== id || navigation.active) return;
  if (!autoBypassOn()) { choice = { ...choice, lyonAuto: undefined }; renderChoice(); return; } // réglage coupé entre-temps
  const { route, stops, avoidPolygons, had } = res;
  const extra = had && !avoidPolygons ? LYON_BYPASS.ZONES_DROPPED_TEXT : '';
  const ro = {
    ...rocadeOption(option, route, stops, autoNote(autoCost(option.route, route), extra), { recommended: true }),
    request: { ...option.request, avoidPolygons },
  };
  // Points sensibles relancés sur le tracé du contournement (cases de Lyon déjà lues pour le trajet direct).
  const check = bypassOf(ro, choice, rulesOf(route, choice.vehicle, new Date()));
  if (check.concerned) { fail('still'); return; }
  const rules = choiceRules();
  const crosses = choice.options.map((_, i) => !!rules?.[i]?.lyonBypass?.concerned);
  const next = applyAutoBypass({ options: choice.options, crosses, rocade: ro, selected: choice.selected, manual: choice.touched === true });
  choice = { ...choice, options: next.options, selected: next.selected, lyonAuto: 'done' };
  map.showRoutes(next.options.map((o) => o.route), next.selected); // une seule fois : pas de clignotement
  extendRoute(route);
  if (next.replaced) showMessage(messageNode, LYON_AUTO.REPLACED_TEXT, 'info');
  renderChoice();
  saveRoute({ force: true });
}

// ───────── v79 : contournement par tronçons des autres interdictions connues (route-bans.js, ban-detour.js) ─────────
// Recommandé (options[0]) par une interdiction encore en vigueur (desserte non déclarée) : un tronçon A → B par
// interdiction avec un carré de 80 m sur chaque point de la section, puis un trajet complet avec les points de passage
// trouvés (requêtes à part du budget de 3, sans diagnostic 2009). Une seule fois par calcul (choice.banAuto, mémoire
// v53), après la décision de Lyon (v77). Réglage désactivé : rien. Jamais dit, rien dans le guidage.
let banSeq = 0; // identifiant du calcul en cours : compteur, jamais l'horloge
/** v81 : état du contournement (diagnostic du trajet). */
const DETOUR_STATE_TEXT = Object.freeze({
  pending: 'en cours', done: 'appliqué', failed: 'échec', declared: 'desserte déclarée, trajet direct remis',
  off: 'non lancé (Autres itinéraires)',
});
/** @returns {boolean} vrai si l'état a changé (la fiche vient d'être redessinée). */
function maybeBanDetour(rules) {
  if (!choice || navigation.active || !autoBypassOn() || choice.banAuto) return false;
  if (sensitive.state.status !== 'ok' || choice.lyonAuto === 'pending') return false;
  const head = rules?.[0];
  if (!head?.bans?.length || head.lyonBanned) return false; // rien à contourner, ou Lyon sans solution (fiche rouge)
  if (head.lyonBypass?.concerned && !choice.lyonAuto) return false; // Lyon pas encore décidé
  choice.banAuto = 'pending';
  runBanDetour(head.bans);
  renderChoice();
  return true;
}
async function runBanDetour(bans) {
  const id = ++banSeq;
  choice.banId = id;
  const option = choice.options[0];
  const had = option.request?.avoidPolygons ?? null;
  const base = {
    apiKey: store.getApiKey(), vehicle: choice.vehicle, avoidTolls: option.request?.avoidTolls,
    avoidFerries: choice.avoidFerries, preference: option.request?.preference ?? null, diagnose: false,
  };
  let finalAvoid = null;
  const out = await planDetour({
    route: option.route, bans, copy: sensitive.state, vehicle: choice.vehicle, stops: optionStops(option, choice.stops),
    fetchLeg: (a, b, avoid) => fetchAvoidRoute({ ...base, start: a, end: b, avoidPolygons: legAvoid(avoid, had) }),
    fetchFinal: (stops) => {
      finalAvoid = avoidForReroute(had, choice.start, choice.end, stopPoints(stops));
      return fetchAvoidRoute({ ...base, start: choice.start, end: choice.end, avoidPolygons: finalAvoid, via: stopPoints(stops) });
    },
  });
  if (!choice || choice.banId !== id || navigation.active) return;
  if (!autoBypassOn()) { choice = { ...choice, banAuto: undefined }; renderChoice(); return; } // réglage coupé entre-temps
  if (!out.ok) {
    choice = { ...choice, banAuto: 'failed', banAutoReason: out.reason, banTrace: out.trace ?? null };
    if (out.error) showMessage(messageNode, `Contournement de l'interdiction : ${errorText(out.error) || 'calcul impossible.'}`, 'info', serviceDetailText(out.error, store.getApiKey() ?? ''));
    renderChoice();
    saveRoute({ force: true });
    return;
  }
  const extra = had && !finalAvoid ? LYON_BYPASS.ZONES_DROPPED_TEXT : '';
  const det = {
    ...detourOption(option, out.route, out.stops, detourNote(bans, detourCost(option.route, out.route), extra), bans),
    request: { ...option.request, avoidPolygons: finalAvoid },
  };
  const ids = new Set(bans.map((b) => b.id));
  const rules = choiceRules();
  const crosses = choice.options.map((_, i) => (rules?.[i]?.bans ?? []).some((b) => ids.has(b.id)));
  const before = choice.options;
  const next = applyDetour({ options: before, crosses, detour: det, selected: choice.selected, manual: choice.touched === true });
  choice = { ...choice, options: next.options, selected: next.selected, banAuto: 'done', banBefore: before, banTrace: out.trace ?? null };
  map.showRoutes(next.options.map((o) => o.route), next.selected); // une seule fois : pas de clignotement
  extendRoute(out.route);
  if (next.replaced) showMessage(messageNode, 'Itinéraire remplacé par le contournement d\'une interdiction connue (à vérifier).', 'info');
  renderChoice();
  saveRoute({ force: true });
}

/**
 * v78 : réponse à « Desserte locale dans la zone … ? » (à l'arrêt seulement, comme « Éviter le tunnel ») : gardée pour
 * ce trajet seulement (choice.localAnswers, mémoire v53), jamais dans les réglages ni l'export.
 */
function answerLocal(id, yes) {
  if (!choice || navigation.active) return;
  if (!tunnelAllowed()) { showMessage(messageNode, 'Desserte locale : réponse possible à l\'arrêt seulement.', 'info'); return; }
  choice = { ...choice, localAnswers: { ...(choice.localAnswers ?? {}), [id]: yes === true } };
  // v79 : desserte déclarée pour toutes les zones contournées → trajet direct remis (gardé, aucune requête) ;
  // « Non » de nouveau → contournement recalculé.
  const head = choice.options[0];
  if (choice.banAuto === 'done' && head?.key === DETOUR.OPTION_KEY && allDeclared(head.avoided, choice.localAnswers)) {
    if (Array.isArray(choice.banBefore)) {
      choice = { ...choice, options: choice.banBefore, selected: 0, banAuto: 'declared', banBefore: undefined };
      map.showRoutes(choice.options.map((o) => o.route), 0);
    } else {
      showMessage(messageNode, 'Desserte locale déclarée : refais le calcul pour retrouver le trajet direct.', 'info');
    }
  } else if (choice.banAuto === 'declared' && yes !== true) {
    choice = { ...choice, banAuto: undefined };
  }
  renderChoice();
  saveRoute({ force: true });
}

// v77 : « Démarrer » sur une fiche interdite sans alternative : confirmation (Annuler / Démarrer quand même).
const startConfirm = { panel: $('#start-confirm'), title: $('#start-confirm-title'), cancel: $('#btn-start-cancel'), go: $('#btn-start-anyway') };
function hideStartConfirm() { startConfirm.panel.hidden = true; }
startConfirm.cancel.addEventListener('click', () => hideStartConfirm());
startConfirm.go.addEventListener('click', () => {
  hideStartConfirm();
  if (!choice || navigation.active) return;
  startGuidance(null); // la première phrase de voix part dans ce geste (règle de Chrome)
});

function renderChoice() {
  if (!choice) return;
  const rules = choiceRules();
  if (maybeAutoBypass(rules)) return; // v77 : état décidé, fiche déjà redessinée avec lui
  if (maybeBanDetour(rules)) return; // v79 : idem pour les autres interdictions connues
  const pending = choice.lyonAuto === 'pending' || choice.banAuto === 'pending';
  if (pending || !rules?.[choice.selected]?.blocked) hideStartConfirm();
  // v77 : « Démarrer » grisé pendant le calcul du contournement (le trajet direct n'est pas proposé au départ).
  navStartBtn.disabled = pending;
  navStartBtn.setAttribute('aria-disabled', String(pending));
  renderRouteChoice(summaryNode, notesNode, {
    choice, dieselPrice: data.settings.dieselPrice, onSelect: selectRoute,
    rules,
    rulesSource: rulesSourceText(zfeData, {
      hazmat: !!choice.vehicle?.hazmat, tunnelsUpdated: tunnels.data?.updated ?? null, accessUpdated: access.state.updated,
    }),
    onAvoidZfe: avoidZfe, avoidBusy, onAvoidTunnel: avoidTunnel, tunnelBusy, tunnelAllowed: tunnelAllowed(),
    onAvoidLocal: avoidLocal, localBusy,
    onBypass: bypassLyon, bypassBusy, // v76
    onLocalAnswer: answerLocal, // v78
    windCredit: weather.status === 'ok',
  });
  // v48 : relevés GPS hors guidage tant que la fiche propose un bouton réservé à l'arrêt : « Éviter le tunnel », et
  // depuis la phase 4 « Carburant sur le trajet » (proposé pour tout itinéraire affiché).
  planPark.watch(!navigation.active);
  fuelBtn.hidden = navigation.active;
  fuelBtn.setAttribute('aria-disabled', String(!planPark.parked));
  showZfeOnMap(rules);
  showBridgesOnMap(rules?.[choice.selected], choice.options[choice.selected]?.route);
}

/**
 * Repères des ponts (phase 12a) et des limites de poids (phase 12a bis) à vérifier de l'itinéraire choisi, à l'arrêt
 * seulement (retirés en guidage).
 */
function showBridgesOnMap(r, route = null) {
  const items = r?.bridges?.items ?? [];
  const weights = r?.weightLimits?.items ?? [];
  const sens = r?.sensitive?.items ?? [];
  // v81 : sections interdites actives : trait rouge fin sur le tracé, « ! » au début de la plage (un par section).
  const coords = route?.coordinates ?? null;
  const bans = coords ? (r?.bans ?? []) : [];
  map.showBanSections(bans.map((b) => rangeCoords(coords, b.range?.from, b.range?.to)).filter((l) => l.length > 1));
  const startOf = new Map(bans.map((b) => [b.section, pointAlong(coords, b.range?.from)]));
  map.showBridges([
    ...items.map((it) => ({
      key: bridgeKey(it), lonlat: it.point, level: it.level,
      label: `Pont à vérifier, priorité ${it.level === 'high' ? 'haute' : 'moyenne'}${it.name ? ` : ${it.name}` : ''}`,
    })),
    ...weights.map((it) => ({
      key: weightKey(it), lonlat: it.point, level: 'high', kind: 'weight', glyph: `${String(it.limit).replace('.', ',')} t`,
      label: `Limite de poids à vérifier : ${String(it.limit).replace('.', ',')} t${it.local ? ', desserte locale possible' : ''}`,
    })),
    // PR 3b : points sensibles (interdictions, hauteurs basses, tunnels) ; texte au toucher, jamais dit.
    ...sens.map((it) => ({
      key: sensitiveKey(it), lonlat: (it.type <= 1 /* interdiction */ && startOf.get(it.section)) || it.point, level: 'high', kind: 'sensitive', glyph: '!',
      label: 'Point sensible à vérifier',
    })),
  ]);
}

/** Choix d'un itinéraire (fiche ou tracé touché), à l'arrêt seulement : l'écran de guidage masque tout ça. */
function selectRoute(index) {
  if (!choice || navigation.active || index === choice.selected || !choice.options[index]) return;
  choice = { ...choice, selected: index, touched: true }; // v77 : choix du chauffeur (gardé par le contournement)
  routeSaveOn = true;
  saveRoute({ force: true });
  map.selectRoute(index);
  renderChoice();
  areas.select(choice.options[index].route);
  revealSelectedCard(summaryNode);
}
map.onRoutePick(selectRoute);

function startGuidance(simulate = null, resume = null, carry = null) {
  if (!choice) return 'Calcule d\'abord un itinéraire (bouton « Calculer l\'itinéraire »).';
  const option = choice.options[choice.selected];
  showMessage(messageNode, '');
  restrictionsUi.closeBridge(); // phase 12b : aucune saisie pendant le guidage
  planPark.watch(false); // v48 : plus de relevés hors guidage
  reportsUi.close(); // phase 3a : fiche fermée au départ (rouverte à l'arrêt seulement)
  syncReportPark();
  closeFuel();
  fuelBtn.hidden = true;
  navigation.start({
    route: option.route,
    vehicle: choice.vehicle,
    // Le recalcul en route garde les réglages de l'itinéraire choisi (plus court, sans péage…).
    params: guidanceParams(option, choice),
    simulate,
    areas: areas.pool,
    announceAreas: data.settings.areaVoice,
    rules: {
      vehicle: choice.vehicle, zfe: zfeData, voice: data.settings.ruleVoice,
      tunnels: tunnels.status === 'ok' ? tunnels.data : null, // phase 5b ; les trois tunnels en dur dans tous les cas
      countries, // phase 5c : règles des pays voisins (data/pays)
      access: access.state.status === 'ok' ? access.state.ways : null, // phase 5d : voies à accès conditionnel
    },
    driving: loadDriving(storage),
    driveVoice: data.settings.driveVoice,
    wind: weather.forecast,
    windGust: data.settings.windGust,
    windVoice: data.settings.windVoice,
    // Phase 11a : limitations de vitesse (copie des cases du trajet) ; « Limite X » dit seulement si le réglage est activé.
    speeds: { data: speedLimits.state.status === 'ok' ? speedLimits.state.data : null, voice: data.settings.speedVoice === true },
    // Phase 11b : directions des panneaux dans les consignes (copie des cases du trajet).
    directions: directions.state.status === 'ok' ? directions.state.data : null,
    // Phase 11c : lieux « vers X » des manœuvres sans direction de panneau (affichés seulement).
    places: places.state.status === 'ok' ? places.state.data : null,
    // Phase 11d : voies à prendre (affichées seulement).
    lanes: lanes.state.status === 'ok' ? lanes.state.data : null,
    resume, // v53 : reprise d'un guidage sauvegardé
    carry, tripFrom: choice.fromLabel ?? '', // v56 : historique
    // Phase 3a : mes signalements ; voix seulement si le réglage est activé (désactivé par défaut), confirmés à moi.
    reports: { list: data.reports ?? [], voice: data.settings.reportVoice === true },
  });
  saveRoute({ force: true });
  return null;
}
navStartBtn.addEventListener('click', () => {
  if (!choice || choice.lyonAuto === 'pending' || choice.banAuto === 'pending') return;
  // v77 : itinéraire interdit sans alternative trouvée : confirmation d'abord (jamais le fait accompli).
  const cur = choiceRules()?.[choice.selected];
  if (cur?.blocked) {
    startConfirm.title.textContent = cur.confirmText;
    startConfirm.panel.hidden = false;
    startConfirm.go.focus();
    return;
  }
  startGuidance(null);
});

// ───────── v44 : « Autres itinéraires » depuis la vue d'ensemble du guidage, à l'arrêt seulement ─────────
// Recalcul de la position reçue vers l'arrivée, profil actif, même budget (3 requêtes), mêmes règles et même fiche que
// le calcul de départ ; l'utilisateur choisit, le guidage repart sur l'itinéraire choisi. Échec : diagnostics du
// départ (2f), rien d'affiché ni de guidé. Aucune saisie en roulant : le panneau se ferme dès que le véhicule roule
// et « Guider par cet itinéraire » est refusé hors de l'arrêt.
const altUi = {
  panel: $('#nav-alts'), status: $('#nav-alts-status'), summary: $('#nav-alts-summary'), notes: $('#nav-alts-notes'),
  go: $('#btn-alts-go'),
};
let altChoice = null;
let altTicket = 0;
function renderAlternatives() {
  if (!altChoice) return;
  renderRouteChoice(altUi.summary, altUi.notes, {
    choice: altChoice, dieselPrice: data.settings.dieselPrice, rules: choiceRules(altChoice),
    onSelect: (i) => {
      if (!altChoice?.options[i] || !navigation.parked) return;
      altChoice = { ...altChoice, selected: i };
      altConfirm = false;
      renderAlternatives();
    },
    rulesSource: rulesSourceText(zfeData, {
      hazmat: !!altChoice.vehicle?.hazmat, tunnelsUpdated: tunnels.data?.updated ?? null, accessUpdated: access.state.updated,
    }),
    windCredit: weather.status === 'ok',
  });
  altUi.go.hidden = false;
  altUi.go.textContent = altConfirm ? 'Guider quand même (itinéraire interdit)' : ALT_GO_TEXT;
}
function closeAlternatives(reason = '') {
  altTicket += 1;
  altChoice = null;
  const wasOpen = !altUi.panel.hidden;
  altUi.panel.hidden = true;
  showAltsStopField(false); // v55 : champ retiré
  altUi.summary.hidden = true;
  altUi.notes.hidden = true;
  altUi.summary.replaceChildren();
  altUi.notes.replaceChildren();
  altUi.go.hidden = true;
  altUi.status.textContent = '';
  if (wasOpen && reason === 'moving') navigation.notify('Autres itinéraires : disponible à l\'arrêt');
}
/** Départ du dernier calcul « Autres itinéraires » (v55 : étape ajoutée depuis ce panneau). */
let altFrom = null;
/** v77 : premier appui sur « Guider » d'une fiche interdite fait ; le second guide. */
let altConfirm = false;
const ALT_GO_TEXT = $('#btn-alts-go')?.textContent ?? 'Guider par cet itinéraire';
/**
 * v44 / v55 : calcul depuis la dernière position, étapes non atteintes gardées ; `extraStop` (fiche carburant ou champ
 * « Ajouter une étape », à l'arrêt seulement) rangé parmi elles selon sa place sur le tracé en cours.
 */
async function openAlternatives(from, extraStop = null) {
  if (!choice || !navigation.active || !navigation.parked) return;
  altFrom = from;
  let stops = navigation.remainingStops;
  if (extraStop) {
    const ins = insertStopByRoute(stops, extraStop, choice.options[choice.selected]?.route?.coordinates ?? null, navigation.progress?.along ?? 0);
    if (!ins.ok) { altUi.panel.hidden = false; altUi.status.textContent = ins.text; return; }
    stops = ins.list;
  }
  const my = ++altTicket;
  altChoice = null;
  altUi.panel.hidden = false;
  showAltsStopField(true); // v55 : à l'arrêt seulement (vérifié ci-dessus)
  altUi.summary.hidden = true;
  altUi.notes.hidden = true;
  altUi.summary.replaceChildren(); // fiches d'un calcul précédent : jamais montrées après un échec
  altUi.notes.replaceChildren();
  altUi.go.hidden = true;
  altUi.status.textContent = extraStop
    ? `Calcul avec l'étape « ${extraStop.label} » depuis ta position…`
    : 'Calcul des itinéraires depuis ta position…';
  const vehicle = activeVehicle(data);
  try {
    await ensureTunnels(vehicle);
    const restr = restrictionsForTrip(data.restrictions ?? [], { vehicle, start: from, end: choice.end, stops });
    const { options, failures } = await fetchRouteOptions({
      apiKey: store.getApiKey(), vehicle, start: from, end: choice.end, avoidTolls: choice.avoidTolls,
      avoidFerries: choice.avoidFerries, avoidPolygons: restr.geometry, isForbidden: tunnelBanCheck(vehicle),
      via: stopPoints(stops),
    });
    if (my !== altTicket || !navigation.active) return;
    altChoice = {
      ...choice, options, failures, selected: 0, vehicle, start: from, restr, startIsMyPosition: true, fromLabel: 'Ma position',
      stops, touched: false, autoId: undefined,
      // v77 : rien d'automatique ici ; fiche par Lyon (A6 / A7) en rouge, confirmation avant de la guider.
      lyonAuto: 'none', lyonAutoReason: undefined,
      banAuto: 'off', banAutoReason: undefined, banBefore: undefined, banId: undefined, banTrace: undefined, // v79 : rien d'automatique ici non plus
    };
    altConfirm = false;
    for (const o of options) { access.extend(o.route); bridges.extend(o.route); axes.extend(o.route); sensitive.extend(o.route); weightLimits.extend(o.route); speedLimits.extend(o.route); directions.extend(o.route); places.extend(o.route); lanes.extend(o.route); winter.extend(o.route); }
    altUi.status.textContent = 'Choisis un itinéraire, puis « Guider par cet itinéraire ».';
    renderAlternatives();
  } catch (err) {
    if (my !== altTicket) return;
    // Mêmes messages qu'au départ (diagnostic 2f compris, au conditionnel) ; aucun tracé affiché ni guidé.
    altUi.status.textContent = errorText(err) || 'Erreur inattendue pendant le calcul.';
  }
}
$('#btn-alts-close').addEventListener('click', () => closeAlternatives());
// v55 : « Ajouter une étape » dans « Autres itinéraires » : champ créé à l'ouverture (à l'arrêt), retiré à la
// fermeture (dès que le véhicule roule) ; aucun champ de saisie n'existe pendant le guidage en roulant (R412-6-2).
const altsStopBox = $('#alts-stop');
function showAltsStopField(on) {
  altsStopBox.replaceChildren();
  altsStopBox.hidden = !on;
  if (!on) return;
  const input = el('input', {
    id: 'alts-stop-input', type: 'search', placeholder: 'Ville, adresse, entreprise…', enterkeyhint: 'search',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'alts-stop-list',
  });
  const list = el('ul', { id: 'alts-stop-list', class: 'suggestions', role: 'listbox', hidden: true });
  altsStopBox.append(el('label', { for: 'alts-stop-input', text: 'Ajouter une étape' }), el('div', { class: 'combo' }, [input]), list);
  attachAutocomplete(input, list, {
    getApiKey: () => store.getApiKey(), getFocus: () => altFrom ?? myPosition,
    onError: (err) => { if (err) altUi.status.textContent = errorText(err); },
    onPick: (place) => {
      if (!place) return;
      if (!navigation.parked) { closeAlternatives('moving'); return; }
      if (altFrom) openAlternatives(altFrom, place);
    },
  });
}
altUi.go.addEventListener('click', () => {
  if (!altChoice || !navigation.active) return;
  if (!navigation.parked) { closeAlternatives('moving'); return; }
  // v77 : itinéraire par Lyon (A6 / A7) interdit aux plus de 7,5 t en transit : un second appui confirme.
  const altRules = choiceRules(altChoice)?.[altChoice.selected];
  if (!altConfirm && altRules?.blocked) {
    altConfirm = true;
    altUi.status.textContent = altRules.confirmText;
    renderAlternatives();
    return;
  }
  altConfirm = false;
  const sim = navigation.simulating ? { speedKmh: navigation.simSpeedKmh ?? data.settings.simSpeed } : null;
  const carry = navigation.tripCarry; // v56 : même trajet pour l'historique (km, début, étapes faites)
  choice = altChoice;
  closeAlternatives();
  renderChoice();
  areas.select(choice.options[choice.selected].route);
  startGuidance(sim, null, carry); // le guidage repart sur l'itinéraire choisi
});

// ───────── Phase 4 : « Carburant sur le trajet », à l'arrêt seulement (préparation et guidage) ─────────
// Module d'interface chargé à la demande (hors précache) : hors ligne, l'import échoue → message, jamais un bouton
// muet. Une requête data.economie.gouv.fr par itinéraire (zones du trajet seulement), aucune requête ORS. Fermé dès
// que le véhicule roule (R412-6-2) ; rien n'est dit à voix haute.
const loadFuel = lazyLoader(() => import('./ui/fuel.js'));
let fuelPanel = null;
const fuelParked = () => (navigation.active ? navigation.parked : planPark.parked);
function fuelMessage(text) {
  if (navigation.active) navigation.notify(text);
  else showMessage(messageNode, text, 'info');
}
async function openFuel(from = null) {
  if (!choice) return;
  if (!fuelParked()) { fuelMessage(FUEL.PARKED_TEXT); return; }
  const loaded = await loadFuel();
  if (!loaded.ok) { fuelMessage(loaded.text); return; }
  if (!choice || !fuelParked()) return;
  fuelPanel ??= loaded.mod.createFuelPanel({
    root: $('#fuel-panel'),
    getOk: () => data.fuelStations ?? [],
    onToggleOk: (station) => update((d) => ({ ...d, fuelStations: toggleFuelStation(d.fuelStations, station) })),
    isParked: fuelParked,
    onAddStop: (stop) => addStopFromFuel(stop), // v55
  });
  const route = choice.options[choice.selected].route;
  fuelPanel.open({ key: route, route, vehicle: choice.vehicle, from: navigation.active ? from : null });
}
function closeFuel(reason = '') {
  if (!fuelPanel?.isOpen) return;
  fuelPanel.close();
  if (reason === 'moving') fuelMessage(FUEL.PARKED_TEXT);
}
fuelBtn.addEventListener('click', () => openFuel(null));

/**
 * v55 : « Ajouter comme étape » (fiche carburant, à l'arrêt seulement). Préparation : étape rangée selon sa place sur
 * le tracé, nouveau calcul (budget de 3 requêtes). Guidage : « Autres itinéraires » avec cette étape, choix à l'arrêt.
 */
function addStopFromFuel(stop) {
  if (!choice || !fuelParked()) { fuelMessage(FUEL.PARKED_TEXT); return; }
  closeFuel();
  if (navigation.active) {
    const from = navigation.lastFix;
    if (from) openAlternatives(from, stop);
    else navigation.notify('Position inconnue : étape non ajoutée');
    return;
  }
  const ins = insertStopByRoute(form.getStops(), stop, choice.options[choice.selected]?.route?.coordinates ?? null);
  if (!ins.ok) { showMessage(messageNode, ins.text); return; }
  form.setStops(ins.list);
  showMessage(messageNode, `Étape ajoutée : ${stop.label}. Nouveau calcul…`, 'info');
  $('#route-form').requestSubmit();
}

// Écrans
const settings = createSettings({
  store,
  getData: () => data,
  onDataReplaced: (d) => {
    update(() => d);
    theme.setMode(d.settings.theme);
    map.setNightLevel(d.settings.nightMapLevel);
    map.setVehicleIcon(d.settings.vehicleIcon);
    voice.setEnabled(d.settings.voice);
    voice.setOptions({ name: d.settings.voiceName, rate: d.settings.voiceRate, volume: d.settings.voiceVolume });
    applyArrowColor();
  },
  onThemeChange: (mode) => { setSetting({ theme: mode }); theme.setMode(mode); },
  onNightLevelChange: (level) => { setSetting({ nightMapLevel: level }); map.setNightLevel(level); },
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
  onVehicleIcon: (k) => { setSetting({ vehicleIcon: k }); map.setVehicleIcon(k); },
  onAreaVoiceChange: (on) => setSetting({ areaVoice: on }),
  onRuleVoiceChange: (on) => setSetting({ ruleVoice: on }),
  onDriveVoiceChange: (on) => setSetting({ driveVoice: on }),
  onWindVoiceChange: (on) => setSetting({ windVoice: on }),
  onReportVoiceChange: (on) => setSetting({ reportVoice: on }), // phase 3a : désactivé par défaut
  onSpeedVoiceChange: (on) => setSetting({ speedVoice: on }), // phase 11a : « Limite X » au dépassement, désactivé par défaut
  onBridgeWarningsChange: (on) => { setSetting({ bridgeWarnings: on }); renderChoice(); },
  onAutoBypassChange: (on) => { setSetting({ autoBypass: on }); renderChoice(); }, // v77
  onWeightWarningsChange: (on) => { setSetting({ weightWarnings: on }); renderChoice(); },
  onClose: () => { settingsOpen = false; syncReportPark(); }, // phase 3a
  onOpen: () => { placesUi?.render(); restrictionsUi.render(); historyPanel.refresh(); settingsOpen = true; syncReportPark(); reportsUi.render(); }, // v56 : historique relu
  getHistory: () => historyStore.list(),
  onHistoryImported: async (list) => { await historyStore.merge(list); await historyPanel.refresh(); },
  onWindGustChange: (g) => { setSetting({ windGust: g }); renderChoice(); },
  // Matières dangereuses (phase 5b) : réglage global, lu au prochain calcul (activeVehicle → withAdr).
  onAdrChange: (adr) => setSetting({ adr }),
  onDrivingReset: () => { saveDriving(storage, emptyDriving()); renderChoice(); },
  onCreditsToggle: (open) => setSetting({ creditsOpen: open }), // v64
  recent: recentPlaces, // v64 : effacer, exporter, importer
  recentEditAllowed: () => recentAllowed(), // v64 : en guidage, à l'arrêt seulement
});
// v64 : ✕ des recherches récentes et « Effacer » : en guidage, à l'arrêt seulement (R412-6-2).
function recentAllowed() { return recentEditAllowed({ navigating: !!navigation?.active, parked: navigation?.parked === true }); }
setRecentEditGuard(recentAllowed);
createVehicles({ getData: () => data, update });
// Phase 3b : mes lieux (domicile, dépôt, clients) en tête des suggestions, sans appel ; Réglages › Mes lieux.
setSavedPlaces(() => data.places ?? []);
let placesUi = null;

const form = createRouteForm({
  getApiKey: () => store.getApiKey(),
  initial: data.settings,
  onOptionsChange: (o) => update((d) => ({ ...d, settings: { ...d.settings, ...o } })),
  onPosition: (lonlat) => { myPosition = lonlat; map.setMyPosition(lonlat); theme.setPosition(lonlat); },
  onError: (err) => showMessage(messageNode, errorText(err)),
  // Saisie dans un champ : le point choisi par appui long est oublié, son repère retiré.
  onEdit: (which) => map.clearPin(which === 'to' ? 'pinTo' : 'pinFrom'),
  onSubmit: async (p) => {
    endResumeQuestion(); // v53 : nouveau calcul, la question de reprise n'a plus lieu d'être
    const vehicle = activeVehicle(data);
    showMessage(messageNode, '');
    form.setBusy(true);
    const tunnelsRead = ensureTunnels(vehicle); // phase 5b : fichier des tunnels lu seulement pour un véhicule ADR avec code tunnel
    try {
      // Phase 12b : restrictions saisies proches du trajet évitées (avoid_polygons), 150 km au plus à vol d'oiseau.
      const stops = Array.isArray(p.stops) ? p.stops : []; // v55 : étapes, une seule requête avec tous les points
      const restr = restrictionsForTrip(data.restrictions ?? [], { vehicle, start: p.start, end: p.end, stops });
      restrictionsUi.closeBridge();
      await tunnelsRead; // v43 : tunnels ADR connus avant de choisir le « Recommandé »
      const { options, failures } = await fetchRouteOptions({
        apiKey: store.getApiKey(), vehicle, start: p.start, end: p.end, avoidTolls: p.avoidTolls, avoidFerries: p.avoidFerries,
        avoidPolygons: restr.geometry, isForbidden: tunnelBanCheck(vehicle), via: stopPoints(stops),
      });
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
        options, failures, selected, vehicle, start: p.start, end: p.end, restr,
        avoidTolls: p.avoidTolls, avoidFerries: p.avoidFerries, fromLabel: p.fromLabel, toLabel: p.toLabel,
        startIsMyPosition: p.startIsMyPosition, stops,
      };
      showChoice(selected);
      routeSaveOn = true;
      saveRoute({ force: true }); // v53 : itinéraire en préparation gardé
      const route = options[0].route;
      update((d) => addTrip(d, {
        date: new Date().toISOString(), from: p.fromLabel, to: p.toLabel, vehicleId: vehicle.id,
        distance: route.distance, duration: route.duration, tollDistance: route.tollDistance,
      }));
    } catch (err) {
      summaryNode.hidden = true;
      notesNode.hidden = true;
      navStartBtn.hidden = true;
      fuelBtn.hidden = true;
      closeFuel();
      planPark.watch(false); // plus de bouton réservé à l'arrêt
      choice = null;
      areas.clear();
      weather.clear();
      access.clear();
      bridges.clear();
      axes.clear();
      sensitive.clear();
      weightLimits.clear();
      speedLimits.clear();
      directions.clear();
      places.clear();
      lanes.clear();
      map.showBridges([]);
      map.showBanSections([]); // v81
      winter.clear();
      map.showZfe([]);
      map.showRoutes([]); // ancien tracé et repères de départ / d'arrivée effacés : rien ne laisse croire à un itinéraire
      map.showStops([]);
      showMessage(messageNode, errorText(err) || 'Erreur inattendue pendant le calcul.', 'error', serviceDetailText(err, store.getApiKey() ?? ''));
    } finally {
      form.setBusy(false);
    }
  },
});
placesUi = createSavedPlaces({
  getList: () => data.places ?? [],
  setList: (list) => update((d) => ({ ...d, places: list })),
  getArrival: () => form.getPlace('to'),
  getCenter: () => map.center(),
  getDrive: () => ({ navigating: navigation.active, parked: navigation.parked }),
});

createShare({ getChoice: () => choice, getMyPosition: () => myPosition });

/**
 * Itinéraires calculés (ou repris, v53) affichés : fiches, tracés, données du trajet (aires, météo, copies data/…),
 * sans requête d'itinéraire.
 */
function showChoice(selected) {
  const options = choice.options;
  // Fiches d'abord : le panneau grandit et la carte rétrécit ; le cadrage se fait ensuite sur la bonne taille.
  renderChoice();
  navStartBtn.hidden = false;
  map.showRoutes(options.map((o) => o.route), selected);
  map.showStops(stopPoints(choice.stops)); // v55
  areas.load(choice); // une requête Overpass pour tous les itinéraires proposés, sans bloquer le calcul
  weather.load(options.map((o) => o.route)); // une requête Open-Meteo, sans bloquer non plus
  access.load(options.map((o) => o.route)); // phase 5d : cases de data/acces-osm/ du trajet, sans requête d'API
  bridges.load(options.map((o) => o.route)); // phase 12a : cases de data/ponts-osm/ du trajet, sans requête d'API
  axes.load(options.map((o) => o.route)); // PR 3a : cases de data/axes-osm/ (repli par la géométrie)
  sensitive.load(options.map((o) => o.route)); // PR 3b : cases de data/points-sensibles/
  weightLimits.load(options.map((o) => o.route)); // phase 12a bis : cases de data/poids-osm/
  speedLimits.load(options.map((o) => o.route)); // phase 11a : cases de data/vitesses-osm/
  directions.load(options.map((o) => o.route)); // phase 11b : cases de data/directions-osm/
  places.load(options.map((o) => o.route)); // phase 11c : cases de data/lieux-osm/
  lanes.load(options.map((o) => o.route)); // phase 11d : cases de data/voies-osm/
  winter.load(options.map((o) => o.route)); // phase 5f : cases de data/hiver/ du trajet, sans requête d'API
}

// ───────── v53 : mémoire de l'itinéraire en arrière-plan (src/lib/route-save.js, IndexedDB) ─────────
// Gardé : itinéraire en préparation et guidage en cours (GPS réel ; jamais une simulation), au passage en arrière-plan
// (visibilitychange / pagehide) et à chaque changement d'état, au plus toutes les 30 s pendant le guidage. Effacé à
// l'arrivée et par « Quitter ». Au démarrage : moins de 12 h → repris tel quel ; plus → « Reprendre l'itinéraire ? »
// posé seulement à l'arrêt (vitesse inconnue = en mouvement, R412-6-2) ; sinon rien n'est demandé, la sauvegarde reste.
const routeStore = createRouteStore();

// ───────── Phase 6 (v56) : historique des trajets terminés (IndexedDB, jamais bloquant, aucune coordonnée) ─────────
const historyStore = createHistoryStore();
const historyPanel = createHistoryPanel({ store: historyStore });
let tripSeq = 0; // identifiant unique : compteur, jamais l'horloge seule
function recordTrip(t) {
  if (!t || t.simulating || !choice) return;
  const trip = buildTrip({
    startedAt: t.tripStartedAt, arrivedAt: Date.now(), from: t.from || choice.fromLabel, to: choice.toLabel,
    stops: (t.stopsDone ?? []).map((label) => ({ label })), drivenM: t.drivenBefore, profile: choice.vehicle?.name ?? '',
    seq: tripSeq++,
  });
  if (trip) historyStore.add(trip).then(() => historyPanel.refresh()).catch(() => {});
}
let lastRouteSave = null;
/** Faux après « Quitter » ou l'arrivée : rien n'est regardé jusqu'au prochain calcul ou choix d'itinéraire. */
let routeSaveOn = false;
function saveRoute(opts) {
  try { writeRoute(opts); } catch { /* sauvegarde impossible : le guidage continue */ }
}
function writeRoute({ force = false } = {}) {
  if (!choice || !routeSaveOn || navigation.simulating) return;
  const kind = navigation.active ? 'nav' : 'plan';
  const progress = navigation.progress;
  if (progress?.arrived) return;
  const key = saveKey(kind, choice);
  const now = Date.now();
  if (!shouldSave(lastRouteSave, { now, key, force })) return;
  const save = buildSave({
    kind, choice, vehicleId: choice.vehicle?.id ?? '', along: progress?.along ?? null, segIndex: progress?.segIndex ?? null,
    nextStop: progress?.nextStop ?? 0, drivenBefore: progress?.drivenBefore ?? 0,
    tripStartedAt: progress?.tripStartedAt ?? null, stopsDone: progress?.stopsDone ?? [], now,
  });
  if (!save) return;
  lastRouteSave = { at: now, key };
  routeStore.put(save).catch(() => {});
}
function forgetRoute() {
  routeSaveOn = false;
  lastRouteSave = null;
  routeStore.clear().catch(() => {});
}
window.addEventListener('pagehide', () => saveRoute({ force: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveRoute({ force: true }); });

const resumeUi = { panel: $('#resume-panel'), yes: $('#btn-resume-yes'), no: $('#btn-resume-no') };
let pendingResume = null;
const resumePark = createPlanPark({ onChange: () => renderResume() });
/** Question « Reprendre l'itinéraire ? » : visible seulement à l'arrêt, jamais pendant un guidage. */
function renderResume() {
  resumeUi.panel.hidden = !pendingResume || !resumePark.parked || navigation.active;
}
function applyResume(save) {
  const back = restoredChoice(save, data.vehicles);
  if (!back) { forgetRoute(); return; }
  choice = back;
  routeSaveOn = true;
  ensureTunnels(back.vehicle); // phase 5b : tunnels ADR lus comme au calcul
  if (!back.startIsMyPosition && Array.isArray(back.start)) form.setPlace('from', { lon: back.start[0], lat: back.start[1], label: back.fromLabel });
  form.setPlace('to', { lon: back.end[0], lat: back.end[1], label: back.toLabel });
  form.setStops(back.stops ?? []); // v55
  showChoice(back.selected);
  if (save.kind === 'nav') startGuidance(null, save.progress);
  else showMessage(messageNode, 'Itinéraire repris (calculé avant la mise en arrière-plan).', 'info');
}
function endResumeQuestion() {
  pendingResume = null;
  resumePark.watch(false);
  renderResume();
}
resumeUi.yes.addEventListener('click', () => {
  if (!pendingResume || !resumePark.parked) return; // refusé hors de l'arrêt
  const save = pendingResume;
  endResumeQuestion();
  applyResume(save);
});
resumeUi.no.addEventListener('click', () => {
  if (!pendingResume || !resumePark.parked) return;
  endResumeQuestion();
  forgetRoute();
});
$('#resume-question').textContent = RESUME_QUESTION;
routeStore.load().then((save) => {
  if (choice || navigation.active) return; // calcul déjà lancé entre-temps : la sauvegarde sera remplacée
  const decision = checkSave(save, { now: Date.now(), vehicles: data.vehicles });
  if (decision.action === 'ignore') routeStore.clear().catch(() => {});
  else if (decision.action === 'restore') applyResume(save);
  else if (decision.action === 'ask') {
    pendingResume = save;
    resumePark.watch(true);
    renderResume();
  }
}).catch(() => { /* reprise impossible : l'appli démarre comme sans sauvegarde */ });

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
