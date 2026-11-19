// Carte MapLibre : fond OpenFreeMap avec repli VersaTiles, tracé de l'itinéraire, position.
// MapLibre est chargé par index.html (window.maplibregl, version épinglée).

import { MAP_STYLES } from '../lib/config.js';

const FRANCE_CENTER = [2.35, 46.6];

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

export function createMap(container, fallbackNode, initialTheme) {
  const lib = window.maplibregl;
  let map = null;
  let route = null; // GeoJSON LineString courant
  let theme = initialTheme;
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

  return {
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      if (lib) loadStyle();
    },
    showRoute(coordinates, bbox) {
      route = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
      if (!map) return;
      removeRouteLayers();
      if (map.isStyleLoaded()) addRouteLayers();
      else map.once('style.load', addRouteLayers);
      marker('start', coordinates[0], '#146c2e');
      marker('end', coordinates[coordinates.length - 1], '#b3261e');
      const b = bbox && bbox.length >= 4 ? [[bbox[0], bbox[1]], [bbox[2], bbox[3]]] : null;
      if (b) map.fitBounds(b, { padding: { top: 64, right: 72, bottom: 48, left: 48 }, duration: 800 });
    },
    setMyPosition(lonlat) {
      marker('me', lonlat, '#0b57d0');
      if (map && !route) map.easeTo({ center: lonlat, zoom: 11 });
    },
    resize() {
      map?.resize();
    },
  };
}
