// Repères « P » des aires PL selon le zoom (v62). Logique pure, sans DOM : la carte fournit la projection en pixels.
//
// Règle (testeur : le repère d'une étape était caché par les P) :
// - zoom < 8 : aucun P (à cette échelle, des dizaines de P couvrent le tracé et les étapes) ;
// - 8 ≤ zoom < 11 : P regroupés par case de 64 px de l'écran → une pastille « P 3 » au centre du groupe (toucher =
//   zoom + 2 sur le groupe) ; une aire seule dans sa case reste un P normal ;
// - zoom ≥ 11 : tous les P, comme avant ;
// - l'aire sélectionnée (fiche ouverte, ligne de la liste touchée) n'est jamais cachée ni regroupée ;
// - à zoom < 11, un P seul à moins de 24 px d'un repère d'étape est masqué (l'étape reste lisible) ;
// - les repères d'étapes restent toujours au-dessus des P (z-index CSS, styles.css).
// Recalculé seulement à la fin d'un zoom ou d'un déplacement (moveend), jamais à chaque image ; à zoom ≥ 11 la
// décision ne dépend plus de la position : rien n'est redessiné en suivant le véhicule.

export const AREA_CLUSTER = Object.freeze({
  HIDE_BELOW: 8,
  ALL_FROM: 11,
  CELL_PX: 64,
  STOP_PX: 24,
  /** Zoom ajouté au toucher d'une pastille de groupe. */
  GROUP_ZOOM_STEP: 2,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Bande de zoom : 'none' (< 8), 'group' (8 à 11), 'all' (≥ 11). */
export function zoomBand(zoom) {
  if (!isNum(zoom)) return 'all';
  if (zoom < AREA_CLUSTER.HIDE_BELOW) return 'none';
  if (zoom < AREA_CLUSTER.ALL_FROM) return 'group';
  return 'all';
}

/**
 * Repères à dessiner.
 * @param {{ id:string, lonlat:number[] }[]} items aires placées
 * @param {{ zoom:number, project:(lonlat:number[])=>{x:number,y:number}, keep?:string|null, stops?:number[][] }} o
 * @returns {{ key:string, marks:({ kind:'area', item:object } | { kind:'group', items:object[], lonlat:number[] })[] }}
 *   key : identique tant que les repères à dessiner ne changent pas (la carte ne redessine rien sinon).
 */
export function clusterAreas(items, { zoom, project, keep = null, stops = [] } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((i) => Array.isArray(i?.lonlat));
  const band = zoomBand(zoom);
  const kept = list.filter((i) => keep && i.id === keep);
  if (band === 'all' || typeof project !== 'function') {
    return { key: `all:${list.map((i) => i.id).join(',')}`, marks: list.map((item) => ({ kind: 'area', item })) };
  }
  const rest = list.filter((i) => !(keep && i.id === keep));
  const marks = kept.map((item) => ({ kind: 'area', item }));
  if (band === 'none') return { key: `none:${kept.map((i) => i.id).join(',')}`, marks };
  const cell = AREA_CLUSTER.CELL_PX;
  const stopPx = (Array.isArray(stops) ? stops : []).filter(Array.isArray).map((s) => project(s));
  const cells = new Map();
  for (const item of rest) {
    const p = project(item.lonlat);
    if (!p || !isNum(p.x) || !isNum(p.y)) continue;
    const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push({ item, p });
  }
  const parts = [];
  for (const [k, group] of [...cells.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (group.length === 1) {
      const { item, p } = group[0];
      const nearStop = stopPx.some((s) => s && Math.hypot(s.x - p.x, s.y - p.y) < AREA_CLUSTER.STOP_PX);
      if (nearStop) continue;
      marks.push({ kind: 'area', item });
      parts.push(item.id);
      continue;
    }
    const lon = group.reduce((a, g) => a + g.item.lonlat[0], 0) / group.length;
    const lat = group.reduce((a, g) => a + g.item.lonlat[1], 0) / group.length;
    marks.push({ kind: 'group', items: group.map((g) => g.item), lonlat: [lon, lat] });
    parts.push(`${k}=${group.map((g) => g.item.id).join('+')}`);
  }
  return { key: `group:${kept.map((i) => i.id).join(',')}|${parts.join(',')}`, marks };
}

/** Texte de la pastille et de son étiquette. */
export function groupLabel(n) {
  return { text: `P ${n}`, aria: `${n} aires PL : toucher pour zoomer` };
}
