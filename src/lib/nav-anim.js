// Animation de la flèche du camion (phase 7c) : position et cap interpolés entre deux positions GPS.
// Logique pure ; la boucle requestAnimationFrame est dans src/ui/map.js et s'arrête à la fin de chaque interpolation
// (aucun rendu continu quand rien ne bouge).

import { normalizeBearing } from './nav-geo.js';

/**
 * Durée d'une interpolation : intervalle mesuré entre deux positions, borné (pas de retard visible).
 * À l'arrêt (moins de 3 km/h) ou sans changement, pas d'animation : une seule image par position, pas de rendu
 * continu sur une aire (batterie, chauffe).
 */
export const ANIM = Object.freeze({
  MIN_MS: 200, MAX_MS: 1000, DEFAULT_MS: 1000, JUMP_M: 500,
  STILL_KMH: 3,
  /**
   * À l'arrêt, flèche et caméra restent où elles sont tant que la position reste à moins de 100 m de celle dessinée
   * (GPS qui dérive sur une aire) : aucune image, ni la carte ni les repères (aires, départ, arrivée) ne sont
   * redessinés. Au-delà (camion qui avance au pas), une image.
   */
  HOLD_M: 100,
  /** En dessous de ces écarts, rien n'a changé. */
  SAME_M: 0.5, SAME_DEG: 0.5, SAME_ZOOM: 0.01, SAME_PITCH: 0.1,
});

/** Différence d'angle la plus courte de a vers b (−180 à 180). */
export function shortestTurn(a, b) {
  let d = normalizeBearing(b) - normalizeBearing(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Interpolation linéaire. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Même valeur (deux absentes comptent comme égales). */
function same(a, b, eps, angle = false) {
  const fa = Number.isFinite(a);
  const fb = Number.isFinite(b);
  if (!fa || !fb) return fa === fb;
  return Math.abs(angle ? shortestTurn(a, b) : b - a) < eps;
}

/** Position, cap, zoom et inclinaison inchangés ? */
export function unchanged(from, to, distanceM) {
  return !!from?.lonlat && Number.isFinite(distanceM) && distanceM < ANIM.SAME_M
    && same(from.bearing, to.bearing, ANIM.SAME_DEG, true) && same(from.zoom, to.zoom, ANIM.SAME_ZOOM)
    && same(from.pitch, to.pitch, ANIM.SAME_PITCH);
}

/** Mêmes marges de caméra ({ top, right, bottom, left }, absentes = égales). */
export function samePadding(a, b) {
  if (!a || !b) return !a && !b;
  return ['top', 'right', 'bottom', 'left'].every((k) => Math.round(a[k] ?? 0) === Math.round(b[k] ?? 0));
}

/**
 * Camion arrêté (moins de 3 km/h), position à moins de 100 m de celle dessinée, même suivi et mêmes marges de
 * caméra : rien à redessiner (la dérive du GPS ne bouge ni la flèche ni la carte).
 * @param {{ lonlat:number[], follow?:boolean, padding?:object }|null} drawn dernière position dessinée
 * @param {{ follow?:boolean, padding?:object }} next
 * @param {number} distanceM distance entre la position dessinée et la nouvelle
 * @param {number|null} speedKmh
 */
export function holdStill(drawn, next, distanceM, speedKmh) {
  return !!drawn?.lonlat && Number.isFinite(speedKmh) && speedKmh < ANIM.STILL_KMH
    && Number.isFinite(distanceM) && distanceM < ANIM.HOLD_M
    && !!drawn.follow === !!next.follow && samePadding(drawn.padding, next.padding);
}

/**
 * Prépare une interpolation de « from » vers « to » ({ lonlat:[lon,lat], bearing:number|null, zoom?, pitch? }).
 * Arrivée immédiate (duration 0, une seule image) : pas de point de départ, saut trop grand (> 500 m, recalcul,
 * signal retrouvé), vitesse sous 3 km/h, ou rien n'a changé.
 * @param {number|null} intervalMs temps écoulé depuis la position précédente
 * @param {number} distanceM distance entre from et to
 * @param {{ speedKmh?:number|null }} [opts]
 */
export function planMove(from, to, intervalMs, distanceM, { speedKmh = null } = {}) {
  const dur = Number.isFinite(intervalMs) && intervalMs > 0
    ? Math.min(ANIM.MAX_MS, Math.max(ANIM.MIN_MS, intervalMs)) : ANIM.DEFAULT_MS;
  const jump = !from?.lonlat || !Number.isFinite(distanceM) || distanceM > ANIM.JUMP_M;
  const still = Number.isFinite(speedKmh) && speedKmh < ANIM.STILL_KMH;
  if (jump || still || unchanged(from, to, distanceM)) return { from: to, to, duration: 0 };
  return { from, to, duration: dur };
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
