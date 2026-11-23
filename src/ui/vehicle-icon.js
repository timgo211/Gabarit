// Repère du véhicule sur la carte (phase 2c) : posé sur un halo rond dans le plan de la carte (vu ovale avec
// l'inclinaison du guidage), ombre douce. Registre d'icônes (v45) : flèche, ou camion vu de dessus (dessin original de
// Gabarit, formes simples : cabine, pare-brise, rétroviseurs, attelage, semi-remorque ; ni logo ni icône d'une autre
// appli). Même taille (60 px), même centre et même rotation au cap que la flèche (map.js). Couleurs : --arrow-fill /
// --arrow-stroke (Réglages 7c), déjà lisibles de jour, de nuit et sur les photos IGN ; pare-brise de la couleur du
// contour, pour voir l'avant.

import { DEFAULT_VEHICLE_ICON } from '../lib/prefs.js';

export { DEFAULT_VEHICLE_ICON };

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/**
 * Formes (viewBox 0 0 64 64, avant vers le haut). Chaque forme : [balise, attributs, classe].
 * Camion : semi-remorque 20 × 33 (y 23 → 56), attelage, cabine 18 × 13 à l'avant (y 7 → 20), pare-brise,
 * rétroviseurs ; emprise 18 → 46 en x (la flèche : 16 → 48), centrée sur le halo.
 */
export const VEHICLE_ICONS = Object.freeze({
  arrow: Object.freeze([['path', { d: 'M32 10 L48 50 L32 41 L16 50 Z' }, 'me-arrow']]),
  truck: Object.freeze([
    ['rect', { x: 22, y: 23, width: 20, height: 33, rx: 2.5 }, 'me-body'],
    ['rect', { x: 29, y: 19, width: 6, height: 5 }, 'me-body'],
    ['rect', { x: 23, y: 7, width: 18, height: 13, rx: 4 }, 'me-body'],
    ['rect', { x: 25.5, y: 9, width: 13, height: 3.5, rx: 1.5 }, 'me-glass'],
    ['rect', { x: 18, y: 10.5, width: 4, height: 3, rx: 1 }, 'me-body'],
    ['rect', { x: 42, y: 10.5, width: 4, height: 3, rx: 1 }, 'me-body'],
  ]),
});
export const VEHICLE_ICON_LABELS = Object.freeze({ arrow: 'Flèche', truck: 'Camion' });

/** Élément HTML du repère : halo, ombre, icône (cap connu) ou pastille (cap inconnu). */
export function vehicleElement(kind = DEFAULT_VEHICLE_ICON) {
  const node = document.createElement('div');
  node.className = 'me-marker no-heading';
  node.dataset.icon = Object.hasOwn(VEHICLE_ICONS, kind) ? kind : DEFAULT_VEHICLE_ICON;
  const svg = svgEl('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
  const icon = svgEl('g', { class: 'me-icon' });
  for (const [tag, attrs, cls] of VEHICLE_ICONS[node.dataset.icon]) icon.append(svgEl(tag, { ...attrs, class: cls }));
  svg.append(
    svgEl('circle', { cx: 32, cy: 32, r: 30, class: 'me-halo' }),
    svgEl('ellipse', { cx: 32, cy: 36, rx: 15, ry: 9, class: 'me-shadow' }),
    icon,
    svgEl('circle', { cx: 32, cy: 32, r: 11, class: 'me-dot' }),
  );
  node.append(svg);
  return node;
}
