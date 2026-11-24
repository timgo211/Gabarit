// Voies à prendre (phase 11d) : copie data/voies-osm/ lue par l'appli et voies de chaque manœuvre. Fixtures
// SYNTHÉTIQUES : ors-directions-sortie.json (autoroute vers le nord, « Restez à droite » au point 20) et
// osm-voies.geojsonseq (w7001 : autoroute through|through|slight_right qui finit au point 20).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { convertLanes, lanesFromFeature } from '../src/lib/lanes-convert.js';
import {
  LANE, VALID_TURNS, lanesFor, lanesForManeuvers, lanesRow, mergeLaneTiles, parseLaneTile, splitTurnLanes, withLanes,
} from '../src/lib/lanes.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { buildManeuvers, STEP_TYPES } from '../src/lib/nav-guidance.js';
import { prepareLine } from '../src/lib/nav-geo.js';
import { prepareRoute, setNavigationLanes, startNavigation } from '../src/lib/navigation.js';

const read = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const features = read('osm-voies.geojsonseq').split('\n').map(parseGeojsonLine).filter(Boolean);
const route = parseDirections(JSON.parse(read('ors-directions-sortie.json')));
const maneuvers = buildManeuvers(route.steps, prepareLine(route.coordinates).cum);
const w7001 = lanesFromFeature(features.find((f) => f.id === 'w7001')).lines[0];

function copy(lines) {
  const conv = convertLanes(lines, { updated: '2026-12-01', countries: ['france'] });
  return mergeLaneTiles([...conv.tiles.values()].map((t) => parseLaneTile(JSON.parse(JSON.stringify(t)))));
}
const EXPECTED = [{ values: ['through'], ok: false }, { values: ['through'], ok: false }, { values: ['slight_right'], ok: true }];

test('lecture : nombre de valeurs = nombre de voies, valeurs reconnues seulement', () => {
  assert.deepEqual(splitTurnLanes('left|through;right', 2), [['left'], ['through', 'right']]);
  assert.equal(splitTurnLanes('left|through', 3), null);
  assert.equal(splitTurnLanes('left|none', 2), null);
  assert.equal(splitTurnLanes('left|foo', 2), null);
  assert.equal(parseLaneTile(null), null);
  const t = parseLaneTile({ t: ['left|through', 'left'], v: [[0, 2, 610000, 4900000, 0, 100], [0, 3, 1, 1, 0, 1], [1, 1, 5], 'x'] });
  assert.equal(t.lines.length, 1);
  assert.deepEqual(t.lines[0].values, [['left'], ['through']]);
  assert.deepEqual(t.lines[0].coords, [[6.1, 49], [6.1, 49.001]]);
});

test('voies valides par type ORS ; aucune valide ou rond-point → rien', () => {
  const v = [['through'], ['through'], ['slight_right']];
  assert.deepEqual(lanesFor(v, STEP_TYPES.KEEP_RIGHT), EXPECTED);
  assert.deepEqual(lanesFor(v, STEP_TYPES.STRAIGHT).map((l) => l.ok), [true, true, false]);
  assert.equal(lanesFor(v, STEP_TYPES.LEFT), null);
  assert.equal(lanesFor(v, STEP_TYPES.ENTER_ROUNDABOUT), null);
  assert.equal(lanesFor(v, STEP_TYPES.EXIT_ROUNDABOUT), null);
  assert.equal(lanesFor(v, STEP_TYPES.GOAL), null);
  assert.equal(VALID_TURNS[STEP_TYPES.DEPART], undefined);
  assert.deepEqual(lanesFor([['left', 'through'], ['right']], STEP_TYPES.LEFT).map((l) => l.ok), [true, false]);
});

test('ligne qui arrive à la manœuvre dans le bon sens → voies', () => {
  const res = lanesForManeuvers(route, maneuvers, copy([w7001]));
  assert.deepEqual([...res.keys()], [1]);
  assert.deepEqual(res.get(1), EXPECTED);
  assert.deepEqual(withLanes(maneuvers, res)[1].lanes, EXPECTED);
});

test('ligne dans l’autre sens, ou qui ne finit pas au carrefour → rien', () => {
  const reversed = { ...w7001, coords: w7001.coords.slice().reverse() };
  assert.equal(lanesForManeuvers(route, maneuvers, copy([reversed])).size, 0);
  // Ligne qui s'arrête 200 m avant le carrefour.
  const early = { ...w7001, coords: [[6.1, 49.015], [6.1, 49.018]] };
  assert.equal(lanesForManeuvers(route, maneuvers, copy([early])).size, 0);
});

test('voie coupée en deux chemins : mêmes flèches → voies ; flèches différentes → rien', () => {
  const before = { ...w7001, coords: [[6.1, 49.016], [6.1, 49.0197]] };
  assert.deepEqual(lanesForManeuvers(route, maneuvers, copy([w7001, before])).get(1), EXPECTED);
  const other = { ...before, turn: 'through|slight_right|slight_right' };
  assert.equal(lanesForManeuvers(route, maneuvers, copy([w7001, other])).size, 0);
});

test('rangée : manœuvre du bandeau à 1 km au plus seulement', () => {
  assert.equal(LANE.SHOW_M, 1000);
  assert.deepEqual(lanesRow({ lanes: EXPECTED, distance: 800 }), EXPECTED);
  assert.equal(lanesRow({ lanes: EXPECTED, distance: 1200 }), null);
  assert.equal(lanesRow({ lanes: null, distance: 100 }), null);
  assert.equal(lanesRow(null), null);
});

test('copie absente ou vide : manœuvres inchangées', () => {
  assert.equal(lanesForManeuvers(route, maneuvers, null).size, 0);
  assert.equal(lanesForManeuvers(route, maneuvers, { lines: [] }).size, 0);
  assert.equal(withLanes(maneuvers, new Map()), maneuvers);
  assert.deepEqual(prepareRoute(route, null, null, null).maneuvers, maneuvers);
});

test('guidage : voies arrivées après « Démarrer » → manœuvres refaites', () => {
  const s0 = startNavigation(route, { now: 0 });
  assert.equal(s0.route.maneuvers[1].lanes, undefined);
  const s1 = setNavigationLanes(s0, copy([w7001]));
  assert.deepEqual(s1.route.maneuvers[1].lanes, EXPECTED);
  assert.equal(setNavigationLanes(s1, null).route.maneuvers[1].lanes, undefined);
  assert.deepEqual(startNavigation(route, { now: 0, lanes: copy([w7001]) }).route.maneuvers[1].lanes, EXPECTED);
});
