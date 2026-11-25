#!/usr/bin/env node
// Cases réduites de data/axes-osm/ pour les tests du repli par la géométrie (PR 3a) : à partir d'une vraie réponse ORS
// du dépôt (tests/fixtures/ors-directions-*.json), garde les voies de la copie (© contributeurs OpenStreetMap, ODbL)
// dont un point est à moins de 300 m du tracé, dans les mêmes cases et le même format. Aucune voie ajoutée ni
// modifiée, aucun appel réseau.
//
// v75 : la reconstitution Joigny → Gonfreville-l'Orcher (diagnostic v70) est remplacée par la vraie réponse ORS du
// 24/11/2026 ; cet outil ne fait plus que l'extraction.
//
// Usage (déterministe ; à relancer seulement si data/axes-osm/ ou la fixture change) :
//   node tools/make-fixture-axes.mjs tests/fixtures/ors-directions-joigny-gonfreville.json tests/fixtures/axes-osm-joigny
//   node tools/make-fixture-axes.mjs tests/fixtures/ors-directions-macon-valence.json tests/fixtures/axes-osm-macon-valence

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { haversine } from '../src/lib/nav-geo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data/axes-osm');
const KEEP_M = 300;

const [fixtureArg, outArg] = process.argv.slice(2);
if (!fixtureArg || !outArg) {
  process.stderr.write('Usage : node tools/make-fixture-axes.mjs <réponse ORS .json> <dossier de sortie>\n');
  process.exit(1);
}
const FIXTURE = resolve(fixtureArg);
const OUT_DIR = resolve(outArg);
const json = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const coords = json.features[0].geometry.coordinates;

// Cases traversées par le tracé, avec une case de marge autour (voies à cheval sur deux cases).
const cells = new Set();
for (const [lon, lat] of coords) {
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
    cells.add(`${Math.floor(lon + dx * 0.01)}_${Math.floor(lat + dy * 0.01)}`);
  }
}

// ── Voies à moins de 300 m du tracé ──
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
for (const f of readdirSync(SRC).sort()) {
  if (f === 'index.json') continue;
  const key = f.replace('.json', '');
  if (!cells.has(key)) continue;
  const t = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
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
  note: `extrait de data/axes-osm/ (voies à moins de 300 m du tracé de ${relative(ROOT, FIXTURE)}), tools/make-fixture-axes.mjs`,
};
writeFileSync(join(OUT_DIR, 'index.json'), `${JSON.stringify(index)}\n`);
process.stdout.write(`${coords.length} points ; cases réduites : ${Object.keys(counts).length} (${index.count} voies) → ${relative(ROOT, OUT_DIR)}\n`);
