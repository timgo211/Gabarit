// Phase 2c : badges de référence de route du bandeau de guidage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roadLabel, BADGE_COLORS } from '../src/lib/road-badge.js';
import { contrastRatio, AA_TEXT } from '../src/lib/contrast.js';

test('références seules : D jaune, N et A rouges, E vert, autres gris', () => {
  assert.deepEqual(roadLabel('D 83').badges.map((b) => [b.ref, b.kind]), [['D 83', 'D']]);
  assert.equal(roadLabel('D 83').street, '');
  assert.equal(roadLabel('A89').badges[0].ref, 'A 89');
  assert.equal(roadLabel('A89').badges[0].bg, BADGE_COLORS.A.bg);
  assert.equal(roadLabel('RN7').badges[0].ref, 'N 7');
  assert.equal(roadLabel('E 25').badges[0].kind, 'E');
  assert.equal(roadLabel('M 6').badges[0].kind, 'other');
  assert.equal(roadLabel('D 1083a').badges[0].ref, 'D 1083A');
});

test('nom de rue et référence mêlés', () => {
  const r = roadLabel('Route de Lyon, D 906');
  assert.deepEqual(r.badges.map((b) => b.ref), ['D 906']);
  assert.equal(r.street, 'Route de Lyon');
  const p = roadLabel('Avenue Foch (N 83)');
  assert.deepEqual([p.badges[0].ref, p.street], ['N 83', 'Avenue Foch']);
  const two = roadLabel('A 6; E 15');
  assert.deepEqual(two.badges.map((b) => b.ref), ['A 6', 'E 15']);
});

test('nom sans référence, vide ou « - »', () => {
  assert.deepEqual(roadLabel('Rue Nationale'), { badges: [], street: 'Rue Nationale' });
  assert.deepEqual(roadLabel('Boulevard de la Croix-Rousse').badges, []);
  assert.deepEqual(roadLabel(''), { badges: [], street: '' });
  assert.deepEqual(roadLabel('-'), { badges: [], street: '' });
  assert.deepEqual(roadLabel(null), { badges: [], street: '' });
  // « Rue A » n'est pas une référence (lettre sans chiffre) ; « Quai 3 » non plus.
  assert.deepEqual(roadLabel('Quai 3').badges, []);
});

test('contraste AA du texte des cartouches', () => {
  for (const [k, c] of Object.entries(BADGE_COLORS)) assert.ok(contrastRatio(c.fg, c.bg) >= AA_TEXT, k);
});
