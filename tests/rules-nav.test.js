// Phase 5 : réglementation dans le moteur de guidage, avec des positions envoyées comme le vrai GPS (une par seconde,
// vitesse fournie) : ZFE interdite annoncée une fois vers 5 km, bandeau, interdiction PL annoncée avant 22 h,
// rien de dit si le réglage voix est coupé, ZFE replacée après un recalcul.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFixes } from './helpers.js';
import { startNavigation, updateNavigation, rerouteDone } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { parseZfeData } from '../src/lib/zfe.js';
import { routeRules } from '../src/lib/route-rules.js';

const square = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const zfe = parseZfeData({
  updated: '2026-03-26',
  zones: [{ id: 'TEST-ZFE-001', name: 'Testville', start: '2025-01-01', end: null, pl: { critair: 'V3', hours: '24/7' }, vul: { critair: 'V3', hours: '24/7' }, polygons: [square(5.2, 45.0, 5.3, 45.1)] }],
  voies: [],
});
const semi = { name: 'Semi', weight: 44, critair: '4', banStatus: 'concerned' };

/** 40 km plein est à la latitude 45,05 : la ZFE commence vers le km 23,5. */
function eastRoute() {
  const n = 400;
  const coords = Array.from({ length: n + 1 }, (_, i) => [4.9 + (0.5 * i) / n, 45.05]);
  return { coordinates: coords, steps: [{ name: 'D 1', instruction: 'Suivez la D 1', type: 11, wayPoints: [0, n], duration: 1800, distance: 39000 }], duration: 1800, distance: 39000, bbox: [4.9, 45.05, 5.4, 45.05] };
}

/** Positions « GPS » à 90 km/h, une par seconde (le simulateur sert de récepteur : vitesse, cap, précision 5 m). */
function drive(route, t0, seconds) {
  const sim = createSimulator(route.coordinates, { speedKmh: 90 });
  return Array.from({ length: seconds }, (_, i) => sim.next(t0 + i * 1000));
}

test('ZFE interdite : bandeau sous 20 km, une seule annonce vers 5 km, rien d\'autre', () => {
  const route = eastRoute();
  const t0 = new Date(2026, 10, 18, 10).getTime(); // mercredi 10 h : pas d'interdiction PL
  const s0 = startNavigation(route, { now: t0, rules: { vehicle: semi, zfe, voice: true } });
  assert.equal(s0.zfe.length, 1);
  const { events, views } = runFixes(updateNavigation, s0, drive(route, t0, 1100));
  const zfeSpeech = events.filter((e) => e.type === 'speak' && /zone à faibles émissions/.test(e.text));
  assert.equal(zfeSpeech.length, 1);
  assert.match(zfeSpeech[0].text, /^Attention, zone à faibles émissions Testville dans 5 kilomètres, interdite à votre véhicule\.$/);
  const enter = s0.zfe[0].enter;
  const at = zfeSpeech[0].view;
  const along = enter - parseFloat(at.rules.zfe.text.match(/dans ([\d,]+) km/)[1].replace(',', '.')) * 1000;
  assert.ok(enter - along <= 5000 && enter - along >= 4500, `annonce à ${enter - along} m`);
  assert.equal(views[0].rules.ban, null);
  assert.ok(views.some((v) => /^Dans la ZFE Testville/.test(v.rules.zfe?.text ?? '')));
  assert.ok(!events.some((e) => /Interdiction poids lourds/.test(e.text ?? '')));
});

test('voix coupée dans Réglages : bandeau seulement ; véhicule Crit\'Air 2 : rien', () => {
  const route = eastRoute();
  const t0 = new Date(2026, 10, 18, 10).getTime();
  const muted = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle: semi, zfe, voice: false } }), drive(route, t0, 1100));
  assert.ok(!muted.events.some((e) => /zone à faibles émissions/.test(e.text ?? '')));
  assert.ok(muted.views.some((v) => v.rules.zfe));
  const clean = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle: { ...semi, critair: '2' }, zfe, voice: true } }), drive(route, t0, 1100));
  assert.ok(clean.views.every((v) => v.rules.zfe === null));
});

test('samedi 20 h 55, arrivée après 22 h : annonces à 21 h et 21 h 45, puis « en cours » à 22 h', () => {
  // 3 h de route à 90 km/h depuis samedi 20 h 55 : l'arrivée est après 22 h.
  const n = 600;
  const coords = Array.from({ length: n + 1 }, (_, i) => [2.0 + (3.6 * i) / n, 47.0]);
  const route = { coordinates: coords, steps: [{ name: 'A 71', instruction: 'Suivez l\'A 71', type: 11, wayPoints: [0, n], duration: 3 * 3600, distance: 270000 }], duration: 3 * 3600, distance: 270000, bbox: [2, 47, 5.6, 47] };
  const t0 = new Date(2026, 10, 21, 20, 55).getTime();
  const { events, views } = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle: semi, zfe, voice: true } }), drive(route, t0, 3600 + 400));
  const bans = events.filter((e) => /Interdiction poids lourds/.test(e.text ?? ''));
  assert.deepEqual(bans.map((e) => new Date(e.t).toTimeString().slice(0, 5)), ['21:00', '21:45', '22:00']);
  assert.match(bans[0].text, /à partir de 22 heures, dans une heure/);
  assert.match(bans[2].text, /en cours jusqu'à dimanche 22 heures/);
  assert.match(views[600].rules.ban.text, /^Interdiction PL dans \d+ min \(samedi 22 h\)$/);
  // Véhicule de moins de 7,5 t : jamais.
  const light = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle: { ...semi, weight: 7.5 }, zfe, voice: true } }), drive(route, t0, 3600 + 400));
  assert.ok(!light.events.some((e) => /Interdiction poids lourds/.test(e.text ?? '')));
});

test('recalcul : ZFE replacées sur le nouvel itinéraire (sans données réseau), et fiche avant le départ', () => {
  const route = eastRoute();
  const t0 = new Date(2026, 10, 18, 10).getTime();
  const s = startNavigation(route, { now: t0, rules: { vehicle: semi, zfe, voice: true } });
  const north = { ...route, coordinates: route.coordinates.map(([x]) => [x, 45.2]) }; // contourne la zone
  const r = rerouteDone({ ...s, lastFixAt: t0 + 60000 }, north);
  assert.equal(r.state.zfe.length, 0);
  const rules = routeRules(route, { vehicle: semi, departure: new Date(t0), zfe });
  assert.deepEqual(rules.short, ['ZFE Testville interdite']);
  assert.equal(rules.lines[0].level, 'warn');
  // Sans profil (ancien appel) : aucune règle, aucun plantage.
  const plain = runFixes(updateNavigation, startNavigation(route, { now: t0 }), drive(route, t0, 20));
  assert.ok(plain.views.every((v) => v.rules.zfe === null && v.rules.ban === null));
});
