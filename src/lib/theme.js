// Choix du thème jour/nuit. Logique pure.
// Mode « auto » (phase 2c) : nuit entre le coucher et le lever du soleil calculés à la position connue
// (src/lib/sun.js) ; sans position : nuit de 20 h à 7 h (heure locale de la tablette). Le choix manuel
// (« jour » ou « nuit » dans Réglages) l'emporte toujours.

import { isNight } from './sun.js';

export const THEME_MODES = ['auto', 'day', 'night'];
export const NIGHT_START_HOUR = 20;
export const NIGHT_END_HOUR = 7;
/** Mode auto : réévaluation pendant le guidage (la position change, le soleil aussi). */
export const THEME_RECHECK_NAV_MS = 5 * 60000;

/**
 * @param {'auto'|'day'|'night'} mode
 * @param {Date} [date]
 * @param {number[]|null} [lonlat] dernière position connue [lon, lat]
 * @returns {'day'|'night'}
 */
export function resolveTheme(mode, date = new Date(), lonlat = null) {
  if (mode === 'day' || mode === 'night') return mode;
  const sun = isNight(date, lonlat);
  if (sun !== null) return sun ? 'night' : 'day';
  const h = date.getHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR ? 'night' : 'day';
}

/** Couleur de la barre du haut, de la barre d'état et de l'écran de chargement (Panier Perdu, jour et nuit). */
export const CHROME_COLOR = '#14161C';
