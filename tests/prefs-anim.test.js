// Phase 7c : couleur de la flèche, réglages de la voix, animation de la flèche entre deux positions GPS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARROW_COLORS, sanitizeArrowColor, arrowColors, sanitizeVoiceRate, sanitizeVoiceVolume, sanitizeVoiceName, VOICE_RATE,
} from '../src/lib/prefs.js';
import { planMove, frameAt, shortestTurn, ANIM } from '../src/lib/nav-anim.js';
import { frenchVoices, pickVoice } from '../src/lib/nav-guidance.js';
import { emptyData, sanitizeData } from '../src/lib/store.js';

test('couleur de la flèche : 4 choix + automatique (bleu le jour, orange la nuit)', () => {
  assert.deepEqual(Object.keys(ARROW_COLORS), ['bleu', 'vert', 'orange', 'violet']);
  for (const c of ['auto', 'bleu', 'vert', 'orange', 'violet']) assert.equal(sanitizeArrowColor(c), c);
  for (const c of ['rouge', '', null, 3, 'constructor', '__proto__']) assert.equal(sanitizeArrowColor(c), 'auto');
  assert.equal(arrowColors('auto', 'day'), ARROW_COLORS.bleu);
  assert.equal(arrowColors('auto', 'night'), ARROW_COLORS.orange);
  assert.equal(arrowColors('violet', 'night'), ARROW_COLORS.violet);
  for (const c of Object.values(ARROW_COLORS)) assert.match(c.fill, /^#[0-9a-f]{6}$/);
});

test('voix : vitesse et volume bornés, au dixième ; nom nettoyé', () => {
  assert.equal(sanitizeVoiceRate(1.2), 1.2);
  assert.equal(sanitizeVoiceRate('1,3'), 1.3);
  assert.equal(sanitizeVoiceRate(0.3), VOICE_RATE.min);
  assert.equal(sanitizeVoiceRate(4), VOICE_RATE.max);
  assert.equal(sanitizeVoiceRate(1.04), 1);
  assert.equal(sanitizeVoiceRate('vite'), 1);
  assert.equal(sanitizeVoiceRate(undefined), 1);
  assert.equal(sanitizeVoiceVolume(0.3), 0.3);
  assert.equal(sanitizeVoiceVolume(0), 0.2, 'jamais muet (bouton Voix pour couper)');
  assert.equal(sanitizeVoiceVolume(7), 1);
  assert.equal(sanitizeVoiceName('  Google français  '), 'Google français');
  assert.equal(sanitizeVoiceName(12), '');
});

test('réglages 7c gardés au chargement et à l\'import, valeurs par défaut sinon', () => {
  const d = emptyData();
  assert.equal(d.settings.arrowColor, 'auto');
  assert.equal(d.settings.voiceName, '');
  assert.equal(d.settings.voiceRate, 1);
  assert.equal(d.settings.voiceVolume, 1);
  const s = sanitizeData({ ...d, settings: { arrowColor: 'vert', voiceName: 'Amélie', voiceRate: 1.2, voiceVolume: 0.6 } }).settings;
  assert.deepEqual([s.arrowColor, s.voiceName, s.voiceRate, s.voiceVolume], ['vert', 'Amélie', 1.2, 0.6]);
  const bad = sanitizeData({ ...d, settings: { arrowColor: '<b>', voiceName: {}, voiceRate: 'x', voiceVolume: -1 } }).settings;
  assert.deepEqual([bad.arrowColor, bad.voiceName, bad.voiceRate, bad.voiceVolume], ['auto', '', 1, 0.2]);
});

test('voix françaises installées : triées, sans doublon ; voix choisie si encore là', () => {
  const voices = [
    { name: 'English', lang: 'en-US', localService: true },
    { name: 'Google français', lang: 'fr-FR', localService: false },
    { name: 'Amélie', lang: 'fr_CA', localService: true },
    { name: 'Thomas', lang: 'fr-FR', localService: true },
    { name: 'Thomas', lang: 'fr-FR', localService: true },
    { lang: 'fr-FR' },
  ];
  assert.deepEqual(frenchVoices(voices).map((v) => v.name), ['Thomas', 'Google français', 'Amélie']);
  assert.equal(pickVoice(voices, 'Amélie').name, 'Amélie');
  assert.equal(pickVoice(voices, 'Disparue').name, 'Thomas', 'voix désinstallée : meilleure voix française');
  assert.equal(pickVoice(voices, '').name, 'Thomas');
  assert.equal(pickVoice(voices, 'English').name, 'Thomas', 'pas une voix française');
  assert.deepEqual(frenchVoices(null), []);
});

test('flèche fluide : cap par le plus court chemin, position linéaire', () => {
  assert.equal(shortestTurn(350, 10), 20);
  assert.equal(shortestTurn(10, 350), -20);
  assert.equal(shortestTurn(0, 180), 180);
  const move = planMove({ lonlat: [6, 48], bearing: 350, zoom: 15 }, { lonlat: [6.001, 48.001], bearing: 10, zoom: 16 }, 1000, 130);
  assert.equal(move.duration, 1000);
  const mid = frameAt(move, 0.5);
  assert.ok(Math.abs(mid.lonlat[0] - 6.0005) < 1e-9 && Math.abs(mid.lonlat[1] - 48.0005) < 1e-9);
  assert.ok(Math.abs(mid.bearing) < 1e-9 || Math.abs(mid.bearing - 360) < 1e-9, `cap ${mid.bearing}`);
  assert.equal(mid.zoom, 15.5);
  assert.deepEqual(frameAt(move, 1).lonlat, [6.001, 48.001]);
  assert.equal(frameAt(move, 1).bearing, 10);
  assert.deepEqual(frameAt(move, 7).lonlat, [6.001, 48.001], 'borné à la fin');
});

test('flèche fluide : durée = intervalle GPS borné ; saut ou premier point : sans animation', () => {
  const a = { lonlat: [6, 48], bearing: 0 };
  const b = { lonlat: [6.0001, 48], bearing: 90 };
  assert.equal(planMove(a, b, 3000, 10).duration, ANIM.MAX_MS, 'pas de retard : jamais plus d\'1 s');
  assert.equal(planMove(a, b, 50, 10).duration, ANIM.MIN_MS);
  assert.equal(planMove(a, b, null, 10).duration, ANIM.DEFAULT_MS);
  for (const m of [planMove(null, b, 1000, 10), planMove(a, b, 1000, 800)]) {
    assert.equal(m.duration, 0);
    assert.deepEqual(frameAt(m, 0).lonlat, b.lonlat);
    assert.equal(frameAt(m, 0).bearing, 90);
  }
  // Cap inconnu (à l'arrêt) : pas d'orientation inventée.
  assert.equal(frameAt(planMove(a, { lonlat: [6, 48] , bearing: null }, 1000, 0), 0.5).bearing, null);
});
