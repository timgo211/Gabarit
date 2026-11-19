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
  assert.equal(v.hazmat, true);
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
