// Saisie dans le champ départ / arrivée : ce que la liste montre pendant la frappe (bug « appui long puis saisie »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestionPlan } from '../src/lib/coords.js';

test('chaque frappe vide la liste : jamais une ancienne suggestion (point de l\'appui long) à toucher', () => {
  // Texte ≥ 3 caractères qui n'est pas une coordonnée : liste vide tout de suite, recherche ensuite.
  assert.deepEqual(suggestionPlan('Lyon715'), { items: [], search: 'Lyon715' });
  assert.deepEqual(suggestionPlan('  Metz '), { items: [], search: 'Metz' });
  // Moins de 3 caractères : liste vide, pas de recherche.
  assert.deepEqual(suggestionPlan('Ly'), { items: [], search: null });
  assert.deepEqual(suggestionPlan(''), { items: [], search: null });
  // Coordonnées : une seule suggestion, sans recherche.
  assert.deepEqual(suggestionPlan('48.6921, 6.1844'), {
    items: [{ label: '48,69210, 6,18440', lon: 6.1844, lat: 48.6921 }], search: null,
  });
});
