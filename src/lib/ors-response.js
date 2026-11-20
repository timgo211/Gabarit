// Lecture d'une réponse ORS directions au format GeoJSON. Logique pure.
// Format : FeatureCollection → features[i] (une Feature par itinéraire avec alternative_routes),
// properties.{summary, segments, extras, way_points}, geometry LineString [lon, lat]. extras.tollways = { values:[[début,fin,valeur]], summary:[{value,distance,amount}] }
// (valeur 1 = tronçon à péage, 0 = sans péage).

import { parseCountryInfo } from './countries.js';

const EARTH_RADIUS_M = 6371008.8;

/** Distance orthodromique entre deux points [lon, lat], en mètres. */
export function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Km à péage, en mètres. null si l'extra « tollways » est absent ou illisible (→ « inconnu »).
 * 1) somme des summary[value=1].distance ; 2) sinon recalcul depuis values + géométrie.
 */
export function tollDistance(extras, coordinates) {
  const t = extras?.tollways;
  if (!t || typeof t !== 'object') return null;

  if (Array.isArray(t.summary) && t.summary.length) {
    let sum = 0;
    let readable = false;
    for (const s of t.summary) {
      if (typeof s?.distance !== 'number') continue;
      readable = true;
      if (Number(s.value) === 1) sum += s.distance;
    }
    if (readable) return sum;
  }

  if (Array.isArray(t.values) && Array.isArray(coordinates) && coordinates.length > 1) {
    let sum = 0;
    for (const v of t.values) {
      if (!Array.isArray(v) || v.length < 3) return null;
      const [from, to, value] = v;
      if (Number(value) !== 1) continue;
      for (let i = from; i < to && i + 1 < coordinates.length; i += 1) {
        sum += haversine(coordinates[i], coordinates[i + 1]);
      }
    }
    return sum;
  }
  return null;
}

/** Erreur « pas d'itinéraire » levée quand la réponse est vide. */
export class NoRouteError extends Error {
  constructor(message = 'Aucun itinéraire dans la réponse.') {
    super(message);
    this.name = 'NoRouteError';
  }
}

/** Emprise [ouest, sud, est, nord] d'une liste de points [lon, lat], ou null. */
export function bboxOf(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of coordinates) {
    if (lon < b[0]) b[0] = lon;
    if (lat < b[1]) b[1] = lat;
    if (lon > b[2]) b[2] = lon;
    if (lat > b[3]) b[3] = lat;
  }
  return b.every(Number.isFinite) ? b : null;
}

/** Lit un itinéraire (Feature GeoJSON d'ORS) ; null s'il n'a pas de tracé exploitable. */
function parseFeature(feature, fallbackBbox) {
  const coords = feature?.geometry?.coordinates;
  if (!feature || !Array.isArray(coords) || coords.length < 2) return null;

  const props = feature.properties ?? {};
  const summary = props.summary ?? {};
  const steps = [];
  for (const seg of props.segments ?? []) {
    for (const st of seg.steps ?? []) {
      const wp = st.way_points;
      steps.push({
        instruction: st.instruction ?? '',
        distance: st.distance ?? 0,
        duration: st.duration ?? 0,
        // Type de manœuvre ORS (0 à 13, voir nav-guidance.js), rue suivante, numéro de sortie de rond-point,
        // indices [début, fin] dans la géométrie (way_points, globaux sur tout l'itinéraire).
        type: Number.isInteger(st.type) ? st.type : null,
        name: typeof st.name === 'string' && st.name !== '-' ? st.name : '',
        exitNumber: Number.isInteger(st.exit_number) ? st.exit_number : null,
        wayPoints: Array.isArray(wp) && wp.length === 2 && wp.every(Number.isInteger) ? [wp[0], wp[1]] : null,
      });
    }
  }
  const warnings = (props.warnings ?? []).map((w) => w?.message).filter(Boolean);

  return {
    // ORS omet distance/duration quand elles valent 0.
    distance: typeof summary.distance === 'number' ? summary.distance : 0,
    duration: typeof summary.duration === 'number' ? summary.duration : 0,
    coordinates: coords,
    bbox: Array.isArray(feature.bbox) ? feature.bbox : (Array.isArray(fallbackBbox) ? fallbackBbox : null),
    tollDistance: tollDistance(props.extras, coords),
    // Pays traversés (phase 5c, extra « countryinfo ») : [{ from, to, code }] ou null (→ « Pays traversés indisponibles »).
    countries: parseCountryInfo(props.extras),
    steps,
    warnings,
  };
}

/**
 * Premier itinéraire de la réponse.
 * @returns {{ distance:number, duration:number, coordinates:number[][], bbox:number[]|null,
 *   tollDistance:number|null, warnings:string[],
 *   steps:{instruction:string,distance:number,duration:number,type:number|null,name:string,exitNumber:number|null,wayPoints:number[]|null}[] }}
 *   distance en m, duration en s.
 */
export function parseDirections(json) {
  const feature = Array.isArray(json?.features) ? json.features[0] : null;
  const route = parseFeature(feature, json?.bbox);
  if (!route) throw new NoRouteError();
  return route;
}

/**
 * Tous les itinéraires de la réponse (alternative_routes : une Feature par itinéraire, la première est
 * l'itinéraire principal). Les Features sans tracé sont ignorées ; aucune → NoRouteError.
 * L'emprise globale de la réponse ne sert de repli que pour une réponse à un seul itinéraire.
 */
export function parseAllDirections(json) {
  const features = Array.isArray(json?.features) ? json.features : [];
  const fallback = features.length === 1 ? json?.bbox : null;
  const routes = [];
  for (const f of features) {
    const r = parseFeature(f, fallback);
    if (r) routes.push(r.bbox ? r : { ...r, bbox: bboxOf(r.coordinates) });
  }
  if (!routes.length) throw new NoRouteError();
  return routes;
}

/** Estimation de gazole consommé (L), ou null si la conso n'est pas renseignée. */
export function fuelEstimate(distanceM, consumptionL100) {
  if (typeof consumptionL100 !== 'number' || !(consumptionL100 > 0)) return null;
  return (distanceM / 1000) * (consumptionL100 / 100);
}

/** Coût du gazole (€) : litres × prix au litre, ou null si l'un des deux manque. */
export function fuelCost(liters, pricePerLiter) {
  if (typeof liters !== 'number' || !Number.isFinite(liters)) return null;
  if (typeof pricePerLiter !== 'number' || !(pricePerLiter > 0)) return null;
  return liters * pricePerLiter;
}
