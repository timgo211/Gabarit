import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryStorage, emptyData, exportData, importData, activeVehicle, addTrip, API_KEY_KEY, MAX_TRIPS }
  from '../src/lib/store.js';

test('données vides par défaut avec un véhicule actif', () => {
  const s = createStore(memoryStorage());
  const d = s.load();
  assert.equal(d.vehicles.length, 1);
  assert.equal(activeVehicle(d).id, d.activeVehicleId);
});

test('sauvegarde puis rechargement', () => {
  const s = createStore(memoryStorage());
  const d = emptyData();
  d.settings.theme = 'night';
  s.save(d);
  assert.equal(s.load().settings.theme, 'night');
});

test('l\'export ne contient jamais la clé ORS', () => {
  const storage = memoryStorage();
  const s = createStore(storage);
  s.setApiKey('CLE-FACTICE-NE-DOIT-PAS-SORTIR');
  const json = exportData({ ...s.load(), apiKey: 'CLE-FACTICE-NE-DOIT-PAS-SORTIR' });
  assert.ok(!json.includes('CLE-FACTICE'));
  assert.equal(storage.getItem(API_KEY_KEY), 'CLE-FACTICE-NE-DOIT-PAS-SORTIR');
  assert.equal(JSON.parse(json).app, 'gabarit');
});

test('import d\'un export : aller-retour', () => {
  const d = emptyData();
  const back = importData(exportData(d));
  assert.deepEqual(back.vehicles, d.vehicles);
  assert.equal(back.activeVehicleId, d.activeVehicleId);
});

test('import refusé : JSON invalide, autre appli, véhicule invalide', () => {
  assert.throws(() => importData('pas du json'), /JSON valide/);
  assert.throws(() => importData('{"app":"autre","vehicles":[]}'), /Gabarit/);
  assert.throws(() => importData('{"vehicles":[{"name":"x","height":99}]}'), /Véhicule n°1/);
  assert.throws(() => importData('[]'), /objet JSON/);
});

test('import : profil actif inexistant → premier véhicule', () => {
  const d = emptyData();
  const back = importData(JSON.stringify({ ...d, activeVehicleId: 'nope' }));
  assert.equal(back.activeVehicleId, back.vehicles[0].id);
});

test('historique des trajets borné', () => {
  let d = emptyData();
  for (let i = 0; i < MAX_TRIPS + 5; i += 1) d = addTrip(d, { n: i });
  assert.equal(d.trips.length, MAX_TRIPS);
  assert.equal(d.trips[0].n, MAX_TRIPS + 4);
});

test('clé vide → supprimée', () => {
  const s = createStore(memoryStorage());
  s.setApiKey('  abc  ');
  assert.equal(s.getApiKey(), 'abc');
  s.setApiKey('');
  assert.equal(s.getApiKey(), '');
});
