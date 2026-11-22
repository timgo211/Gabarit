// Phase 2c : badges de référence de route du bandeau de guidage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roadLabel, keepRefsTogether, BADGE_COLORS } from '../src/lib/road-badge.js';
import { contrastRatio, AA_TEXT } from '../src/lib/contrast.js';

/** Références attendues : espaces insécables (jamais coupées entre deux lignes, phase 2e). */
const nb = (s) => s.replace(/ /g, '\u00A0');

test('références seules : D jaune, N et A rouges, E vert, autres gris', () => {
  assert.deepEqual(roadLabel('D 83').badges.map((b) => [b.ref, b.kind]), [[nb('D 83'), 'D']]);
  assert.equal(roadLabel('D 83').street, '');
  assert.equal(roadLabel('A89').badges[0].ref, nb('A 89'));
  assert.equal(roadLabel('A89').badges[0].bg, BADGE_COLORS.A.bg);
  assert.equal(roadLabel('RN7').badges[0].ref, nb('N 7'));
  assert.equal(roadLabel('E 25').badges[0].kind, 'E');
  assert.equal(roadLabel('M 6').badges[0].kind, 'other');
  assert.equal(roadLabel('D 1083a').badges[0].ref, nb('D 1083A'));
});

test('nom de rue et référence mêlés', () => {
  const r = roadLabel('Route de Lyon, D 906');
  assert.deepEqual(r.badges.map((b) => b.ref), [nb('D 906')]);
  assert.equal(r.street, 'Route de Lyon');
  const p = roadLabel('Avenue Foch (N 83)');
  assert.deepEqual([p.badges[0].ref, p.street], [nb('N 83'), 'Avenue Foch']);
  const two = roadLabel('A 6; E 15');
  assert.deepEqual(two.badges.map((b) => b.ref), [nb('A 6'), nb('E 15')]);
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

test('références avec suffixe (phase 2e) : D 120 E, D 57e2, N 83 bis, jamais coupées', () => {
  const r = roadLabel('Rue de Tortelet, D 120 E');
  assert.deepEqual([r.badges.map((b) => [b.ref, b.kind]), r.street], [[[nb('D 120 E'), 'D']], 'Rue de Tortelet']);
  assert.equal(roadLabel('D 57e2').badges[0].ref, nb('D 57E2'));
  assert.equal(roadLabel('N 83 bis').badges[0].ref, nb('N 83 bis'));
  assert.equal(roadLabel('N 83 bis').badges[0].bg, BADGE_COLORS.N.bg);
  assert.equal(roadLabel('RD 120 ter').badges[0].ref, nb('D 120 ter'));
  assert.equal(roadLabel('D 120 E').badges[0].bg, BADGE_COLORS.D.bg, 'couleurs inchangées');
  for (const t of ['D 120 E', 'D 57e2', 'N 83 bis', 'A 89']) assert.ok(!/ /.test(roadLabel(t).badges[0].ref), t);
  // Pas une référence : nom de rue avec suffixe trop long, lettre seule.
  assert.deepEqual(roadLabel('D 120 Est').badges, []);
  assert.deepEqual(roadLabel('Rue A').badges, []);
});

test('consigne sans badge : références gardées sur une ligne', () => {
  assert.equal(keepRefsTogether('Prenez la D 120 E en direction de Metz'), `Prenez la ${nb('D 120 E')} en direction de Metz`);
  assert.equal(keepRefsTogether('Sortie vers A 6 et N 83 bis'), `Sortie vers ${nb('A 6')} et ${nb('N 83 bis')}`);
  assert.equal(keepRefsTogether('Prenez la D 120 en direction de Metz'), `Prenez la ${nb('D 120')} en direction de Metz`);
  assert.equal(keepRefsTogether('Dans 300 m, tournez à droite'), 'Dans 300 m, tournez à droite');
  assert.equal(keepRefsTogether(null), '');
});

test('contraste AA du texte des cartouches', () => {
  for (const [k, c] of Object.entries(BADGE_COLORS)) assert.ok(contrastRatio(c.fg, c.bg) >= AA_TEXT, k);
});
