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

// v62 : menu de suggestions commun (src/lib/suggest.js), budget de géocodage (geocode-quota.js) et texte validé sans
// choix (place-resolve.js). Fixtures : pelias-suggest-5.json (7 lieux), pelias-suggest-vide.json, erreur réseau simulée.
import { fixture } from './helpers.js';
import { parseAutocomplete } from '../src/lib/ors-request.js';
import { SUGGEST, suggestionRows, createSuggester, isOfflineError } from '../src/lib/suggest.js';
import { GEOCODE_QUOTA, createGeocodeBudget, createTextCache, readCounts, dayOf } from '../src/lib/geocode-quota.js';
import { resolvePlace, RESOLVE } from '../src/lib/place-resolve.js';

const FIVE = fixture('pelias-suggest-5.json');
const EMPTY = fixture('pelias-suggest-vide.json');
const NET = Object.assign(new Error('réseau'), { kind: 'network' });

/** Minuteur simulé : rien ne part tant que le temps n'avance pas (jamais d'horloge réelle). */
function fakeTimer() {
  let t = 0;
  let id = 0;
  const jobs = new Map();
  return {
    set(fn, ms) { id += 1; jobs.set(id, { at: t + ms, fn }); return id; },
    clear(i) { jobs.delete(i); },
    async advance(ms) {
      t += ms;
      for (const [i, j] of [...jobs]) if (j.at <= t) { jobs.delete(i); j.fn(); }
      await new Promise((r) => setImmediate(r));
    },
    get now() { return t; },
  };
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, map: m };
}

test('5 résultats au plus ; ligne = nom puis commune et pays (gris)', () => {
  const items = parseAutocomplete(FIVE);
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((i) => [i.name, i.place]), [
    ['Clermont-Ferrand', 'France'],
    ['Clermont', 'France'],
    ['Aire de Clermont-Ferrand Nord', 'Gerzat, France'],
    ['Rue de Clermont', 'Riom, France'],
    ['Clermont-l’Hérault', 'France'],
  ]);
  const rows = suggestionRows({ status: 'results', items });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[2], { kind: 'place', text: 'Aire de Clermont-Ferrand Nord', sub: 'Gerzat, France', index: 2 });
  assert.deepEqual(suggestionRows({ status: 'empty' }), [{ kind: 'info', text: 'Aucun résultat' }]);
  assert.deepEqual(suggestionRows({ status: 'offline' }), [{ kind: 'info', text: 'Pas de connexion' }]);
  assert.equal(parseAutocomplete(EMPTY).length, 0);
  assert.ok(isOfflineError({ kind: 'offline' }) && isOfflineError(NET) && !isOfflineError({ kind: 'daily-quota' }));
});

test('après 3 caractères, 400 ms après la dernière frappe, requête précédente annulée (compteur d\'appels)', async () => {
  assert.equal(SUGGEST.DELAY_MS, 400);
  const timer = fakeTimer();
  const sent = [];
  const states = [];
  const s = createSuggester({
    timer,
    search: (text, signal) => { sent.push({ text, signal }); return new Promise((r) => { sent.at(-1).done = r; }); },
    onState: (st) => states.push(st),
  });
  s.input('Cl');
  await timer.advance(1000);
  assert.equal(sent.length, 0, '2 caractères : aucun appel');
  s.input('Cle');
  await timer.advance(399);
  assert.equal(sent.length, 0, 'pas avant 400 ms');
  s.input('Cler'); // frappe suivante : le minuteur repart
  await timer.advance(399);
  assert.equal(sent.length, 0);
  await timer.advance(1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'Cler');
  s.input('Clerm');
  assert.equal(sent[0].signal.aborted, true, 'requête précédente annulée à la frappe');
  sent[0].done(parseAutocomplete(FIVE)); // réponse tardive : ignorée
  await timer.advance(400);
  assert.equal(sent.length, 2);
  sent[1].done(parseAutocomplete(FIVE));
  await new Promise((r) => setImmediate(r));
  const last = states.at(-1);
  assert.equal(last.status, 'results');
  assert.equal(last.items.length, 5);
  assert.ok(!states.some((st) => st.status === 'results' && st.items === undefined));
  s.input('48.6921, 6.1844');
  assert.equal(states.at(-1).items[0].label, '48,69210, 6,18440', 'coordonnées : sans appel');
  await timer.advance(1000);
  assert.equal(sent.length, 2);
});

test('liste vide → « Aucun résultat » ; erreur réseau → « Pas de connexion » ; hors ligne : aucun appel', async () => {
  const timer = fakeTimer();
  let mode = 'empty';
  let calls = 0;
  const states = [];
  const errors = [];
  const s = createSuggester({
    timer,
    search: async () => { calls += 1; if (mode === 'net') throw NET; if (mode === 'quota') throw { kind: 'daily-quota' }; return parseAutocomplete(EMPTY); },
    onState: (st) => states.push(st.status),
    onError: (e) => errors.push(e),
    isOnline: () => mode !== 'off',
  });
  s.input('Zzqxw');
  await timer.advance(400);
  assert.equal(states.at(-1), 'empty');
  assert.deepEqual(suggestionRows({ status: states.at(-1) }).map((r) => r.text), ['Aucun résultat']);
  mode = 'net';
  s.input('Zzqxwy');
  await timer.advance(400);
  assert.equal(states.at(-1), 'offline');
  mode = 'off';
  s.input('Zzqxwyz');
  await timer.advance(400);
  assert.equal(states.at(-1), 'offline');
  assert.equal(calls, 2, 'hors ligne : aucune requête');
  mode = 'quota';
  s.input('Metz-Nord');
  await timer.advance(400);
  assert.equal(states.at(-1), 'idle', 'quota d\'ORS : liste fermée, message habituel');
  assert.equal(errors.at(-1).kind, 'daily-quota');
});

test('budget : compteur du jour par service, minute glissante, changement de jour ; cache en mémoire seulement', async () => {
  assert.equal(GEOCODE_QUOTA.DAY.autocomplete, 500);
  assert.equal(GEOCODE_QUOTA.DAY.search, 500);
  let now = new Date(2026, 10, 24, 9, 0).getTime();
  const storage = memStorage();
  const b = createGeocodeBudget({ storage, now: () => now });
  for (let i = 0; i < GEOCODE_QUOTA.PER_MINUTE; i += 1) { assert.ok(b.canSend('autocomplete')); b.record('autocomplete'); }
  assert.equal(b.canSend('autocomplete'), false, '40 par minute');
  assert.equal(b.canSend('search'), true, 'recherche : compteur à part');
  now += 61_000;
  assert.equal(b.canSend('autocomplete'), true, 'minute suivante');
  assert.equal(b.count('autocomplete'), 40);
  const stored = JSON.parse(storage.getItem(GEOCODE_QUOTA.KEY));
  assert.deepEqual(stored, { day: dayOf(now), autocomplete: 40, search: 0 }, 'ni texte, ni clé, ni coordonnée');
  storage.setItem(GEOCODE_QUOTA.KEY, JSON.stringify({ day: dayOf(now), autocomplete: 500, search: 3 }));
  assert.equal(b.canSend('autocomplete'), false, 'plafond du jour');
  assert.equal(b.canSend('search'), true, 'plafond d\'autocomplétion : recherche toujours possible');
  now += 24 * 3600_000;
  assert.equal(b.count('autocomplete'), 0, 'jour suivant : remis à zéro');
  assert.deepEqual(readCounts('{illisible', '2026-11-24'), { day: '2026-11-24', autocomplete: 0, search: 0 });
  // Plafond atteint : ligne qui renvoie à la validation, aucun appel.
  const timer = fakeTimer();
  let calls = 0;
  const states = [];
  const full = { canSend: () => false, record: () => { calls += 100; } };
  const s = createSuggester({ timer, budget: full, search: async () => { calls += 1; return []; }, onState: (st) => states.push(st.status) });
  s.input('Clermont');
  await timer.advance(400);
  assert.equal(states.at(-1), 'exhausted');
  assert.match(suggestionRows({ status: 'exhausted' })[0].text, /validez/);
  assert.equal(calls, 0);
  // Cache : même texte = aucun appel ; 20 textes au plus ; rien n'est écrit dans le stockage.
  const cache = createTextCache();
  const st2 = memStorage();
  const b2 = createGeocodeBudget({ storage: st2, now: () => now });
  let sent = 0;
  const s2 = createSuggester({ timer, budget: b2, cache, search: async () => { sent += 1; return parseAutocomplete(FIVE); }, onState: () => {} });
  s2.input('Clermont');
  await timer.advance(400);
  s2.input('clermont ');
  await timer.advance(400);
  assert.equal(sent, 1, 'même texte : réponse du cache');
  for (let i = 0; i < 25; i += 1) cache.set(`t${i}`, []);
  assert.equal(cache.size, 20);
  assert.deepEqual([...st2.map.keys()], [GEOCODE_QUOTA.KEY], 'cache jamais écrit sur disque');
  assert.ok(!st2.getItem(GEOCODE_QUOTA.KEY).includes('lermont'));
});

test('texte validé sans choix : coordonnées sans appel, 1 lieu pris, plusieurs → liste, 0, réseau, quota', async () => {
  let calls = 0;
  const by = (json) => async () => { calls += 1; return parseAutocomplete(json); };
  const coords = await resolvePlace('48.6921, 6.1844', { search: by(FIVE) });
  assert.equal(coords.kind, 'picked');
  assert.equal(calls, 0, 'coordonnées : aucun appel');
  const one = { ...FIVE, features: FIVE.features.slice(0, 1) };
  const r1 = await resolvePlace('Clermont-Ferrand', { search: by(one) });
  assert.equal(r1.kind, 'picked');
  assert.equal(r1.item.name, 'Clermont-Ferrand');
  const r5 = await resolvePlace('Clermont', { search: by(FIVE) });
  assert.equal(r5.kind, 'choose', 'plusieurs lieux : rien de deviné');
  assert.equal(r5.items.length, 5);
  assert.equal((await resolvePlace('Zzqxw', { search: by(EMPTY) })).kind, 'none');
  assert.equal((await resolvePlace('Zzqxw', { search: async () => { throw NET; } })).kind, 'offline');
  assert.equal((await resolvePlace('Zzqxw', { search: by(FIVE), isOnline: () => false })).kind, 'offline');
  assert.equal((await resolvePlace('   ', { search: by(FIVE) })).kind, 'empty');
  // Plafond d'autocomplétion atteint : la recherche reste possible (compteur « search » à part).
  const now = new Date(2026, 10, 24, 9, 0).getTime();
  const storage = memStorage();
  storage.setItem(GEOCODE_QUOTA.KEY, JSON.stringify({ day: dayOf(now), autocomplete: 500, search: 0 }));
  const b = createGeocodeBudget({ storage, now: () => now });
  assert.equal(b.canSend('autocomplete'), false);
  assert.equal((await resolvePlace('Clermont-Ferrand', { search: by(one), budget: b })).kind, 'picked');
  assert.equal(b.count('search'), 1);
  storage.setItem(GEOCODE_QUOTA.KEY, JSON.stringify({ day: dayOf(now), autocomplete: 500, search: 500 }));
  const q = await resolvePlace('Clermont-Ferrand', { search: by(one), budget: b });
  assert.equal(q.kind, 'quota');
  assert.match(RESOLVE.QUOTA_TEXT, /touchez la carte longuement|coordonnées/, 'jamais une impasse');
  assert.equal((await resolvePlace('48.6921, 6.1844', { search: by(one), budget: b })).kind, 'picked', 'coordonnées : toujours');
});
