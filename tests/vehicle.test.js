import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultVehicle, normalizeVehicle, validateVehicle, parseNumber } from '../src/lib/vehicle.js';

test('le profil par défaut est valide', () => {
  assert.deepEqual(validateVehicle(defaultVehicle()), { valid: true, errors: {} });
});

test('parseNumber accepte la virgule française', () => {
  assert.equal(parseNumber('3,85'), 3.85);
  assert.equal(parseNumber(' 4.2 '), 4.2);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('4 m')));
});

test('normalisation depuis un formulaire', () => {
  const v = normalizeVehicle({ name: ' Porteur ', height: '3,5', width: '2,55', length: '10', weight: '19',
    axleload: '', maxSpeed: '90', consumption: '', hazmat: 'on', critair: '2' });
  assert.equal(v.name, 'Porteur');
  assert.equal(v.height, 3.5);
  assert.equal(v.axleload, null);
  assert.equal('hazmat' in v, false, 'ADR : dans Réglages, plus dans le profil');
  assert.equal(v.critair, '2');
  assert.equal(validateVehicle(v).valid, true);
});

test('champs obligatoires et bornes', () => {
  const v = normalizeVehicle({ name: '', height: '45', width: 'abc', length: '', weight: '44', maxSpeed: '90' });
  const { valid, errors } = validateVehicle(v);
  assert.equal(valid, false);
  assert.ok(errors.name);
  assert.match(errors.height, /entre 1 et 6/);
  assert.match(errors.width, /nombre attendu/);
  assert.match(errors.length, /obligatoire/);
  assert.equal(errors.weight, undefined);
});

test('charge à l\'essieu supérieure au PTAC refusée', () => {
  const v = { ...defaultVehicle(), weight: 7.5, axleload: 11.5 };
  assert.ok(validateVehicle(v).errors.axleload);
});

test('vignette Crit\'Air inconnue → NC à la normalisation', () => {
  assert.equal(normalizeVehicle({ critair: '9' }).critair, 'NC');
  assert.ok(validateVehicle({ ...defaultVehicle(), critair: '9' }).errors.critair);
});

test('phase 5 : situation vis-à-vis des interdictions PL (concerné par défaut, valeur inconnue refusée à la lecture)', async () => {
  const { normalizeVehicle, validateVehicle, defaultVehicle } = await import('../src/lib/vehicle.js');
  assert.equal(defaultVehicle().banStatus, 'concerned');
  assert.equal(normalizeVehicle({ name: 'X' }).banStatus, 'concerned', 'ancien profil');
  assert.equal(normalizeVehicle({ ...defaultVehicle(), banStatus: 'art4' }).banStatus, 'art4');
  assert.equal(normalizeVehicle({ ...defaultVehicle(), banStatus: 'n\'importe quoi' }).banStatus, 'concerned');
  assert.equal(validateVehicle({ ...normalizeVehicle(defaultVehicle()), banStatus: 'x' }).errors.banStatus, 'Valeur invalide.');
});
