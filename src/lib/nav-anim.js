// Animation de la flèche du camion (phase 7c) : position et cap interpolés entre deux positions GPS.
// Logique pure ; la boucle requestAnimationFrame est dans src/ui/map.js et s'arrête à la fin de chaque interpolation
// (aucun rendu continu quand rien ne bouge).

import { normalizeBearing } from './nav-geo.js';

/** Durée d'une interpolation : intervalle mesuré entre deux positions, borné (pas de retard visible). */
export const ANIM = Object.freeze({ MIN_MS: 200, MAX_MS: 1000, DEFAULT_MS: 1000, JUMP_M: 500 });

/** Différence d'angle la plus courte de a vers b (−180 à 180). */
export function shortestTurn(a, b) {
  let d = normalizeBearing(b) - normalizeBearing(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Interpolation linéaire. */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Prépare une interpolation de « from » vers « to » ({ lonlat:[lon,lat], bearing:number|null }).
 * Saut trop grand (> 500 m, recalcul, signal retrouvé) ou pas de point de départ : arrivée immédiate.
 * @param {number|null} intervalMs temps écoulé depuis la position précédente
 */
export function planMove(from, to, intervalMs, distanceM) {
  const dur = Number.isFinite(intervalMs) && intervalMs > 0
    ? Math.min(ANIM.MAX_MS, Math.max(ANIM.MIN_MS, intervalMs)) : ANIM.DEFAULT_MS;
  const jump = !from?.lonlat || !Number.isFinite(distanceM) || distanceM > ANIM.JUMP_M;
  return { from: jump ? to : from, to, duration: jump ? 0 : dur };
}

/**
 * État au temps t (0 à 1) d'une interpolation : position linéaire, cap par le plus court chemin, autres valeurs
 * numériques (zoom, inclinaison) linéaires.
 */
export function frameAt(move, t) {
  const k = move.duration > 0 ? Math.min(1, Math.max(0, t)) : 1;
  const a = move.from;
  const b = move.to;
  const out = { lonlat: [lerp(a.lonlat[0], b.lonlat[0], k), lerp(a.lonlat[1], b.lonlat[1], k)] };
  if (Number.isFinite(b.bearing)) {
    out.bearing = Number.isFinite(a.bearing) ? normalizeBearing(a.bearing + shortestTurn(a.bearing, b.bearing) * k) : b.bearing;
  } else {
    out.bearing = null;
  }
  for (const key of ['zoom', 'pitch']) {
    if (Number.isFinite(b[key])) out[key] = Number.isFinite(a[key]) ? lerp(a[key], b[key], k) : b[key];
  }
  return out;
}
