import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirections, tollDistance, haversine, fuelEstimate, NoRouteError } from '../src/lib/ors-response.js';
import { fixture } from './helpers.js';

test('lecture d\'une réponse ORS complète', () => {
  const r = parseDirections(fixture('ors-directions.json'));
  assert.equal(r.distance, 5230.4);
  assert.equal(r.duration, 512.7);
  assert.equal(r.coordinates.length, 7);
  assert.deepEqual(r.bbox, [4.8357, 45.7578, 4.8752, 45.7801]);
  assert.equal(r.steps.length, 3);
  assert.match(r.steps[1].instruction, /A7/);
  assert.deepEqual(r.warnings, ['There may be restrictions on some roads']);
});

test('km à péage depuis summary (value = 1)', () => {
  assert.equal(parseDirections(fixture('ors-directions.json')).tollDistance, 3500.4);
});

test('km à péage inconnu si l\'extra est absent (pas de plantage)', () => {
  const r = parseDirections(fixture('ors-directions-no-extras.json'));
  assert.equal(r.tollDistance, null);
  assert.equal(r.distance, 15000);
});

test('km à péage recalculés depuis values + géométrie', () => {
  const r = parseDirections(fixture('ors-directions-values-only.json'));
  const expected = haversine([0, 0.01], [0, 0.02]) + haversine([0, 0.02], [0, 0.03]);
  assert.ok(Math.abs(r.tollDistance - expected) < 1e-6);
  assert.ok(Math.abs(r.tollDistance - 2223.9) < 1);
});

test('tollDistance : cas limites', () => {
  assert.equal(tollDistance(undefined, []), null);
  assert.equal(tollDistance({ tollways: {} }, []), null);
  assert.equal(tollDistance({ tollways: { summary: [{ value: 0, distance: 1000 }] } }, []), 0);
  assert.equal(tollDistance({ tollways: { values: [[0, 1]] } }, [[0, 0], [1, 1]]), null);
});

test('réponse vide → NoRouteError', () => {
  assert.throws(() => parseDirections({ type: 'FeatureCollection', features: [] }), NoRouteError);
  assert.throws(() => parseDirections(null), NoRouteError);
});

test('distance/durée omises par ORS → 0', () => {
  const j = fixture('ors-directions-no-extras.json');
  j.features[0].properties.summary = {};
  const r = parseDirections(j);
  assert.equal(r.distance, 0);
  assert.equal(r.duration, 0);
});

test('haversine : 1° de latitude ≈ 111,2 km', () => {
  assert.ok(Math.abs(haversine([0, 0], [0, 1]) - 111195) < 10);
});

test('estimation gazole', () => {
  assert.equal(fuelEstimate(100000, 32), 32);
  assert.equal(fuelEstimate(100000, null), null);
});
