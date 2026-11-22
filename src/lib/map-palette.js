// Fond de carte aux couleurs Panier Perdu (phase 2c-a). Logique pure, sans DOM.
// Le style OpenFreeMap (liberty le jour, dark la nuit ; schéma OpenMapTiles) ou VersaTiles en secours (schéma
// Shortbread) est recoloré à son chargement : seules les propriétés « *-color » changent, jamais les largeurs, les
// opacités, les filtres ni l'ordre des couches. Une couche non reconnue reste telle quelle.

const DAY = Object.freeze({
  background: '#EDEAE3', land: '#E2DED5', building: '#D8D5CD', water: '#C9D3D3', park: '#D9DFCB',
  road: '#FAF8F3', roadCasing: '#A9A79E', major: '#FFFFFF', majorCasing: '#7E7A70',
  label: '#2B2E37', halo: '#EDEAE3',
});

/**
 * Nuit, trois niveaux de luminosité (phase 2d, Réglages › Affichage). Gris de la gamme Panier Perdu déjà employés
 * dans l'interface (#14161C, #1C1F28, #22252F, #2B2E37, #3A3E4A, #4A4E5A, #5C5F69, #6B6E78, #7E7A70, #A9A79E,
 * #EDEAE3) ; seules l'eau et la verdure gardent une pointe de bleu / vert (mêmes teintes que la v35, éclaircies).
 * - dark : la nuit de la v35, à l'identique.
 * - normal (défaut) : fond et routes un cran plus clairs, libellés crème : fond, terre, bâti et routes bien séparés.
 * - light : routes nettement visibles (≥ 3:1 sur le fond, comme le tracé ambre) ; libellés crème sur halo du fond.
 */
export const NIGHT_PALETTES = Object.freeze({
  dark: Object.freeze({
    background: '#14161C', land: '#1C1F28', building: '#22252F', water: '#17222C', park: '#1B2620',
    road: '#1C1F28', roadCasing: '#3A3E4A', major: '#2B2E37', majorCasing: '#6B6E78',
    label: '#A9A79E', halo: '#14161C',
  }),
  normal: Object.freeze({
    background: '#22252F', land: '#2B2E37', building: '#3A3E4A', water: '#1C2A36', park: '#232F28',
    road: '#4A4E5A', roadCasing: '#6B6E78', major: '#5C5F69', majorCasing: '#A9A79E',
    label: '#EDEAE3', halo: '#22252F',
  }),
  light: Object.freeze({
    background: '#2B2E37', land: '#343844', building: '#4A4E5A', water: '#253747', park: '#2D3D33',
    road: '#7E7A70', roadCasing: '#4A4E5A', major: '#A9A79E', majorCasing: '#5C5F69',
    label: '#EDEAE3', halo: '#2B2E37',
  }),
});

/** Niveaux de luminosité de la carte la nuit (Sombre, Normal, Clair) ; Normal par défaut (phase 2d). */
export const NIGHT_LEVELS = Object.freeze(['dark', 'normal', 'light']);
export const DEFAULT_NIGHT_LEVEL = 'normal';
export const NIGHT_LEVEL_LABELS = Object.freeze({ dark: 'Sombre', normal: 'Normal', light: 'Clair' });

export function sanitizeNightLevel(x) {
  return NIGHT_LEVELS.includes(x) ? x : DEFAULT_NIGHT_LEVEL;
}

/** Palette du jour et de la nuit au niveau par défaut (Normal). */
export const MAP_PALETTE = Object.freeze({ day: DAY, night: NIGHT_PALETTES[DEFAULT_NIGHT_LEVEL] });

/** Palette à appliquer selon le thème et, la nuit, le niveau de luminosité. */
export function mapPalette(theme, level = DEFAULT_NIGHT_LEVEL) {
  return theme === 'night' ? NIGHT_PALETTES[sanitizeNightLevel(level)] : DAY;
}

/** Largeurs (px) du tracé choisi : le bord sombre dépasse de 2 px de chaque côté, à tous les zooms. */
export const ROUTE_WIDTH = Object.freeze({ line: 7, casing: 11, altLine: 5, altCasing: 9 });
/** Guidage (phase 2c) : tracé épais, même bord de 2 px ; partie parcourue (grise) de la même largeur. */
export const ROUTE_WIDTH_NAV = Object.freeze({ line: 12, casing: 16, done: 12, doneCasing: 16 });

const WATER = /^(water|waterway|water_polygons|water_lines|ocean)$/;
const PARK = /park|wood|forest|grass|meadow|wetland|scrub|pitch|cemetery|garden|golf|farmland|orchard|vineyard|heath/;
const ROADS = /^(transportation|streets|street_polygons)$/;
const SKIP_ROAD = /rail|tram|subway|ferry|pier|aerialway|hatching|dash|arrow|oneway|pattern/;
const MAJOR = /motorway|trunk|primary|major/;
const CASING = /casing|outline/;
const LAND = /^(landuse|landcover|land|sites|aeroway|street_polygons)$/;

/**
 * Rôle d'une couche dans la palette, ou null (laissée telle quelle).
 * @param {{ id:string, type:string, 'source-layer'?:string }} layer
 */
export function layerRole(layer) {
  const id = String(layer?.id ?? '').toLowerCase();
  const src = String(layer?.['source-layer'] ?? '').toLowerCase();
  const type = layer?.type;
  if (type === 'background') return 'background';
  if (type === 'symbol') return /shield/.test(id) ? null : 'label';
  if (WATER.test(src)) return type === 'fill' || type === 'line' ? 'water' : null;
  if (/^building/.test(src)) return type === 'fill' || type === 'fill-extrusion' ? 'building' : null;
  if (src === 'park') return type === 'fill' ? 'park' : null;
  if (ROADS.test(src) && type === 'line') {
    if (SKIP_ROAD.test(id)) return null;
    const major = MAJOR.test(id);
    if (CASING.test(id)) return major ? 'majorCasing' : 'roadCasing';
    return major ? 'major' : 'road';
  }
  if (LAND.test(src) && type === 'fill') return PARK.test(id) ? 'park' : 'land';
  return null;
}

/** Propriétés de couleur réécrites pour chaque type de couche. */
const PROPS = {
  background: ['background-color'],
  fill: ['fill-color', 'fill-outline-color'],
  'fill-extrusion': ['fill-extrusion-color'],
  line: ['line-color'],
  symbol: ['text-color', 'text-halo-color'],
};

/**
 * Couleurs à appliquer : [{ id, prop, value }]. Les couches dont l'id est dans `keep` (nos tracés, ZFE, photos IGN)
 * ne sont jamais touchées. Une propriété absente de la couche n'est ajoutée que si elle est indispensable
 * (couleur de fond, de ligne ou de texte), pas le contour des surfaces ni le halo.
 */
export function mapPaintPatches(layers, theme, keep = [], level = DEFAULT_NIGHT_LEVEL) {
  const pal = mapPalette(theme, level);
  const skip = new Set(keep);
  const out = [];
  for (const l of Array.isArray(layers) ? layers : []) {
    if (!l || skip.has(l.id)) continue;
    const role = layerRole(l);
    if (!role) continue;
    const paint = l.paint ?? {};
    for (const prop of PROPS[l.type] ?? []) {
      const optional = prop === 'fill-outline-color' || prop === 'text-halo-color';
      if (optional && !(prop in paint)) continue;
      const value = role === 'label' ? (prop === 'text-color' ? pal.label : pal.halo) : pal[role];
      out.push({ id: l.id, prop, value });
    }
  }
  return out;
}

/** Copie du style JSON recolorée (pour l'option transformStyle de setStyle). */
export function recolorStyle(style, theme, keep = [], level = DEFAULT_NIGHT_LEVEL) {
  if (!style || !Array.isArray(style.layers)) return style;
  const byId = new Map();
  for (const p of mapPaintPatches(style.layers, theme, keep, level)) {
    if (!byId.has(p.id)) byId.set(p.id, {});
    byId.get(p.id)[p.prop] = p.value;
  }
  return {
    ...style,
    layers: style.layers.map((l) => (byId.has(l.id) ? { ...l, paint: { ...(l.paint ?? {}), ...byId.get(l.id) } } : l)),
  };
}

// ───────── Guidage (phase 2c) ─────────

/**
 * Bulles des noms de rues pendant le guidage : petites étiquettes arrondies, à plat face à l'écran, au milieu de
 * chaque tronçon. Couleurs de la palette (crème bordé de gris le jour, gris foncé bordé de gris la nuit, un cran
 * au-dessus du fond du niveau de luminosité choisi).
 */
export const NIGHT_BUBBLES = Object.freeze({
  dark: Object.freeze({ fill: '#1C1F28', border: '#6B6E78', text: '#EDEAE3' }),
  normal: Object.freeze({ fill: '#2B2E37', border: '#A9A79E', text: '#EDEAE3' }),
  light: Object.freeze({ fill: '#3A3E4A', border: '#A9A79E', text: '#EDEAE3' }),
});
export const STREET_BUBBLE = Object.freeze({
  image: 'gabarit-bubble',
  day: Object.freeze({ fill: '#FAF8F3', border: '#7E7A70', text: '#14161C' }),
  night: NIGHT_BUBBLES[DEFAULT_NIGHT_LEVEL],
});

/** Couleurs des bulles selon le thème et le niveau de nuit. */
export function bubbleColors(theme, level = DEFAULT_NIGHT_LEVEL) {
  return theme === 'night' ? NIGHT_BUBBLES[sanitizeNightLevel(level)] : STREET_BUBBLE.day;
}
const STREET_SOURCES = /^(transportation_name|street_labels)$/;

/** Couches de noms de rues du fond (OpenMapTiles ou Shortbread), sans les cartouches de références. */
export function streetLabelLayers(layers) {
  return (Array.isArray(layers) ? layers : []).filter((l) => l?.type === 'symbol'
    && STREET_SOURCES.test(String(l['source-layer'] ?? '')) && !/shield|ref/.test(String(l.id).toLowerCase()));
}

/**
 * Réglages des noms de rues : bulles en guidage (`on`), réglages d'origine du style sinon.
 * @returns {{ id:string, kind:'layout'|'paint', prop:string, value:any }[]}
 */
export function streetBubblePatches(layers, theme, on, level = DEFAULT_NIGHT_LEVEL) {
  const c = bubbleColors(theme, level);
  const out = [];
  for (const l of streetLabelLayers(layers)) {
    const lay = l.layout ?? {};
    // Réglage d'origine, ou undefined : MapLibre remet alors la valeur par défaut.
    const orig = (p) => lay[p];
    const layout = on ? {
      'symbol-placement': 'line-center', 'icon-image': STREET_BUBBLE.image, 'icon-text-fit': 'both',
      'icon-text-fit-padding': [3, 8, 3, 8], 'icon-rotation-alignment': 'viewport', 'text-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport', 'text-pitch-alignment': 'viewport',
    } : {
      'symbol-placement': orig('symbol-placement'), 'icon-image': orig('icon-image'),
      'icon-text-fit': orig('icon-text-fit'), 'icon-text-fit-padding': orig('icon-text-fit-padding'),
      'icon-rotation-alignment': orig('icon-rotation-alignment'), 'text-rotation-alignment': orig('text-rotation-alignment'),
      'icon-pitch-alignment': orig('icon-pitch-alignment'), 'text-pitch-alignment': orig('text-pitch-alignment'),
    };
    for (const [prop, value] of Object.entries(layout)) out.push({ id: l.id, kind: 'layout', prop, value });
    if (on) {
      out.push({ id: l.id, kind: 'paint', prop: 'text-color', value: c.text });
      out.push({ id: l.id, kind: 'paint', prop: 'text-halo-width', value: 0 });
    }
  }
  return out;
}

/**
 * Photos IGN la nuit : même image, assombrie (pas d'éblouissement). Phase 2d : 0,6 (Sombre, = v35), 0,8 (Normal),
 * 0,9 (Clair).
 */
export const SATELLITE_NIGHT_BRIGHTNESS = Object.freeze({ dark: 0.6, normal: 0.8, light: 0.9 });
export function satellitePaint(theme, level = DEFAULT_NIGHT_LEVEL) {
  return { 'raster-brightness-max': theme === 'night' ? SATELLITE_NIGHT_BRIGHTNESS[sanitizeNightLevel(level)] : 1 };
}

/** Libellés sur les photos la nuit : clairs, halo noir (lisibles sur l'image assombrie). */
export const PHOTO_NIGHT_LABEL = Object.freeze({ text: '#EDEAE3', halo: '#14161C' });

/** Couleurs des libellés selon les photos et le thème : [{ id, prop, value }] (le reste : mapPaintPatches). */
export function photoLabelPatches(layers, theme, photos, keep = [], level = DEFAULT_NIGHT_LEVEL) {
  const skip = new Set(keep);
  const pal = mapPalette(theme, level);
  const night = photos && theme === 'night';
  const out = [];
  for (const l of Array.isArray(layers) ? layers : []) {
    if (!l || skip.has(l.id) || layerRole(l) !== 'label') continue;
    out.push({ id: l.id, prop: 'text-color', value: night ? PHOTO_NIGHT_LABEL.text : pal.label });
    out.push({ id: l.id, prop: 'text-halo-color', value: night ? PHOTO_NIGHT_LABEL.halo : pal.halo });
  }
  return out;
}
