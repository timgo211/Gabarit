// Routes « sauf desserte locale / livraisons » (phase 5d) : extra « roadaccessrestrictions » d'OpenRouteService,
// demandé dans la même requête que l'itinéraire (variantes et recalcul compris, aucune requête en plus). Logique pure.
//
// Doc ORS (docs/api-reference/endpoints/directions/extra-info/road-access-restrictions.md, lue le 20/11/2026) :
// 0 aucune, 1 No, 2 Customers, 4 Destination, 8 Delivery, 16 Private, 32 Permissive, 64 Permit ; disponible pour
// driving-hgv (extra-info/index.md). Code (AccessRestrictionsParser) : valeurs cumulées (opérateur |, 12 = Destination
// + Delivery), étiquettes lues dans l'ordre hgv, motor_vehicle, vehicle, access.
// Pourquoi une alerte : le profil camion d'ORS (HeavyVehicleFlagEncoder) accepte hgv=destination (absent des valeurs
// interdites : private, no, restricted, military) et hgv=delivery (valeur autorisée) partout, même en transit.
// Un tronçon réservé est accepté s'il mène à l'arrivée ou part du départ (client, dépôt) ou s'en trouve à moins de
// LOCAL.RADIUS_M ; sinon : alerte et bouton « Éviter » (à l'arrêt, une requête ORS sur appui).

import { prepareLine, pointAt, haversine } from './nav-geo.js';
import { timeAt } from './areas-route.js';
import { squareAround } from './adr.js';

export const LOCAL = Object.freeze({
  /** Desserte acceptée à moins de 3 km du départ ou de l'arrivée (à vol d'oiseau). */
  RADIUS_M: 3000,
  /** Bits de roadaccessrestrictions retenus : Customers, Destination, Delivery. */
  MASK: 2 | 4 | 8,
  /** Deux tronçons réservés séparés de moins de 50 m : un seul passage. */
  JOIN_M: 50,
  /** « Éviter » : carré de 80 m au milieu du tronçon (options.avoid_polygons), 150 km au plus à vol d'oiseau. */
  AVOID_SQUARE_M: 80,
  MAX_AVOID_M: 150000,
  BANNER_M: 10000,
  ANNOUNCE_M: 3000,
  ANNOUNCE_MIN_M: 1000,
  UNAVAILABLE_TEXT: 'Routes réservées à la desserte locale : information indisponible pour cet itinéraire.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPoint = (p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]);

/**
 * Extra roadaccessrestrictions → morceaux [{ from, to, value }] (indices de la géométrie) gardant les seuls bits de
 * desserte ; [] si l'extra est là sans desserte ; null s'il manque.
 */
export function parseAccessExtra(extras) {
  const values = extras?.roadaccessrestrictions?.values;
  if (!Array.isArray(values)) return null;
  const out = [];
  for (const v of values) {
    if (!Array.isArray(v) || v.length < 3 || !Number.isInteger(v[0]) || !Number.isInteger(v[1]) || !isNum(v[2])) continue;
    const value = Math.round(v[2]) & LOCAL.MASK;
    if (v[1] <= v[0] || !value) continue;
    out.push({ from: v[0], to: v[1], value });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Plus petite distance d'un point aux sommets d'un morceau du tracé (m). */
function minDistance(coords, from, to, p) {
  let best = Infinity;
  for (let i = from; i <= to; i += 1) best = Math.min(best, haversine(coords[i], p));
  return best;
}

/**
 * Tronçons de desserte traversés par l'itinéraire.
 * @param {object} route itinéraire (coordinates, steps, duration, local : parseAccessExtra)
 * @returns {{ ok:boolean, passages:{ enter, exit, from, to, value, accepted:boolean, reason:'start'|'end'|null,
 *   time, at:Date, mid:number[], name:string }[] }}
 */
export function localAlongRoute(route, { departure = new Date(), elapsed = (t) => t, radius = LOCAL.RADIUS_M } = {}) {
  const parts = route?.local;
  const coords = route?.coordinates;
  if (!Array.isArray(parts) || !Array.isArray(coords) || coords.length < 2) return { ok: false, passages: [] };
  const line = prepareLine(coords);
  const last = coords.length - 1;
  const at = (i) => line.cum[Math.max(0, Math.min(last, i))] ?? 0;
  const runs = [];
  for (const p of parts) {
    const prev = runs[runs.length - 1];
    if (prev && at(p.from) - at(prev.to) <= LOCAL.JOIN_M) { prev.to = Math.max(prev.to, p.to); prev.value |= p.value; continue; }
    runs.push({ ...p });
  }
  const start = coords[0];
  const end = coords[last];
  const steps = Array.isArray(route.steps) ? route.steps : [];
  const passages = runs.map((r) => {
    const enter = at(r.from);
    const exit = at(r.to);
    let reason = null;
    if (r.from <= 0 || minDistance(coords, r.from, r.to, start) <= radius) reason = 'start';
    if (r.to >= last || minDistance(coords, r.from, r.to, end) <= radius) reason = 'end';
    const step = steps.find((s) => Array.isArray(s?.wayPoints) && s.wayPoints[0] <= r.from && s.wayPoints[1] > r.from);
    const time = elapsed(timeAt(route, line, enter));
    return {
      id: `local:${r.from}`, enter, exit, from: r.from, to: r.to, value: r.value, accepted: reason !== null, reason,
      time, at: new Date(departure.getTime() + time * 1000), mid: pointAt(line, (enter + exit) / 2).point,
      name: step?.name ?? '',
    };
  });
  return { ok: true, passages };
}

const km = (m) => `km ${Math.round(m / 1000)}`;

/** Fiche : tronçon réservé traversé en transit. */
export function describeLocal(p) {
  const what = p.value & 8 && !(p.value & 4) ? 'Route réservée aux livraisons' : 'Route réservée à la desserte locale';
  return `${what} vers ${km(p.enter)}${p.name ? ` (${p.name})` : ''} : vous la traversez. La signalisation fait foi.`;
}

/** Fiche : tronçon réservé accepté (près du départ ou de l'arrivée). */
export function describeLocalAccepted(p) {
  const near = p.reason === 'start' ? 'près du départ' : 'près de l\'arrivée';
  return `Route réservée à la desserte locale vers ${km(p.enter)}${p.name ? ` (${p.name})` : ''}, ${near} : acceptée. La signalisation fait foi.`;
}

/**
 * Zones à éviter pour les tronçons traversés en transit, ajoutées à celles déjà évitées (ZFE, tunnels). Même limite
 * de l'API publique d'ORS que pour les ZFE : départ et arrivée à 150 km au plus à vol d'oiseau.
 * @returns {{ ok:true, geometry:object }|{ ok:false, text:string }}
 */
export function avoidLocalFor(passages, { start, end, existing = null, maxDistance = LOCAL.MAX_AVOID_M }) {
  const list = (passages ?? []).filter((p) => !p.accepted && isPoint(p.mid));
  if (!list.length) return { ok: false, text: 'Aucune route réservée à la desserte locale traversée sur cet itinéraire.' };
  if (!isPoint(start) || !isPoint(end) || haversine(start, end) > maxDistance) {
    return {
      ok: false,
      text: 'Éviter la desserte locale : impossible pour ce trajet. OpenRouteService (service gratuit) ne contourne une zone que si le départ et l\'arrivée sont à 150 km au plus à vol d\'oiseau. Choisis un autre itinéraire proposé ou ajoute une étape ; la signalisation fait foi.',
    };
  }
  const polygons = [];
  if (existing?.type === 'MultiPolygon' && Array.isArray(existing.coordinates)) polygons.push(...existing.coordinates);
  else if (existing?.type === 'Polygon' && Array.isArray(existing.coordinates)) polygons.push(existing.coordinates);
  for (const p of list) polygons.push([squareAround(p.mid, LOCAL.AVOID_SQUARE_M)]);
  return { ok: true, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}

const distText = (m) => (m >= 1000 ? `${(Math.round(m / 100) / 10).toString().replace('.', ',')} km` : `${Math.round(m)} m`);

/**
 * Guidage : prochain tronçon traversé en transit (bandeau sous 10 km, voix une fois vers 3 km).
 * @returns {{ view:{ distance, text }|null, speak:string|null, announced:object }}
 */
export function guidanceLocal(passages, along, announced = {}) {
  const next = (passages ?? []).find((p) => !p.accepted && p.exit >= along);
  if (!next) return { view: null, speak: null, announced };
  const distance = Math.max(0, next.enter - along);
  if (distance > LOCAL.BANNER_M) return { view: null, speak: null, announced };
  const head = distance > 0 ? `Desserte locale dans ${distText(distance)}` : 'Desserte locale';
  const view = { distance, text: `${head}${next.name ? ` (${next.name})` : ''} : vous la traversez · la signalisation fait foi` };
  const out = { ...announced };
  let speak = null;
  if (!out[next.id] && distance <= LOCAL.ANNOUNCE_M && distance >= LOCAL.ANNOUNCE_MIN_M) {
    out[next.id] = true;
    speak = `Attention, dans ${Math.round(distance / 1000)} kilomètres, route réservée à la desserte locale. Suivez la signalisation.`;
  }
  return { view, speak, announced: out };
}
