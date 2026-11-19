import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDistance, formatDuration, formatArrival, formatLiters, formatNavDistance, formatSpeed,
  formatDurationDelta, formatDistanceDelta, formatEuros, formatPricePerLiter,
} from '../src/lib/format.js';
import { resolveTheme } from '../src/lib/theme.js';

test('distances', () => {
  assert.equal(formatDistance(850), '850 m');
  assert.equal(formatDistance(3500.4), '3,5 km');
  assert.equal(formatDistance(123456), '123 km');
  assert.equal(formatDistance(-1), '—');
});

test('durées', () => {
  assert.equal(formatDuration(2700), '45 min');
  assert.equal(formatDuration(7500), '2 h 05');
  assert.equal(formatDuration(null), '—');
});

test('heure d\'arrivée, avec changement de jour', () => {
  const now = new Date(2026, 10, 19, 14, 0);
  assert.equal(formatArrival(now, 1920), '14:32');
  assert.equal(formatArrival(new Date(2026, 10, 19, 22, 30), 3 * 3600), '01:30 (+1 j)');
});

test('litres', () => {
  assert.equal(formatLiters(52.44), '52,4 L');
});

test('thème auto : nuit de 20 h à 7 h', () => {
  assert.equal(resolveTheme('auto', new Date(2026, 0, 1, 21)), 'night');
  assert.equal(resolveTheme('auto', new Date(2026, 0, 1, 6, 59)), 'night');
  assert.equal(resolveTheme('auto', new Date(2026, 0, 1, 7)), 'day');
  assert.equal(resolveTheme('night', new Date(2026, 0, 1, 12)), 'night');
  assert.equal(resolveTheme('day', new Date(2026, 0, 1, 23)), 'day');
});

test('distance du guidage et vitesse', () => {
  assert.equal(formatNavDistance(487), '490 m');
  assert.equal(formatNavDistance(3), '0 m');
  assert.equal(formatNavDistance(996), '1,0 km');
  assert.equal(formatNavDistance(1480), '1,5 km');
  assert.equal(formatNavDistance(-1), '—');
  assert.equal(formatSpeed(87.6), '88 km/h');
  assert.equal(formatSpeed(null), '—');
});

test('écarts signés avec le premier itinéraire', () => {
  assert.equal(formatDurationDelta(360), '+6 min');
  assert.equal(formatDurationDelta(-3900), '\u22121 h 05');
  assert.equal(formatDurationDelta(20), '±0 min');
  assert.equal(formatDurationDelta(null), '—');
  assert.equal(formatDistanceDelta(-12345), '\u221212 km');
  assert.equal(formatDistanceDelta(2400), '+2,4 km');
  assert.equal(formatDistanceDelta(-430), '\u2212430 m');
  assert.equal(formatDistanceDelta(30), '±0 km');
  assert.equal(formatDistanceDelta(9960), '+10 km');
});

test('euros et prix au litre', () => {
  assert.equal(formatEuros(91.6), '92 €');
  assert.equal(formatEuros(2.66), '2,7 €');
  assert.equal(formatEuros(-1), '—');
  assert.equal(formatPricePerLiter(1.85), '1,85');
  assert.equal(formatPricePerLiter(1.859), '1,859');
  assert.equal(formatPricePerLiter(2), '2,00');
  assert.equal(formatPricePerLiter(null), '');
});
