/**
 * Couches du plan qui recouvrent les photos aériennes (v65).
 *
 * La couche raster des photos est glissée avant le premier libellé (symbol) du style. Dans les styles OpenFreeMap
 * (github.com/hyperknot/openfreemap-styles, lus le 24/11/2026), des aplats viennent APRÈS ce premier libellé, donc
 * par-dessus les photos :
 *  - liberty : premier symbol « road_one_way_arrow » (n° 61), puis « building » (fill, n° 83) et « building-3d »
 *    (fill-extrusion, n° 84) → bâtiments gris-beige et flancs sombres sur chaque toit ;
 *  - dark : premier symbol « water_name » (n° 8), puis « building » (fill noir, n° 9), « aeroway-area » (fill #000,
 *    n° 12), « road_area_pier » (fill, n° 14) → photo presque cachée la nuit en ville.
 * Ces aplats sont masqués tant que les photos sont montrées, puis rendus tels quels. Routes (line), libellés (symbol)
 * et couches de Gabarit (`keep` : tracé, ZFE, photos) ne sont jamais touchés.
 *
 * Logique pure, sans DOM : `src/ui/map.js` applique les patches par setLayoutProperty.
 */

/** Types de couche qui couvrent une surface (aplats) : masqués au-dessus des photos. */
const COVER_TYPES = new Set(['fill', 'fill-extrusion', 'background', 'hillshade']);

/** Vrai si la couche est un aplat du plan (ou un contour de bâtiment) à masquer au-dessus des photos. */
export function isCoverLayer(layer) {
  if (!layer || typeof layer !== 'object') return false;
  if (COVER_TYPES.has(layer.type)) return true;
  // Contours de bâtiments (styles VersaTiles) : traits qui dessinent le « film » autour de chaque toit.
  return layer.type === 'line' && /^building/.test(String(layer['source-layer'] ?? ''));
}

/**
 * Identifiants des aplats placés au-dessus de la première couche de photos (ordre du style), hors `keep`.
 * Aucune couche de photos dans le style → liste vide (rien n'est recouvert).
 */
export function photoCoverLayers(layers, satIds = [], keep = []) {
  const list = Array.isArray(layers) ? layers : [];
  const sat = new Set(satIds);
  const skip = new Set([...keep, ...satIds]);
  const first = list.findIndex((l) => l && sat.has(l.id));
  if (first < 0) return [];
  return list.slice(first + 1).filter((l) => l && !skip.has(l.id) && isCoverLayer(l)).map((l) => l.id);
}

/**
 * Visibilités à poser : { patches: [{ id, value }], hidden }.
 *  - photos montrées : chaque aplat au-dessus encore visible → 'none', retenu dans `hidden` (un aplat déjà masqué par
 *    le style lui-même n'est jamais retenu, donc jamais rallumé) ;
 *  - photos absentes (Plan, zone sans photo) : chaque couche retenue encore présente → 'visible', `hidden` vidé.
 * `hidden` (Set d'identifiants) est l'état gardé par la carte ; il repart vide à chaque nouveau style.
 */
export function photoCoverPatches(layers, { photos = false, satIds = [], keep = [], hidden = new Set() } = {}) {
  const list = Array.isArray(layers) ? layers : [];
  const done = new Set(hidden);
  const patches = [];
  if (photos) {
    const byId = new Map(list.filter(Boolean).map((l) => [l.id, l]));
    for (const id of photoCoverLayers(list, satIds, keep)) {
      if (done.has(id)) continue;
      if (byId.get(id)?.layout?.visibility === 'none') continue;
      patches.push({ id, value: 'none' });
      done.add(id);
    }
    return { patches, hidden: done };
  }
  const present = new Set(list.filter(Boolean).map((l) => l.id));
  for (const id of done) if (present.has(id)) patches.push({ id, value: 'visible' });
  return { patches, hidden: new Set() };
}
