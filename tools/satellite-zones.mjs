// Phase 7d : zones couvertes par les photos aériennes hors de France (src/lib/satellite-zones.js, généré).
// Contours Natural Earth 1:10m (pays « admin 0 » et subdivisions « admin 1 »), domaine public
// (https://www.naturalearthdata.com/about/terms-of-use/, https://github.com/nvkelso/natural-earth-vector, LICENSE.md
// lu le 23/11/2026 : « Everything here is public domain »). Simplifiés (Douglas-Peucker, ~300 m) : la zone sert
// seulement à choisir la source de photos d'après le centre de la carte, la France (IGN) restant prioritaire.
//
// Usage (fichiers GeoJSON de natural-earth-vector/geojson/) :
//   node tools/satellite-zones.mjs ne_10m_admin_0_countries.geojson ne_10m_admin_1_states_provinces.geojson ID…
// ID : code ISO du pays (LU, CH, ES), d'une subdivision (DE-SL, BE-BRU) ou d'une région belge (BE-VL, BE-WA).
import { readFile, writeFile } from 'node:fs/promises';

const TOLERANCE = 0.003; // degrés
const OUT = new URL('../src/lib/satellite-zones.js', import.meta.url);
const BE_REGIONS = { 'BE-VL': 'Flemish', 'BE-WA': 'Walloon' };

function dp(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a]; const [bx, by] = points[b];
    const dx = bx - ax; const dy = by - ay; const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1; let dmax = 0;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > dmax) { dmax = d; best = i; }
    }
    if (dmax > tol && best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

/** Anneau fermé : coupé au point le plus éloigné du premier, chaque moitié simplifiée. */
function simplifyRing(ring, tol) {
  const [x0, y0] = ring[0];
  let far = 1;
  for (let i = 1; i < ring.length - 1; i += 1) {
    if (Math.hypot(ring[i][0] - x0, ring[i][1] - y0) > Math.hypot(ring[far][0] - x0, ring[far][1] - y0)) far = i;
  }
  const first = dp(ring.slice(0, far + 1), tol);
  const second = dp(ring.slice(far), tol);
  return [...first, ...second.slice(1)];
}

/** Polygones [[extérieur, trous…], …] simplifiés ; anneaux trop petits retirés. */
function polygons(geometry) {
  const list = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return list
    .map((poly) => poly.map((ring) => simplifyRing(ring, TOLERANCE).map(round)).filter((ring) => ring.length >= 4))
    .filter((poly) => poly.length > 0);
}

const [a0, a1, ...ids] = process.argv.slice(2);
if (!a0 || !a1 || !ids.length) {
  console.error('Usage : node tools/satellite-zones.mjs admin0.geojson admin1.geojson ID…');
  process.exit(1);
}
const countries = JSON.parse(await readFile(a0, 'utf8')).features;
const states = JSON.parse(await readFile(a1, 'utf8')).features;
const zones = {};
for (const id of ids) {
  let feats;
  if (BE_REGIONS[id]) feats = states.filter((f) => f.properties.adm0_a3 === 'BEL' && f.properties.region === BE_REGIONS[id]);
  else if (id.includes('-')) feats = states.filter((f) => f.properties.iso_3166_2 === id);
  else feats = countries.filter((f) => f.properties.ISO_A2 === id || f.properties.ISO_A2_EH === id);
  if (!feats.length) { console.error(`Zone introuvable : ${id}`); process.exit(1); }
  zones[id] = feats.flatMap((f) => polygons(f.geometry));
}
const body = `// Généré par tools/satellite-zones.mjs — ne pas modifier à la main.
// Contours Natural Earth 1:10m (domaine public), simplifiés à ~300 m : zones des photos aériennes hors de France
// (phase 7d, src/lib/map-layers.js). [lon, lat] ; chaque zone = liste de polygones [extérieur, trous…].
export const SATELLITE_ZONES = Object.freeze(${JSON.stringify(zones)});
`;
await writeFile(OUT, body);
console.log(`${ids.length} zones, ${body.length} octets → src/lib/satellite-zones.js`);
