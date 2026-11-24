// Copie des lieux habités (phase 11c) : conversion côté Action vers data/lieux-osm/. Fixture SYNTHÉTIQUE
// osm-lieux.geojsonseq : city, town, village gardés ; hameau, village sans nom, lieu en surface (way) et nom trop long
// refusés ; nom aux espaces multiples nettoyé ; un lieu dans une autre case (Belfort).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PLACES, cleanPlaceName, convertPlaces, osmiumPlacesFilter, placeFromFeature, placeSizeProblem, placeSourceProblem,
} from '../src/lib/places-convert.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';

const features = readFileSync(new URL('./fixtures/osm-lieux.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);
const byId = (id) => features.find((f) => f.id === id);

test('filtre osmium : nœuds city, town, village', () => {
  assert.deepEqual(osmiumPlacesFilter(), ['n/place=city,town,village']);
  assert.equal(PLACES.INDEX_PATH, './data/lieux-osm/index.json');
  assert.deepEqual(PLACES.RANKS, ['city', 'town', 'village']);
});

test('lieux gardés : nom, rang, position', () => {
  assert.deepEqual(placeFromFeature(byId('n8001')), { name: 'Metz', rank: 0, at: [6.1757, 49.1193] });
  assert.equal(placeFromFeature(byId('n8002')).rank, 1);
  assert.equal(placeFromFeature(byId('n8003')).rank, 2);
  assert.equal(placeFromFeature(byId('n8007')).name, 'Saint Julien');
});

test('lieux refusés : hameau, sans nom, surface, nom trop long', () => {
  for (const id of ['n8004', 'n8005', 'w8006', 'n8008']) assert.equal(placeFromFeature(byId(id)), null, id);
  assert.equal(placeFromFeature(null), null);
  assert.equal(cleanPlaceName('   '), null);
  assert.equal(cleanPlaceName(42), null);
});

test('conversion : une case par degré, rangs et coordonnées entières, index', () => {
  const list = features.map(placeFromFeature).filter(Boolean);
  assert.equal(list.length, 5);
  const conv = convertPlaces(list, { updated: '2026-12-01', countries: ['france'] });
  assert.equal(conv.problem, null);
  assert.deepEqual(Object.keys(conv.index.tiles), ['6_47', '6_49']);
  assert.equal(conv.index.count, 5);
  assert.deepEqual(conv.index.ranks, ['city', 'town', 'village']);
  const tile = conv.tiles.get('6_49');
  assert.deepEqual(Object.keys(tile), ['t', 'p']);
  const metz = tile.p.find((r) => tile.t[r[0]] === 'Metz');
  assert.deepEqual(metz.slice(1), [0, 617570, 4911930]);
  assert.equal(conv.tiles.get('6_47').p.length, 1);
  assert.match(conv.log[0], /Lieux : 5 \(1 city, 2 town, 2 village\)/);
  // Même résultat quel que soit l'ordre de lecture.
  assert.deepEqual(convertPlaces(list.slice().reverse()).tiles, conv.tiles);
});

test('plafonds : trop gros → rien, journal clair', () => {
  const list = features.map(placeFromFeature).filter(Boolean);
  const none = convertPlaces(list, { maxTotal: 5 });
  assert.equal(none.index, null);
  assert.equal(none.tiles, null);
  assert.match(none.problem, /total/);
  assert.match(placeSizeProblem({ total: 1, biggest: ['6_49', 6 * 1024 * 1024] }), /case 6_49/);
  assert.equal(placeSourceProblem(1, 10), null);
  assert.match(placeSourceProblem(300 * 1024 * 1024), /300 Mo \(plus de 256 Mo\)/);
});
