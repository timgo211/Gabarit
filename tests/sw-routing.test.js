import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheStrategy, MAPLIBRE_ASSETS } from '../src/lib/sw-routing.js';

const ORIGIN = 'https://exemple.github.io';

test('les appels API ne sont jamais mis en cache', () => {
  assert.equal(cacheStrategy('POST', 'https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson', ORIGIN), 'bypass');
  assert.equal(cacheStrategy('GET', 'https://api.heigit.org/pelias/v1/autocomplete?text=Lyon&api_key=x', ORIGIN), 'bypass');
  assert.equal(cacheStrategy('GET', 'https://tiles.openfreemap.org/styles/liberty', ORIGIN), 'bypass');
  assert.equal(cacheStrategy('GET', 'https://tiles.versatiles.org/tiles/osm/5/16/11', ORIGIN), 'bypass');
});

test('interface en network-first, MapLibre épinglé en cache-first', () => {
  assert.equal(cacheStrategy('GET', `${ORIGIN}/gabarit/`, ORIGIN), 'network-first');
  assert.equal(cacheStrategy('GET', `${ORIGIN}/gabarit/index.html`, ORIGIN), 'network-first');
  assert.equal(cacheStrategy('GET', `${ORIGIN}/gabarit/src/app.js`, ORIGIN), 'network-first');
  for (const u of MAPLIBRE_ASSETS) assert.equal(cacheStrategy('GET', u, ORIGIN), 'cache-first');
  assert.equal(cacheStrategy('GET', 'https://unpkg.com/autre@1.0.0/x.js', ORIGIN), 'bypass');
  assert.equal(cacheStrategy('GET', 'pas une url', ORIGIN), 'bypass');
});

test('aires (phase 9) : Overpass jamais mis en cache, jeu officiel copié servi réseau d\'abord', () => {
  assert.equal(cacheStrategy('POST', 'https://overpass-api.de/api/interpreter', ORIGIN), 'bypass');
  assert.equal(cacheStrategy('POST', 'https://overpass.private.coffee/api/interpreter', ORIGIN), 'bypass');
  assert.equal(cacheStrategy('GET', 'https://overpass-api.de/api/interpreter?data=x', ORIGIN), 'bypass');
  assert.equal(cacheStrategy('GET', `${ORIGIN}/gabarit/data/aires-pl.json`, ORIGIN), 'network-first');
});
