// Pictogramme de manœuvre en SVG (flèche orientée, rond-point numéroté, demi-tour, arrivée).
// La forme vient de maneuverIcon() (src/lib/nav-guidance.js).

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** Pointe de flèche (triangle) en (x, y), orientée selon angle (degrés, 0 = vers le haut). */
function head(x, y, angle) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const tip = [x + dx * 16, y + dy * 16];
  const l = [x - dy * 15, y + dx * 15];
  const r = [x + dy * 15, y - dx * 15];
  return svgEl('path', { d: `M${tip} L${l} L${r} Z`, class: 'ico-fill' });
}

/** @param {{ kind:string, angle:number, exit:number|null }} icon */
export function maneuverSvg(icon) {
  const svg = svgEl('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
  const stroke = (d) => svgEl('path', { d, class: 'ico-stroke' });
  const kind = icon?.kind ?? 'arrow';
  if (kind === 'goal') {
    svg.append(
      stroke('M30 92 L30 14'),
      svgEl('path', { d: 'M30 16 L78 16 L70 32 L78 48 L30 48 Z', class: 'ico-fill' }),
    );
  } else if (kind === 'uturn') {
    // En France, demi-tour par la gauche : on monte à droite, on revient à gauche.
    svg.append(stroke('M64 92 L64 42 A18 18 0 0 0 28 42 L28 62'), head(28, 64, 180));
  } else if (kind === 'roundabout') {
    svg.append(
      svgEl('circle', { cx: 50, cy: 46, r: 22, class: 'ico-stroke' }),
      stroke('M50 92 L50 70'),
    );
    if (Number.isInteger(icon.exit)) {
      const t = svgEl('text', { x: 50, y: 56, 'text-anchor': 'middle', class: 'ico-text' });
      t.textContent = String(icon.exit);
      svg.append(t);
    }
  } else {
    const a = ((icon?.angle ?? 0) * Math.PI) / 180;
    const len = Math.abs(icon?.angle ?? 0) < 1 ? 40 : 30;
    const ex = 50 + Math.sin(a) * len;
    const ey = 52 - Math.cos(a) * len;
    svg.append(stroke(`M50 94 L50 52 L${ex.toFixed(1)} ${ey.toFixed(1)}`), head(ex, ey, icon?.angle ?? 0));
  }
  return svg;
}
