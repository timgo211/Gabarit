// Pictogrammes des voies à prendre (phase 11d) : dessin maison, formes simples (une tige, un trait coudé et une pointe
// par flèche, plusieurs flèches superposées pour « through;right »), jamais une icône copiée. Couleur : currentColor
// (voie valide en clair, les autres grisées par la feuille de style).

const NS = 'http://www.w3.org/2000/svg';
/** Angle de la flèche (degrés, 0 = tout droit, positif = à droite). */
const ANGLE = Object.freeze({
  through: 0, slight_right: 45, right: 90, sharp_right: 135, slight_left: -45, left: -90, sharp_left: -135,
  merge_to_right: 25, merge_to_left: -25,
});

function arrowPath(value) {
  if (value === 'reverse') return { line: 'M24 46 V22 a8 8 0 0 0 -16 0 V30', head: [8, 36, 3, 28, 13, 28] };
  const a = (ANGLE[value] ?? 0) * Math.PI / 180;
  const len = value.startsWith('merge') ? 10 : 14;
  const x = 20 + len * Math.sin(a); const y = 24 - len * Math.cos(a);
  // Pointe : triangle au bout du trait, dans son sens.
  const tip = [x + 6 * Math.sin(a), y - 6 * Math.cos(a)];
  const l = [x + 5 * Math.cos(a), y + 5 * Math.sin(a)];
  const r = [x - 5 * Math.cos(a), y - 5 * Math.sin(a)];
  const f = (n) => Math.round(n * 10) / 10;
  return { line: `M20 46 V24 L${f(x)} ${f(y)}`, head: [...tip, ...l, ...r].map(f) };
}

/** Pictogramme d'une voie : ['through', 'right'] → <svg> avec deux flèches. */
export function laneSvg(values) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 48');
  svg.setAttribute('aria-hidden', 'true');
  for (const v of values) {
    const { line, head } = arrowPath(v);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', line);
    p.setAttribute('class', 'lane-stroke');
    const h = document.createElementNS(NS, 'polygon');
    h.setAttribute('points', head.join(' '));
    h.setAttribute('class', 'lane-fill');
    svg.append(p, h);
  }
  return svg;
}
