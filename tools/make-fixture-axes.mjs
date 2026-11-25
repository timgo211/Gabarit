#!/usr/bin/env node
// Reconstitution d'une réponse ORS Joigny → Gonfreville-l'Orcher pour les tests du repli par la géométrie (PR 3a).
// Aucune vraie réponse ORS de ce trajet n'est dans le dépôt et les tests n'appellent jamais l'API : le tracé est
// reconstitué à partir de data/axes-osm/ (© contributeurs OpenStreetMap, ODbL) en passant par les points du diagnostic
// v70 envoyé par le propriétaire (départ 47.97, 3.20 ; arrivée 49.51, 0.23 ; 320,8 km ; points de début d'étape et
// points tous les 10 km des étapes sans nom). Entre deux points : plus court chemin dans la copie (autoroutes
// préférées), jamais une route supposée.
//
// Étapes recopiées du diagnostic (km de début et de fin, nom renvoyé par ORS) ; début d'étape = point du tracé le plus
// proche du point de début donné par le diagnostic, sinon même écart en km depuis le dernier point connu : 0,1–72,0 sans nom ; 72,0–112,8 « A 6 » ; 112,8–115,9 et 115,9–130,1 sans nom ; 130,1–139,8 « N 12 » ;
// 139,8–146,1 et 146,1–249,5 sans nom ; 249,5–281,7 « A 13 » ; 281,7–317,5 « A 131 » ; 317,5–317,9 « N 182 » ; puis
// « D 982 » (et rues, ici une seule étape). Soit 199 km sans nom sur 320,8. Points décalés de 2 à 6 m (suite
// pseudo-aléatoire fixe), arrondis à 1e-5° comme ORS.
//
// Sorties : tests/fixtures/ors-directions-joigny-gonfreville.json et tests/fixtures/axes-osm-joigny/ (voies de la copie
// à moins de 300 m du tracé, mêmes cases). Usage : node tools/make-fixture-axes.mjs (déterministe ; à relancer seulement
// si data/axes-osm/ change ; à remplacer par une vraie réponse ORS copiée depuis le diagnostic quand elle existera).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { haversine, bearing, destinationPoint } from '../src/lib/nav-geo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data/axes-osm');
const OUT = join(ROOT, 'tests/fixtures/ors-directions-joigny-gonfreville.json');
const OUT_DIR = join(ROOT, 'tests/fixtures/axes-osm-joigny');

// Points du diagnostic v70 [lon, lat], dans l'ordre du trajet.
const POINTS = [
  [3.20, 47.97], [3.116, 48.044], [3.018, 48.106], [2.903, 48.149], [2.798, 48.204], [2.714, 48.273], [2.607, 48.325],
  [2.555, 48.405], [2.54, 48.42], [2.32, 48.73], [2.34, 48.76], [2.227, 48.777], [2.17, 48.78], [2.05, 48.80],
  [2.09, 48.84], [2.005, 48.900], [1.926, 48.964], [1.794, 48.964], [1.664, 48.987], [1.544, 49.021], [1.430, 49.060],
  [1.330, 49.120], [1.237, 49.185], [1.159, 49.255], [1.088, 49.329], [0.23, 49.51],
];
// Étapes du diagnostic : km de début, nom renvoyé par ORS (« - » = sans nom), point de début quand le diagnostic le
// donne ; fin du trajet à 320,8 km.
const STEPS = [
  [0, '-', [3.20, 47.97]], [72.0, 'A 6', [2.54, 48.42]], [112.8, '-', [2.32, 48.73]], [115.9, '-', [2.34, 48.76]],
  [130.1, 'N 12', [2.17, 48.78]], [139.8, '-', [2.05, 48.80]], [146.1, '-', [2.09, 48.84]], [249.5, 'A 13'],
  [281.7, 'A 131'], [317.5, 'N 182'], [317.9, 'D 982'],
];
const TOTAL_KM = 320.8;
const BOX = [-0.2, 47.7, 3.6, 49.7];
const SNAP_M = 50;
const KEEP_M = 300;

// ── Lecture de la copie ──
const lines = [];
const seen = new Set();
const tiles = new Map();
for (const f of readdirSync(SRC).sort()) {
  if (f === 'index.json') continue;
  const [x, y] = f.replace('.json', '').split('_').map(Number);
  if (x < Math.floor(BOX[0]) || x > BOX[2] || y < Math.floor(BOX[1]) || y > BOX[3]) continue;
  const t = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  tiles.set(f.replace('.json', ''), t);
  for (const a of t.a) {
    const ref = a[0] < 0 ? '' : t.r[a[0]];
    const k = `${ref}|${a.slice(1).join(',')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    let px = 0; let py = 0;
    const c = [];
    for (let i = 2; i < a.length; i += 2) { px += a[i]; py += a[i + 1]; c.push([px / 1e5, py / 1e5]); }
    lines.push({ ref, cls: a[1], c });
  }
}

// ── Graphe : sommets des voies, arêtes le long des voies, raccords à 25 m (pénalisés) ──
const cost = (l) => [1, 1.1, 1.4][l.cls]; // autoroute, voie rapide, primaire
const nodes = [];
const adj = [];
const grid = new Map();
const CELL = 0.0005;
const gk = (p) => `${Math.floor(p[0] / CELL)}_${Math.floor(p[1] / CELL)}`;
for (const [li, l] of lines.entries()) {
  let prev = -1;
  for (const p of l.c) {
    const id = nodes.length;
    nodes.push({ p, li });
    adj.push([]);
    const k = gk(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(id);
    if (prev >= 0) {
      const w = haversine(nodes[prev].p, p) * cost(l);
      adj[prev].push([id, w, li]);
      adj[id].push([prev, w, li]);
    }
    prev = id;
  }
}
for (const [id, nd] of nodes.entries()) {
  const [cx, cy] = gk(nd.p).split('_').map(Number);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const o of grid.get(`${cx + dx}_${cy + dy}`) ?? []) {
        if (o <= id || nodes[o].li === nd.li) continue;
        const d = haversine(nd.p, nodes[o].p);
        if (d < SNAP_M) { adj[id].push([o, d + 300, -1]); adj[o].push([id, d + 300, -1]); }
      }
    }
  }
}
// Réseau principal : plus grande composante connexe (un point du diagnostic arrondi à 0,01° peut tomber près d'un
// bout de voie isolé de la copie).
const comp = new Int32Array(nodes.length).fill(-1);
const sizes = [];
for (let s0 = 0; s0 < nodes.length; s0 += 1) {
  if (comp[s0] >= 0) continue;
  const c = sizes.length;
  let size = 0;
  const stack = [s0];
  comp[s0] = c;
  while (stack.length) {
    const i = stack.pop();
    size += 1;
    for (const [j] of adj[i]) if (comp[j] < 0) { comp[j] = c; stack.push(j); }
  }
  sizes.push(size);
}
const main = sizes.indexOf(Math.max(...sizes));
const nearest = (p) => {
  let b = -1; let bd = Infinity;
  for (const [i, nd] of nodes.entries()) {
    if (comp[i] !== main) continue;
    const d = haversine(p, nd.p);
    if (d < bd) { bd = d; b = i; }
  }
  return b;
};
function dijkstra(s, e) {
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const via = new Int32Array(nodes.length).fill(-1);
  const h = [];
  const push = (d, i) => {
    h.push([d, i]);
    let k = h.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (h[p][0] <= h[k][0]) break; [h[p], h[k]] = [h[k], h[p]]; k = p; }
  };
  const pop = () => {
    const t = h[0]; const l = h.pop();
    if (h.length) {
      h[0] = l;
      let k = 0;
      for (;;) {
        const a = 2 * k + 1; const b = a + 1; let m = k;
        if (a < h.length && h[a][0] < h[m][0]) m = a;
        if (b < h.length && h[b][0] < h[m][0]) m = b;
        if (m === k) break;
        [h[m], h[k]] = [h[k], h[m]]; k = m;
      }
    }
    return t;
  };
  dist[s] = 0; push(0, s);
  while (h.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    if (i === e) break;
    for (const [j, w, li] of adj[i]) if (d + w < dist[j]) { dist[j] = d + w; prev[j] = i; via[j] = li; push(d + w, j); }
  }
  const path = [];
  for (let i = e; i >= 0; i = prev[i]) path.push({ id: i, li: via[i] });
  return path.reverse();
}
const stops = POINTS.map(nearest);
let path = [];
for (let k = 1; k < stops.length; k += 1) {
  const part = dijkstra(stops[k - 1], stops[k]);
  if (part[0].id !== stops[k - 1]) throw new Error(`aucun chemin dans la copie entre ${POINTS[k - 1]} et ${POINTS[k]}`);
  path = path.concat(k > 1 ? part.slice(1) : part);
}
// Raccord à SNAP_M (li = -1) : la voie du point d'arrivée.
for (const q of path) if (q.li < 0) q.li = nodes[q.id].li;

// ── Tracé décalé de 2 à 6 m, sans point doublé ──
let seed = 20261125;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const coords = [];
const segLine = [];
for (const [k, q] of path.entries()) {
  const p = nodes[q.id].p;
  const nb = path[Math.min(k + 1, path.length - 1)];
  const pb = path[Math.max(k - 1, 0)];
  const b = bearing(nodes[pb.id].p, nodes[nb.id].p);
  const side = rnd() < 0.5 ? -90 : 90;
  const moved = destinationPoint(p, b + side, 2 + 4 * rnd());
  const pt = [Math.round(moved[0] * 1e5) / 1e5, Math.round(moved[1] * 1e5) / 1e5];
  if (coords.length && coords.at(-1)[0] === pt[0] && coords.at(-1)[1] === pt[1]) continue;
  coords.push(pt);
  if (coords.length > 1) segLine.push(q.li);
}

// ── Étapes du diagnostic : début au point du tracé le plus proche du point donné, sinon même écart en km ──
const distOf = (a, b) => { let d = 0; for (let i = a; i < b; i += 1) d += haversine(coords[i], coords[i + 1]); return d; };
const SPEED = [85, 75, 60]; // km/h d'un poids lourd par classe (autoroute, voie rapide, primaire)
const durOf = (a, b) => { let t = 0; for (let i = a; i < b; i += 1) t += haversine(coords[i], coords[i + 1]) / (SPEED[lines[segLine[i]].cls] / 3.6); return t; };
const n = coords.length - 1;
const cum = [0];
for (let i = 0; i < n; i += 1) cum.push(cum[i] + haversine(coords[i], coords[i + 1]));
const bounds = [];
let known = { index: 0, km: 0 };
for (const [k, [km, , point]] of STEPS.entries()) {
  const from = k ? bounds[k - 1] : 0;
  let idx;
  if (point) {
    idx = from;
    for (let i = from; i <= n; i += 1) if (haversine(coords[i], point) < haversine(coords[idx], point)) idx = i;
    known = { index: idx, km };
  } else {
    const d = cum[known.index] + (km - known.km) * 1000;
    idx = from;
    while (idx < n && cum[idx + 1] <= d) idx += 1;
  }
  bounds.push(k ? Math.max(idx, from) : 0);
}
const steps = STEPS.map(([, name], k) => ({ name, from: bounds[k], to: k + 1 < STEPS.length ? bounds[k + 1] : n }));
const orsSteps = steps.map((s, i) => ({
  distance: Math.round(distOf(s.from, s.to) * 10) / 10,
  duration: Math.round(durOf(s.from, s.to) * 10) / 10,
  type: i === 0 ? 11 : 6,
  instruction: s.name === '-' ? 'Continuer sur la route' : `Continuer sur ${s.name}`,
  name: s.name,
  way_points: [s.from, s.to],
}));
orsSteps.push({ distance: 0, duration: 0, type: 10, instruction: 'Arrivée', name: '-', way_points: [n, n] });

// Extras : waycategory (bit 1 = autoroute), waytype 1 (voie d'État : motorway, trunk, primary), comme ORS.
const ranges = (f) => {
  const out = [];
  for (let i = 0; i < segLine.length; i += 1) {
    const v = f(lines[segLine[i]]);
    if (out.length && out.at(-1)[2] === v && out.at(-1)[1] === i) out.at(-1)[1] = i + 1;
    else out.push([i, i + 1, v]);
  }
  return out;
};
const distance = Math.round(distOf(0, n) * 10) / 10;
const duration = Math.round(durOf(0, n) * 10) / 10;
const bbox = [
  Math.min(...coords.map((c) => c[0])), Math.min(...coords.map((c) => c[1])),
  Math.max(...coords.map((c) => c[0])), Math.max(...coords.map((c) => c[1])),
];
const fixture = {
  type: 'FeatureCollection',
  bbox,
  features: [{
    bbox,
    type: 'Feature',
    properties: {
      segments: [{ distance, duration, steps: orsSteps }],
      extras: {
        waycategory: { values: ranges((l) => (l.cls === 0 ? 1 : 0)) },
        waytype: { values: ranges(() => 1) },
        countryinfo: { values: [[0, n, 70]] },
      },
      summary: { distance, duration },
      way_points: [0, n],
    },
    geometry: { coordinates: coords, type: 'LineString' },
  }],
  metadata: {
    attribution: 'openrouteservice.org | OpenStreetMap contributors',
    service: 'routing',
    query: { profile: 'driving-hgv', format: 'geojson' },
    engine: { version: '9.0.0' },
    reconstitution: 'tools/make-fixture-axes.mjs : tracé reconstitué depuis data/axes-osm/ par les points et étapes '
      + 'du diagnostic v70, pas une vraie réponse ORS',
  },
};
writeFileSync(OUT, `${JSON.stringify(fixture)}\n`);

// ── Cases réduites : voies de la copie à moins de 300 m du tracé ──
const near = new Set();
const RG = 0.003;
const rk = (p) => `${Math.floor(p[0] / RG)}_${Math.floor(p[1] / RG)}`;
for (const c of coords) near.add(rk(c));
const close = (p) => {
  const [cx, cy] = rk(p).split('_').map(Number);
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) if (near.has(`${cx + dx}_${cy + dy}`)) return true;
  return false;
};
const keepNear = (c) => c.some((p) => close(p) && coords.some((q) => Math.abs(q[0] - p[0]) < 0.006 && Math.abs(q[1] - p[1]) < 0.004 && haversine(p, q) < KEEP_M));
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const counts = {};
const srcIndex = JSON.parse(readFileSync(join(SRC, 'index.json'), 'utf8'));
for (const [key, t] of tiles) {
  const r = [];
  const a = [];
  for (const row of t.a) {
    let px = 0; let py = 0;
    const c = [];
    for (let i = 2; i < row.length; i += 2) { px += row[i]; py += row[i + 1]; c.push([px / 1e5, py / 1e5]); }
    if (!keepNear(c)) continue;
    let i = -1;
    if (row[0] >= 0) {
      const ref = t.r[row[0]];
      i = r.indexOf(ref);
      if (i < 0) { r.push(ref); i = r.length - 1; }
    }
    a.push([i, ...row.slice(1)]);
  }
  if (!a.length) continue;
  counts[key] = a.length;
  writeFileSync(join(OUT_DIR, `${key}.json`), `${JSON.stringify({ r, a })}\n`);
}
const index = {
  source: srcIndex.source, license: srcIndex.license, updated: srcIndex.updated, countries: srcIndex.countries,
  count: Object.values(counts).reduce((x, y) => x + y, 0), tolerance: srcIndex.tolerance, grid: srcIndex.grid, tiles: counts,
  note: 'extrait de data/axes-osm/ (voies à moins de 300 m du tracé de la fixture), tools/make-fixture-axes.mjs',
};
writeFileSync(join(OUT_DIR, 'index.json'), `${JSON.stringify(index)}\n`);

const unnamed = steps.filter((s) => s.name === '-').reduce((d, s) => d + distOf(s.from, s.to), 0);
console.log(`Tracé : ${(distance / 1000).toFixed(1)} km, ${coords.length} points, ${orsSteps.length} étapes, `
  + `${(unnamed / 1000).toFixed(1)} km sans nom ; cases réduites : ${Object.keys(counts).length} (${index.count} voies).`);
for (const s of steps) {
  const refs = {};
  for (let i = s.from; i < s.to; i += 1) { const r = lines[segLine[i]].ref || '(sans ref)'; refs[r] = (refs[r] ?? 0) + haversine(coords[i], coords[i + 1]); }
  const top = Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, d]) => `${r} ${(d / 1000).toFixed(1)}`).join(', ');
  console.log(`  ${s.name.padEnd(6)} ${(cum[s.from] / 1000).toFixed(1)}–${(cum[s.to] / 1000).toFixed(1)} km : ${top}`);
}
