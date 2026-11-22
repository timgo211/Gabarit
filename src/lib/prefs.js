// Préférences d'affichage et de voix (phase 7c) : couleur de la flèche, voix, vitesse et volume de la voix.
// Logique pure : valeurs permises et nettoyage des réglages chargés ou importés.

/** Couleurs de la flèche du camion (fond, contour) : bien visibles sur le plan jour, nuit et les photos IGN. */
export const ARROW_COLORS = Object.freeze({
  bleu: { label: 'Bleu', fill: '#0b57d0', stroke: '#ffffff' },
  vert: { label: 'Vert', fill: '#127a35', stroke: '#ffffff' },
  orange: { label: 'Orange', fill: '#f08a00', stroke: '#000000' },
  violet: { label: 'Violet', fill: '#7b2fbf', stroke: '#ffffff' },
});
/**
 * « auto » (phase 2c-a, couleurs Panier Perdu) : noire bordée d'ambre le jour (fond crème), ambre bordée de noir la
 * nuit (fond presque noir). Pas un choix de la liste : seulement la valeur par défaut.
 */
export const AUTO_ARROW = Object.freeze({
  day: Object.freeze({ label: 'Auto (jour)', fill: '#14161c', stroke: '#e8a93b' }),
  night: Object.freeze({ label: 'Auto (nuit)', fill: '#e8a93b', stroke: '#14161c' }),
});
export const DEFAULT_ARROW_COLOR = 'auto';

export function sanitizeArrowColor(x) {
  return x === 'auto' || Object.hasOwn(ARROW_COLORS, x) ? x : DEFAULT_ARROW_COLOR;
}

/** Couleurs de la flèche à appliquer selon le choix et le thème. */
export function arrowColors(choice, theme) {
  const c = sanitizeArrowColor(choice);
  if (c === 'auto') return theme === 'night' ? AUTO_ARROW.night : AUTO_ARROW.day;
  return ARROW_COLORS[c];
}

/** Vitesse de la voix (SpeechSynthesisUtterance.rate : 0,1 à 10, 1 = normale) ; plage utile en cabine. */
export const VOICE_RATE = Object.freeze({ min: 0.7, max: 1.5, step: 0.1, default: 1 });
/** Volume de la voix (SpeechSynthesisUtterance.volume : 0 à 1) ; jamais muet ici (bouton Voix pour couper). */
export const VOICE_VOLUME = Object.freeze({ min: 0.2, max: 1, step: 0.1, default: 1 });

const clampStep = (x, { min, max, step, default: d }) => {
  const n = typeof x === 'string' ? Number(x.replace(',', '.')) : x;
  if (typeof n !== 'number' || !Number.isFinite(n)) return d;
  const snapped = Math.round(Math.round(n / step) * step * 100) / 100; // pas de 0,1, sans 0,30000000000000004
  return Math.min(max, Math.max(min, snapped));
};

export const sanitizeVoiceRate = (x) => clampStep(x, VOICE_RATE);
export const sanitizeVoiceVolume = (x) => clampStep(x, VOICE_VOLUME);

/** Nom de la voix choisie ('' = automatique : meilleure voix française). */
export function sanitizeVoiceName(x) {
  return typeof x === 'string' ? x.trim().slice(0, 200) : '';
}
