// Choix du thème jour/nuit. Logique pure.
// Mode « auto » : nuit de 20 h à 7 h (heure locale de la tablette).

export const THEME_MODES = ['auto', 'day', 'night'];
export const NIGHT_START_HOUR = 20;
export const NIGHT_END_HOUR = 7;

/** @returns {'day'|'night'} */
export function resolveTheme(mode, date = new Date()) {
  if (mode === 'day' || mode === 'night') return mode;
  const h = date.getHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR ? 'night' : 'day';
}
