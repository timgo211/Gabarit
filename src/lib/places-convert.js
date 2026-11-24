// Copie des lieux habités d'OpenStreetMap dans data/lieux-osm/ (phase 11c : « vers Metz » quand aucune bretelle sûre
// ne donne la direction du panneau), côté Action (tools/osm-update.mjs). Logique pure, testée sous Node. Données
// © contributeurs OpenStreetMap, licence ODbL.
//
// Même extrait, même filtrage et mêmes cases que data/directions-osm/ (5 Mo par fichier, 40 Mo en tout, jamais
// précachée ; trop gros → rien n'est écrit, l'ancienne copie reste).
// Gardés : nœuds place=city, town ou village portant `name` (wiki OSM Key:place, lu le 24/11/2026 : city > town >
// village par importance ; hamlet, isolated_dwelling, quartiers… non gardés). Un lieu OSM est un point (centre du
// lieu), pas un panneau : l'appli écrit « vers X », jamais « direction X », et ne le dit jamais à voix haute.
//
// Format (lu par parsePlaceTile, src/lib/places.js, PR B) : index.json (source, license, updated, countries, count,
// ranks, grid, tiles) + une case E_N.json par degré : { t:[noms…], p:[[i_nom, rang, x, y]] } ; rang 0 city, 1 town,
// 2 village ; coordonnées entières absolues en 1e-5 degré.

import { tileKey } from './areas-osm-data.js';
import { BRIDGES } from './bridges-convert.js';

export const PLACES = Object.freeze({
  DIR: './data/lieux-osm/',
  INDEX_PATH: './data/lieux-osm/index.json',
  REGIONS: BRIDGES.REGIONS,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 40 * 1024 * 1024,
  /** Lignes GeoJSON de l'export lues pour les lieux : au-delà, plus rien n'est gardé et rien n'est écrit. */
  MAX_SOURCE_BYTES: 256 * 1024 * 1024,
  RANKS: Object.freeze(['city', 'town', 'village']),
  MAX_NAME: 60,
});

/** Étiquettes ajoutées au filtre osmium des ponts. */
export function osmiumPlacesFilter() {
  return ['n/place=city,town,village'];
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Nom nettoyé (espaces) ; vide ou trop long → null. */
export function cleanPlaceName(text) {
  if (typeof text !== 'string') return null;
  const v = text.replace(/\s+/g, ' ').trim();
  return v && v.length <= PLACES.MAX_NAME ? v : null;
}

/** Objet GeoJSON exporté par osmium → { name, rank, at } ou null. */
export function placeFromFeature(f) {
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!t || !/^n\d+$/.test(String(f?.id ?? ''))) return null;
  const rank = PLACES.RANKS.indexOf(t.place);
  if (rank < 0) return null;
  const name = cleanPlaceName(t.name);
  const at = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
  if (!name || !Array.isArray(at) || !isNum(at[0]) || !isNum(at[1])) return null;
  return { name, rank, at: [at[0], at[1]] };
}

/** Volume lu dans l'export au-delà du plafond ? Sinon null. */
export function placeSourceProblem(bytes, max = PLACES.MAX_SOURCE_BYTES) {
  return bytes > max ? `lignes de l'export pour les lieux : ${(bytes / 1024 / 1024).toFixed(0)} Mo (plus de ${(max / 1024 / 1024).toFixed(0)} Mo)` : null;
}

/** Taille dans les limites (fichiers ≤ 5 Mo, total ≤ 40 Mo) ? Sinon le texte du journal. */
export function placeSizeProblem(sizes, maxTotal = PLACES.MAX_TOTAL_BYTES) {
  if (sizes.biggest[1] > PLACES.MAX_FILE_BYTES) return `case ${sizes.biggest[0]} de ${(sizes.biggest[1] / 1024 / 1024).toFixed(1)} Mo (plus de 5 Mo)`;
  if (sizes.total > maxTotal) return `total de ${(sizes.total / 1024 / 1024).toFixed(1)} Mo (plus de ${(maxTotal / 1024 / 1024).toFixed(0)} Mo)`;
  return null;
}

/**
 * Lieux → contenu de data/lieux-osm/, sinon problème (rien n'est écrit).
 * @returns {{ index:object|null, tiles:Map|null, log:string[], sizes:object|null, problem:string|null }}
 */
export function convertPlaces(list, { updated = null, grid = null, countries = [], maxTotal = PLACES.MAX_TOTAL_BYTES } = {}) {
  const ranks = PLACES.RANKS.map((r, i) => [r, list.filter((p) => p.rank === i).length]);
  const log = [`Lieux : ${list.length} (${ranks.map(([r, n]) => `${n} ${r}`).join(', ')}).`];
  const sortedList = list.slice().sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const tiles = new Map();
  for (const p of sortedList) {
    const key = tileKey(p.at[0], p.at[1]);
    if (!tiles.has(key)) tiles.set(key, { t: [], p: [], idx: new Map() });
    const tile = tiles.get(key);
    if (!tile.idx.has(p.name)) { tile.idx.set(p.name, tile.t.length); tile.t.push(p.name); }
    tile.p.push([tile.idx.get(p.name), p.rank, Math.round(p.at[0] * 1e5), Math.round(p.at[1] * 1e5)]);
  }
  const out = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, t]) => [k, { t: t.t, p: t.p }]));
  let total = 0;
  let biggest = ['', 0];
  for (const [k, t] of out) {
    const n = Buffer.byteLength(`${JSON.stringify(t)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [k, n];
  }
  const sizes = { total, biggest };
  const problem = placeSizeProblem(sizes, maxTotal);
  log.push(`Lieux : ${(total / 1024 / 1024).toFixed(2)} Mo, plus grosse case ${biggest[0]} (${(biggest[1] / 1024).toFixed(0)} Ko)${problem ? ` — ${problem}` : ''}.`);
  if (problem) return { index: null, tiles: null, log, sizes: null, problem };
  const index = {
    source: 'OpenStreetMap (extraits Geofabrik) : nœuds place=city, town ou village avec name',
    license: 'ODbL, © contributeurs OpenStreetMap',
    updated,
    countries,
    count: list.length,
    ranks: PLACES.RANKS,
    grid,
    tiles: Object.fromEntries([...out.entries()].map(([k, t]) => [k, t.p.length])),
  };
  return { index, tiles: out, log, sizes, problem: null };
}
