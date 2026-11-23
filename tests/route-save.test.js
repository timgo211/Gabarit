// v53 : mémoire de l'itinéraire en arrière-plan (src/lib/route-save.js) et reprise du guidage (resumeNavigation).
// Fixture : ors-directions-sortie.json (itinéraire synthétique déjà utilisé par directions.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ROUTE_SAVE, RESUME_QUESTION, buildSave, checkSave, isValidSave, restoredChoice, saveKey, shouldSave, withoutSecrets,
} from '../src/lib/route-save.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { startNavigation, resumeNavigation, updateNavigation } from '../src/lib/navigation.js';

const route = parseDirections(JSON.parse(readFileSync(new URL('./fixtures/ors-directions-sortie.json', import.meta.url), 'utf8')));
const vehicles = [{ id: 'v1', name: 'Porteur' }, { id: 'v2', name: 'Semi' }];
const end = route.coordinates[route.coordinates.length - 1];
const choice = {
  options: [{ key: 'recommended', label: 'Recommandé', route }, { key: 'shortest', label: 'Plus court', route }],
  selected: 1, start: route.coordinates[0], end, restr: null, avoidTolls: true, avoidFerries: false,
  fromLabel: 'Ma position', toLabel: 'Metz', startIsMyPosition: true,
  vehicle: { id: 'v1', name: 'Porteur', weight: 19 }, failures: [new Error('x')],
};
const H = 3600 * 1000;

test('sauvegarde : itinéraire en préparation et guidage, profil par identifiant seulement, aucun secret', () => {
  const plan = buildSave({ kind: 'plan', choice, vehicleId: 'v1', now: 1000 });
  assert.equal(plan.format, ROUTE_SAVE.FORMAT);
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.vehicleId, 'v1');
  assert.equal(plan.choice.vehicle, undefined, 'jamais une copie du profil');
  assert.equal(plan.choice.failures, undefined);
  assert.equal(plan.choice.selected, 1);
  assert.equal(plan.choice.options[0].key, 'recommended', 'clé de variante gardée (pas un secret)');
  assert.equal(plan.progress, undefined);
  const nav = buildSave({ kind: 'nav', choice, vehicleId: 'v1', along: 523.4, segIndex: 7, now: 2000 });
  assert.deepEqual(nav.progress, { along: 523.4, segIndex: 7, nextStop: 0, drivenBefore: 0, tripStartedAt: null, stopsDone: [] });
  // Champ secret glissé n'importe où : retiré.
  const leaky = { ...choice, options: [{ ...choice.options[0], apiKey: 'SECRET1', route: { ...route, meta: { orsKey: 'SECRET2', token: 'SECRET3' } } }] };
  const text = JSON.stringify(buildSave({ kind: 'plan', choice: leaky, vehicleId: 'v1', now: 1 }));
  assert.doesNotMatch(text, /SECRET/);
  assert.deepEqual(withoutSecrets({ a: 1, Authorization: 'x', nested: [{ password: 'p', b: 2 }] }), { a: 1, nested: [{ b: 2 }] });
  // Rien à garder.
  assert.equal(buildSave({ kind: 'plan', choice: null, vehicleId: 'v1', now: 1 }), null);
  assert.equal(buildSave({ kind: 'sim', choice, vehicleId: 'v1', now: 1 }), null);
  assert.equal(buildSave({ kind: 'plan', choice, vehicleId: '', now: 1 }), null);
  assert.equal(buildSave({ kind: 'plan', choice: { ...choice, options: [{ route: { coordinates: [[1, 2]] } }] }, vehicleId: 'v1', now: 1 }), null);
});

test('restauration : moins de 12 h → reprise seule ; plus de 12 h → question ; 12 h pile → reprise', () => {
  const save = buildSave({ kind: 'nav', choice, vehicleId: 'v1', along: 10, now: 0 });
  assert.deepEqual(checkSave(save, { now: 3 * H, vehicles }), { action: 'restore' });
  assert.deepEqual(checkSave(save, { now: 12 * H, vehicles }), { action: 'restore' });
  assert.deepEqual(checkSave(save, { now: 12 * H + 1, vehicles }), { action: 'ask' });
  assert.equal(RESUME_QUESTION, 'Reprendre l\'itinéraire ?');
  const back = restoredChoice(save, vehicles);
  assert.equal(back.vehicle, vehicles[0], 'profil actuel, retrouvé par son identifiant');
  assert.equal(back.selected, 1);
  assert.deepEqual(back.failures, []);
  assert.equal(back.toLabel, 'Metz');
  // Passée par JSON (IndexedDB copie la valeur) : identique.
  assert.deepEqual(checkSave(JSON.parse(JSON.stringify(save)), { now: 1, vehicles }), { action: 'restore' });
});

test('sauvegarde ignorée : rien, format différent, contenu illisible, profil supprimé, date dans le futur', () => {
  const save = buildSave({ kind: 'plan', choice, vehicleId: 'v2', now: 100 });
  assert.deepEqual(checkSave(null, { now: 0, vehicles }), { action: 'none' });
  assert.deepEqual(checkSave(undefined, { now: 0, vehicles }), { action: 'none' });
  assert.equal(checkSave({ ...save, format: 2 }, { now: 200, vehicles }).action, 'ignore');
  assert.equal(checkSave({ ...save, format: 2 }, { now: 200, vehicles }).reason, 'format');
  assert.equal(checkSave({ ...save, kind: 'sim' }, { now: 200, vehicles }).action, 'ignore');
  assert.equal(checkSave({ ...save, choice: { ...save.choice, selected: 9 } }, { now: 200, vehicles }).action, 'ignore');
  assert.equal(checkSave({ ...save, choice: { ...save.choice, end: null } }, { now: 200, vehicles }).action, 'ignore');
  assert.equal(checkSave({ ...save, kind: 'nav' }, { now: 200, vehicles }).action, 'ignore', 'guidage sans progression');
  assert.equal(checkSave('texte', { now: 200, vehicles }).action, 'ignore');
  assert.deepEqual(checkSave(save, { now: 200, vehicles: [vehicles[0]] }), { action: 'ignore', reason: 'vehicle' });
  assert.equal(checkSave(save, { now: 50, vehicles }).action, 'ignore');
  assert.equal(isValidSave(save), true);
  assert.equal(restoredChoice({ ...save, format: 0 }, vehicles), null);
  assert.equal(restoredChoice(save, []), null);
});

test('écritures limitées : au plus toutes les 30 s, tout de suite en arrière-plan ou au changement d\'état', () => {
  const key = saveKey('nav', choice);
  assert.equal(shouldSave(null, { now: 0, key }), true);
  assert.equal(shouldSave({ at: 0, key }, { now: 29999, key }), false);
  assert.equal(shouldSave({ at: 0, key }, { now: 30000, key }), true);
  assert.equal(shouldSave({ at: 0, key }, { now: 10, key, force: true }), true, 'page cachée');
  assert.equal(shouldSave({ at: 0, key }, { now: 10, key: saveKey('plan', choice) }), true, 'guidage ↔ préparation');
  assert.notEqual(saveKey('plan', choice), saveKey('plan', { ...choice, selected: 0, options: [{ route: { coordinates: [[0, 0], [1, 1]] } }] }));
  assert.equal(saveKey('plan', null), 'plan:-');
});

test('reprise du guidage : à l\'étape gardée, consignes passées non rejouées, pas de « Guidage démarré »', () => {
  const st = startNavigation(route, { now: 1000 });
  const total = st.route.line.total;
  const at = st.route.maneuvers[1].at + 50;
  const r = resumeNavigation(st, { along: at, segIndex: 3 });
  assert.equal(r.along, at);
  assert.equal(r.started, true);
  assert.equal(r.resumed, true);
  assert.equal(r.announced[1], 'now', 'manœuvre déjà passée');
  assert.equal(r.announced[st.route.maneuvers.length - 1], undefined, 'arrivée pas encore annoncée');
  assert.equal(resumeNavigation(st, { along: 1e9 }).along, total, 'borné au tracé');
  assert.equal(resumeNavigation(st, { along: -5, segIndex: 1e6 }).segIndex, null);
  // Position suivante sur le tracé, après la manœuvre 1 : aucune annonce de départ ni de la manœuvre passée.
  const p = st.route.line.coords[Math.min(st.route.line.coords.length - 1, 25)];
  const out = updateNavigation(r, { lon: p[0], lat: p[1], accuracy: 5, speed: 20, heading: 45, timestamp: 2000 });
  assert.ok(!out.events.some((e) => e.type === 'speak' && /^Restez à droite\.?$/.test(e.text)), 'consigne passée non rejouée');
});
