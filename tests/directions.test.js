// Directions des panneaux dans les consignes (phase 11b) : copie data/directions-osm/ (Action) et complément
// « direction Metz » des manœuvres. Fixtures SYNTHÉTIQUES : ors-directions-sortie.json (autoroute puis bretelle vers le
// nord-est, « Restez à droite » au point 20) et osm-directions-sortie.geojsonseq (bretelle Metz;Nancy / A 31, bretelle
// parallèle « Thionville », bretelle proche au cap opposé « Paris », destination:lanes seule, route non bretelle).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DIRECTIONS, cleanDestination, convertDirections, directionFromFeature, directionSizeProblem, osmiumDirectionsFilter,
} from '../src/lib/directions-convert.js';
import {
  DIRECTION, directionText, directionsForManeuvers, mergeDirectionTiles, parseDirectionTile,
} from '../src/lib/directions.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { buildManeuvers, maneuverText, announcementText } from '../src/lib/nav-guidance.js';
import { prepareLine } from '../src/lib/nav-geo.js';
import { bannerText } from '../src/lib/nav-layout.js';

const features = readFileSync(new URL('./fixtures/osm-directions-sortie.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);
const route = parseDirections(JSON.parse(readFileSync(new URL('./fixtures/ors-directions-sortie.json', import.meta.url), 'utf8')));
const maneuvers = buildManeuvers(route.steps, prepareLine(route.coordinates).cum);

function copy(ids) {
  const list = features.filter((f) => ids.includes(f.id)).map(directionFromFeature).filter(Boolean);
  const conv = convertDirections(list, { updated: '2026-11-21', countries: ['france'] });
  const tiles = conv.tiles ? [...conv.tiles.values()].map((t) => parseDirectionTile(JSON.parse(JSON.stringify(t)))) : [];
  return { conv, data: mergeDirectionTiles(tiles) };
}

test('étiquettes : bretelles seulement, destination et destination:ref, lanes seules ignorées, oneway=-1 retourné', () => {
  assert.equal(cleanDestination('Metz;Nancy'), 'Metz, Nancy');
  assert.equal(cleanDestination(' ; '), null);
  assert.equal(cleanDestination('x'.repeat(90)), null);
  const byId = new Map(features.map((f) => [f.id, directionFromFeature(f)]));
  assert.equal(byId.get('w4001').dest, 'Metz, Nancy');
  assert.equal(byId.get('w4001').ref, 'A 31');
  assert.equal(byId.get('w4004'), null, 'destination:lanes seule');
  assert.equal(byId.get('w4005'), null, 'pas une bretelle');
  assert.deepEqual(byId.get('w4006').coords[0], [6.199, 49.099], 'oneway=-1 : sens retourné');
  assert.deepEqual(osmiumDirectionsFilter(), ['w/destination', 'w/destination:ref']);
});

test('copie : cases, textes partagés, taille, rien écrit au-delà', () => {
  const { conv, data } = copy(['w4001', 'w4002', 'w4003', 'w4006']);
  assert.equal(conv.problem, null);
  assert.equal(conv.index.count, 4);
  assert.deepEqual(Object.keys(conv.index.tiles), ['6_49']);
  assert.equal(data.links.length, 4);
  assert.equal(DIRECTIONS.MAX_TOTAL_BYTES, 40 * 1024 * 1024);
  assert.match(directionSizeProblem({ total: 41 * 1024 * 1024, biggest: ['6_49', 10] }), /plus de 40 Mo/);
  const none = convertDirections(copy(['w4001']).data.links.map((l) => ({ ...l })), { maxTotal: 5 });
  assert.equal(none.index, null);
  assert.equal(none.tiles, null);
});

test('bretelle unique : « direction Metz, Nancy (A 31) » affiché et dit', () => {
  const { data } = copy(['w4001']);
  const dirs = directionsForManeuvers(route, maneuvers, data);
  assert.deepEqual([...dirs.entries()], [[1, { text: 'Metz, Nancy (A 31)', speak: true }]]);
  const m = { ...maneuvers[1], direction: dirs.get(1) };
  assert.equal(maneuverText(m), 'Restez à droite, direction Metz, Nancy (A 31)');
  assert.equal(announcementText({ maneuver: m, stage: 'now', distance: 0 }), 'Restez à droite, direction Metz, Nancy (A 31).');
  // Bandeau : la consigne entière remplace le nom de rue quand elle donne une direction (règle gardée).
  assert.equal(bannerText({ text: maneuverText(m), name: '-' }).text, 'Restez à droite, direction Metz, Nancy (A 31)');
  assert.equal(directionText({ dest: null, ref: 'A 31' }), 'A 31');
});

test('deux bretelles au même cap : consigne inchangée (jamais de direction devinée)', () => {
  const { data } = copy(['w4001', 'w4002']);
  assert.equal(directionsForManeuvers(route, maneuvers, data).size, 0);
});

test('aucune bretelle, copie absente : consigne inchangée', () => {
  assert.equal(directionsForManeuvers(route, maneuvers, { links: [] }).size, 0);
  assert.equal(directionsForManeuvers(route, maneuvers, null).size, 0);
  assert.equal(maneuverText(maneuvers[1]), 'Restez à droite');
  // Bretelle loin du point de manœuvre (N 52, à 10 km) : rien.
  assert.equal(directionsForManeuvers(route, maneuvers, copy(['w4006']).data).size, 0);
});

test('cap incohérent : seule, rien ; à côté de la bonne, affichée mais pas dite (ambiguë)', () => {
  assert.equal(directionsForManeuvers(route, maneuvers, copy(['w4003']).data).size, 0);
  const dirs = directionsForManeuvers(route, maneuvers, copy(['w4001', 'w4003']).data);
  assert.deepEqual(dirs.get(1), { text: 'Metz, Nancy (A 31)', speak: false });
  const m = { ...maneuvers[1], direction: dirs.get(1) };
  assert.equal(maneuverText(m), 'Restez à droite, direction Metz, Nancy (A 31)');
  assert.equal(maneuverText(m, { spoken: true }), 'Restez à droite');
  assert.equal(announcementText({ maneuver: m, stage: 'near', distance: 400 }), 'Dans 400 mètres, restez à droite.');
});

test('consigne qui donne déjà une direction : inchangée', () => {
  const ms = maneuvers.map((m, i) => (i === 1 ? { ...m, instruction: 'Prenez la sortie en direction de Metz' } : m));
  assert.equal(directionsForManeuvers(route, ms, copy(['w4001']).data).size, 0);
  assert.equal(maneuverText({ ...ms[1], direction: { text: 'Nancy', speak: true } }), 'Prenez la sortie en direction de Metz');
  assert.equal(DIRECTION.NEAR_M, 60);
});

test('guidage : directions calculées une fois par itinéraire, arrivées après « Démarrer », gardées au recalcul', async () => {
  const { startNavigation, updateNavigation, setNavigationDirections, rerouteDone } = await import('../src/lib/navigation.js');
  const { data } = copy(['w4001']);
  const st = startNavigation(route, { now: 1000, directions: data });
  assert.equal(st.route.maneuvers[1].direction.text, 'Metz, Nancy (A 31)');
  const fix = { lon: 6.1, lat: 49.019, accuracy: 5, speed: 25, heading: 0, timestamp: 2000 };
  const r = updateNavigation(st, fix);
  assert.equal(r.view.maneuver.text, 'Restez à droite, direction Metz, Nancy (A 31)');
  const late = setNavigationDirections(startNavigation(route, { now: 1000 }), data);
  assert.equal(updateNavigation(late, fix).view.maneuver.text, 'Restez à droite, direction Metz, Nancy (A 31)');
  assert.equal(rerouteDone(late, route).state.route.maneuvers[1].direction.text, 'Metz, Nancy (A 31)');
  const plain = updateNavigation(startNavigation(route, { now: 1000 }), fix);
  assert.equal(plain.view.maneuver.text, 'Restez à droite');
});
