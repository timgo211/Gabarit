// Phase 3b — Lieux enregistrés : validation, ajout, renommage, suggestions sans appel, export complet seulement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVED, cleanPlace, sanitizePlaces, addPlace, editPlace, removePlace, matchSaved, savedToPick, placeSub, isSaved,
} from '../src/lib/saved-places.js';
import { suggestionRows } from '../src/lib/suggest.js';
import { emptyData, sanitizeData, exportData, importData } from '../src/lib/store.js';

let n = 0;
const makeId = () => `p-${(n += 1)}`;
// Lieux synthétiques (aucune adresse réelle d'une personne).
const DEPOT = { kind: 'depot', name: 'Dépôt Test', label: '1 rue Exemple, Villetest', lon: 5.5, lat: 47.25 };
const HOME = { kind: 'home', name: 'Maison', label: '', lon: 5.6, lat: 47.3 };

test('validation : champs connus seulement, catégorie par défaut client, nom tiré du libellé', () => {
  const c = cleanPlace({ ...DEPOT, id: 'a', secret: 'jamais', apiKey: 'x' });
  assert.deepEqual(Object.keys(c).sort(), ['id', 'kind', 'label', 'lat', 'lon', 'name']);
  assert.equal(cleanPlace({ label: 'Client A, Ville', lon: 5, lat: 47 }).kind, 'client');
  assert.equal(cleanPlace({ label: 'Client A, Ville', lon: 5, lat: 47 }).name, 'Client A, Ville');
  assert.equal(cleanPlace({ name: 'x', lon: 500, lat: 47 }), null);
  assert.equal(cleanPlace({ lon: 5, lat: 47 }), null);
  assert.equal(cleanPlace({ name: 'x'.repeat(200), lon: 5, lat: 47 }).name.length, SAVED.NAME_MAX);
  assert.equal(cleanPlace({ name: 'a\u0000b', lon: 5, lat: 47 }).name, 'a b');
});

test('liste : doublons de même catégorie écartés, 50 au plus', () => {
  const many = Array.from({ length: 70 }, (_, i) => ({ name: `C${i}`, lon: 5 + i * 0.01, lat: 47 }));
  assert.equal(sanitizePlaces(many).length, SAVED.MAX);
  assert.equal(sanitizePlaces([DEPOT, { ...DEPOT, name: 'Autre nom' }]).length, 1);
  assert.equal(sanitizePlaces([DEPOT, { ...DEPOT, kind: 'client' }]).length, 2);
  assert.deepEqual(sanitizePlaces({ pas: 'une liste' }), []);
});

test('ajout, renommage, suppression ; coordonnées refusées comme nom', () => {
  let list = addPlace([], DEPOT, { makeId });
  assert.throws(() => addPlace(list, DEPOT, { makeId }), /déjà enregistré/);
  assert.throws(() => addPlace(list, { kind: 'client', name: '48.69, 6.18', lon: 6.18, lat: 48.69 }, { makeId }), /Donne un nom/);
  list = addPlace(list, HOME, { makeId });
  const id = list[0].id;
  list = editPlace(list, id, { name: 'Dépôt Nord', kind: 'client' });
  assert.deepEqual([list[0].name, list[0].kind, list[0].lon], ['Dépôt Nord', 'client', DEPOT.lon]);
  assert.equal(editPlace(list, id, { name: '' })[0].name, 'Dépôt Nord');
  assert.equal(removePlace(list, id).length, 1);
});

test('suggestions : « Mes lieux » en tête, filtre sans accents, récents et ORS sans doublon', () => {
  const list = sanitizePlaces([DEPOT, HOME]);
  assert.deepEqual(matchSaved(list, '').map((p) => p.name), ['Maison', 'Dépôt Test']); // domicile d'abord
  assert.deepEqual(matchSaved(list, 'DEPOT').map((p) => p.name), ['Dépôt Test']);
  assert.deepEqual(matchSaved(list, 'villetest').map((p) => p.name), ['Dépôt Test']);
  const saved = matchSaved(list, '');
  const recent = [{ label: '1 rue Exemple, Villetest', name: 'x', place: '', lon: 5.5, lat: 47.25 }, { label: 'Lyon', name: 'Lyon', place: 'France', lon: 4.8, lat: 45.7 }];
  const items = [{ label: 'Lyon', name: 'Lyon', place: 'France', lon: 4.8, lat: 45.7 }, { label: 'Dijon', name: 'Dijon', place: 'France', lon: 5.04, lat: 47.32 }];
  const rows = suggestionRows({ status: 'results', items, recent, saved });
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.text}`), [
    'title:Mes lieux', 'saved:Maison', 'saved:Dépôt Test', 'title:Recherches récentes', 'recent:Lyon', 'place:Dijon',
  ]);
  assert.equal(rows.find((r) => r.kind === 'recent').index, 1); // indice dans la liste des récents
  assert.equal(placeSub(list.find((p) => p.kind === 'depot')), 'Dépôt · 1 rue Exemple, Villetest');
  assert.deepEqual(savedToPick(list[0]), { label: DEPOT.label, name: 'Dépôt Test', place: 'Dépôt', lon: 5.5, lat: 47.25 });
  assert.equal(isSaved(list, { label: 'autre', lon: 5.5, lat: 47.25 }), true);
  // Sans lieux enregistrés : lignes inchangées (v64).
  assert.deepEqual(suggestionRows({ status: 'empty', items: [], recent: [] }).map((r) => r.kind), ['info']);
});

test('stockage : validés au chargement, dans l\'export complet, sans la clé', () => {
  const d = sanitizeData({ ...emptyData(), places: [DEPOT, { name: 'x', lon: 'a', lat: 1 }, 'texte'] });
  assert.equal(d.places.length, 1);
  const out = JSON.parse(exportData(d, new Date(Date.UTC(2026, 10, 24))));
  assert.equal(out.places.length, 1);
  assert.equal(JSON.stringify(out).includes('orsKey'), false);
  assert.equal(importData(JSON.stringify(out)).places[0].name, 'Dépôt Test');
});
