// Carte MapLibre : fond OpenFreeMap avec repli VersaTiles, tracés des itinéraires (choisi en couleur, autres en gris),
// position, suivi en guidage (flèche animée, phase 7c), vue satellite IGN (phase 7 ; en guidage aussi depuis la 7c),
// appui long (phase 8), repères des aires et parkings PL (phase 9).
// MapLibre est chargé par index.html (window.maplibregl, version épinglée).
//
// Phase 7b : au retour de l'arrière-plan, Android peut retirer le contexte WebGL (carte vide). On écoute
// webglcontextlost / webglcontextrestored ; si le contexte n'est pas rendu, la carte est recréée à l'identique
// (style, tracés, marqueurs, caméra). Le guidage, lui, ne dépend pas de la carte et continue sans interruption.

import { MAP_STYLES } from '../lib/config.js';
import { routesBbox, pickRouteAt } from '../lib/route-options.js';
import { IGN_ORTHO, satelliteView, sanitizeMapLayer, carryOverlay } from '../lib/map-layers.js';
import { planMove, frameAt, holdStill } from '../lib/nav-anim.js';
import { haversine } from '../lib/nav-geo.js';
import { overviewPadding } from '../lib/navigation.js';
import { recolorStyle, mapPaintPatches, ROUTE_WIDTH } from '../lib/map-palette.js';

const FRANCE_CENTER = [2.35, 46.6];
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROUTE_LAYERS = ['route-hit', 'route-line', 'route-casing', 'route-alt-line', 'route-alt-casing'];
/** Marge de toucher autour du doigt (px), en plus de la largeur invisible du tracé. */
const TAP_MARGIN_PX = 10;
/** ZFE (phase 5) : contours sous les libellés, au-dessus des photos ; rouge si interdite au véhicule. */
const ZFE_SOURCE = 'zfe';
const ZFE_LAYERS = ['zfe-fill', 'zfe-line'];
const SAT_SOURCE = 'ign-ortho';
const SAT_LAYER = 'ign-ortho';
/** Couches de Gabarit, jamais recolorées avec le fond (phase 2c-a). */
const OWN_LAYERS = [...ROUTE_LAYERS, ...ZFE_LAYERS, SAT_LAYER];
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
  let onLongPress = null;
  let onTap = null;
  /** Animation de la flèche (et de la caméra si elle suit) entre deux positions : une boucle qui s'arrête à la fin. */
  let anim = null;
  let animFrame = null;
  let lastNav = null;
  let layer = sanitizeMapLayer(opts.layer);
  let lastView = null;
  let styleUrl = null;
  let lost = false;
  let restoreTimer = null;
  const markers = { start: null, end: null, me: null, pin: null, pinTo: null, pinFrom: null };
  /** Dernières positions des marqueurs (pour recréer la carte). */
  const marks = { start: null, end: null, me: null, meBearing: null, pin: null, pinTo: null, pinFrom: null };
  /**
   * Aires du trajet (phase 9) : repères HTML (pas des couches du style : ils restent au changement de thème et se
   * touchent facilement). [{ id, lonlat, label, otherSide }]
   */
  let areaItems = [];
  let areaMarkers = [];
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
      paint: { 'line-color': c['route-alt-casing'], 'line-width': ROUTE_WIDTH.altCasing },
    });
    map.addLayer({
      id: 'route-alt-line', type: 'line', source: 'route', filter: ['!', isSelected], layout,
      paint: { 'line-color': c['route-alt-line'], 'line-width': ROUTE_WIDTH.altLine },
    });
    map.addLayer({
      id: 'route-casing', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': c['route-casing'], 'line-width': ROUTE_WIDTH.casing },
    });
    map.addLayer({
      id: 'route-line', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': c['route-line'], 'line-width': ROUTE_WIDTH.line },
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
      const photosChanged = lastView?.photos !== view.photos;
      lastView = view;
      if (photosChanged) paintRoutes();
      opts.onLayerView?.(view);
    }
  }

  /** Couleurs des tracés déjà dessinés (changement plan ↔ photos : bord noir sur les photos). */
  function paintRoutes() {
    if (!map) return;
    for (const [id, color] of Object.entries(routeColors())) if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color);
  }

  /** Fond de carte aux couleurs Panier Perdu (src/lib/map-palette.js), au premier chargement d'un style. */
  function recolorBase() {
    const layers = map?.getStyle()?.layers;
    for (const p of mapPaintPatches(layers, theme, OWN_LAYERS)) {
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
    const c = routeColors();
    const paint = Object.fromEntries(Object.entries(c).map(([id, color]) => [id, { 'line-color': color }]));
    return carryOverlay(prev, recolorStyle(next, theme, OWN_LAYERS), { below: [SAT_LAYER, ...ZFE_LAYERS], above: [...ROUTE_LAYERS].reverse(), paint });
  }

  /** Crée la carte MapLibre (au démarrage, ou pour remplacer une carte dont le contexte WebGL est perdu). */
  function build(url, camera = { center: FRANCE_CENTER, zoom: 5 }) {
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
    if (marks.start) marker('start', marks.start, MARK_COLORS.start);
    if (marks.end) marker('end', marks.end, MARK_COLORS.end);
    if (marks.me) vehicle(marks.me, marks.meBearing);
    if (marks.pin) marker('pin', marks.pin, MARK_COLORS.pin);
    if (marks.pinTo) marker('pinTo', marks.pinTo, MARK_COLORS.pin);
    if (marks.pinFrom) marker('pinFrom', marks.pinFrom, MARK_COLORS.pin);
    drawAreas();
  }

  function areaElement(item) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `area-marker${item.otherSide ? ' other-side' : ''}`;
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

  function drawAreas() {
    clearAreaMarkers();
    if (!map) return;
    // Autre sens en dessous (ajoutés d'abord), sens de circulation par-dessus.
    const items = [...areaItems].sort((a, b) => Number(b.otherSide) - Number(a.otherSide));
    for (const item of items) {
      areaMarkers.push(new lib.Marker({ element: areaElement(item), anchor: 'center' }).setLngLat(item.lonlat).addTo(map));
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
      if (Number.isFinite(f.bearing)) cam.bearing = f.bearing;
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
    if (!routes.length) {
      // Liste vide (calcul en échec) : tracés et repères de départ / d'arrivée retirés.
      removeRouteLayers();
      for (const key of ['start', 'end']) {
        markers[key]?.remove();
        markers[key] = null;
        marks[key] = null;
      }
      return;
    }
    if (!map) return;
    removeRouteLayers();
    if (styleReady()) addRouteLayers();
    else map.once('style.load', addRouteLayers);
    const line = routes[selected].coordinates;
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
    /** Repères des aires du trajet (phase 9) : [{ id, lonlat, label, otherSide }] ; liste vide = aucun repère. */
    showAreas(items) {
      areaItems = Array.isArray(items) ? items.filter((i) => Array.isArray(i?.lonlat)) : [];
      drawAreas();
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
    navigateTo({ lonlat, bearing, zoom, pitch, follow, padding, speedKmh = null }) {
      if (!lonlat) return;
      const now = performance.now();
      const cur = anim ? frameAt(anim.move, (now - anim.start) / (anim.move.duration || 1)) : lastNav;
      const target = { lonlat, bearing, zoom, pitch };
      // À l'arrêt, GPS qui dérive : rien ne bouge, aucune image (ni carte ni repères des aires).
      if (holdStill(lastNav, { follow, padding }, lastNav ? haversine(lastNav.lonlat, lonlat) : NaN, speedKmh)) return;
      // À l'arrêt (< 3 km/h) ou sans changement : une seule image, puis plus aucun rendu jusqu'à la position suivante.
      const move = planMove(cur, target, lastNav ? now - lastNav.at : null, cur ? haversine(cur.lonlat, lonlat) : NaN,
        { speedKmh });
      lastNav = { ...target, at: now, follow: !!follow, padding };
      if (follow && map) map.stop(); // fin d'une vue d'ensemble animée
      anim = { move, start: now, follow: !!follow, padding };
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
      applyLayer(); // boutons « Plan / Satellite » de l'arrêt masqués en guidage (le guidage a le sien)
      if (!map) return;
      map.resize();
      if (!on) {
        stopAnim();
        lastNav = null;
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
    /** Couche de fond choisie : 'plan' ou 'satellite'. */
    setLayer(next) {
      layer = sanitizeMapLayer(next);
      applyLayer();
    },
  };
}
