// Carte MapLibre : fond OpenFreeMap avec repli VersaTiles, tracés des itinéraires (choisi en couleur, autres en gris),
// position, suivi en guidage (flèche animée, phase 7c), vue satellite IGN (phase 7 ; en guidage aussi depuis la 7c),
// appui long (phase 8), repères des aires et parkings PL (phase 9).
// Phase 2c (guidage façon GPS de téléphone) : tracé épais, partie parcourue en gris, nord en haut au choix, noms des
// rues en bulles, photos IGN assombries la nuit, voile de la couleur du fond pendant le changement de thème (jamais
// de blanc).
// MapLibre est chargé par index.html (window.maplibregl, version épinglée).
//
// Phase 7b : au retour de l'arrière-plan, Android peut retirer le contexte WebGL (carte vide). On écoute
// webglcontextlost / webglcontextrestored ; si le contexte n'est pas rendu, la carte est recréée à l'identique
// (style, tracés, marqueurs, caméra). Le guidage, lui, ne dépend pas de la carte et continue sans interruption.

import { MAP_STYLES } from '../lib/config.js';
import { routesBbox, pickRouteAt } from '../lib/route-options.js';
import { SATELLITE_SOURCES, satelliteView, sanitizeMapLayer, carryOverlay } from '../lib/map-layers.js';
import { planMove, frameAt, holdStill, stillPoint, stillDrift } from '../lib/nav-anim.js';
import { haversine } from '../lib/nav-geo.js';
import { overviewPadding } from '../lib/navigation.js';
import {
  recolorStyle, mapPaintPatches, ROUTE_WIDTH, ROUTE_WIDTH_NAV, streetBubblePatches, satellitePaint, photoLabelPatches,
  STREET_BUBBLE, bubbleColors, sanitizeNightLevel,
} from '../lib/map-palette.js';
import { vehicleElement } from './vehicle-icon.js';
import { clusterAreas, groupLabel, AREA_CLUSTER } from '../lib/area-cluster.js';
import { sanitizeVehicleIcon } from '../lib/prefs.js';
import { photoCoverPatches } from '../lib/photo-cover.js';
import { ROUTE_ARROWS } from '../lib/nav-layout.js';
import { CHEVRON_IMAGE, TURN_IMAGE, chevronImage, turnImage } from './route-arrows.js';
import { symbolSvg } from './nav-symbols.js';
import { createRouteReplay } from '../lib/route-replay.js';

const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

const FRANCE_CENTER = [2.35, 46.6];
const ROUTE_LAYERS = [
  'ban-sections-line', 'route-hit', 'route-done-line', 'route-done-casing', 'route-turns', 'route-chevrons', 'route-line', 'route-casing',
  'route-alt-line', 'route-alt-casing',
];
/** Flèches sur le tracé en guidage (v53) : pastilles des manœuvres (source à part), chevrons sur le tracé choisi. */
const TURNS_SOURCE = 'route-turns';
const ARROW_LAYERS = ['route-turns', 'route-chevrons'];
/** Partie du tracé déjà parcourue (guidage, phase 2c) : source à part, grise, au-dessus du tracé. */
const DONE_SOURCE = 'route-done';
/**
 * v81 : sections d'interdiction connues du tracé choisi (route-bans.js) : trait rouge fin (couleur réglementaire des ZFE
 * interdites) sur le tracé, à l'arrêt seulement.
 */
const BAN_SOURCE = 'ban-sections';
const BAN_COLOR = '#c62828';
const BAN_WIDTH = 3;
/** Changement de thème : voile posé avant setStyle, retiré au premier rendu complet (1,5 s au plus). */
const VEIL_IN_MS = 150;
const VEIL_MAX_MS = 1500;
/** Marge de toucher autour du doigt (px), en plus de la largeur invisible du tracé. */
const TAP_MARGIN_PX = 10;
/** ZFE (phase 5) : contours sous les libellés, au-dessus des photos ; rouge si interdite au véhicule. */
const ZFE_SOURCE = 'zfe';
const ZFE_LAYERS = ['zfe-fill', 'zfe-line'];
/** Photos aériennes (phases 7 et 7d) : une source raster et une couche par source du registre (« ign-ortho », « sat-lu »…). */
const SAT_LAYERS = SATELLITE_SOURCES.map((src) => src.layer);
/** Bascule d'une source à l'autre : l'ancienne couche reste jusqu'au rendu de la nouvelle (1,5 s au plus). */
const SAT_SWAP_MAX_MS = 1500;
/** Couches de Gabarit, jamais recolorées avec le fond (phase 2c-a). */
const OWN_LAYERS = [...ROUTE_LAYERS, ...ZFE_LAYERS, ...SAT_LAYERS];
/** Bord du tracé sur les photos IGN, jour et nuit (noir Panier Perdu). */
const SAT_CASING = '#14161C';
/** Repères : départ vert, arrivée rouge (repères universels), point choisi violet ; hors palette exprès. */
const MARK_COLORS = Object.freeze({ start: '#146c2e', end: '#b3261e', pin: '#7b2fbf' });
/** Contexte WebGL perdu : délai avant de recréer la carte s'il n'est pas rendu (retour au premier plan / page visible). */
const RESTORE_WAIT_VISIBLE_MS = 1500;
const RESTORE_WAIT_LOST_MS = 3000;
/** Appui long sur la carte (phase 8) : durée et tolérance de mouvement du doigt. */
const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE_PX = 10;

/** Le canevas de la carte a-t-il perdu son contexte WebGL ? (getContext renvoie le contexte existant.) */
function contextLost(canvas) {
  try {
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    return !gl || gl.isContextLost();
  } catch {
    return true;
  }
}

/** Premier style qui répond (fetch rapide), sinon null. */
async function pickStyle(urls) {
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        await res.json();
        return url;
      }
    } catch {
      // on essaie le suivant
    }
  }
  return null;
}

/**
 * @param {HTMLElement} container
 * @param {HTMLElement} fallbackNode
 * @param {'day'|'night'} initialTheme
 * @param {{ layer?:string, onLayerView?:(view:{photos:boolean,message:string,button:boolean})=>void }} [opts]
 */
export function createMap(container, fallbackNode, initialTheme, opts = {}) {
  const lib = window.maplibregl;
  let map = null;
  let routes = []; // [{ coordinates, bbox }] : itinéraires affichés
  let selected = 0; // indice de l'itinéraire choisi (couleur vive)
  let routeBbox = null;
  const replay = createRouteReplay(); // v85 : cadrage d'un itinéraire montré avant la création de la carte
  let theme = initialTheme;
  /** Luminosité de la carte la nuit (phase 2d) : 'dark' | 'normal' | 'light'. */
  let nightLevel = sanitizeNightLevel(opts.nightLevel);
  let vehicleIcon = sanitizeVehicleIcon(opts.vehicleIcon); // v45 : « Flèche » ou « Camion » (Réglages › Affichage)
  /** Aire mise en évidence (liste du guidage, phase 2d). */
  let highlighted = null;
  let navigating = false;
  let onGesture = null;
  let onPick = null;
  let onLongPress = null;
  let onTap = null;
  /** Animation de la flèche (et de la caméra si elle suit) entre deux positions : une boucle qui s'arrête à la fin. */
  let anim = null;
  let animFrame = null;
  let lastNav = null;
  /** Point d'arrêt (moyenne des positions reçues à l'arrêt, stillPoint) : référence de la dérive du GPS. */
  let stop = null;
  let layer = sanitizeMapLayer(opts.layer);
  let lastView = null;
  /** Couche de photos visible (phase 7d), bascule en cours. */
  let shownSat = null;
  /** v65 : aplats du plan masqués au-dessus des photos (bâtiments…), rendus au retour en plan (photo-cover.js). */
  let coverHidden = new Set();
  let swapTimer = null;
  let styleUrl = null;
  let lost = false;
  let restoreTimer = null;
  /** Partie parcourue (guidage) : [[lon, lat]…], vide hors guidage. */
  let done = [];
  /** Pastilles des manœuvres du guidage (v53). */
  let turns = EMPTY_FC;
  /** Guidage : caméra nord en haut (boussole) au lieu du cap en haut. */
  let northUp = false;
  let veilTimer = null;
  /** Bulles des noms de rues posées sur le style en cours (retirées seulement si elles y sont). */
  let bubbles = false;
  const veil = document.createElement('div');
  veil.className = 'map-veil';
  veil.setAttribute('aria-hidden', 'true');
  container.append(veil);
  const markers = { start: null, end: null, me: null, pin: null, pinTo: null, pinFrom: null };
  /** Dernières positions des marqueurs (pour recréer la carte). */
  const marks = { start: null, end: null, me: null, meBearing: null, pin: null, pinTo: null, pinFrom: null };
  /**
   * Aires du trajet (phase 9) : repères HTML (pas des couches du style : ils restent au changement de thème et se
   * touchent facilement). [{ id, lonlat, label, otherSide }]
   */
  let areaItems = [];
  let areaKey = ''; // v62 : repères des aires dessinés (clusterAreas) ; areaDraws compte les dessins (ui-check)
  let areaDraws = 0;
  let areaMarkers = [];
  // Ponts sans hauteur connue (phase 12a) : repères à l'arrêt seulement, jamais en guidage.
  let bridgeItems = [];
  let bridgeMarkers = [];
  let bridgeKey = ''; // v81 : repères des ponts dessinés (regroupés à zoom < 11)
  /** v81 : morceaux du tracé choisi dans une section interdite : [[[lon, lat], …], …]. */
  let banLines = [];
  /** v55 : étapes du trajet, repères numérotés (aussi en guidage) : [[lon, lat], …]. */
  let stopItems = [];
  let stopMarkers = [];
  let reportItems = []; // phase 3a : mes signalements [{ id, lonlat, label, confirmed }]
  let reportMarkers = [];
  let onReport = null;
  let trafficItems = []; // phase 10 A : événements de trafic du tracé, fiche ouverte à l'arrêt [{ key, lonlat, glyph, kind, label }]
  let trafficMarkers = [];
  let onTraffic = null;
  let onBridge = null;
  let onArea = null;
  /** ZFE affichées (phase 5) : [{ name, banned, polygons }]. */
  let zfeItems = [];

  function zfeData() {
    return {
      type: 'FeatureCollection',
      features: zfeItems.map((z) => ({
        type: 'Feature',
        properties: { name: z.name, banned: !!z.banned },
        geometry: { type: 'MultiPolygon', coordinates: z.polygons },
      })),
    };
  }

  /** Contours des ZFE du trajet, sous les libellés du fond et au-dessus des photos IGN. */
  function addZfeLayers() {
    if (!map) return;
    const src = map.getSource(ZFE_SOURCE);
    if (src) { src.setData(zfeData()); return; }
    if (!zfeItems.length) return;
    map.addSource(ZFE_SOURCE, { type: 'geojson', data: zfeData() });
    const firstSymbol = map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
    const color = ['case', ['get', 'banned'], '#c62828', '#e08a00'];
    map.addLayer({ id: 'zfe-fill', type: 'fill', source: ZFE_SOURCE, paint: { 'fill-color': color, 'fill-opacity': 0.12 } }, firstSymbol);
    map.addLayer({
      id: 'zfe-line', type: 'line', source: ZFE_SOURCE,
      paint: { 'line-color': color, 'line-width': 2.5, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 },
    }, firstSymbol);
  }

  function routesData() {
    return {
      type: 'FeatureCollection',
      features: routes.map((r, i) => ({
        type: 'Feature',
        properties: { index: i, selected: i === selected },
        geometry: { type: 'LineString', coordinates: r.coordinates },
      })),
    };
  }

  /** Couleurs des tracés selon le thème en cours (variables CSS). */
  function routeColors() {
    const css = getComputedStyle(document.documentElement);
    const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const photos = !!lastView?.photos;
    return {
      'route-alt-casing': photos ? SAT_CASING : color('--route-alt-casing', '#14161C'),
      'route-alt-line': color('--route-alt', '#A9A79E'),
      'route-casing': photos ? SAT_CASING : color('--route-casing', '#14161C'),
      'route-line': color('--route', '#E8A93B'),
      'route-done-casing': photos ? SAT_CASING : color('--route-alt-casing', '#14161C'),
      'route-done-line': color('--route-alt', '#A9A79E'),
    };
  }

  function banData() {
    return {
      type: 'FeatureCollection',
      features: navigating ? [] : banLines.filter((l) => Array.isArray(l) && l.length > 1)
        .map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
    };
  }

  function doneData() {
    return {
      type: 'FeatureCollection',
      features: done.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: done } }] : [],
    };
  }

  /** Largeurs du tracé : épais en guidage (phase 2c), comme avant à l'arrêt. */
  function routeWidths() {
    return navigating
      ? { 'route-line': ROUTE_WIDTH_NAV.line, 'route-casing': ROUTE_WIDTH_NAV.casing, 'route-done-line': ROUTE_WIDTH_NAV.done, 'route-done-casing': ROUTE_WIDTH_NAV.doneCasing }
      : { 'route-line': ROUTE_WIDTH.line, 'route-casing': ROUTE_WIDTH.casing, 'route-done-line': ROUTE_WIDTH.line, 'route-done-casing': ROUTE_WIDTH.casing };
  }

  function applyRouteWidths() {
    if (!map) return;
    for (const [id, w] of Object.entries(routeWidths())) if (map.getLayer(id)) map.setPaintProperty(id, 'line-width', w);
  }

  function addRouteLayers() {
    if (!map || !routes.length || map.getSource('route')) return;
    const c = routeColors();
    const isSelected = ['==', ['get', 'selected'], true];
    const layout = { 'line-join': 'round', 'line-cap': 'round' };
    const w = routeWidths();
    map.addSource('route', { type: 'geojson', data: routesData() });
    map.addSource(DONE_SOURCE, { type: 'geojson', data: doneData() });
    // Ordre d'empilement : autres itinéraires (gris) dessous, itinéraire choisi dessus, zone de toucher invisible au-dessus.
    map.addLayer({
      id: 'route-alt-casing', type: 'line', source: 'route', filter: ['!', isSelected], layout,
      paint: { 'line-color': c['route-alt-casing'], 'line-width': ROUTE_WIDTH.altCasing },
    });
    map.addLayer({
      id: 'route-alt-line', type: 'line', source: 'route', filter: ['!', isSelected], layout,
      paint: { 'line-color': c['route-alt-line'], 'line-width': ROUTE_WIDTH.altLine },
    });
    map.addLayer({
      id: 'route-casing', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': c['route-casing'], 'line-width': w['route-casing'] },
    });
    map.addLayer({
      id: 'route-line', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': c['route-line'], 'line-width': w['route-line'] },
    });
    // v81 : trait rouge fin sur les sections interdites, au milieu du tracé choisi (vide en guidage).
    map.addSource(BAN_SOURCE, { type: 'geojson', data: banData() });
    map.addLayer({ id: 'ban-sections-line', type: 'line', source: BAN_SOURCE, layout, paint: { 'line-color': BAN_COLOR, 'line-width': BAN_WIDTH } });
    // v53 : chevrons blancs dans le sens de la marche (cachés de loin) et pastilles des manœuvres, sous la partie
    // parcourue (grise) ; seulement en guidage. Dessinés par MapLibre le long de la ligne : rien par position.
    putArrowImages();
    map.addSource(TURNS_SOURCE, { type: 'geojson', data: turns });
    const shown = navigating ? 'visible' : 'none';
    map.addLayer({
      id: 'route-chevrons', type: 'symbol', source: 'route', filter: isSelected, minzoom: ROUTE_ARROWS.MIN_ZOOM,
      layout: {
        visibility: shown, 'symbol-placement': 'line', 'symbol-spacing': ROUTE_ARROWS.SPACING_PX, 'icon-image': CHEVRON_IMAGE,
        'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    });
    map.addLayer({
      id: 'route-turns', type: 'symbol', source: TURNS_SOURCE, minzoom: ROUTE_ARROWS.TURN_MIN_ZOOM,
      layout: {
        visibility: shown, 'icon-image': TURN_IMAGE, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    });
    map.addLayer({
      id: 'route-done-casing', type: 'line', source: DONE_SOURCE, layout,
      paint: { 'line-color': c['route-done-casing'], 'line-width': w['route-done-casing'] },
    });
    map.addLayer({
      id: 'route-done-line', type: 'line', source: DONE_SOURCE, layout,
      paint: { 'line-color': c['route-done-line'], 'line-width': w['route-done-line'] },
    });
    map.addLayer({
      id: 'route-hit', type: 'line', source: 'route', layout,
      paint: { 'line-color': '#000', 'line-width': 28, 'line-opacity': 0 },
    });
  }

  /**
   * Style lu et prêt à recevoir sources et couches. Pas map.isStyleLoaded() : il reste faux tant qu'une tuile ou
   * une source GeoJSON se charge (Style.loaded() de MapLibre 4.7.1), alors que « style.load » ne sera plus émis
   * → tracé jamais dessiné (régression constatée en v17). map.getStyle() n'est vide qu'avant la lecture du style.
   */
  function styleReady() {
    return !!map?.getStyle();
  }

  function removeRouteLayers() {
    if (!map) return;
    for (const id of ROUTE_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource('route')) map.removeSource('route');
    if (map.getSource(DONE_SOURCE)) map.removeSource(DONE_SOURCE);
    if (map.getSource(TURNS_SOURCE)) map.removeSource(TURNS_SOURCE);
    if (map.getSource(BAN_SOURCE)) map.removeSource(BAN_SOURCE);
  }

  /** Images des flèches (v53), ajoutées une fois par style. */
  function putArrowImages() {
    if (!map) return;
    for (const [id, draw] of [[CHEVRON_IMAGE, chevronImage], [TURN_IMAGE, turnImage]]) {
      if (map.hasImage(id)) continue;
      const img = draw();
      try { if (img) map.addImage(id, img, { pixelRatio: 2 }); } catch { /* image refusée : pas de flèche */ }
    }
  }

  /** Flèches visibles seulement en guidage. */
  function applyArrowVisibility() {
    if (!map) return;
    for (const id of ARROW_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', navigating ? 'visible' : 'none');
  }

  /** Toucher un tracé (à l'arrêt, plusieurs itinéraires) le sélectionne. */
  function onMapClick(e) {
    // Choix de l'appui long : fermé par un toucher ailleurs, mais pas par le « clic » qui suit le doigt levé.
    if (Date.now() - lastPressAt > 700) onTap?.();
    if (navigating || routes.length < 2 || !onPick || !map.getLayer('route-hit')) return;
    const { x, y } = e.point;
    const box = [[x - TAP_MARGIN_PX, y - TAP_MARGIN_PX], [x + TAP_MARGIN_PX, y + TAP_MARGIN_PX]];
    const hits = map.queryRenderedFeatures(box, { layers: ['route-hit'] }).map((f) => f.properties?.index);
    const next = pickRouteAt(hits, selected);
    if (next !== null) onPick(next);
  }

  /**
   * Photos IGN : couche raster glissée sous les libellés du fond (les noms de rues restent lisibles) ; les tracés,
   * ajoutés au-dessus, et les marqueurs (éléments HTML) restent toujours visibles par-dessus.
   */
  function addSatelliteLayer() {
    if (!map) return;
    const style = map.getStyle();
    const firstSymbol = style?.layers?.find((l) => l.type === 'symbol')?.id;
    const beforeId = firstSymbol ?? (map.getLayer('route-casing') ? 'route-casing' : undefined);
    for (const src of SATELLITE_SOURCES) {
      if (map.getSource(src.layer)) continue;
      map.addSource(src.layer, {
        type: 'raster', tiles: src.tiles, tileSize: src.tileSize, minzoom: src.minzoom, maxzoom: src.maxzoom, attribution: src.attribution,
      });
      map.addLayer({ id: src.layer, type: 'raster', source: src.layer, layout: { visibility: 'none' }, paint: satellitePaint(theme, nightLevel) }, beforeId);
    }
    shownSat = null; // style neuf : couches toutes masquées
    coverHidden = new Set(); // style neuf : aplats d'origine, visibles
    applyLayer();
  }

  /**
   * Couche de photos montrée (phase 7d) : la nouvelle source s'affiche d'abord, l'ancienne n'est masquée qu'une fois
   * la nouvelle dessinée (« idle », 1,5 s au plus) : pas de clignotement à la frontière.
   */
  function showSatLayer(id) {
    if (!map || shownSat === id) return;
    const prev = shownSat;
    shownSat = id;
    clearTimeout(swapTimer);
    if (id && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    const hideOthers = () => {
      clearTimeout(swapTimer);
      if (!map) return;
      for (const l of SAT_LAYERS) if (l !== shownSat && map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'none');
    };
    if (prev && id) {
      swapTimer = setTimeout(hideOthers, SAT_SWAP_MAX_MS);
      map.once('idle', hideOthers);
    } else hideOthers();
  }

  /** Montre ou masque les photos selon le choix, le centre de la carte et le guidage. */
  function applyLayer() {
    const c = map?.getCenter();
    // Pas de carte (hors ligne, MapLibre absent) : pas de bouton.
    const view = map ? satelliteView({ layer, center: [c.lng, c.lat], navigating }) : { photos: false, message: '', button: false, source: null };
    const src = SATELLITE_SOURCES.find((x) => x.id === view.source);
    if (map?.getLayer(src?.layer ?? SAT_LAYERS[0]) || !view.photos) showSatLayer(view.photos ? src.layer : null);
    if (!lastView || lastView.photos !== view.photos || lastView.message !== view.message || lastView.button !== view.button) {
      const photosChanged = lastView?.photos !== view.photos;
      lastView = view;
      if (photosChanged) { paintRoutes(); paintLabels(); applyPhotoCover(); }
      opts.onLayerView?.(view);
    }
  }

  /**
   * v65 : bâtiments (fill, fill-extrusion) et autres aplats du style placés au-dessus des photos masqués tant que les
   * photos sont montrées ; rendus en plan, hors zone de photos et rappliqués après chaque nouveau style.
   */
  function applyPhotoCover() {
    const layers = map?.getStyle()?.layers;
    if (!layers) return;
    const r = photoCoverPatches(layers, { photos: !!lastView?.photos, satIds: SAT_LAYERS, keep: OWN_LAYERS, hidden: coverHidden });
    coverHidden = r.hidden;
    for (const p of r.patches) {
      try { map.setLayoutProperty(p.id, 'visibility', p.value); } catch { /* couche refusée : laissée */ }
    }
  }

  /** Couleurs des tracés déjà dessinés (changement plan ↔ photos : bord noir sur les photos). */
  function paintRoutes() {
    if (!map) return;
    for (const [id, color] of Object.entries(routeColors())) if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color);
  }

  /** Libellés sur les photos la nuit : clairs (src/lib/map-palette.js), sinon ceux de la palette. */
  function paintLabels() {
    const layers = map?.getStyle()?.layers;
    if (!layers) return;
    for (const p of photoLabelPatches(layers, theme, !!lastView?.photos, OWN_LAYERS, nightLevel)) {
      try { map.setPaintProperty(p.id, p.prop, p.value); } catch { /* couche refusée : laissée */ }
    }
  }

  /** Bulle des noms de rues (image étirable autour du texte), aux couleurs du thème. */
  function bubbleImage() {
    const c = bubbleColors(theme, nightLevel);
    const size = 32;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = c.border;
    g.beginPath(); g.roundRect(0, 0, size, size, 14); g.fill();
    g.fillStyle = c.fill;
    g.beginPath(); g.roundRect(3, 3, size - 6, size - 6, 11); g.fill();
    return g.getImageData(0, 0, size, size);
  }

  function putBubble() {
    if (!map) return;
    const img = bubbleImage();
    if (!img) return;
    const opts = { pixelRatio: 2, stretchX: [[14, 18]], stretchY: [[14, 18]], content: [8, 8, 24, 24] };
    try {
      if (map.hasImage(STREET_BUBBLE.image)) map.updateImage(STREET_BUBBLE.image, img);
      else map.addImage(STREET_BUBBLE.image, img, opts);
    } catch { /* image refusée : libellés sans bulle */ }
  }

  /**
   * Réglages du fond propres au guidage et au thème (phase 2c) : bulles des rues en guidage, photos assombries la
   * nuit, libellés clairs sur les photos la nuit. Appelé au chargement d'un style, au changement de thème et à
   * l'entrée / la sortie du guidage — jamais à chaque position.
   */
  function applyGuidanceStyle() {
    const layers = map?.getStyle()?.layers;
    if (!layers) return;
    if (!navigating) recolorBase(); // couleurs des libellés de la palette rendues (bulles retirées)
    for (const id of SAT_LAYERS) {
      if (!map.getLayer(id)) continue;
      for (const [prop, value] of Object.entries(satellitePaint(theme, nightLevel))) map.setPaintProperty(id, prop, value);
    }
    paintLabels();
    applyPhotoCover();
    if (navigating) putBubble();
    if (navigating || bubbles) {
      for (const p of streetBubblePatches(layers, theme, navigating, nightLevel)) {
        try {
          if (p.kind === 'layout') map.setLayoutProperty(p.id, p.prop, p.value);
          else map.setPaintProperty(p.id, p.prop, p.value);
        } catch { /* propriété refusée : laissée */ }
      }
    }
    bubbles = navigating;
    applyRouteWidths();
  }

  /** Fond de carte aux couleurs Panier Perdu (src/lib/map-palette.js), au premier chargement d'un style. */
  function recolorBase() {
    const layers = map?.getStyle()?.layers;
    for (const p of mapPaintPatches(layers, theme, OWN_LAYERS, nightLevel)) {
      try { map.setPaintProperty(p.id, p.prop, p.value); } catch { /* couche ou propriété refusée : laissée */ }
    }
  }

  function fitRoute(duration = 800) {
    const b = routeBbox && routeBbox.length >= 4 ? [[routeBbox[0], routeBbox[1]], [routeBbox[2], routeBbox[3]]] : null;
    if (map && b) map.resize(); // le panneau a pu changer de hauteur (fiches) : cadrer sur la taille réelle
    if (map && b) map.fitBounds(b, { padding: { top: 64, right: 72, bottom: 48, left: 48 }, duration, bearing: 0, pitch: 0 });
  }

  /**
   * Nouveau style (thème) : setStyle compare les deux styles et retirerait nos couches sans émettre « style.load » ;
   * carryOverlay les recopie (photos sous les libellés, tracés au-dessus, aux couleurs du nouveau thème).
   */
  function transformStyle(prev, next) {
    coverHidden = new Set(); // nouveau style : aplats d'origine, remasqués par applyGuidanceStyle si photos
    const c = routeColors();
    const paint = Object.fromEntries(Object.entries(c).map(([id, color]) => [id, { 'line-color': color }]));
    return carryOverlay(prev, recolorStyle(next, theme, OWN_LAYERS, nightLevel), { below: [...SAT_LAYERS, ...ZFE_LAYERS], above: [...ROUTE_LAYERS].reverse(), paint });
  }

  /** Crée la carte MapLibre (au démarrage, ou pour remplacer une carte dont le contexte WebGL est perdu). */
  function build(url, camera = { center: FRANCE_CENTER, zoom: 5 }) {
    bubbles = false;
    map = new lib.Map({ container, style: url, ...camera, attributionControl: { compact: true } });
    map.addControl(new lib.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new lib.ScaleControl({ unit: 'metric' }), 'bottom-left');
    // Geste de l'utilisateur (doigt) : les mouvements lancés par le code n'ont pas d'originalEvent.
    for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
      map.on(ev, (e) => {
        if (!e.originalEvent) return;
        cancelPress();
        if (navigating) {
          if (anim) anim.follow = false; // la caméra ne reprend pas la main pendant le geste
          onGesture?.();
        }
      });
    }
    map.on('click', onMapClick);
    wireLongPress();
    map.on('style.load', recolorBase); // couleurs Panier Perdu (setStyle avec transformStyle : recolorStyle)
    map.on('style.load', addSatelliteLayer); // aussi après une reconstruction complète du style
    map.on('style.load', addZfeLayers);
    map.on('style.load', applyGuidanceStyle);
    // Style changé (thème) : l'image de la bulle n'existe plus, elle est redessinée à la demande.
    map.on('styleimagemissing', (e) => {
      if (e.id === STREET_BUBBLE.image) putBubble();
      if (e.id === CHEVRON_IMAGE || e.id === TURN_IMAGE) putArrowImages();
    });
    map.on('moveend', applyLayer);
    // v62 : P masqués / regroupés selon le zoom (area-cluster.js), recalculés à la fin d'un mouvement seulement.
    map.on('moveend', () => drawAreas());
    map.on('moveend', () => drawBridges()); // v81 : ponts regroupés selon le zoom
    map.on('webglcontextlost', () => {
      lost = true;
      scheduleRestoreCheck(RESTORE_WAIT_LOST_MS);
    });
    map.on('webglcontextrestored', () => {
      lost = false;
      clearTimeout(restoreTimer);
      map.resize();
      map.triggerRepaint();
    });
    map.once('style.load', addRouteLayers);
    if (marks.start) marker('start', marks.start, MARK_COLORS.start);
    if (marks.end) marker('end', marks.end, MARK_COLORS.end);
    if (marks.me) vehicle(marks.me, marks.meBearing);
    if (marks.pin) marker('pin', marks.pin, MARK_COLORS.pin);
    if (marks.pinTo) marker('pinTo', marks.pinTo, MARK_COLORS.pin);
    if (marks.pinFrom) marker('pinFrom', marks.pinFrom, MARK_COLORS.pin);
    drawAreas({ force: true });
    drawBridges({ force: true });
    drawStops();
    drawReports();
    drawTraffic();
    if (replay.takeFit()) fitRoute(0); // v85 : itinéraire montré avant la carte : cadré une fois, sans animation
  }

  /**
   * Phase 10 A : repères des événements de trafic (fiche « Trafic » ouverte, à l'arrêt seulement, hors guidage et en
   * guidage) : bord pointillé (à vérifier), texte court, jamais rouge ; toucher → ligne de la fiche.
   */
  function drawTraffic() {
    for (const m of trafficMarkers) m.remove();
    trafficMarkers = [];
    if (!map) return;
    for (const item of trafficItems) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `traffic-marker kind-${item.kind}`;
      node.dataset.key = item.key;
      node.textContent = item.glyph;
      node.setAttribute('aria-label', item.label);
      node.title = item.label;
      for (const ev of ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu']) node.addEventListener(ev, (e) => e.stopPropagation());
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onTraffic?.(item.key);
      });
      trafficMarkers.push(new lib.Marker({ element: node, anchor: 'center' }).setLngLat(item.lonlat).addTo(map));
    }
  }

  /** Phase 3a : repères de mes signalements (hors guidage et en guidage) ; toucher → fiche (à l'arrêt, app.js). */
  function drawReports() {
    for (const m of reportMarkers) m.remove();
    reportMarkers = [];
    if (!map) return;
    for (const item of reportItems) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `report-marker${item.confirmed ? ' confirmed' : ''}`;
      node.dataset.id = item.id;
      node.append(symbolSvg('flag'));
      node.setAttribute('aria-label', item.label);
      node.title = item.label;
      for (const ev of ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu']) node.addEventListener(ev, (e) => e.stopPropagation());
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onReport?.(item.id);
      });
      reportMarkers.push(new lib.Marker({ element: node, anchor: 'center' }).setLngLat(item.lonlat).addTo(map));
    }
  }

  function drawStops() {
    for (const m of stopMarkers) m.remove();
    stopMarkers = [];
    if (!map) return;
    stopItems.forEach((p, i) => {
      const node = document.createElement('div');
      node.className = 'stop-marker';
      node.textContent = String(i + 1);
      node.setAttribute('aria-label', `Étape ${i + 1}`);
      stopMarkers.push(new lib.Marker({ element: node, anchor: 'center' }).setLngLat(p).addTo(map));
    });
  }

  function bridgeElement(item) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `bridge-marker ${item.level === 'high' ? 'high' : 'medium'}${item.kind === 'weight' ? ' weight-marker' : ''}${item.kind === 'dialog' ? ' weight-marker dialog-marker' : ''}${item.kind === 'sensitive' ? ' sensitive-marker' : ''}`;
    node.dataset.key = item.key;
    // Limite de poids (12a bis) : « 3,5 t » ; limite DiaLog (12c) : « 3,4 m » ou « 3,5 t », bord pointillé ;
    // point sensible (PR 3b) : « ! ».
    node.textContent = (item.kind === 'weight' || item.kind === 'dialog' || item.kind === 'sensitive') && item.glyph ? item.glyph : '⚠';
    node.setAttribute('aria-label', item.label);
    node.title = item.label;
    for (const ev of ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu']) node.addEventListener(ev, (e) => e.stopPropagation());
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onBridge?.(item.key);
    });
    return node;
  }

  /** v81 : pastille « ⚠ 12 » d'un groupe de ponts / limites de poids (toucher = zoom + 2 sur le groupe). */
  function bridgeGroupElement(mark) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'bridge-marker weight-marker bridge-group';
    node.textContent = `⚠ ${mark.items.length}`;
    const aria = `${mark.items.length} ponts ou limites à vérifier : toucher pour zoomer`;
    node.setAttribute('aria-label', aria);
    node.title = aria;
    for (const ev of ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu']) node.addEventListener(ev, (e) => e.stopPropagation());
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!map) return;
      if (anim) anim.follow = false;
      map.easeTo({ center: mark.lonlat, zoom: map.getZoom() + AREA_CLUSTER.GROUP_ZOOM_STEP, duration: 500 });
    });
    return node;
  }

  /**
   * Repères des ponts (12a), limites de poids (12a bis) et points sensibles (PR 3b), à l'arrêt seulement. v81 : à zoom
   * < 11, ponts et limites regroupés par case de 64 px (même règle que les P, area-cluster.js ; jamais cachés, même
   * sous le zoom 8) : 51 repères collés le long de la N59 formaient une masse noire sur le tracé (test tablette du
   * 26/11/2026). Les points sensibles (« ! », un par section) ne sont jamais regroupés.
   */
  function drawBridges({ force = false } = {}) {
    if (!map || navigating) {
      for (const m of bridgeMarkers) m.remove();
      bridgeMarkers = [];
      bridgeKey = '';
      return;
    }
    const zoom = map.getZoom();
    const pool = bridgeItems.filter((i) => i.kind !== 'sensitive').map((i) => ({ ...i, id: i.key }));
    const plan = clusterAreas(pool, {
      zoom: zoom < AREA_CLUSTER.ALL_FROM ? Math.max(zoom, AREA_CLUSTER.HIDE_BELOW) : zoom,
      project: (ll) => map.project(ll),
    });
    const sens = bridgeItems.filter((i) => i.kind === 'sensitive');
    const key = `${plan.key}|${sens.map((i) => i.key).join(',')}`;
    if (!force && key === bridgeKey) return;
    bridgeKey = key;
    for (const m of bridgeMarkers) m.remove();
    bridgeMarkers = [];
    for (const m of plan.marks) {
      const node = m.kind === 'group' ? bridgeGroupElement(m) : bridgeElement(m.item);
      bridgeMarkers.push(new lib.Marker({ element: node, anchor: 'center' }).setLngLat(m.kind === 'group' ? m.lonlat : m.item.lonlat).addTo(map));
    }
    for (const item of sens) {
      bridgeMarkers.push(new lib.Marker({ element: bridgeElement(item), anchor: 'center' }).setLngLat(item.lonlat).addTo(map));
    }
  }

  function areaElement(item) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `area-marker${item.otherSide ? ' other-side' : ''}${item.id === highlighted ? ' selected' : ''}`;
    node.dataset.id = item.id;
    node.textContent = 'P';
    node.setAttribute('aria-label', item.label);
    node.title = item.label;
    // Le toucher ouvre la fiche sans être pris par la carte (sélection d'un tracé, fermeture de l'appui long).
    for (const ev of ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu']) node.addEventListener(ev, (e) => e.stopPropagation());
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onArea?.(item.id);
    });
    return node;
  }

  function clearAreaMarkers() {
    for (const m of areaMarkers) m.remove();
    areaMarkers = [];
  }

  function groupElement(mark) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'area-marker area-group';
    const l = groupLabel(mark.items.length);
    node.textContent = l.text;
    node.setAttribute('aria-label', l.aria);
    node.title = l.aria;
    for (const ev of ['mousedown', 'touchstart', 'pointerdown', 'dblclick', 'contextmenu']) node.addEventListener(ev, (e) => e.stopPropagation());
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!map) return;
      if (anim) anim.follow = false;
      map.easeTo({ center: mark.lonlat, zoom: map.getZoom() + AREA_CLUSTER.GROUP_ZOOM_STEP, duration: 500 });
    });
    return node;
  }

  function drawAreas({ force = false } = {}) {
    if (!map) { clearAreaMarkers(); areaKey = ''; return; }
    const plan = clusterAreas(areaItems, {
      zoom: map.getZoom(),
      project: (ll) => map.project(ll),
      keep: highlighted,
      stops: stopItems,
    });
    // Mêmes repères qu'avant : rien n'est recréé (le suivi du véhicule ne redessine jamais les P).
    if (!force && plan.key === areaKey) return;
    areaKey = plan.key;
    areaDraws += 1;
    clearAreaMarkers();
    // Autre sens en dessous (ajoutés d'abord), sens de circulation par-dessus ; groupes au-dessus des P.
    const rank = (m) => (m.kind === 'group' ? 2 : m.item.otherSide ? 0 : 1);
    const marks = [...plan.marks].sort((a, b) => rank(a) - rank(b));
    for (const m of marks) {
      const node = m.kind === 'group' ? groupElement(m) : areaElement(m.item);
      areaMarkers.push(new lib.Marker({ element: node, anchor: 'center' }).setLngLat(m.kind === 'group' ? m.lonlat : m.item.lonlat).addTo(map));
    }
  }

  // ───────── Appui long (phase 8) : « Aller ici » / « Partir d'ici », hors guidage ─────────
  let press = null;
  let lastPressAt = 0;

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  function firePress(lngLat) {
    if (navigating || !onLongPress || !lngLat) return;
    lastPressAt = Date.now();
    onLongPress([lngLat.lng, lngLat.lat]);
  }

  function wireLongPress() {
    map.on('touchstart', (e) => {
      cancelPress();
      if (navigating || e.originalEvent?.touches?.length !== 1) return;
      const { point, lngLat } = e;
      press = { point, timer: setTimeout(() => { press = null; firePress(lngLat); }, LONG_PRESS_MS) };
    });
    map.on('touchmove', (e) => {
      if (!press) return;
      if (e.originalEvent?.touches?.length !== 1
        || Math.hypot(e.point.x - press.point.x, e.point.y - press.point.y) > LONG_PRESS_MOVE_PX) cancelPress();
    });
    map.on('touchend', cancelPress);
    map.on('touchcancel', cancelPress);
    // Souris (clic droit) ; Chrome Android émet aussi « contextmenu » après un appui long : pas de doublon.
    map.on('contextmenu', (e) => {
      e.originalEvent?.preventDefault?.();
      if (Date.now() - lastPressAt > 1000) firePress(e.lngLat);
    });
  }

  // ───────── Flèche fluide (phase 7c) ─────────

  function tick(now) {
    animFrame = null;
    if (!anim) return;
    const t = anim.move.duration > 0 ? (now - anim.start) / anim.move.duration : 1;
    const f = frameAt(anim.move, t);
    vehicle(f.lonlat, f.bearing);
    if (anim.follow && map) {
      const cam = { center: f.lonlat, padding: anim.padding };
      if (anim.northUp) cam.bearing = 0;
      else if (Number.isFinite(f.bearing)) cam.bearing = f.bearing;
      if (Number.isFinite(f.zoom)) cam.zoom = f.zoom;
      if (Number.isFinite(f.pitch)) cam.pitch = f.pitch;
      map.jumpTo(cam);
    }
    if (t < 1) animFrame = requestAnimationFrame(tick);
    else anim = null; // fin de l'interpolation : plus aucun rendu tant que rien ne bouge
  }

  function stopAnim() {
    if (animFrame !== null) cancelAnimationFrame(animFrame);
    animFrame = null;
    anim = null;
  }

  /** Recrée la carte à l'identique (même style, tracés, marqueurs, caméra). */
  function recreate() {
    if (!map || !styleUrl) return;
    const camera = {
      center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
    };
    const padding = map.getPadding();
    try {
      map.remove();
    } catch {
      // carte déjà inutilisable : on la remplace quand même
    }
    map = null;
    for (const k of Object.keys(markers)) markers[k] = null;
    areaMarkers = [];
    bridgeMarkers = [];
    lost = false;
    lastView = null;
    build(styleUrl, camera);
    map.setPadding(padding);
    applyLayer();
  }

  /** Contexte encore perdu après le délai (page visible) : la carte est recréée. */
  function scheduleRestoreCheck(ms) {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (!map || document.visibilityState === 'hidden') return; // on vérifiera au retour au premier plan
      if (lost || contextLost(map.getCanvas())) recreate();
    }, ms);
  }

  /**
   * Voile de la couleur du nouveau fond (variables CSS déjà basculées) : aucune image claire pendant le changement
   * de style ou de luminosité, fondu de 300 ms (src/styles.css).
   */
  function showVeil() {
    veil.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#14161C';
    veil.classList.add('on');
    clearTimeout(veilTimer);
  }

  /**
   * Luminosité de la nuit changée (phase 2d) : mêmes couches, couleurs reprises par setPaintProperty sous le voile,
   * sans setStyle ni rechargement. Le jour : retenue pour la prochaine nuit, rien à redessiner.
   */
  function applyNightLevel() {
    if (!map || theme !== 'night' || !map.getStyle()?.layers) return;
    showVeil();
    veilTimer = setTimeout(() => {
      recolorBase();
      applyGuidanceStyle();
      const off = () => { clearTimeout(veilTimer); veil.classList.remove('on'); };
      map.once('idle', off);
      map.triggerRepaint();
      veilTimer = setTimeout(off, VEIL_MAX_MS);
    }, VEIL_IN_MS);
  }

  async function loadStyle() {
    const url = await pickStyle(MAP_STYLES[theme] ?? MAP_STYLES.day);
    if (!url) {
      fallbackNode.hidden = false;
      return;
    }
    fallbackNode.hidden = true;
    styleUrl = url;
    if (!map) {
      build(url);
    } else {
      showVeil();
      veilTimer = setTimeout(() => {
        bubbles = false; // nouveau style : couches d'origine
        map.setStyle(url, { transformStyle });
        map.once('styledata', () => { applyLayer(); applyGuidanceStyle(); });
        const off = () => { clearTimeout(veilTimer); veil.classList.remove('on'); };
        map.once('idle', off);
        veilTimer = setTimeout(off, VEIL_MAX_MS);
      }, VEIL_IN_MS);
    }
  }

  if (!lib) {
    fallbackNode.hidden = false;
    applyLayer();
  } else {
    loadStyle();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && map) scheduleRestoreCheck(RESTORE_WAIT_VISIBLE_MS);
    });
  }

  function marker(key, lonlat, color) {
    if (lonlat) marks[key] = lonlat;
    if (!map || !lonlat) return;
    if (!markers[key]) markers[key] = new lib.Marker({ color }).setLngLat(lonlat).addTo(map);
    else markers[key].setLngLat(lonlat);
  }

  /** Repère du véhicule, orienté selon le cap (degrés) s'il est donné. */
  function vehicle(lonlat, bearing = null) {
    if (lonlat) { marks.me = lonlat; marks.meBearing = bearing; }
    if (!map || !lonlat) return;
    if (!markers.me) {
      markers.me = new lib.Marker({ element: vehicleElement(vehicleIcon), rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(lonlat).addTo(map);
    } else {
      markers.me.setLngLat(lonlat);
    }
    const hasHeading = typeof bearing === 'number' && Number.isFinite(bearing);
    markers.me.getElement().classList.toggle('no-heading', !hasHeading);
    markers.me.setRotation(hasHeading ? bearing : 0);
  }

  /**
   * Affiche les itinéraires proposés : celui d'indice `index` en couleur vive, les autres en gris.
   * @param {{ coordinates:number[][], bbox?:number[]|null }[]} list
   */
  function showRoutes(list, index = 0, { fit = true } = {}) {
    routes = list.filter((r) => Array.isArray(r?.coordinates) && r.coordinates.length > 1);
    selected = Math.min(Math.max(0, index), Math.max(0, routes.length - 1));
    routeBbox = routesBbox(routes);
    if (!routes.length) {
      // Liste vide (calcul en échec) : tracés et repères de départ / d'arrivée retirés.
      removeRouteLayers();
      for (const key of ['start', 'end']) {
        markers[key]?.remove();
        markers[key] = null;
        marks[key] = null;
      }
      replay.shown();
      return;
    }
    const line = routes[selected].coordinates;
    if (!map) {
      // v85 : carte pas encore créée (style en chargement, ex. itinéraire repris v53) : repères retenus (`marks`),
      // tracés ajoutés par build() sur « style.load », cadrage fait une fois à la création (replay.takeFit).
      marker('start', line[0], MARK_COLORS.start);
      marker('end', line[line.length - 1], MARK_COLORS.end);
      replay.deferred(fit);
      return;
    }
    replay.shown();
    removeRouteLayers();
    if (styleReady()) addRouteLayers();
    else map.once('style.load', addRouteLayers);
    marker('start', line[0], MARK_COLORS.start);
    marker('end', line[line.length - 1], MARK_COLORS.end);
    if (fit) fitRoute();
  }

  return {
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      if (lib) loadStyle();
    },
    /** Luminosité de la carte la nuit (phase 2d) : appliquée tout de suite la nuit, sans rechargement. */
    /** Repère du véhicule (v45) : « arrow » ou « truck » ; même place, même cap, recréé tout de suite. */
    setVehicleIcon(kind) {
      const k = sanitizeVehicleIcon(kind);
      if (k === vehicleIcon) return;
      vehicleIcon = k;
      if (!markers.me) return;
      const at = markers.me.getLngLat().toArray();
      const rot = markers.me.getRotation();
      const noHeading = markers.me.getElement().classList.contains('no-heading');
      markers.me.remove();
      markers.me = new lib.Marker({ element: vehicleElement(vehicleIcon), rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(at).setRotation(rot).addTo(map);
      markers.me.getElement().classList.toggle('no-heading', noHeading);
    },
    setNightLevel(level) {
      const l = sanitizeNightLevel(level);
      if (l === nightLevel) return;
      nightLevel = l;
      applyNightLevel();
    },
    /**
     * Repère d'une aire mis en évidence (liste du guidage, phase 2d) ; null : aucun. Classe CSS seulement : ni
     * repère recréé ni carte redessinée.
     */
    highlightArea(id) {
      highlighted = id ?? null;
      // v62 : à zoom bas, l'aire choisie sort de son groupe (jamais cachée) : repères recalculés si besoin.
      drawAreas();
      for (const m of areaMarkers) {
        const el = m.getElement();
        el.classList.toggle('selected', !!highlighted && el.dataset.id === highlighted);
      }
    },
    /** Montre une aire (geste, à l'arrêt seulement : décidé par l'écran de guidage). */
    /** Centre la carte sur un lieu (suivi du véhicule suspendu) ; phase 10 A : zoom et décalage facultatifs. */
    showPlace(lonlat, { zoom = null, offset = null } = {}) {
      if (!map || !Array.isArray(lonlat)) return;
      if (anim) anim.follow = false;
      map.easeTo({ center: lonlat, duration: 600, ...(Number.isFinite(zoom) ? { zoom } : {}), ...(Array.isArray(offset) ? { offset } : {}) });
    },
    showRoutes,
    /** v62 : nombre de fois où les repères des aires ont été recréés (contrôle d'ui-check : 0 en suivant le véhicule). */
    areaDrawCount() {
      return areaDraws;
    },
    /** Un seul itinéraire (guidage, recalcul) : les autres disparaissent. */
    showRoute(coordinates, bbox, opts = {}) {
      showRoutes([{ coordinates, bbox }], 0, opts);
    },
    /** Pastilles des manœuvres du guidage (v53, maneuverMarks) : une fois par itinéraire. */
    showTurns(fc) {
      turns = fc?.type === 'FeatureCollection' ? fc : EMPTY_FC;
      map?.getSource(TURNS_SOURCE)?.setData(turns);
    },
    /** Change l'itinéraire mis en avant, sans bouger la carte. */
    selectRoute(index) {
      if (!Number.isInteger(index) || index < 0 || index >= routes.length) return;
      selected = index;
      map?.getSource('route')?.setData(routesData());
    },
    /** Repères des aires du trajet (phase 9) : [{ id, lonlat, label, otherSide }] ; liste vide = aucun repère. */
    showAreas(items) {
      areaItems = Array.isArray(items) ? items.filter((i) => Array.isArray(i?.lonlat)) : [];
      drawAreas({ force: true });
    },
    /**
     * Ponts sans hauteur connue (phase 12a) : [{ key, lonlat, level, label }] ; repères à l'arrêt seulement (retirés
     * pendant le guidage, R412-6-2).
     */
    /** Centre de la carte [lon, lat] (phase 12b : « Ajouter au centre de la carte »), null sans carte. */
    center() {
      const c = map?.getCenter();
      return c ? [c.lng, c.lat] : null;
    },
    /** v55 : repères numérotés des étapes ([lon, lat] dans l'ordre) ; liste vide → retirés. */
    showStops(points) {
      stopItems = (Array.isArray(points) ? points : []).filter((p) => Array.isArray(p) && p.length >= 2);
      drawStops();
      drawAreas(); // v62 : un P seul collé à une étape est masqué à zoom bas
    },
    /** Phase 3a : mes signalements [{ id, lonlat, label, confirmed }] ; liste vide → retirés. */
    showReports(items) {
      reportItems = (Array.isArray(items) ? items : []).filter((i) => Array.isArray(i?.lonlat) && typeof i.id === 'string');
      drawReports();
    },
    /** Appelé avec l'identifiant du signalement touché. */
    onReportPick(cb) {
      onReport = cb;
    },
    /** Phase 10 A : repères des événements de trafic (liste vide = aucun). */
    showTraffic(items) {
      trafficItems = (Array.isArray(items) ? items : []).filter((i) => Array.isArray(i?.lonlat) && typeof i.key === 'string');
      drawTraffic();
    },
    /** Appelé avec la clé de l'événement de trafic touché. */
    onTrafficPick(cb) {
      onTraffic = cb;
    },
    showBridges(items) {
      bridgeItems = Array.isArray(items) ? items.filter((i) => Array.isArray(i?.lonlat)) : [];
      drawBridges({ force: true });
    },
    /** v81 : sections interdites du tracé choisi (morceaux [[lon, lat], …]) ; liste vide = aucune. */
    showBanSections(lines) {
      banLines = Array.isArray(lines) ? lines : [];
      map?.getSource(BAN_SOURCE)?.setData(banData());
    },
    /** Appelé avec la clé du repère de pont touché (à l'arrêt). */
    onBridgePick(cb) {
      onBridge = cb;
    },
    /** Contours des ZFE du trajet (phase 5) : [{ name, banned, polygons }] ; liste vide = aucun contour. */
    showZfe(items) {
      zfeItems = Array.isArray(items) ? items.filter((z) => Array.isArray(z?.polygons) && z.polygons.length) : [];
      if (styleReady()) addZfeLayers();
    },
    /** Appelé avec l'identifiant de l'aire touchée sur la carte. */
    onAreaPick(cb) {
      onArea = cb;
    },
    /** Appelé avec l'indice du tracé touché sur la carte (à l'arrêt). */
    onRoutePick(cb) {
      onPick = cb;
    },
    setMyPosition(lonlat) {
      vehicle(lonlat);
      if (map && !routes.length && !navigating) map.easeTo({ center: lonlat, zoom: 11 });
    },
    /**
     * Guidage : la flèche glisse et tourne de sa position actuelle vers la nouvelle pendant l'intervalle entre deux
     * positions GPS (1 s au plus). Si la caméra suit, elle est déplacée dans la même image (flèche et carte
     * ensemble, sans décalage) : centrée sur le véhicule (placé bas grâce au padding), inclinée, orientée route.
     * @param {{ lonlat:number[], bearing:number|null, zoom?:number, pitch?:number, follow:boolean, padding?:object,
     *   speedKmh?:number|null }} p
     */
    navigateTo({ lonlat, bearing, zoom, pitch, follow, padding, speedKmh = null, northUp: up = false }) {
      if (!lonlat) return;
      const now = performance.now();
      const cur = anim ? frameAt(anim.move, (now - anim.start) / (anim.move.duration || 1)) : lastNav;
      // À l'arrêt, GPS qui dérive : rien ne bouge, aucune image (ni carte ni repères des aires). La dérive se mesure
      // depuis le point d'arrêt ; s'il faut redessiner à l'arrêt (bandeau, suivi, camion au pas), flèche et caméra y
      // vont.
      const prevStop = stop;
      stop = stillPoint(stop, lonlat, speedKmh);
      const target = { lonlat: stop?.lonlat ?? lonlat, bearing, zoom, pitch };
      if (holdStill(lastNav, { follow, padding, northUp: up }, stillDrift(prevStop, stop, lastNav?.lonlat, lonlat), speedKmh)) return;
      // À l'arrêt (< 3 km/h) ou sans changement : une seule image, puis plus aucun rendu jusqu'à la position suivante.
      const move = planMove(cur, target, lastNav ? now - lastNav.at : null, cur ? haversine(cur.lonlat, target.lonlat) : NaN,
        { speedKmh });
      lastNav = { ...target, at: now, follow: !!follow, padding, northUp: !!up };
      northUp = !!up;
      if (follow && map) map.stop(); // fin d'une vue d'ensemble animée
      anim = { move, start: now, follow: !!follow, padding, northUp };
      if (animFrame === null) animFrame = requestAnimationFrame(tick);
    },
    /**
     * Vue d'ensemble : le cadre donné (trajet restant), à plat, nord en haut. La caméra ne suit plus (les positions
     * suivantes ne déplacent que la flèche) jusqu'au prochain navigateTo avec follow.
     * MapLibre ajoute la marge de la carte (celle du suivi : moitié haute de l'écran) à celle de fitBounds ; sur un
     * téléphone, le cadre ne tenait plus et fitBounds était abandonné sans bouger. On remet donc la marge de la carte
     * à zéro et on passe des marges qui laissent toujours de la place (overviewPadding).
     */
    overview(bbox, padding) {
      if (anim) anim.follow = false;
      if (!map || !Array.isArray(bbox) || bbox.length < 4) return;
      map.stop();
      map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
      const c = map.getContainer();
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
        padding: overviewPadding({ width: c.clientWidth, height: c.clientHeight }, padding),
        bearing: 0, pitch: 0, duration: 600, maxZoom: 17, essential: true,
      });
    },
    /** Entrée / sortie du mode guidage. En sortie : carte à plat, nord en haut, itinéraire entier. */
    setNavigating(on) {
      navigating = on;
      drawBridges({ force: true }); // phase 12a : aucun repère de pont pendant le guidage
      map?.getSource(BAN_SOURCE)?.setData(banData()); // v81 : aucune section rouge pendant le guidage
      applyLayer(); // boutons « Plan / Satellite » de l'arrêt masqués en guidage (le guidage a le sien)
      if (!map) return;
      map.resize();
      done = [];
      map.getSource(DONE_SOURCE)?.setData(doneData());
      if (!on) { turns = EMPTY_FC; map.getSource(TURNS_SOURCE)?.setData(turns); }
      applyArrowVisibility();
      if (styleReady()) applyGuidanceStyle();
      if (!on) {
        northUp = false;
        stopAnim();
        lastNav = null;
        stop = null;
        map.stop();
        map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
        if (markers.me) vehicle(markers.me.getLngLat().toArray());
        fitRoute(600);
      }
    },
    /** Appui long sur la carte, hors guidage : cb([lon, lat]). */
    onLongPress(cb) {
      onLongPress = cb;
    },
    /** Toucher simple sur la carte (ferme le choix de l'appui long). */
    onMapTap(cb) {
      onTap = cb;
    },
    /** Repère d'un point choisi par appui long : 'pin' (choix en cours), 'pinTo' (arrivée), 'pinFrom' (départ). */
    showPin(lonlat, key = 'pin') {
      marker(key, lonlat, MARK_COLORS.pin);
    },
    clearPin(key = 'pin') {
      markers[key]?.remove();
      markers[key] = null;
      marks[key] = null;
    },
    /** Appelé quand l'utilisateur déplace la carte au doigt pendant le guidage. */
    onUserGesture(cb) {
      onGesture = cb;
    },
    resize() {
      map?.resize();
    },
    /** Partie du tracé déjà parcourue (guidage) : [[lon, lat]…] ; appelé seulement quand elle a avancé (nav-layout). */
    showTraveled(coords) {
      done = Array.isArray(coords) ? coords : [];
      map?.getSource(DONE_SOURCE)?.setData(doneData());
    },
    /** Couche de fond choisie : 'plan' ou 'satellite'. */
    setLayer(next) {
      layer = sanitizeMapLayer(next);
      applyLayer();
    },
  };
}
