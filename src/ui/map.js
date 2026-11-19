// Carte MapLibre : fond OpenFreeMap avec repli VersaTiles, tracés des itinéraires (choisi en couleur, autres en gris),
// position, suivi en guidage, vue satellite IGN (phase 7, à l'arrêt seulement).
// MapLibre est chargé par index.html (window.maplibregl, version épinglée).

import { MAP_STYLES } from '../lib/config.js';
import { routesBbox, pickRouteAt } from '../lib/route-options.js';
import { IGN_ORTHO, satelliteView, sanitizeMapLayer } from '../lib/map-layers.js';

const FRANCE_CENTER = [2.35, 46.6];
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROUTE_LAYERS = ['route-hit', 'route-line', 'route-casing', 'route-alt-line', 'route-alt-casing'];
/** Marge de toucher autour du doigt (px), en plus de la largeur invisible du tracé. */
const TAP_MARGIN_PX = 10;
const SAT_SOURCE = 'ign-ortho';
const SAT_LAYER = 'ign-ortho';

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
  const markers = { start: null, end: null, me: null };

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

  function addRouteLayers() {
    if (!map || !routes.length || map.getSource('route')) return;
    const css = getComputedStyle(document.documentElement);
    const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const isSelected = ['==', ['get', 'selected'], true];
    const layout = { 'line-join': 'round', 'line-cap': 'round' };
    map.addSource('route', { type: 'geojson', data: routesData() });
    // Ordre d'empilement : autres itinéraires (gris) dessous, itinéraire choisi dessus, zone de toucher invisible au-dessus.
    map.addLayer({
      id: 'route-alt-casing', type: 'line', source: 'route', filter: ['!', isSelected], layout,
      paint: { 'line-color': color('--route-alt-casing', '#fff'), 'line-width': 9 },
    });
    map.addLayer({
      id: 'route-alt-line', type: 'line', source: 'route', filter: ['!', isSelected], layout,
      paint: { 'line-color': color('--route-alt', '#7d8894'), 'line-width': 5 },
    });
    map.addLayer({
      id: 'route-casing', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': color('--route-casing', '#fff'), 'line-width': 11 },
    });
    map.addLayer({
      id: 'route-line', type: 'line', source: 'route', filter: isSelected, layout,
      paint: { 'line-color': color('--route', '#0b57d0'), 'line-width': 7 },
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

  async function loadStyle() {
    const url = await pickStyle(MAP_STYLES[theme] ?? MAP_STYLES.day);
    if (!url) {
      fallbackNode.hidden = false;
      return;
    }
    fallbackNode.hidden = true;
    if (!map) {
      map = new lib.Map({ container, style: url, center: FRANCE_CENTER, zoom: 5, attributionControl: { compact: true } });
      map.addControl(new lib.NavigationControl({ showCompass: true }), 'top-right');
      map.addControl(new lib.ScaleControl({ unit: 'metric' }), 'bottom-left');
      // Geste de l'utilisateur (doigt) : les mouvements lancés par le code n'ont pas d'originalEvent.
      for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
        map.on(ev, (e) => { if (e.originalEvent && navigating) onGesture?.(); });
      }
      map.on('click', onMapClick);
      map.on('style.load', addSatelliteLayer); // aussi après un changement de style (thème jour / nuit)
      map.on('moveend', applyLayer);
    } else {
      map.setStyle(url);
    }
    map.once('style.load', addRouteLayers);
  }

  if (!lib) {
    fallbackNode.hidden = false;
    applyLayer();
  } else {
    loadStyle();
  }

  function marker(key, lonlat, color) {
    if (!map || !lonlat) return;
    if (!markers[key]) markers[key] = new lib.Marker({ color }).setLngLat(lonlat).addTo(map);
    else markers[key].setLngLat(lonlat);
  }

  /** Repère du véhicule, orienté selon le cap (degrés) s'il est donné. */
  function vehicle(lonlat, bearing = null) {
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
