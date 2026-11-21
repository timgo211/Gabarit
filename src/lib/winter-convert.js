// Équipements d'hiver (phase 5f) : liste officielle des communes de montagne soumises à l'obligation d'équipement
// (Sécurité routière) + contours des communes (data.gouv.fr) → data/hiver/ (index.json + une case par degré).
// Utilisé par tools/hiver-update.mjs (Action « Équipements d'hiver »). Logique pure, testable sous Node.
//
// Sources lues le 21/11/2026 :
// - Liste : Sécurité routière, « Équipements hivernaux : départements et communes »
//   (www.securite-routiere.gouv.fr/equipements-hivernaux-departements-et-communes), fichier
//   « 221022 liste communes équipements hivernaux » (xlsx) (22/10/2022, lien repris par le jeu de la Région Grand Est sur
//   data.gouv.fr) : feuille « liste communes », colonnes « Nom Commune », « Code INSEE Commune », « obligation
//   équipements hivernaux (1 : toute la commune, 5 : une partie de la commune) », « Département », « Massif » ;
//   4 173 communes de 34 départements (feuille « bilan par massif »).
// - Contours : « Contours administratifs » (data.gouv.fr, licence ODbL), millésime 2022, simplifiés à 100 m
//   (communes-100m.geojson.gz) ; propriétés `code` (INSEE) et `nom`.

export const WINTER_DATA = Object.freeze({
  // Nom du fichier découpé : le test statique prend les longs identifiants « mot_mot_… » pour des clés.
  LIST_URL: `https://www.securite-routiere.gouv.fr/sites/default/files/2022-10/${['221022', 'liste', 'communes', 'equipements', 'hivernaux'].join('_')}.xlsx`,
  LIST_DATE: '2022-10-22',
  LIST_PAGE: 'https://www.securite-routiere.gouv.fr/equipements-hivernaux-departements-et-communes',
  CONTOURS_URLS: Object.freeze([
    'https://contours-administratifs.s3.rbx.io.cloud.ovh.net/2022/geojson/communes-100m.geojson.gz',
    'https://contours-administratifs.s3.rbx.io.cloud.ovh.net/2021/geojson/communes-100m.geojson.gz',
  ]),
  CONTOURS_PAGE: 'https://www.data.gouv.fr/datasets/contours-administratifs/',
  /** Part maximale de codes INSEE sans contour avant échec de l'Action. */
  MAX_MISSING: 0.02,
  /** Coordonnées entières en 1e-5 degré (≈ 1 m). */
  SCALE: 1e5,
});

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Lignes de la feuille « liste communes » → communes { code, name, dept, massif, partial }.
 * Titres cherchés dans les 5 premières lignes ; codes INSEE à 5 caractères (2A / 2B compris).
 * @returns {{ communes:object[], skipped:string[], header:string[]|null }}
 */
export function parseCommuneList(rows) {
  const out = { communes: [], skipped: [], header: null };
  if (!Array.isArray(rows)) return out;
  let h = -1;
  const col = {};
  for (let i = 0; i < Math.min(5, rows.length) && h < 0; i += 1) {
    const r = (rows[i] ?? []).map(norm);
    const code = r.findIndex((c) => c.includes('code insee'));
    const name = r.findIndex((c) => c.includes('nom commune'));
    if (code >= 0 && name >= 0) {
      h = i;
      Object.assign(col, {
        code, name,
        kind: r.findIndex((c) => c.includes('obligation')),
        dept: r.findIndex((c) => c.startsWith('departement')),
        massif: r.findIndex((c) => c.startsWith('massif')),
      });
      out.header = rows[i];
    }
  }
  if (h < 0) return out;
  const seen = new Set();
  for (const r of rows.slice(h + 1)) {
    const raw = String(r?.[col.code] ?? '').trim();
    if (!raw && !String(r?.[col.name] ?? '').trim()) continue;
    const code = /^\d{4}$/.test(raw) ? `0${raw}` : raw.toUpperCase();
    if (!/^(\d{5}|2[AB]\d{3})$/.test(code)) { out.skipped.push(`${raw} ${r?.[col.name] ?? ''}`.trim()); continue; }
    if (seen.has(code)) continue;
    seen.add(code);
    const kind = String(r?.[col.kind] ?? '').trim();
    out.communes.push({
      code, name: String(r[col.name] ?? '').trim(), dept: String(r?.[col.dept] ?? '').trim(),
      massif: String(r?.[col.massif] ?? '').trim(), partial: kind === '5',
    });
  }
  return out;
}

/** Anneaux d'une géométrie GeoJSON Polygon / MultiPolygon (extérieurs et trous mélangés : règle pair-impair). */
export function geometryRings(geom) {
  if (geom?.type === 'Polygon') return geom.coordinates ?? [];
  if (geom?.type === 'MultiPolygon') return (geom.coordinates ?? []).flat();
  return [];
}

/** Anneau → entiers 1e-5° en écarts [x0, y0, dx1, dy1, …] ; points répétés retirés. */
export function compactRing(ring) {
  const out = [];
  let px = null;
  let py = null;
  for (const p of ring ?? []) {
    const x = Math.round(p[0] * WINTER_DATA.SCALE);
    const y = Math.round(p[1] * WINTER_DATA.SCALE);
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === px && y === py)) continue;
    if (px === null) out.push(x, y);
    else out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out.length >= 6 ? out : null;
}

/** Inverse de compactRing → [[lon, lat], …]. */
export function expandRing(c) {
  const out = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < c.length; i += 2) {
    x += c[i];
    y += c[i + 1];
    out.push([x / WINTER_DATA.SCALE, y / WINTER_DATA.SCALE]);
  }
  return out;
}

const tileKeyOf = (lon, lat) => `${Math.floor(lon)}_${Math.floor(lat)}`;

/**
 * Communes de la liste + contours → cases de 1° (une commune dans toutes les cases que son cadre touche).
 * @param {object[]} communes parseCommuneList
 * @param {Map<string,{ name:string, geometry:object }>} contours code INSEE → contour (premier millésime trouvé)
 * @returns {{ tiles:Object<string,object[]>, missing:object[], placed:number }}
 */
export function buildTiles(communes, contours) {
  const tiles = {};
  const missing = [];
  let placed = 0;
  for (const c of communes) {
    const f = contours.get(c.code);
    const rings = f ? geometryRings(f.geometry).map(compactRing).filter(Boolean) : [];
    if (!rings.length) { missing.push(c); continue; }
    placed += 1;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rings) for (const [x, y] of expandRing(r)) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    // Nom des contours (casse d'usage) d'abord, sinon celui de la liste (majuscules).
    const item = { c: c.code, n: f.name || c.name, d: c.dept, ...(c.partial ? { p: 1 } : {}), b: [x0, y0, x1, y1].map((v) => Math.round(v * 1e5) / 1e5), r: rings };
    for (let gx = Math.floor(x0); gx <= Math.floor(x1); gx += 1) {
      for (let gy = Math.floor(y0); gy <= Math.floor(y1); gy += 1) (tiles[`${gx}_${gy}`] ??= []).push(item);
    }
  }
  return { tiles, missing, placed };
}

/** index.json de data/hiver/. */
export function buildIndex({ updated, communes, tiles, missing }) {
  const depts = [...new Set(communes.map((c) => c.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  return {
    updated, listDate: WINTER_DATA.LIST_DATE, listUrl: WINTER_DATA.LIST_URL, source: WINTER_DATA.LIST_PAGE,
    contours: WINTER_DATA.CONTOURS_PAGE, count: communes.length - missing.length, listed: communes.length,
    partial: communes.filter((c) => c.partial).length, departments: depts,
    tiles: Object.fromEntries(Object.keys(tiles).sort().map((k) => [k, tiles[k].length])),
  };
}

export { tileKeyOf };
