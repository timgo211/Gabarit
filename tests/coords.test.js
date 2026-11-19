// Coordonnées GPS saisies dans le champ départ / arrivée (phase 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinates, coordsLabel } from '../src/lib/coords.js';

const near = (r, lat, lon, eps = 1e-6) => {
  assert.ok(r, 'coordonnées lues');
  assert.ok(Math.abs(r.lat - lat) < eps && Math.abs(r.lon - lon) < eps, JSON.stringify(r));
};
// 48°41'31.6"N 6°11'03.8"E = 48 + 41/60 + 31,6/3600 ; 6 + 11/60 + 3,8/3600
const NANCY = [48 + 41 / 60 + 31.6 / 3600, 6 + 11 / 60 + 3.8 / 3600];

test('décimal : point ou virgule décimale, séparateurs usuels', () => {
  for (const t of ['48.6921, 6.1844', '48.6921,6.1844', '48.6921 6.1844', '48.6921;6.1844', ' 48.6921 ; 6.1844 ',
    '48,6921 6,1844', '48,6921; 6,1844', '48,6921, 6,1844', '+48.6921, +6.1844']) {
    near(parseCoordinates(t), 48.6921, 6.1844);
  }
  near(parseCoordinates('-21.1151, 55.5364'), -21.1151, 55.5364); // La Réunion
  near(parseCoordinates('43.3, -1.48'), 43.3, -1.48); // ouest de Greenwich
  near(parseCoordinates('48, 6'), 48, 6);
});

test('degrés-minutes-secondes et degrés-minutes décimales', () => {
  near(parseCoordinates('48°41\'31.6"N 6°11\'03.8"E'), ...NANCY);
  near(parseCoordinates('48°41′31.6″N 6°11′03.8″E'), ...NANCY);
  near(parseCoordinates('48°41’31,6”N, 6°11’03,8”E'), ...NANCY);
  near(parseCoordinates('N 48°41\'31.6" E 6°11\'03.8"'), ...NANCY);
  near(parseCoordinates('6°11\'03.8"E 48°41\'31.6"N'), ...NANCY);
  near(parseCoordinates('48°41.527\'N 6°11.063\'E'), 48 + 41.527 / 60, 6 + 11.063 / 60);
  near(parseCoordinates('48.6921 N 6.1844 E'), 48.6921, 6.1844);
  near(parseCoordinates('48°41\'31.6"n 6°11\'03.8"e'), ...NANCY);
  near(parseCoordinates('43°18\'N 1°28\'48"O'), 43.3, -1.48); // O = Ouest
  near(parseCoordinates('43°18\'N 1°28\'48"W'), 43.3, -1.48);
  near(parseCoordinates('S 21°6\'54" E 55°32\'11"'), -(21 + 6 / 60 + 54 / 3600), 55 + 32 / 60 + 11 / 3600);
});

test('pas des coordonnées : adresses, nombres seuls, valeurs hors bornes, formats ambigus', () => {
  for (const t of ['', '   ', 'Lyon', 'Lyon 3e', 'A6 sortie 34', '12 rue de la Paix', '48.6921', '48.6921, 6.1844, 3',
    '91, 6', '48, 181', '-91, 0', '48°61\'N 6°E', '48°41\'75"N 6°E', '48°N', 'N N 48° 6°', '48°N 6°N', '48°E 6°E',
    '-48°N 6°E', 'abc, def', null, undefined, 42, '1'.repeat(200)]) {
    assert.equal(parseCoordinates(t), null, String(t));
  }
});

test('libellé : 5 décimales à la française', () => {
  assert.equal(coordsLabel({ lat: 48.6921, lon: 6.1844 }), '48,69210, 6,18440');
  assert.equal(coordsLabel({ lat: -21.11512345, lon: -1.5 }), '-21,11512, -1,50000');
});
