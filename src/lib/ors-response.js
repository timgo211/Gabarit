// Lecture d'une réponse ORS directions au format GeoJSON. Logique pure.
// Format : FeatureCollection → features[0].properties.{summary, segments, extras, way_points},
// geometry LineString [lon, lat]. extras.tollways = { values:[[début,fin,valeur]], summary:[{value,distance,amount}] }
// (valeur 1 = tronçon à péage, 0 = sans péage).

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

/**
 * @returns {{ distance:number, duration:number, coordinates:number[][], bbox:number[]|null,
 *   tollDistance:number|null, warnings:string[],
 *   steps:{instruction:string,distance:number,duration:number,type:number|null,name:string,exitNumber:number|null,wayPoints:number[]|null}[] }}
 *   distance en m, duration en s.
 */
export function parseDirections(json) {
  const feature = Array.isArray(json?.features) ? json.features[0] : null;
  const coords = feature?.geometry?.coordinates;
  if (!feature || !Array.isArray(coords) || coords.length < 2) throw new NoRouteError();

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
    bbox: Array.isArray(feature.bbox) ? feature.bbox : (Array.isArray(json.bbox) ? json.bbox : null),
    tollDistance: tollDistance(props.extras, coords),
    steps,
    warnings,
  };
}

/** Estimation de gazole consommé (L), ou null si la conso n'est pas renseignée. */
export function fuelEstimate(distanceM, consumptionL100) {
  if (typeof consumptionL100 !== 'number' || !(consumptionL100 > 0)) return null;
  return (distanceM / 1000) * (consumptionL100 / 100);
}
