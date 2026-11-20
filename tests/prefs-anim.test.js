// Phase 7c : couleur de la flèche, réglages de la voix, animation de la flèche entre deux positions GPS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARROW_COLORS, sanitizeArrowColor, arrowColors, sanitizeVoiceRate, sanitizeVoiceVolume, sanitizeVoiceName, VOICE_RATE,
} from '../src/lib/prefs.js';
import { planMove, frameAt, shortestTurn, ANIM, holdStill, samePadding } from '../src/lib/nav-anim.js';
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

test('flèche à l\'arrêt : sous 3 km/h ou sans changement, une seule image (pas d\'interpolation)', async () => {
  const { unchanged } = await import('../src/lib/nav-anim.js');
  const a = { lonlat: [6, 48], bearing: 90, zoom: 17, pitch: 50 };
  const drift = { lonlat: [6.0002, 48.0001], bearing: 90, zoom: 17, pitch: 50 }; // GPS qui dérive (≈ 18 m)
  for (const kmh of [0, 1.5, 2.99]) {
    const m = planMove(a, drift, 1000, 18, { speedKmh: kmh });
    assert.equal(m.duration, 0, `${kmh} km/h`);
    assert.deepEqual(frameAt(m, 0).lonlat, drift.lonlat, 'posée directement à la nouvelle position');
  }
  assert.equal(planMove(a, drift, 1000, 18, { speedKmh: 3 }).duration, 1000, 'dès 3 km/h : animée');
  assert.equal(planMove(a, drift, 1000, 18).duration, 1000, 'vitesse inconnue : animée');
  // Rien n'a changé (même à 50 km/h annoncés) : pas d'animation.
  const same = { ...a, lonlat: [6, 48.000001], bearing: 90.2, zoom: 17.005, pitch: 50.05 };
  assert.equal(unchanged(a, same, 0.1), true);
  assert.equal(planMove(a, same, 1000, 0.1, { speedKmh: 50 }).duration, 0);
  assert.equal(unchanged({ lonlat: [6, 48], bearing: null }, { lonlat: [6, 48], bearing: null }, 0), true);
  // Un seul élément qui change suffit à animer.
  for (const [k, v] of [['bearing', 95], ['zoom', 16.5], ['pitch', 40]]) {
    assert.equal(unchanged(a, { ...a, [k]: v }, 0), false, k);
    assert.equal(planMove(a, { ...a, [k]: v }, 1000, 0, { speedKmh: 20 }).duration, 1000, k);
  }
  assert.equal(unchanged(a, { ...a, bearing: null }, 0), false, 'cap perdu');
  assert.equal(unchanged(a, drift, 18), false, 'position changée');
  assert.equal(unchanged({ ...a, bearing: 359.9 }, { ...a, bearing: 0.1 }, 0), true, 'cap autour du nord');
});

test('arrêté, GPS qui dérive : flèche et carte figées (aucune image), sauf au-delà de 100 m', () => {
  const pad = { top: 300, right: 0, bottom: 40, left: 0 };
  const drawn = { lonlat: [6, 48], bearing: 90, follow: true, padding: pad };
  const next = { follow: true, padding: { ...pad } };
  assert.equal(holdStill(drawn, next, 60, 0), true, 'dérive de 60 m à 0 km/h');
  assert.equal(holdStill(drawn, next, 99, 2.9), true);
  assert.equal(holdStill(drawn, next, 120, 0), false, 'camion qui avance au pas : une image');
  assert.equal(holdStill(drawn, next, 20, 3), false, 'en roulant : interpolation habituelle');
  assert.equal(holdStill(drawn, next, 20, null), false, 'vitesse inconnue');
  assert.equal(holdStill(null, next, 0, 0), false, 'première position : dessinée');
  assert.equal(holdStill(drawn, { ...next, follow: false }, 10, 0), false, 'vue d\'ensemble / recentrer : redessiné');
  assert.equal(holdStill(drawn, { ...next, padding: { ...pad, top: 200 } }, 10, 0), false, 'bandeau qui change de taille');
  assert.equal(holdStill(drawn, next, NaN, 0), false);
  assert.equal(samePadding(null, undefined), true);
  assert.equal(samePadding(pad, { ...pad, top: 300.3 }), true, 'arrondi au pixel');
  assert.equal(samePadding(pad, null), false);
});
