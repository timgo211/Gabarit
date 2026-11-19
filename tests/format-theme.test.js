import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, formatDuration, formatArrival, formatLiters } from '../src/lib/format.js';
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
