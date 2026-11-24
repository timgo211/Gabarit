// v62 : repères « P » selon le zoom (src/lib/area-cluster.js) — masqués < 8, regroupés de 8 à 11, tous ≥ 11 ;
// l'aire choisie jamais cachée ; P seul collé à une étape masqué à zoom bas.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AREA_CLUSTER, zoomBand, clusterAreas, groupLabel } from '../src/lib/area-cluster.js';

// Projection simple : 1° = 1000 px (assez pour placer les repères dans des cases connues).
const project = ([lon, lat]) => ({ x: lon * 1000, y: -lat * 1000 });
const A = (id, lon, lat) => ({ id, lonlat: [lon, lat], label: id });
// a, b, c dans la même case de 64 px ; d seul ailleurs.
const ITEMS = [A('a', 1.001, -0.001), A('b', 1.01, -0.01), A('c', 1.02, -0.02), A('d', 2.5, -2.5)];

test('bandes de zoom : < 8 aucun, 8 à 11 groupés, ≥ 11 tous', () => {
  assert.equal(AREA_CLUSTER.HIDE_BELOW, 8);
  assert.equal(AREA_CLUSTER.ALL_FROM, 11);
  assert.equal(zoomBand(7.99), 'none');
  assert.equal(zoomBand(8), 'group');
  assert.equal(zoomBand(10.99), 'group');
  assert.equal(zoomBand(11), 'all');
  assert.equal(zoomBand(NaN), 'all', 'zoom inconnu : comme avant');
});

test('zoom ≥ 11 : tous les P, clé indépendante de la position (rien redessiné en suivant le véhicule)', () => {
  const r1 = clusterAreas(ITEMS, { zoom: 14, project });
  const r2 = clusterAreas(ITEMS, { zoom: 16.5, project: ([lon, lat]) => ({ x: lon * 9 + 300, y: lat }) });
  assert.equal(r1.marks.length, 4);
  assert.ok(r1.marks.every((m) => m.kind === 'area'));
  assert.equal(r1.key, r2.key);
});

test('zoom < 8 : aucun P, sauf l\'aire choisie', () => {
  assert.deepEqual(clusterAreas(ITEMS, { zoom: 6, project }).marks, []);
  const r = clusterAreas(ITEMS, { zoom: 6, project, keep: 'b' });
  assert.deepEqual(r.marks.map((m) => m.item.id), ['b']);
});

test('8 ≤ zoom < 11 : P d\'une même case regroupés (« P 3 »), aire seule gardée, aire choisie hors du groupe', () => {
  const r = clusterAreas(ITEMS, { zoom: 9, project });
  const groups = r.marks.filter((m) => m.kind === 'group');
  const single = r.marks.filter((m) => m.kind === 'area');
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['a', 'b', 'c']);
  assert.ok(Math.abs(groups[0].lonlat[0] - 1.0103) < 1e-3, 'centre du groupe');
  assert.deepEqual(single.map((m) => m.item.id), ['d']);
  assert.deepEqual(groupLabel(3), { text: 'P 3', aria: '3 aires PL : toucher pour zoomer' });
  const k = clusterAreas(ITEMS, { zoom: 9, project, keep: 'a' });
  assert.ok(k.marks.some((m) => m.kind === 'area' && m.item.id === 'a'), 'aire choisie jamais regroupée');
  assert.deepEqual(k.marks.find((m) => m.kind === 'group').items.map((i) => i.id), ['b', 'c']);
  assert.notEqual(k.key, r.key, 'choix d\'une aire : repères recalculés');
  assert.equal(clusterAreas(ITEMS, { zoom: 9.5, project }).key, r.key, 'même découpage : même clé, rien redessiné');
});

test('zoom bas : un P seul à moins de 24 px d\'une étape est masqué, l\'étape reste lisible', () => {
  const stop = [2.51, -2.51]; // 14 px de d
  const r = clusterAreas(ITEMS, { zoom: 9, project, stops: [stop] });
  assert.ok(!r.marks.some((m) => m.kind === 'area' && m.item.id === 'd'));
  const far = clusterAreas(ITEMS, { zoom: 9, project, stops: [[2.6, -2.6]] });
  assert.ok(far.marks.some((m) => m.kind === 'area' && m.item.id === 'd'), 'étape loin : P gardé');
  const z = clusterAreas(ITEMS, { zoom: 12, project, stops: [stop] });
  assert.equal(z.marks.length, 4, 'zoom ≥ 11 : tous les P (étape au-dessus par le CSS)');
  const kept = clusterAreas(ITEMS, { zoom: 9, project, stops: [stop], keep: 'd' });
  assert.ok(kept.marks.some((m) => m.item?.id === 'd'), 'aire choisie : jamais masquée');
});

test('entrées invalides : ignorées', () => {
  assert.deepEqual(clusterAreas(null, { zoom: 9, project }).marks, []);
  assert.equal(clusterAreas([{ id: 'x' }, A('y', 1, 1)], { zoom: 14, project }).marks.length, 1);
});
