// Flèches sur le tracé en guidage (v53) : chevrons blancs dans le sens de la marche et pastille blanche à flèche noire
// à chaque point de manœuvre. Dessins maison (formes simples sur un canvas), jamais une icône copiée. Bord #14161C
// (noir Panier Perdu, comme le bord du tracé) : lisibles sur le tracé ambre, de jour, de nuit et sur les photos.
// Images ajoutées une fois par style (`styleimagemissing` après setStyle) ; aucun redessin par position.

export const CHEVRON_IMAGE = 'gabarit-chevron';
export const TURN_IMAGE = 'gabarit-turn';
const EDGE = '#14161C';
const WHITE = '#FFFFFF';

function canvas(size) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  return { cv, g: cv.getContext('2d') };
}

/** Chevron « › » pointant vers la droite (MapLibre aligne la droite de l'image sur le sens de la ligne). */
export function chevronImage() {
  const size = 36; // pixelRatio 2 → 18 px à l'écran
  const { g } = canvas(size);
  if (!g) return null;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const path = () => { g.beginPath(); g.moveTo(12, 8); g.lineTo(24, 18); g.lineTo(12, 28); };
  g.strokeStyle = EDGE; g.lineWidth = 9; path(); g.stroke();
  g.strokeStyle = WHITE; g.lineWidth = 5; path(); g.stroke();
  return g.getImageData(0, 0, size, size);
}

/** Pastille blanche, bord noir, flèche noire vers le haut (tournée par icon-rotate selon le cap de sortie). */
export function turnImage() {
  const size = 56; // pixelRatio 2 → 28 px
  const { g } = canvas(size);
  if (!g) return null;
  const c = size / 2;
  g.beginPath(); g.arc(c, c, c - 2, 0, 2 * Math.PI);
  g.fillStyle = WHITE; g.fill();
  g.lineWidth = 3; g.strokeStyle = EDGE; g.stroke();
  g.fillStyle = EDGE;
  g.beginPath();
  g.moveTo(c, 11); g.lineTo(c + 11, 25); g.lineTo(c + 4, 25); g.lineTo(c + 4, 44);
  g.lineTo(c - 4, 44); g.lineTo(c - 4, 25); g.lineTo(c - 11, 25); g.closePath();
  g.fill();
  return g.getImageData(0, 0, size, size);
}
