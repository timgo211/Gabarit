// Carte MapLibre : fond OpenFreeMap avec repli VersaTiles, tracés des itinéraires (choisi en couleur, autres en gris),
// position, suivi en guidage, vue satellite IGN (phase 7, à l'arrêt seulement).
// MapLibre est chargé par index.html (window.maplibregl, version épinglée).
//
// Phase 7b : au retour de l'arrière-plan, Android peut retirer le contexte WebGL (carte vide). On écoute
// webglcontextlost / webglcontextrestored ; si le contexte n'est pas rendu, la carte est recréée à l'identique
// (style, tracés, marqueurs, caméra). Le guidage, lui, ne dépend pas de la carte et continue sans interruption.

import { MAP_STYLES } from '../lib/config.js';
import { routesBbox, pickRouteAt } from '../lib/route-options.js';
import { IGN_ORTHO, satelliteView, sanitizeMapLayer, carryOverlay } from '../lib/map-layers.js';

const FRANCE_CENTER = [2.35, 46.6];
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROUTE_LAYERS = ['route-hit', 'route-line', 'route-casing', 'route-alt-line', 'route-alt-casing'];
/** Marge de toucher autour du doigt (px), en plus de la largeur invisible du tracé. */
const TAP_MARGIN_PX = 10;
const SAT_SOURCE = 'ign-ortho';
const SAT_LAYER = 'ign-ortho';
/** Contexte WebGL perdu : délai avant de recréer la carte s'il n'est pas rendu (retour au premier plan / page visible). */
const RESTORE_WAIT_VISIBLE_MS = 1500;
const RESTORE_WAIT_LOST_MS = 3000;

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

/** Repère « ma position » : pastille, avec une flèche quand le cap est connu. */
function vehicleElement() {
  const node = document.createElement('div');
  node.className = 'me-marker no-heading';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  const halo = document.createElementNS(SVG_NS, 'circle');
  halo.setAttribute('cx', '24'); halo.setAttribute('cy', '24'); halo.setAttribute('r', '20');
  halo.setAttribute('class', 'me-halo');
  const arrow = document.createElementNS(SVG_NS, 'path');
  arrow.setAttribute('d', 'M24 6 L38 38 L24 30 L10 38 Z');
  arrow.setAttribute('class', 'me-arrow');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', '24'); dot.setAttribute('cy', '24'); dot.setAttribute('r', '9');
  dot.setAttribute('class', 'me-dot');
  svg.append(halo, arrow, dot);
  node.append(svg);
  return node;
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
  let theme = initialTheme;
  let navigating = false;
  let onGesture = null;
  let onPick = null;
  let layer = sanitizeMapLayer(opts.layer);
  let lastView = null;
  let styleUrl = null;
  let lost = false;
  let restoreTimer = null;
  const markers = { start: null, end: null, me: null };
  /** Dernières positions des marqueurs (pour recréer la carte). */
  const marks = { start: null, end: null, me: null, meBearing: null };

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
    return {
      'route-alt-casing': color('--route-alt-casing', '#fff'),
      'route-alt-line': color('--route-alt', '#7d8894'),
      'route-casing': color('--route-casing', '#fff'),
      'route-line': color('--route', '#0b57d0'),
    };
  }

  function addRouteLayers() {
    if (!map || !routes.length || map.getSource('route')) return;
    const c = routeColors();
    const isSelected = ['==', ['get', 'selected'], true];
    const layout = { 'line-join': 'round', 'line-cap': 'round' };
    map.addSource('route', { type: 'geojson', data: routesData() });
    // Ordre d'empilement : autres itinéraires (gris) dessous, itinéraire choisi dessus, zone de toucher invisible au-dessus.
    map.addLayer({
      id: 'route-alt-casing', type: 'line', source: 'route', filter: ['!', isSelected], layout,
      paint: { 'line-color': c['route-alt-casing'], 'line-width': 9 },
    });
    map.addLayer({
      id: 'route-alt-line', type: 'line', source: 'route', filter: ['!', isSelected], layout,
      paint: { 'line-color': c['route-alt-line'], 'line-width': 5 },
    });
    map.addLayer({
      id: 'route-casing', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': c['route-casing'], 'line-width': 11 },
    });
    map.addLayer({
      id: 'route-line', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': c['route-line'], 'line-width': 7 },
    });
    map.addLayer({
      id: 'route-hit', type: 'line', source: 'route', layout,
      paint: { 'line-color': '#000', 'line-width': 28, 'line-opacity': 0 },
    });
  }

  function removeRouteLayers() {
    if (!map) return;
    for (const id of ROUTE_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource('route')) map.removeSource('route');
  }

  /** Toucher un tracé (à l'arrêt, plusieurs itinéraires) le sélectionne. */
  function onMapClick(e) {
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
    if (!map || map.getSource(SAT_SOURCE)) { applyLayer(); return; }
    map.addSource(SAT_SOURCE, {
      type: 'raster', tiles: IGN_ORTHO.tiles, tileSize: IGN_ORTHO.tileSize,
      minzoom: IGN_ORTHO.minzoom, maxzoom: IGN_ORTHO.maxzoom, attribution: IGN_ORTHO.attribution,
    });
    const style = map.getStyle();
    const firstSymbol = style?.layers?.find((l) => l.type === 'symbol')?.id;
    const beforeId = firstSymbol ?? (map.getLayer(ROUTE_LAYERS[4]) ? ROUTE_LAYERS[4] : undefined);
    map.addLayer({ id: SAT_LAYER, type: 'raster', source: SAT_SOURCE, layout: { visibility: 'none' } }, beforeId);
    applyLayer();
  }

  /** Montre ou masque les photos selon le choix, le centre de la carte et le guidage. */
  function applyLayer() {
    const c = map?.getCenter();
    // Pas de carte (hors ligne, MapLibre absent) : pas de bouton.
    const view = map ? satelliteView({ layer, center: [c.lng, c.lat], navigating }) : { photos: false, message: '', button: false };
    if (map?.getLayer(SAT_LAYER)) map.setLayoutProperty(SAT_LAYER, 'visibility', view.photos ? 'visible' : 'none');
    if (!lastView || lastView.photos !== view.photos || lastView.message !== view.message || lastView.button !== view.button) {
      lastView = view;
      opts.onLayerView?.(view);
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
    const c = routeColors();
    const paint = Object.fromEntries(Object.entries(c).map(([id, color]) => [id, { 'line-color': color }]));
    return carryOverlay(prev, next, { below: [SAT_LAYER], above: [...ROUTE_LAYERS].reverse(), paint });
  }

  /** Crée la carte MapLibre (au démarrage, ou pour remplacer une carte dont le contexte WebGL est perdu). */
  function build(url, camera = { center: FRANCE_CENTER, zoom: 5 }) {
    map = new lib.Map({ container, style: url, ...camera, attributionControl: { compact: true } });
    map.addControl(new lib.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new lib.ScaleControl({ unit: 'metric' }), 'bottom-left');
    // Geste de l'utilisateur (doigt) : les mouvements lancés par le code n'ont pas d'originalEvent.
    for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
      map.on(ev, (e) => { if (e.originalEvent && navigating) onGesture?.(); });
    }
    map.on('click', onMapClick);
    map.on('style.load', addSatelliteLayer); // aussi après une reconstruction complète du style
    map.on('moveend', applyLayer);
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
    if (marks.start) marker('start', marks.start, '#146c2e');
    if (marks.end) marker('end', marks.end, '#b3261e');
    if (marks.me) vehicle(marks.me, marks.meBearing);
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
    markers.start = null; markers.end = null; markers.me = null;
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
      map.setStyle(url, { transformStyle });
      map.once('styledata', applyLayer);
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
      markers.me = new lib.Marker({ element: vehicleElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
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
    if (!map || !routes.length) return;
    removeRouteLayers();
    if (map.isStyleLoaded()) addRouteLayers();
    else map.once('style.load', addRouteLayers);
    const line = routes[selected].coordinates;
    marker('start', line[0], '#146c2e');
    marker('end', line[line.length - 1], '#b3261e');
    if (fit) fitRoute();
  }

  return {
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      if (lib) loadStyle();
    },
    showRoutes,
    /** Un seul itinéraire (guidage, recalcul) : les autres disparaissent. */
    showRoute(coordinates, bbox, opts = {}) {
      showRoutes([{ coordinates, bbox }], 0, opts);
    },
    /** Change l'itinéraire mis en avant, sans bouger la carte. */
    selectRoute(index) {
      if (!Number.isInteger(index) || index < 0 || index >= routes.length) return;
      selected = index;
      map?.getSource('route')?.setData(routesData());
    },
    /** Appelé avec l'indice du tracé touché sur la carte (à l'arrêt). */
    onRoutePick(cb) {
      onPick = cb;
    },
    setMyPosition(lonlat) {
      vehicle(lonlat);
      if (map && !routes.length && !navigating) map.easeTo({ center: lonlat, zoom: 11 });
    },
    /** Position et cap du véhicule pendant le guidage (sans bouger la caméra). */
    setVehicle(lonlat, bearing) {
      vehicle(lonlat, bearing);
    },
    /** Caméra de guidage : centrée sur le véhicule (placé bas grâce au padding), inclinée, orientée route. */
    follow({ center, bearing, zoom, pitch, padding, animate = true }) {
      if (!map || !center) return;
      map.easeTo({
        center, bearing, zoom, pitch, padding,
        duration: animate ? 1000 : 0,
        easing: (t) => t,
        essential: true, // guidage : non concerné par prefers-reduced-motion
      });
    },
    /** Entrée / sortie du mode guidage. En sortie : carte à plat, nord en haut, itinéraire entier. */
    setNavigating(on) {
      navigating = on;
      applyLayer(); // guidage : plan uniquement, sans bouton
      if (!map) return;
      map.resize();
      if (!on) {
        map.stop();
        map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
        if (markers.me) vehicle(markers.me.getLngLat().toArray());
        fitRoute(600);
      }
    },
    /** Appelé quand l'utilisateur déplace la carte au doigt pendant le guidage. */
    onUserGesture(cb) {
      onGesture = cb;
    },
    resize() {
      map?.resize();
    },
    /** Couche de fond choisie : 'plan' ou 'satellite'. */
    setLayer(next) {
      layer = sanitizeMapLayer(next);
      applyLayer();
    },
  };
}
