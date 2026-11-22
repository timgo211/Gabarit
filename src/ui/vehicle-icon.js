// Repère du véhicule sur la carte (phase 2c) : flèche posée sur un halo rond dans le plan de la carte (vu ovale avec
// l'inclinaison du guidage), ombre douce. Registre d'icônes : seule la flèche existe ; l'icône camion (Bloc 2,
// personnalisation) s'ajoutera ici sans toucher à map.js. Couleurs : --arrow-fill / --arrow-stroke (Réglages 7c).

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** Formes de la flèche (viewBox 0 0 64 64, pointe vers le haut). */
export const VEHICLE_ICONS = Object.freeze({
  arrow: 'M32 10 L48 50 L32 41 L16 50 Z',
});
export const DEFAULT_VEHICLE_ICON = 'arrow';

/** Élément HTML du repère : halo, ombre, flèche (cap connu) ou pastille (cap inconnu). */
export function vehicleElement(kind = DEFAULT_VEHICLE_ICON) {
  const node = document.createElement('div');
  node.className = 'me-marker no-heading';
  node.dataset.icon = Object.hasOwn(VEHICLE_ICONS, kind) ? kind : DEFAULT_VEHICLE_ICON;
  const svg = svgEl('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
  svg.append(
    svgEl('circle', { cx: 32, cy: 32, r: 30, class: 'me-halo' }),
    svgEl('ellipse', { cx: 32, cy: 36, rx: 15, ry: 9, class: 'me-shadow' }),
    svgEl('path', { d: VEHICLE_ICONS[node.dataset.icon], class: 'me-arrow' }),
    svgEl('circle', { cx: 32, cy: 32, r: 11, class: 'me-dot' }),
  );
  node.append(svg);
  return node;
}
