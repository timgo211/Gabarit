// v64 : recherches récentes (src/lib/recent-places.js), menu de suggestions (suggest.js) et export / import (store.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT, normalizeText, recentEntry, addRecent, removeRecent, sanitizeRecent, mergeRecent, matchRecent, samePlace,
  createRecentStore, recentEditAllowed,
} from '../src/lib/recent-places.js';
import { suggestionRows } from '../src/lib/suggest.js';
import { emptyData, exportData, readExport, memoryStorage, sanitizeData, createStore, DATA_KEY } from '../src/lib/store.js';

const place = (i, extra = {}) => ({
  label: `Lieu ${i}, Ville ${i}, France`, name: `Lieu ${i}`, place: `${10000 + i} Ville ${i}, France`,
  lon: 2 + i / 100, lat: 45 + i / 100, ...extra,
});
const STE = { label: 'Saint-Étienne, Loire, France', name: 'Saint-Étienne', place: '42000 Saint-Étienne, France', lon: 4.3872, lat: 45.4397 };

test('ajout : en tête, champs gardés seulement (nom, commune / code postal, coordonnées)', () => {
  const l = addRecent(addRecent([], place(1)), { ...place(2), details: { street: 'x' }, area: 'Loire', postalcode: '1' });
  assert.deepEqual(l.map((p) => p.name), ['Lieu 2', 'Lieu 1']);
  assert.deepEqual(Object.keys(l[0]).sort(), ['label', 'lat', 'lon', 'name', 'place']);
});

test('jamais un texte tapé ni des coordonnées : lieu sans coordonnées ou libellé en coordonnées refusé', () => {
  assert.equal(recentEntry({ label: 'Lyon' }), null);
  assert.equal(recentEntry({ label: '48,69210, 6,18440', lon: 6.1844, lat: 48.6921 }), null);
  assert.equal(recentEntry({ label: 'X', lon: 200, lat: 10 }), null);
  assert.equal(recentEntry({ label: '  ', lon: 2, lat: 45 }), null);
  assert.deepEqual(addRecent([place(1)], { label: 'Lyon' }).length, 1);
});

test('doublon (coordonnées arrondies ou même libellé) : le lieu remonte en tête, une seule fois', () => {
  let l = [place(1), place(2), place(3)].reduce(addRecent, []);
  assert.deepEqual(l.map((p) => p.name), ['Lieu 3', 'Lieu 2', 'Lieu 1']);
  l = addRecent(l, { ...place(1), lon: place(1).lon + 0.00001, label: 'Autre libellé' }); // ≈ 1 m : même lieu
  assert.deepEqual(l.map((p) => p.name), ['Lieu 1', 'Lieu 3', 'Lieu 2']);
  assert.equal(l[0].label, 'Autre libellé');
  l = addRecent(l, { ...place(2), lon: 7, lat: 47, label: 'LIEU 2, ville 2, France' }); // même libellé, ailleurs
  assert.equal(l.length, 3);
  assert.equal(l[0].lon, 7);
  assert.ok(samePlace(STE, { ...STE, label: 'saint etienne, loire, france', lon: 0, lat: 0 }));
});

test('limite de 20 : les plus anciens retirés', () => {
  let l = [];
  for (let i = 0; i < 25; i += 1) l = addRecent(l, place(i));
  assert.equal(l.length, RECENT.MAX);
  assert.equal(l[0].name, 'Lieu 24');
  assert.equal(l.at(-1).name, 'Lieu 5');
});

test('filtre sans accents ni majuscules ; champ vide : les 5 derniers', () => {
  const l = [place(1), STE, place(2), place(3), place(4), place(5), place(6)];
  assert.equal(normalizeText('  Saint-ÉTIENNE '), 'saint etienne');
  assert.deepEqual(matchRecent(l, 'saint etienne').map((p) => p.name), ['Saint-Étienne']);
  assert.deepEqual(matchRecent(l, 'st').length, 0);
  assert.deepEqual(matchRecent(l, 'ETIEN 42000').map((p) => p.name), ['Saint-Étienne']);
  assert.deepEqual(matchRecent(l, 'lieu').map((p) => p.name), ['Lieu 1', 'Lieu 2', 'Lieu 3', 'Lieu 4', 'Lieu 5']);
  assert.deepEqual(matchRecent(l, '').map((p) => p.name), ['Lieu 1', 'Saint-Étienne', 'Lieu 2', 'Lieu 3', 'Lieu 4']);
});

test('menu : titre puis récents, puis ORS sans doublons ; « Aucun résultat » omis si un récent correspond', () => {
  const ors = [{ ...STE, label: 'Saint-Étienne, France' }, place(8)];
  const rows = suggestionRows({ status: 'results', items: ors, recent: [STE] });
  assert.deepEqual(rows.map((r) => r.kind), ['title', 'recent', 'place']);
  assert.equal(rows[0].text, 'Recherches récentes');
  assert.equal(rows[2].index, 1); // indice dans la liste d'ORS gardé
  assert.deepEqual(suggestionRows({ status: 'idle', recent: [STE] }).map((r) => r.kind), ['title', 'recent']);
  assert.deepEqual(suggestionRows({ status: 'empty', recent: [STE] }).map((r) => r.kind), ['title', 'recent']);
  assert.deepEqual(suggestionRows({ status: 'offline', recent: [STE] }).map((r) => r.kind), ['title', 'recent', 'info']);
  assert.deepEqual(suggestionRows({ status: 'idle' }), []);
});

test('✕ et effacement', () => {
  const store = createRecentStore(memoryStorage());
  store.add(place(1)); store.add(STE); store.add(place(2));
  store.remove({ ...STE });
  assert.deepEqual(store.list().map((p) => p.name), ['Lieu 2', 'Lieu 1']);
  assert.deepEqual(removeRecent(store.list(), place(9)).length, 2);
  store.clear();
  assert.deepEqual(store.list(), []);
});

test('stockage : relu au prochain lancement ; effacer retire la clé', () => {
  const st = memoryStorage();
  createRecentStore(st).add(STE);
  assert.deepEqual(createRecentStore(st).list().map((p) => p.name), ['Saint-Étienne']);
  createRecentStore(st).clear();
  assert.equal(st.getItem(RECENT.KEY), null);
});

test('stockage refusé ou plein : liste gardée en mémoire pour la session, aucune erreur', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('refusé'); } };
  const store = createRecentStore(full);
  assert.doesNotThrow(() => { store.add(place(1)); store.add(STE); });
  assert.deepEqual(store.match('etienne').map((p) => p.name), ['Saint-Étienne']);
  assert.doesNotThrow(() => store.remove(STE));
  assert.deepEqual(store.list().map((p) => p.name), ['Lieu 1']);
  assert.doesNotThrow(() => store.clear());
  const denied = { getItem: () => { throw new Error('SecurityError'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  assert.deepEqual(createRecentStore(denied).list(), []);
  assert.deepEqual(createRecentStore(null).add(STE).length, 1);
});

test('JSON abîmé dans le stockage : liste vide, puis enregistrement normal', () => {
  const st = memoryStorage();
  st.setItem(RECENT.KEY, '{pas du json');
  const store = createRecentStore(st);
  assert.deepEqual(store.list(), []);
  store.add(STE);
  assert.deepEqual(JSON.parse(st.getItem(RECENT.KEY)).map((p) => p.name), ['Saint-Étienne']);
  st.setItem(RECENT.KEY, JSON.stringify({ a: 1 }));
  assert.deepEqual(createRecentStore(st).list(), []);
  assert.deepEqual(sanitizeRecent([null, 3, 'x', { label: 'a' }, STE, STE]).length, 1);
});

test('export : recentPlaces inclus, jamais dans gabarit.data, jamais la clé ; import : fusion', () => {
  const st = memoryStorage();
  const store = createStore(st);
  store.setApiKey('cle-de-test-ne-doit-pas-sortir');
  const json = exportData(emptyData(), new Date(0), [], [STE, place(1)]);
  assert.doesNotMatch(json, /cle-de-test/);
  const back = readExport(json);
  assert.deepEqual(back.recentPlaces.map((p) => p.name), ['Saint-Étienne', 'Lieu 1']);
  assert.equal('recentPlaces' in back.data, false);
  store.save(back.data);
  assert.doesNotMatch(st.getItem(DATA_KEY), /recentPlaces/);
  assert.deepEqual(mergeRecent([place(2), STE], back.recentPlaces).map((p) => p.name), ['Lieu 2', 'Saint-Étienne', 'Lieu 1']);
  assert.doesNotMatch(exportData(emptyData()), /recentPlaces/); // indisponible → champ absent
});

test('ancien export sans recentPlaces : import sans erreur, liste vide', () => {
  const old = JSON.stringify({ app: 'gabarit', version: 1, vehicles: emptyData().vehicles, settings: {} });
  const r = readExport(old);
  assert.deepEqual(r.recentPlaces, []);
  assert.deepEqual(readExport(JSON.stringify({ ...JSON.parse(old), recentPlaces: 'abîmé' })).recentPlaces, []);
});

test('« Sources et licences » : repliée par défaut, état gardé et exporté (v84 : settings.sectionsOpen.credits)', () => {
  assert.equal(emptyData().settings.sectionsOpen.credits, undefined);
  assert.equal(sanitizeData({ vehicles: [], settings: {} }).settings.sectionsOpen.credits, undefined);
  const d = emptyData();
  d.settings.sectionsOpen = { credits: true };
  assert.equal(readExport(exportData(d)).data.settings.sectionsOpen.credits, true);
  assert.equal(sanitizeData({ vehicles: [], settings: { sectionsOpen: { credits: 'oui' } } }).settings.sectionsOpen.credits, undefined);
  // Ancienne sauvegarde v64 : creditsOpen repris, jamais réécrit (une seule source d'état).
  const old = sanitizeData({ vehicles: [], settings: { creditsOpen: true } }).settings;
  assert.equal(old.sectionsOpen.credits, true);
  assert.equal('creditsOpen' in old, false);
});

test('✕ et « Effacer » : en guidage, à l\'arrêt seulement (R412-6-2, vitesse inconnue = en mouvement)', () => {
  assert.equal(recentEditAllowed({ navigating: false }), true); // écran d'avant le départ
  assert.equal(recentEditAllowed({ navigating: true, parked: true }), true);
  assert.equal(recentEditAllowed({ navigating: true, parked: false }), false);
  assert.equal(recentEditAllowed({ navigating: true }), false); // vitesse inconnue
  assert.equal(recentEditAllowed({ navigating: true, parked: 'oui' }), false);
});
