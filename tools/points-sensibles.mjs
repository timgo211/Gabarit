#!/usr/bin/env node
// Copie data/points-sensibles/ (PR 3b) tirée des fiches de l'audit OSM : lit data/audit-osm/,
// tools/audit-osm-interdictions.json, data/axes-osm/ (cap des points) et les identifiants de data/ponts-osm/ (recoupement
// des ponts, déjà signalés par la phase 12a) ; écrit data/points-sensibles/ (rien si la copie dépasse les limites).
// Logique : src/lib/sensitive-points.js. Lancé à la fin de tools/audit-osm.mjs (Action « Audit OSM », manuelle) ;
// lançable seul : node tools/points-sensibles.mjs. Lecture seule d'OSM : rien n'est écrit dans OpenStreetMap.

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSensitivePoints } from '../src/lib/sensitive-points.js';
import { parseAxesTile, mergeAxesTiles } from '../src/lib/axis-match.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const tilesOf = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort() : []);

/**
 * @param {{ root?:string, say?:(line:string)=>void }} opts
 * @returns {{ written:boolean, log:string[] }}
 */
export function writeSensitivePoints({ root = ROOT, say = (l) => console.log(l) } = {}) {
  const auditDir = join(root, 'data', 'audit-osm');
  const axesDir = join(root, 'data', 'axes-osm');
  const pontsDir = join(root, 'data', 'ponts-osm');
  const outDir = join(root, 'data', 'points-sensibles');
  const auditIndex = readJson(join(auditDir, 'index.json'));
  const cards = Object.keys(auditIndex.files ?? {}).flatMap((f) => readJson(join(auditDir, f)).fiches ?? []);
  const sections = readJson(join(root, 'tools', 'audit-osm-interdictions.json')).sections ?? [];
  const axesIndex = readJson(join(axesDir, 'index.json'));
  const axes = mergeAxesTiles(tilesOf(axesDir).map((f) => parseAxesTile(readJson(join(axesDir, f)))));
  let pontsIds = null;
  if (existsSync(join(pontsDir, 'index.json'))) {
    pontsIds = new Set();
    for (const f of tilesOf(pontsDir)) for (const r of readJson(join(pontsDir, f)).b ?? []) if (Number.isInteger(r?.[0])) pontsIds.add(r[0]);
  }
  const res = buildSensitivePoints(cards, sections, axes, { pontsIds, updated: auditIndex.updated ?? null, grid: axesIndex.grid ?? null });
  for (const l of res.log) say(l);
  if (res.problem) return { written: false, log: res.log };
  const tmp = `${outDir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [k, t] of res.tiles) writeFileSync(join(tmp, `${k}.json`), `${JSON.stringify(t)}\n`);
  writeFileSync(join(tmp, 'index.json'), `${JSON.stringify(res.index)}\n`);
  rmSync(outDir, { recursive: true, force: true });
  renameSync(tmp, outDir);
  say(`data/points-sensibles/ : ${res.tiles.size} cases + index.json.`);
  return { written: true, log: res.log };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) writeSensitivePoints();
