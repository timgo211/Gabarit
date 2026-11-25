#!/usr/bin/env node
// Reconstitution d'une réponse ORS Joigny → Gonfreville-l'Orcher pour les tests du repli par la géométrie (PR 3a).
// Aucune vraie réponse ORS de ce trajet n'est dans le dépôt (constat de docs/etude-osm-axes.md, section 5, sans
// fichier) et les tests n'appellent jamais l'API : le tracé est reconstitué à partir de data/axes-osm/ (© contributeurs
// OpenStreetMap, ODbL), en suivant les routes des étapes du diagnostic envoyé par le propriétaire : A6, puis N12, puis
// A13, puis A131. Les raccords entre ces axes sont le plus court chemin dans la copie (jamais une route supposée).
//
// Étapes structurées comme ORS (docs/etude-osm-axes.md, section 5 : GraphHopper ne crée pas d'instruction quand un
// seul chemin est possible) : une étape qui commence sur une bretelle sans référence s'appelle « - » et garde les
// voies suivantes jusqu'à la prochaine manœuvre ; ici l'A12 et l'A13 restent dans une étape « - ». Points décalés de 2 à 6 m (suite pseudo-aléatoire fixe), arrondis à 1e-5° comme ORS.
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

const START = [3.3965, 47.982]; // Joigny
const VIA = [[2.10, 48.791]]; // sur la N12 (Versailles – Bois-d'Arcy), route d'une étape du diagnostic
const END = [0.233, 49.505]; // Gonfreville-l'Orcher
const ROUTES = new Set(['A6', 'N12', 'A13', 'A131']);
const BOX = [-0.2, 47.7, 3.6, 49.7];
const SNAP_M = 25;
// Voies gardées dans l'étape « - » de la bretelle qui y mène (constat de l'étude : l'A13 reste dans une étape sans nom).
const ABSORBED = new Set(['A12', 'A13']);
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
const cost = (l) => {
  if (l.ref.split(';').some((r) => ROUTES.has(r))) return 1;
  return l.ref ? 2 : 1.3; // raccord : bretelle sans référence, sinon autre route de la copie
};
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
const nearest = (p) => {
  let b = -1; let bd = Infinity;
  for (const [i, nd] of nodes.entries()) { const d = haversine(p, nd.p); if (d < bd) { bd = d; b = i; } }
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
const stops = [START, ...VIA, END].map(nearest);
let path = [];
for (let k = 1; k < stops.length; k += 1) {
  const part = dijkstra(stops[k - 1], stops[k]);
  path = path.concat(k > 1 ? part.slice(1) : part);
}
// Raccord à 25 m (li = -1) : la voie du point d'arrivée.
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

// ── Séries de même voie (référence, classe) → étapes comme ORS ──
const runs = [];
for (let i = 0; i < segLine.length; i += 1) {
  const l = lines[segLine[i]];
  const key = `${l.ref}|${l.cls}`;
  if (runs.length && runs.at(-1).key === key) runs.at(-1).to = i + 1;
  else runs.push({ key, ref: l.ref, cls: l.cls, from: i, to: i + 1 });
}
const distOf = (a, b) => { let d = 0; for (let i = a; i < b; i += 1) d += haversine(coords[i], coords[i + 1]); return d; };
const SPEED = [85, 75, 60]; // km/h d'un poids lourd par classe (autoroute, voie rapide, primaire)
const durOf = (a, b) => { let t = 0; for (let i = a; i < b; i += 1) t += haversine(coords[i], coords[i + 1]) / (SPEED[lines[segLine[i]].cls] / 3.6); return t; };
const steps = [];
for (const r of runs) {
  const last = steps.at(-1);
  // Bretelle sans référence : étape « - » ; elle garde les voies suivantes (un seul chemin, aucune instruction).
  if (last && last.unnamedAbsorb && ABSORBED.has(r.ref)) { last.to = r.to; continue; }
  if (last && !r.ref && last.name === '-') { last.to = r.to; last.unnamedAbsorb = true; continue; }
  if (last && r.ref && last.ref === r.ref) { last.to = r.to; continue; }
  const name = r.ref ? r.ref.split(';').map((x) => x.replace(/^([A-Z]+)(\d)/, '$1 $2')).join(', ') : '-';
  steps.push({ name, ref: r.ref, from: r.from, to: r.to, unnamedAbsorb: !r.ref });
}
const orsSteps = steps.map((s, i) => ({
  distance: Math.round(distOf(s.from, s.to) * 10) / 10,
  duration: Math.round(durOf(s.from, s.to) * 10) / 10,
  type: i === 0 ? 11 : 6,
  instruction: s.name === '-' ? 'Continuer sur la route' : `Continuer sur ${s.name}`,
  name: s.name,
  way_points: [s.from, s.to],
}));
const n = coords.length - 1;
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
    reconstitution: 'tools/make-fixture-axes.mjs : tracé reconstitué depuis data/axes-osm/ (A6, N12, A13, A131 '
      + 'd\'après le diagnostic), pas une vraie réponse ORS',
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
for (const s of steps) console.log(`  ${s.name.padEnd(12)} ${(distOf(s.from, s.to) / 1000).toFixed(1)} km`);
