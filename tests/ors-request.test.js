import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectionsRequest, buildAutocompleteUrl, parseAutocomplete, clampMaxSpeed, directionsHeaders, peliasHeaders, buildKeyTestRequest }
  from '../src/lib/ors-request.js';
import { ORS_BASE, PELIAS_BASE } from '../src/lib/config.js';
import { defaultVehicle } from '../src/lib/vehicle.js';
import { fixture } from './helpers.js';

const start = [4.8357, 45.764];
const end = [4.8752, 45.7801];

test('URL de base sans slash final', () => {
  assert.equal(ORS_BASE, 'https://api.heigit.org/openrouteservice/v2');
  assert.equal(PELIAS_BASE, 'https://api.heigit.org/pelias/v1');
  assert.ok(!ORS_BASE.endsWith('/') && !PELIAS_BASE.endsWith('/'));
});

test('requête construite depuis un profil', () => {
  const vehicle = { ...defaultVehicle(), hazmat: true };
  const req = buildDirectionsRequest({ start, end, vehicle });
  assert.equal(req.url, 'https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson');
  assert.equal(req.method, 'POST');
  assert.deepEqual(req.body.coordinates, [start, end]);
  assert.deepEqual(req.body.extra_info, ['tollways', 'countryinfo']);
  assert.equal(req.body.language, 'fr');
  assert.equal(req.body.units, 'm');
  assert.equal(req.body.maximum_speed, 90);
  assert.equal(req.body.options.vehicle_type, 'hgv');
  assert.deepEqual(req.body.options.profile_params.restrictions, {
    height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, hazmat: true,
  });
  assert.equal(req.body.options.avoid_features, undefined);
});

test('éviter péages et ferries', () => {
  const req = buildDirectionsRequest({ start, end, vehicle: defaultVehicle(), avoidTolls: true, avoidFerries: true });
  assert.deepEqual(req.body.options.avoid_features, ['tollways', 'ferries']);
});

test('zones à éviter (phase 5) : options.avoid_polygons en GeoJSON, rien si absent ou illisible', () => {
  const zones = { type: 'MultiPolygon', coordinates: [[[[4.8, 45.7], [4.9, 45.7], [4.9, 45.8], [4.8, 45.7]]]], extra: 1 };
  const req = buildDirectionsRequest({ start, end, vehicle: defaultVehicle(), avoidPolygons: zones });
  assert.deepEqual(req.body.options.avoid_polygons, { type: 'MultiPolygon', coordinates: zones.coordinates });
  assert.equal(req.body.options.vehicle_type, 'hgv');
  assert.equal(buildDirectionsRequest({ start, end, vehicle: defaultVehicle() }).body.options.avoid_polygons, undefined);
  assert.equal(buildDirectionsRequest({ start, end, vehicle: defaultVehicle(), avoidPolygons: { type: 'Point', coordinates: [1, 2] } })
    .body.options.avoid_polygons, undefined);
});

test('restrictions vides ou absentes non envoyées, hazmat false omis', () => {
  const v = { ...defaultVehicle(), axleload: null, hazmat: false };
  const r = buildDirectionsRequest({ start, end, vehicle: v }).body.options.profile_params.restrictions;
  assert.equal('axleload' in r, false);
  assert.equal('hazmat' in r, false);
  const bare = buildDirectionsRequest({ start, end, vehicle: { name: 'x' } }).body;
  assert.equal(bare.options.profile_params, undefined);
  assert.equal(bare.maximum_speed, undefined);
});

test('maximum_speed borné à 80 km/h minimum', () => {
  assert.equal(clampMaxSpeed(50), 80);
  assert.equal(clampMaxSpeed(80), 80);
  assert.equal(clampMaxSpeed(89.6), 90);
  assert.equal(clampMaxSpeed(null), null);
  const req = buildDirectionsRequest({ start, end, vehicle: { ...defaultVehicle(), maxSpeed: 60 } });
  assert.equal(req.body.maximum_speed, 80);
});

test('coordonnées invalides refusées', () => {
  assert.throws(() => buildDirectionsRequest({ start: [200, 0], end, vehicle: defaultVehicle() }), /départ/);
  assert.throws(() => buildDirectionsRequest({ start, end: null, vehicle: defaultVehicle() }), /arrivée/);
  assert.throws(() => buildDirectionsRequest({ start, end }), /profil/);
});

test('en-têtes : clé dans Authorization', () => {
  const h = directionsHeaders('CLE-FACTICE');
  assert.equal(h.Authorization, 'CLE-FACTICE');
  assert.match(h['Content-Type'], /application\/json/);
});

test('URL d\'autocomplétion Pelias', () => {
  const url = new URL(buildAutocompleteUrl({ text: ' Lyon ', apiKey: 'CLE-FACTICE', focus: [4.8357, 45.764] }));
  assert.equal(url.origin + url.pathname, 'https://api.heigit.org/pelias/v1/autocomplete');
  assert.equal(url.searchParams.get('text'), 'Lyon');
  assert.equal(url.searchParams.get('api_key'), null, 'par défaut la clé ne va pas dans l\'URL');
  assert.equal(url.searchParams.get('focus.point.lon'), '4.83570');
  assert.equal(url.searchParams.get('lang'), 'fr');
  assert.match(url.searchParams.get('boundary.country'), /^FR,/);
});

test('lecture des suggestions Pelias (points invalides ignorés)', () => {
  const s = parseAutocomplete(fixture('pelias-autocomplete.json'));
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { label: 'Lyon, France', lon: 4.835659, lat: 45.764043 });
  assert.deepEqual(parseAutocomplete(null), []);
});

test('Pelias : clé dans Authorization, api_key seulement en repli', () => {
  assert.equal(peliasHeaders('CLE-FACTICE').Authorization, 'CLE-FACTICE');
  const url = new URL(buildAutocompleteUrl({ text: 'Lyon', apiKey: 'CLE-FACTICE', keyInQuery: true }));
  assert.equal(url.searchParams.get('api_key'), 'CLE-FACTICE');
});

test('requête de test de clé : petit itinéraire camion sans restriction', () => {
  const req = buildKeyTestRequest();
  assert.equal(req.url, 'https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson');
  assert.equal(req.body.coordinates.length, 2);
  assert.equal(req.body.options.vehicle_type, 'hgv');
  assert.equal(req.body.options.profile_params, undefined);
  assert.equal(req.body.maximum_speed, undefined);
});

test('préférence et alternative_routes (phase 2b)', () => {
  const v = defaultVehicle();
  const plain = buildDirectionsRequest({ start, end, vehicle: v }).body;
  assert.equal(plain.preference, undefined, 'par défaut : « recommended » d\'ORS');
  assert.equal(plain.alternative_routes, undefined);
  const short = buildDirectionsRequest({ start, end, vehicle: v, preference: 'shortest' }).body;
  assert.equal(short.preference, 'shortest');
  assert.equal(short.options.vehicle_type, 'hgv');
  const alt = buildDirectionsRequest({ start, end, vehicle: v, alternatives: 3 }).body;
  assert.deepEqual(alt.alternative_routes, { target_count: 3 });
  assert.deepEqual(alt.coordinates, [start, end]);
  assert.ok(alt.options.profile_params.restrictions.height);
  assert.throws(() => buildDirectionsRequest({ start, end, vehicle: v, preference: 'eco' }), /Préférence/);
  assert.throws(() => buildDirectionsRequest({ start, end, vehicle: v, alternatives: 4 }), /alternatifs/);
  assert.throws(() => buildDirectionsRequest({ start, end, vehicle: v, alternatives: 1 }), /alternatifs/);
});
