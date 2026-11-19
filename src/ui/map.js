// Carte MapLibre : fond OpenFreeMap avec repli VersaTiles, tracé de l'itinéraire, position, suivi en guidage.
// MapLibre est chargé par index.html (window.maplibregl, version épinglée).

import { MAP_STYLES } from '../lib/config.js';

const FRANCE_CENTER = [2.35, 46.6];
const SVG_NS = 'http://www.w3.org/2000/svg';

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

export function createMap(container, fallbackNode, initialTheme) {
  const lib = window.maplibregl;
  let map = null;
  let route = null; // GeoJSON LineString courant
  let routeBbox = null;
  let theme = initialTheme;
  let navigating = false;
  let onGesture = null;
  const markers = { start: null, end: null, me: null };

  function addRouteLayers() {
    if (!map || !route || map.getSource('route')) return;
    const css = getComputedStyle(document.documentElement);
    map.addSource('route', { type: 'geojson', data: route });
    map.addLayer({
      id: 'route-casing', type: 'line', source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': css.getPropertyValue('--route-casing').trim() || '#fff', 'line-width': 11 },
    });
    map.addLayer({
      id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': css.getPropertyValue('--route').trim() || '#0b57d0', 'line-width': 7 },
    });
  }

  function removeRouteLayers() {
    if (!map) return;
    for (const id of ['route-line', 'route-casing']) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource('route')) map.removeSource('route');
  }

  function fitRoute(duration = 800) {
    const b = routeBbox && routeBbox.length >= 4 ? [[routeBbox[0], routeBbox[1]], [routeBbox[2], routeBbox[3]]] : null;
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
    } else {
      map.setStyle(url);
    }
    map.once('style.load', addRouteLayers);
  }

  if (!lib) {
    fallbackNode.hidden = false;
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

  return {
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      if (lib) loadStyle();
    },
    showRoute(coordinates, bbox, { fit = true } = {}) {
      route = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
      routeBbox = bbox;
      if (!map) return;
      removeRouteLayers();
      if (map.isStyleLoaded()) addRouteLayers();
      else map.once('style.load', addRouteLayers);
      marker('start', coordinates[0], '#146c2e');
      marker('end', coordinates[coordinates.length - 1], '#b3261e');
      if (fit) fitRoute();
    },
    setMyPosition(lonlat) {
      vehicle(lonlat);
      if (map && !route && !navigating) map.easeTo({ center: lonlat, zoom: 11 });
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
  };
}
