// Couche de fond (phases 7 et 7c) : « Plan » (fond vectoriel OpenFreeMap / VersaTiles) ou « Satellite » (photos aériennes IGN).
// Logique pure : choix mémorisé, zone couverte, message. L'affichage est dans src/ui/map.js.
//
// Photos aériennes : couche ORTHOIMAGERY.ORTHOPHOTOS de la Géoplateforme IGN (data.geopf.fr), gratuite et sans clé,
// sous Licence Ouverte Etalab 2.0 (https://www.etalab.gouv.fr/licence-ouverte-open-licence/) : réutilisation libre,
// y compris personnelle, à condition de citer la source (« IGN »). Service : https://geoservices.ign.fr/services-web-experts-ortho
// Paramètres du GetCapabilities WMTS (https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0) :
// TileMatrixSet « PM » (Web Mercator, tuiles 256 px), format image/jpeg, style « normal », niveaux 2 à 19.
// data.geopf.fr n'étant pas joignable depuis le conteneur de développement, ces valeurs ont été relevées dans des
// copies générées depuis ce GetCapabilities (geopandas/xyzservices providers.json, iTowns Ortho.json) et recoupées
// avec osmlab/editor-layer-index (BDOrthoIGN : zoom maximal 19, zone couverte).
//
// Hors de France : aucune source satellite gratuite dont les conditions autorisent clairement cet usage sans compte
// ni clé (Esri World Imagery : compte ArcGIS exigé ; Sentinel-2 cloudless d'EOX : 10 m par pixel, inutile pour
// repérer une entrée camion, licence non commerciale). On garde donc le plan, avec un message.

export const MAP_LAYERS = Object.freeze(['plan', 'satellite']);
export const DEFAULT_MAP_LAYER = 'plan';

export const IGN_ORTHO = Object.freeze({
  tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS'
    + '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'],
  tileSize: 256,
  minzoom: 2,
  maxzoom: 19, // au-delà, MapLibre agrandit les tuiles du niveau 19
  attribution: '<a href="https://www.ign.fr/" target="_blank" rel="noopener">© IGN – Géoplateforme</a>',
});

export const SATELLITE_OUTSIDE_TEXT = 'Vue satellite disponible en France uniquement';

/**
 * France métropolitaine, contour simplifié (lon, lat), un peu large sur la mer, au plus près des frontières terrestres
 * (Belgique, Luxembourg, Allemagne, Suisse, Italie, Espagne ; Andorre et les îles Anglo-Normandes laissées dehors).
 * Approximation à quelques kilomètres près le long des frontières.
 */
const METROPOLE = [
  [2.55, 51.09], [2.63, 50.95], [2.6, 50.82], [2.87, 50.7], [3.15, 50.78], [3.3, 50.52], [3.65, 50.36], [4.05, 50.34], [4.2, 50.1],
  [4.68, 49.99], [4.8, 50.15], [4.88, 50.12], [4.86, 49.8], [5.4, 49.62], [5.8, 49.55], [6.15, 49.47],
  [6.37, 49.46], [6.6, 49.2], [6.85, 49.17], [7.1, 49.13], [7.5, 49.06], [8.2, 48.97], [7.83, 48.6],
  [7.57, 48.1], [7.55, 47.58], [7.3, 47.44], [6.95, 47.48], [6.95, 47.25], [6.65, 47.0], [6.4, 46.75],
  [6.1, 46.4], [5.96, 46.2], [6.0, 46.13], [6.2, 46.15], [6.3, 46.25], [6.8, 46.4], [6.8, 46.12], [7.03, 45.92], [6.8, 45.68],
  [7.1, 45.46], [6.88, 45.13], [6.62, 45.1], [6.98, 44.83], [6.85, 44.5], [7.0, 44.22], [7.67, 44.15],
  [7.55, 43.78], [7.6, 43.5], [6.5, 42.9], [4.5, 43.2], [3.3, 42.8], [3.3, 42.42], [2.6, 42.33],
  [1.79, 42.36], [1.8, 42.62], [1.44, 42.7], [0.7, 42.8], [-0.3, 42.78], [-1.4, 43.03], [-1.8, 43.35],
  [-2.0, 43.6], [-1.5, 45.0], [-1.8, 46.0], [-2.6, 46.8], [-3.4, 47.2], [-5.0, 47.7], [-5.3, 48.5],
  [-4.0, 48.95], [-2.5, 48.75], [-1.75, 48.72], [-1.68, 49.2], [-2.05, 49.75], [-1.2, 49.8], [-0.2, 49.4],
  [0.0, 49.75], [1.1, 50.05], [1.5, 50.9], [1.85, 51.1], [2.4, 51.15],
];

/** Corse, outre-mer et collectivités couverts par la BD ORTHO (cadres [ouest, sud, est, nord]). */
const BOXES = [
  [8.4, 41.3, 9.7, 43.1], // Corse
  [-61.95, 15.75, -60.9, 16.6], // Guadeloupe
  [-61.3, 14.35, -60.7, 14.9], // Martinique
  [-54.8, 2.0, -51.5, 6.0], // Guyane
  [55.1, -21.5, 55.95, -20.8], // La Réunion
  [44.9, -13.1, 45.35, -12.6], // Mayotte
  [-56.5, 46.7, -56.0, 47.2], // Saint-Pierre-et-Miquelon
  [-63.2, 17.85, -62.78, 18.13], // Saint-Martin, Saint-Barthélemy
];

/** Point dans un polygone (lancer de rayon). */
function inPolygon([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Vrai si le point [lon, lat] est dans la zone couverte par les photos aériennes IGN. */
export function isInFrance(lonlat) {
  if (!Array.isArray(lonlat) || lonlat.length < 2) return false;
  const [lon, lat] = lonlat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (BOXES.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n)) return true;
  return inPolygon([lon, lat], METROPOLE);
}

/** Vrai si le point [lon, lat] est en France métropolitaine (continent et Corse, même contour approximatif). */
export function isInMetropole(lonlat) {
  if (!Array.isArray(lonlat) || lonlat.length < 2) return false;
  const [lon, lat] = lonlat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const [w, s, e, n] = BOXES[0];
  if (lon >= w && lon <= e && lat >= s && lat <= n) return true;
  return inPolygon([lon, lat], METROPOLE);
}

/** Couche mémorisée lisible, sinon le plan. */
export function sanitizeMapLayer(x) {
  return MAP_LAYERS.includes(x) ? x : DEFAULT_MAP_LAYER;
}

/**
 * Phase 7c : le guidage démarre toujours en plan (lisibilité) ; un bouton passe en satellite pour ce guidage
 * seulement (choix non mémorisé, le choix à l'arrêt `settings.mapLayer` ne change pas).
 */
export const GUIDANCE_START_LAYER = 'plan';

/**
 * Ce que la carte doit montrer. Satellite hors de France : plan + message ; le choix reste et les photos reviennent
 * quand la carte revient au-dessus de la France. `button` : boutons « Plan / Satellite » de l'arrêt (en guidage,
 * l'écran de guidage a son propre bouton).
 * @param {{ layer:string, center:number[]|null, navigating?:boolean }} p
 * @returns {{ photos:boolean, message:string, button:boolean }}
 */
export function satelliteView({ layer, center, navigating = false }) {
  const satellite = sanitizeMapLayer(layer) === 'satellite';
  const inFrance = isInFrance(center);
  return {
    photos: satellite && inFrance,
    message: satellite && !inFrance ? SATELLITE_OUTSIDE_TEXT : '',
    button: !navigating,
  };
}

/** Bouton du guidage : il propose l'autre couche. */
export function guidanceLayerButton(layer) {
  return sanitizeMapLayer(layer) === 'satellite'
    ? { next: 'plan', text: '🗺 Plan', label: 'Passer en plan' }
    : { next: 'satellite', text: '🛰 Satellite', label: 'Passer en vue satellite' };
}

/**
 * Changement de fond (thème jour / nuit) : MapLibre compare l'ancien et le nouveau style (setStyle en « diff ») et
 * retire tout ce qui n'est pas dans le nouveau, sans émettre « style.load ». Cette fonction (option transformStyle de
 * setStyle, MapLibre ≥ 3) recopie nos couches dans le nouveau style : `below` sous le premier libellé (photos IGN),
 * `above` tout en haut (tracés), avec leurs sources et, si donnée, une nouvelle peinture (couleurs du thème).
 * @param {{ sources?:object, layers?:object[] }|undefined} prev style sérialisé en cours
 * @param {{ sources?:object, layers?:object[] }} next nouveau style
 * @param {{ below?:string[], above?:string[], paint?:Object<string,object> }} opts
 */
export function carryOverlay(prev, next, { below = [], above = [], paint = {} } = {}) {
  const prevLayers = Array.isArray(prev?.layers) ? prev.layers : [];
  const ours = new Set([...below, ...above]);
  const pick = (ids) => ids
    .map((id) => prevLayers.find((l) => l.id === id))
    .filter(Boolean)
    .map((l) => (paint[l.id] ? { ...l, paint: { ...l.paint, ...paint[l.id] } } : l));
  const lower = pick(below);
  const upper = pick(above);
  const layers = (Array.isArray(next?.layers) ? next.layers : []).filter((l) => !ours.has(l.id));
  const sources = { ...(next?.sources ?? {}) };
  for (const l of [...lower, ...upper]) {
    if (l.source && !sources[l.source] && prev?.sources?.[l.source]) sources[l.source] = prev.sources[l.source];
  }
  let at = layers.findIndex((l) => l.type === 'symbol');
  if (at < 0) at = layers.length;
  layers.splice(at, 0, ...lower);
  layers.push(...upper);
  return { ...next, sources, layers };
}
