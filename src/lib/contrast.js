// Contraste des couleurs (phase 2c-a). Logique pure, sans DOM.
// Source : W3C, WCAG 2.2, définitions « relative luminance » et « contrast ratio »
// (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance, #dfn-contrast-ratio) ; seuils AA : texte 4,5:1
// (critère 1.4.3), gros texte et composants d'interface 3:1 (critères 1.4.3 et 1.4.11).

export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

/** '#rgb', '#rrggbb' ou 'rgb(a)(r, g, b[, a])' → { r, g, b, a } (0–255, a 0–1), ou null. */
export function parseColor(str) {
  const s = String(str ?? '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

/** Couleur (éventuellement transparente) posée sur un fond opaque. */
export function composite(top, under) {
  const a = top.a ?? 1;
  const mix = (k) => top[k] * a + under[k] * (1 - a);
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 };
}

/** Luminance relative WCAG (0 = noir, 1 = blanc). */
export function luminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Rapport de contraste (1 à 21) entre deux couleurs CSS. Un fond transparent est évalué posé sur du noir puis sur du
 * blanc (la carte dessous peut être claire ou sombre) : le plus faible des deux est rendu.
 */
export function contrastRatio(fg, bg) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return NaN;
  const unders = b.a < 1 ? [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }] : [b];
  let worst = Infinity;
  for (const u of unders) {
    const back = composite(b, u);
    const front = composite(f, back);
    const [l1, l2] = [luminance(front), luminance(back)].sort((x, y) => y - x);
    worst = Math.min(worst, (l1 + 0.05) / (l2 + 0.05));
  }
  return worst;
}

/** Variables CSS (--nom: valeur) déclarées dans les blocs dont le sélecteur est exactement `selector`. */
export function cssVars(cssText, selector) {
  const out = {};
  const text = String(cssText).replace(/\/\*[\s\S]*?\*\//g, '');
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'g');
  for (const m of text.matchAll(block)) {
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}
