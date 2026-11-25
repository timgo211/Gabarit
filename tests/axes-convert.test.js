import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { AXES, axesSizeProblem, axisFromFeature, axisRef, chainAxes, convertAxes, parseAxesTile } from '../src/lib/axes-convert.js';

const FEATURES = readFileSync(new URL('./fixtures/osm-audit-axes.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);

test('copie des axes : autoroutes, voies rapides, primaires et bretelles ; référence normalisée', () => {
  const ways = FEATURES.map(axisFromFeature).filter(Boolean);
  assert.deepEqual(ways.map((w) => w.id).sort((a, b) => a - b), [11, 12, 13, 14, 16, 17, 18, 19]);
  const byId = Object.fromEntries(ways.map((w) => [w.id, w]));
  assert.equal(byId[11].ref, 'A6');
  assert.equal(byId[11].cls, 0);
  assert.equal(byId[13].ref, '', 'bretelle sans référence');
  assert.equal(byId[13].cls, 0, 'bretelle classée comme l\'autoroute');
  assert.equal(byId[17].cls, 1);
  assert.equal(byId[14].cls, 2);
  assert.equal(axisRef('A 35;E 25'), 'A35;E25');
  assert.equal(axisRef('RN 7'), 'N7');
  assert.equal(axisFromFeature({ id: 'w1', properties: { highway: 'secondary', ref: 'D 1' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }), null);
});

test('mise bout à bout : même classe et même référence seulement', () => {
  const a = { cls: 0, ref: 'A6', coords: [[0, 0], [0.01, 0]] };
  const b = { cls: 0, ref: 'A6', coords: [[0.02, 0], [0.01, 0]] };
  const c = { cls: 0, ref: 'A7', coords: [[0.02, 0], [0.03, 0]] };
  const out = chainAxes([a, b, c]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.find((l) => l.ref === 'A6').coords, [[0, 0], [0.01, 0], [0.02, 0]]);
});

test('cases : format, index, relecture', () => {
  const ways = FEATURES.map(axisFromFeature).filter(Boolean);
  const res = convertAxes(ways, { updated: '2026-11-25', grid: null, countries: ['france'] });
  assert.equal(res.problem, null);
  assert.equal(res.index.tolerance, 3);
  assert.equal(res.index.license, 'ODbL — © contributeurs OpenStreetMap');
  assert.ok(res.index.km.autoroute > 0);
  const tile = res.tiles.get('4_45');
  assert.ok(tile.r.includes('A6'));
  const read = parseAxesTile(JSON.parse(JSON.stringify(tile)));
  const a6 = read.lines.filter((l) => l.ref === 'A6');
  assert.ok(a6.length >= 1);
  assert.deepEqual(a6[0].coords[0], [4.7, 45.8]);
  assert.equal(parseAxesTile({}), null);
});

test('trop gros même à 20 m : rien à écrire, journal par classe, jamais de coupe silencieuse', () => {
  const ways = FEATURES.map(axisFromFeature).filter(Boolean);
  const res = convertAxes(ways, { limits: { maxFile: 10, maxTotal: 10 } });
  assert.ok(res.problem);
  assert.equal(res.index, null);
  assert.equal(res.tiles, null);
  assert.equal(res.log.filter((l) => /simplification/.test(l)).length, AXES.TOLERANCES_M.length);
  assert.match(res.log.at(-1), /non modifié.*aucune classe retirée/);
  assert.match(res.log[1], /autoroute .* Mo, voie rapide .* Mo, primaire .* Mo/);
  assert.equal(axesSizeProblem({ total: 1, biggest: ['x', 1] }), null);
  assert.match(axesSizeProblem({ total: 31 * 1024 * 1024, biggest: ['x', 1] }), /plus de 30\.0 Mo/);
  assert.match(axesSizeProblem({ total: 1, biggest: ['2_48', 6 * 1024 * 1024] }), /case 2_48 .*plus de 5\.0 Mo/);
});

test('Action « Audit OSM » : manuelle, lecture seule, sans secret', () => {
  const yml = readFileSync(new URL('../.github/workflows/audit-osm.yml', import.meta.url), 'utf8');
  assert.match(yml, /workflow_dispatch:/);
  assert.doesNotMatch(yml, /^\s*(schedule|push|pull_request):/m);
  assert.doesNotMatch(yml, /secrets\./);
  const tool = readFileSync(new URL('../tools/audit-osm.mjs', import.meta.url), 'utf8');
  for (const t of [yml, tool]) assert.doesNotMatch(t, /api\.openstreetmap\.org|api\/0\.6/, 'aucun appel à l\'API d\'écriture d\'OSM');
  assert.match(tool, /from '\.\/osm-download\.mjs'/);
});

test('copies jamais précachées', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sw, /axes-osm|audit-osm/);
});
