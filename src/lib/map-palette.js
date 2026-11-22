// Fond de carte aux couleurs Panier Perdu (phase 2c-a). Logique pure, sans DOM.
// Le style OpenFreeMap (liberty le jour, dark la nuit ; schéma OpenMapTiles) ou VersaTiles en secours (schéma
// Shortbread) est recoloré à son chargement : seules les propriétés « *-color » changent, jamais les largeurs, les
// opacités, les filtres ni l'ordre des couches. Une couche non reconnue reste telle quelle.

export const MAP_PALETTE = Object.freeze({
  day: Object.freeze({
    background: '#EDEAE3', land: '#E2DED5', building: '#D8D5CD', water: '#C9D3D3', park: '#D9DFCB',
    road: '#FAF8F3', roadCasing: '#A9A79E', major: '#FFFFFF', majorCasing: '#7E7A70',
    label: '#2B2E37', halo: '#EDEAE3',
  }),
  night: Object.freeze({
    background: '#14161C', land: '#1C1F28', building: '#22252F', water: '#17222C', park: '#1B2620',
    road: '#1C1F28', roadCasing: '#3A3E4A', major: '#2B2E37', majorCasing: '#6B6E78',
    label: '#A9A79E', halo: '#14161C',
  }),
});

/** Largeurs (px) du tracé choisi : le bord sombre dépasse de 2 px de chaque côté, à tous les zooms. */
export const ROUTE_WIDTH = Object.freeze({ line: 7, casing: 11, altLine: 5, altCasing: 9 });

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
export function mapPaintPatches(layers, theme, keep = []) {
  const pal = MAP_PALETTE[theme === 'night' ? 'night' : 'day'];
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
export function recolorStyle(style, theme, keep = []) {
  if (!style || !Array.isArray(style.layers)) return style;
  const byId = new Map();
  for (const p of mapPaintPatches(style.layers, theme, keep)) {
    if (!byId.has(p.id)) byId.set(p.id, {});
    byId.get(p.id)[p.prop] = p.value;
  }
  return {
    ...style,
    layers: style.layers.map((l) => (byId.has(l.id) ? { ...l, paint: { ...(l.paint ?? {}), ...byId.get(l.id) } } : l)),
  };
}
