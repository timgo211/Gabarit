// « vers X » dans les consignes (phase 11c) : copie data/lieux-osm/ lue par l'appli et lieu des manœuvres restées sans
// direction de panneau. Fixtures SYNTHÉTIQUES : ors-directions-sortie.json (« Restez à droite » au point 20, « Tournez
// à droite sur D 1 » au point 25, arrivée au point 30) et osm-lieux-sortie.geojsonseq (Ennery-Test ≈ 370 m après la
// manœuvre, Trémery-Test ≈ 50 m après, Proche-Test ≈ 95 m après Ennery-Test, Loin-Test à plus de 1 km du tracé).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { convertPlaces, placeFromFeature } from '../src/lib/places-convert.js';
import {
  PLACE, mergePlaceTiles, parsePlaceTile, placesAlongRoute, placesForManeuvers, withPlaces,
} from '../src/lib/places.js';
import { convertDirections, directionFromFeature } from '../src/lib/directions-convert.js';
import { mergeDirectionTiles, parseDirectionTile } from '../src/lib/directions.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { buildManeuvers, maneuverText, announcementText } from '../src/lib/nav-guidance.js';
import { prepareLine } from '../src/lib/nav-geo.js';
import { bannerText } from '../src/lib/nav-layout.js';
import { prepareRoute, setNavigationPlaces, startNavigation } from '../src/lib/navigation.js';

const read = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const placeFeatures = read('osm-lieux-sortie.geojsonseq').split('\n').map(parseGeojsonLine).filter(Boolean);
const dirFeatures = read('osm-directions-sortie.geojsonseq').split('\n').map(parseGeojsonLine).filter(Boolean);
const route = parseDirections(JSON.parse(read('ors-directions-sortie.json')));
const maneuvers = buildManeuvers(route.steps, prepareLine(route.coordinates).cum);

function places(ids) {
  const list = placeFeatures.filter((f) => ids.includes(f.id)).map(placeFromFeature).filter(Boolean);
  const conv = convertPlaces(list, { updated: '2026-12-01', countries: ['france'] });
  return mergePlaceTiles([...conv.tiles.values()].map((t) => parsePlaceTile(JSON.parse(JSON.stringify(t)))));
}
function directions(ids) {
  const list = dirFeatures.filter((f) => ids.includes(f.id)).map(directionFromFeature).filter(Boolean);
  const conv = convertDirections(list, { updated: '2026-12-01', countries: ['france'] });
  return mergeDirectionTiles([...conv.tiles.values()].map((t) => parseDirectionTile(JSON.parse(JSON.stringify(t)))));
}
const ALL = ['n8101', 'n8102', 'n8104'];

test('lecture d’une case : illisible → null, lignes abîmées ignorées', () => {
  assert.equal(parsePlaceTile(null), null);
  assert.equal(parsePlaceTile({ t: [] }), null);
  const t = parsePlaceTile({ t: ['A', 'B'], p: [[0, 2, 610000, 4902000], [5, 1, 1, 1], [1, 9, 1, 1], 'x', [1, 0, 1.5, 2]] });
  assert.deepEqual(t.places.map((p) => p.name), ['A']);
  assert.deepEqual(t.places[0].at, [6.1, 49.02]);
  assert.equal(mergePlaceTiles([t, t]).places.length, 1);
});

test('lieux le long du tracé : à 1 km au plus, triés', () => {
  const line = prepareLine(route.coordinates);
  const along = placesAlongRoute(line, places(ALL).places);
  assert.deepEqual(along.map((p) => p.name), ['Trémery-Test', 'Ennery-Test']); // Loin-Test : à plus de 1 km
  assert.ok(along[0].along < along[1].along);
});

test('aucune bretelle sûre : « vers » le premier lieu à plus de 300 m, affiché seulement', () => {
  const res = placesForManeuvers(route, maneuvers, places(ALL));
  assert.deepEqual([...res.entries()], [[1, { text: 'Ennery-Test' }]]);
  const ms = withPlaces(maneuvers, res);
  assert.equal(maneuverText(ms[1]), 'Restez à droite, vers Ennery-Test');
  assert.equal(maneuverText(ms[1], { spoken: true }), 'Restez à droite');
  const spoken = announcementText({ maneuver: ms[1], stage: 'near', distance: 400 });
  assert.doesNotMatch(spoken, /vers|Ennery/);
  // Le lieu est déjà derrière la manœuvre suivante (point 25) : rien pour elle.
  assert.equal(ms[2].place, undefined);
});

test('direction de panneau connue (11b) : pas de « vers »', () => {
  const p = prepareRoute(route, directions(['w4001']), places(ALL));
  assert.equal(maneuverText(p.maneuvers[1]), 'Restez à droite, direction Metz, Nancy (A 31)');
  assert.equal(p.maneuvers[1].place, undefined);
  // Bretelles ambiguës : aucune direction → « vers ».
  const q = prepareRoute(route, directions(['w4001', 'w4002']), places(ALL));
  assert.equal(maneuverText(q.maneuvers[1]), 'Restez à droite, vers Ennery-Test');
});

test('consigne ORS qui donne déjà une direction : inchangée', () => {
  const ms = maneuvers.map((m, i) => (i === 1 ? { ...m, instruction: 'Prenez la sortie en direction de Metz' } : m));
  assert.equal(placesForManeuvers(route, ms, places(ALL)).size, 0);
});

test('deux lieux à moins de 300 m le long du tracé : rien (jamais deviné)', () => {
  assert.equal(placesForManeuvers(route, maneuvers, places(['n8101', 'n8103'])).size, 0);
  assert.ok(PLACE.TIE_M === 300 && PLACE.MIN_AHEAD_M === 300 && PLACE.NEAR_M === 1000 && PLACE.MAX_AHEAD_M === 15000);
});

test('lieu après l’étape suivante ou l’arrivée : rien', () => {
  const ms = maneuvers.map((m, i) => (i === 2 ? { ...m, type: 10, waypoint: true } : m));
  // Étape au point 25 (≈ 465 m) : Ennery-Test (≈ 370 m) reste avant elle.
  assert.equal(placesForManeuvers(route, ms, places(ALL)).get(1)?.text, 'Ennery-Test');
  const early = maneuvers.map((m, i) => (i === 2 ? { ...m, type: 10, waypoint: true, at: maneuvers[1].at + 320 } : m));
  assert.equal(placesForManeuvers(route, early, places(ALL)).size, 0);
});

test('copie absente ou vide : manœuvres inchangées', () => {
  assert.equal(placesForManeuvers(route, maneuvers, null).size, 0);
  assert.equal(placesForManeuvers(route, maneuvers, { places: [] }).size, 0);
  assert.equal(withPlaces(maneuvers, new Map()), maneuvers);
  assert.deepEqual(prepareRoute(route, null, null).maneuvers, maneuvers);
});

test('bandeau : consigne entière avec « vers », même si la route a un nom', () => {
  const b = bannerText({ text: 'Tournez à droite sur D 1, vers Metz', name: 'D 1', place: 'Metz' });
  assert.deepEqual(b.badges, []);
  assert.match(b.text, /vers Metz$/);
  assert.notDeepEqual(bannerText({ text: 'Tournez à droite sur D 1', name: 'D 1' }).badges, []);
});

test('guidage : lieux arrivés après « Démarrer » → consignes refaites', () => {
  const s0 = startNavigation(route, { now: 0 });
  assert.equal(s0.route.maneuvers[1].place, undefined);
  const s1 = setNavigationPlaces(s0, places(ALL));
  assert.equal(s1.route.maneuvers[1].place.text, 'Ennery-Test');
  assert.equal(setNavigationPlaces(s1, null).route.maneuvers[1].place, undefined);
});
