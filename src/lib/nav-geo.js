// Géométrie de la navigation : cap, distances cumulées, projection de la position GPS sur le tracé.
// Logique pure. Points en [longitude, latitude], distances en mètres, caps en degrés (0 = nord, sens horaire,
// même convention que GeolocationCoordinates.heading).

import { haversine } from './ors-response.js';

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Distance vers l'avant explorée autour de la dernière position connue (évite de sauter sur la voie d'en face). */
export const LOOKAHEAD_M = 2000;
/** Au-delà de cet écart à la recherche locale, on cherche sur tout le tracé. */
export const REACQUIRE_M = 60;

export { haversine };

/** Ramène un angle dans [0, 360). */
export function normalizeBearing(deg) {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Cap initial de a vers b, en degrés [0, 360). */
export function bearing(a, b) {
  const f1 = a[1] * RAD;
  const f2 = b[1] * RAD;
  const dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return normalizeBearing(Math.atan2(y, x) / RAD);
}

/** Point atteint en partant de p, au cap donné, après la distance donnée (sphère). */
export function destinationPoint(p, bearingDeg, distance) {
  const d = distance / EARTH_RADIUS_M;
  const t = bearingDeg * RAD;
  const f1 = p[1] * RAD;
  const l1 = p[0] * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [((l2 / RAD + 540) % 360) - 180, f2 / RAD];
}

/** Écart angulaire le plus court entre deux caps, dans [0, 180]. */
export function bearingDiff(a, b) {
  const d = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return d > 180 ? 360 - d : d;
}

/**
 * Prépare une ligne pour la navigation : distances cumulées depuis le départ.
 * @param {number[][]} coordinates
 * @returns {{ coords:number[][], cum:number[], total:number }}
 */
export function prepareLine(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw new TypeError('Tracé trop court.');
  const cum = [0];
  for (let i = 1; i < coordinates.length; i += 1) cum.push(cum[i - 1] + haversine(coordinates[i - 1], coordinates[i]));
  return { coords: coordinates, cum, total: cum[cum.length - 1] };
}

/** Projection de p sur le segment [a, b] (approximation plane locale, précise à quelques cm sur quelques km). */
export function projectOnSegment(p, a, b) {
  const kx = Math.cos(p[1] * RAD) * EARTH_RADIUS_M * RAD;
  const ky = EARTH_RADIUS_M * RAD;
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return { t, distance: Math.hypot(ax + t * dx, ay + t * dy) };
}

function scan(line, p, from, to) {
  let best = null;
  for (let i = from; i < to; i += 1) {
    const r = projectOnSegment(p, line.coords[i], line.coords[i + 1]);
    if (!best || r.distance < best.distance) best = { segIndex: i, t: r.t, distance: r.distance };
  }
  return best;
}

/**
 * Position GPS ramenée sur le tracé.
 * Avec hint (segment précédent), on cherche d'abord un peu en arrière et LOOKAHEAD_M en avant ;
 * si rien n'est à moins de REACQUIRE_M, on cherche sur tout le tracé.
 * @returns {{ segIndex:number, t:number, distance:number, along:number, point:number[] }}
 *   distance = écart au tracé (m), along = distance parcourue sur le tracé (m)
 */
export function locateOnLine(line, p, hint = null) {
  const last = line.coords.length - 1;
  let best = null;
  if (Number.isInteger(hint) && hint >= 0 && hint < last) {
    const from = Math.max(0, hint - 2);
    const limit = line.cum[hint] + LOOKAHEAD_M;
    let to = hint + 1;
    while (to < last && line.cum[to] < limit) to += 1;
    best = scan(line, p, from, to);
    if (best && best.distance > REACQUIRE_M) best = null;
  }
  if (!best) best = scan(line, p, 0, last);
  const a = line.coords[best.segIndex];
  const b = line.coords[best.segIndex + 1];
  const segLen = line.cum[best.segIndex + 1] - line.cum[best.segIndex];
  return {
    ...best,
    along: line.cum[best.segIndex] + best.t * segLen,
    point: [a[0] + best.t * (b[0] - a[0]), a[1] + best.t * (b[1] - a[1])],
  };
}

/** Indice du segment qui contient la distance « along ». */
export function segmentAt(line, along) {
  const last = line.coords.length - 1;
  if (!(along > 0)) return 0;
  if (along >= line.total) return last - 1;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point et cap de la route à une distance donnée depuis le départ (bornée au tracé). */
export function pointAt(line, along) {
  const a = Math.min(Math.max(0, along), line.total);
  const i = segmentAt(line, a);
  const p0 = line.coords[i];
  const p1 = line.coords[i + 1];
  const segLen = line.cum[i + 1] - line.cum[i];
  const t = segLen > 0 ? (a - line.cum[i]) / segLen : 0;
  return { point: [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])], bearing: segmentBearing(line, i), segIndex: i };
}

/** Cap du segment i ; si le segment est de longueur nulle, cap du suivant (ou du précédent). */
export function segmentBearing(line, i) {
  const n = line.coords.length;
  for (let k = i; k < n - 1; k += 1) if (line.cum[k + 1] - line.cum[k] > 0.01) return bearing(line.coords[k], line.coords[k + 1]);
  for (let k = Math.min(i, n - 2) - 1; k >= 0; k -= 1) if (line.cum[k + 1] - line.cum[k] > 0.01) return bearing(line.coords[k], line.coords[k + 1]);
  return 0;
}
