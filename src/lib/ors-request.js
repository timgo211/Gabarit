// Construction des requêtes ORS (itinéraire) et Pelias (autocomplétion). Logique pure.
// Référence : https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/
// La clé n'est JAMAIS écrite ici : elle est passée par l'appelant au moment de l'envoi.

import {
  ORS_BASE, PELIAS_BASE, ORS_MIN_MAX_SPEED, GEOCODE_COUNTRIES, ORS_MAX_ALTERNATIVE_ROUTES, ORS_PREFERENCES,
} from './config.js';

/** Clés de restriction ORS (profile_params.restrictions) ← champs du profil. Unités : m et t. */
const RESTRICTION_FIELDS = ['height', 'width', 'length', 'weight', 'axleload'];

function isLonLat(p) {
  return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n))
    && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

/** maximum_speed : niveau racine, ORS impose un minimum de 80 km/h. */
export function clampMaxSpeed(speed) {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return null;
  return Math.max(ORS_MIN_MAX_SPEED, Math.round(speed));
}

/** Restrictions camion du profil ; seules les valeurs renseignées sont envoyées (ORS n'a pas de défaut). */
export function buildRestrictions(vehicle) {
  const r = {};
  for (const key of RESTRICTION_FIELDS) {
    const val = vehicle?.[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) r[key] = val;
  }
  if (vehicle?.hazmat === true) r.hazmat = true;
  return r;
}

/**
 * Requête d'itinéraire camion.
 * @param {{ start:[number,number], end:[number,number], vehicle:object, avoidTolls?:boolean, avoidFerries?:boolean,
 *   preference?:'recommended'|'fastest'|'shortest'|null, alternatives?:number, avoidPolygons?:object|null }} p
 *   start/end en [longitude, latitude] ; preference absente → défaut ORS (« recommended ») ;
 *   alternatives = nombre d'itinéraires voulus (2 ou 3, itinéraire principal compris) → alternative_routes.target_count.
 * @returns {{ url:string, method:'POST', body:object }}
 */
export function buildDirectionsRequest({
  start, end, vehicle, avoidTolls = false, avoidFerries = false, preference = null, alternatives = 0, avoidPolygons = null,
}) {
  if (!isLonLat(start)) throw new TypeError('Point de départ invalide.');
  if (!isLonLat(end)) throw new TypeError("Point d'arrivée invalide.");
  if (!vehicle) throw new TypeError('Aucun profil véhicule actif.');
  if (preference !== null && preference !== undefined && !ORS_PREFERENCES.includes(preference)) {
    throw new TypeError("Préférence d'itinéraire inconnue.");
  }
  if (alternatives && !(Number.isInteger(alternatives) && alternatives >= 2 && alternatives <= ORS_MAX_ALTERNATIVE_ROUTES)) {
    throw new TypeError(`Nombre d'itinéraires alternatifs : entre 2 et ${ORS_MAX_ALTERNATIVE_ROUTES}.`);
  }

  const options = { vehicle_type: 'hgv' };
  const avoid = [];
  if (avoidTolls) avoid.push('tollways');
  if (avoidFerries) avoid.push('ferries');
  if (avoid.length) options.avoid_features = avoid;
  // Zones à éviter (phase 5, « Éviter la ZFE ») : GeoJSON Polygon ou MultiPolygon (options.avoid_polygons, doc ORS
  // docs/api-reference/endpoints/directions/routing-options.md) ; limites de l'API publique : voir ZFE dans zfe.js.
  if (avoidPolygons && (avoidPolygons.type === 'Polygon' || avoidPolygons.type === 'MultiPolygon')
    && Array.isArray(avoidPolygons.coordinates) && avoidPolygons.coordinates.length) {
    options.avoid_polygons = { type: avoidPolygons.type, coordinates: avoidPolygons.coordinates };
  }
  const restrictions = buildRestrictions(vehicle);
  if (Object.keys(restrictions).length) options.profile_params = { restrictions };

  const body = {
    coordinates: [start, end],
    instructions: true,
    language: 'fr',
    units: 'm',
    // countryinfo (phase 5c) : pays traversés, dans la même requête (variantes et recalcul compris).
    extra_info: ['tollways', 'countryinfo'],
    options,
  };
  const speed = clampMaxSpeed(vehicle.maxSpeed);
  if (speed !== null) body.maximum_speed = speed;
  if (preference) body.preference = preference;
  // weight_factor (1,4) et share_factor (0,6) : valeurs par défaut d'ORS.
  if (alternatives) body.alternative_routes = { target_count: alternatives };

  return { url: `${ORS_BASE}/directions/driving-hgv/geojson`, method: 'POST', body };
}

/** En-têtes de la requête d'itinéraire (la clé vient de l'appareil, jamais du code). */
export function directionsHeaders(apiKey) {
  return {
    Authorization: apiKey,
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'application/json, application/geo+json',
  };
}

/**
 * URL d'autocomplétion Pelias (GET). Par défaut la clé part dans l'en-tête Authorization
 * (voir peliasHeaders), comme pour les itinéraires : api.heigit.org refuse la clé en api_key
 * dans certains cas. keyInQuery=true n'est qu'un repli si le navigateur bloque l'en-tête (CORS).
 * @param {{ text:string, apiKey?:string, keyInQuery?:boolean, focus?:[number,number], countries?:string[], size?:number }} p
 */
export function buildAutocompleteUrl({ text, apiKey, keyInQuery = false, focus, countries = GEOCODE_COUNTRIES, size = 6 }) {
  const params = new URLSearchParams();
  if (keyInQuery) params.set('api_key', apiKey ?? '');
  params.set('text', String(text ?? '').trim());
  params.set('size', String(size));
  params.set('lang', 'fr');
  if (countries?.length) params.set('boundary.country', countries.join(','));
  if (isLonLat(focus)) {
    params.set('focus.point.lon', focus[0].toFixed(5));
    params.set('focus.point.lat', focus[1].toFixed(5));
  }
  return `${PELIAS_BASE}/autocomplete?${params.toString()}`;
}

/** En-têtes de l'autocomplétion Pelias (clé dans Authorization). */
export function peliasHeaders(apiKey) {
  return { Authorization: apiKey, Accept: 'application/json, application/geo+json' };
}

/** Petit itinéraire fixe (centre de Lyon, ~1 km) pour tester la clé sur le service principal. */
export function buildKeyTestRequest() {
  return buildDirectionsRequest({ start: [4.8357, 45.7640], end: [4.8467, 45.7597], vehicle: {} });
}

/** Lit une réponse Pelias (GeoJSON) en suggestions simples. */
export function parseAutocomplete(json) {
  const features = Array.isArray(json?.features) ? json.features : [];
  return features
    .filter((f) => isLonLat(f?.geometry?.coordinates))
    .map((f) => ({
      label: f.properties?.label || f.properties?.name || 'Lieu sans nom',
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
}
