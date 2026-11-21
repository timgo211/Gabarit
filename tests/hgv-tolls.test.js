process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDirections } from '../src/lib/ors-response.js';
import { TOLLS, parseTollData, tollsAlongRoute, tollRules, longDate } from '../src/lib/hgv-tolls.js';
import { routeRules } from '../src/lib/route-rules.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const routeOf = (name) => parseDirections(fixture(name));
const alsace = routeOf('ors-directions-alsace.json');
const metz = routeOf('ors-directions-metz-nancy.json');
const munich = routeOf('ors-directions-muenchen-innsbruck.json');
const real = parseTollData(JSON.parse(readFileSync(new URL('../data/taxes-pl.json', import.meta.url), 'utf8')));
const ok = (data) => ({ status: 'ok', data });
const truck = { weight: 19, euroClass: '6' };

const sample = {
  verified: '2026-11-21',
  sources: { off: { name: 'Délibération de test', url: 'https://example.invalid/deliberation', kind: 'official' } },
  taxes: [
    { id: 'test', name: 'Taxe de test', start: '2027-01-01', status: 'confirmed', source: 'off', verified: '2026-11-21',
      bbox: [6.84, 47.42, 8.24, 49.08], roads: ['M35'], rates: [{ text: 'Euro VI : taux de test' }], url: 'https://example.invalid/' },
  ],
};

test('données réelles : lisibles, chaque montant a une source et une date de lecture', () => {
  assert.ok(real, 'data/taxes-pl.json illisible');
  assert.ok(real.taxes.length >= 2);
  assert.ok(real.taxes.some((t) => t.id === 'r-pass'));
  assert.ok(real.taxes.some((t) => t.id === 'ecpl'));
  for (const t of real.taxes) {
    if (t.rates) {
      assert.equal(t.status, 'confirmed', `${t.id} : montant sans texte officiel lu`);
      assert.ok(t.source && t.verified, `${t.id} : montant sans source datée`);
    }
    if (t.status === 'check') assert.equal(t.rates, null);
    assert.ok(t.url, `${t.id} : lien officiel absent`);
  }
});

test('un montant sans source officielle datée est écarté (statut ramené à « à vérifier »)', () => {
  const d = parseTollData({ ...sample, taxes: [{ ...sample.taxes[0], source: null }] });
  assert.equal(d.taxes[0].status, 'check');
  assert.equal(d.taxes[0].rates, null);
  const d2 = parseTollData({ ...sample, taxes: [{ ...sample.taxes[0], verified: null }] });
  assert.equal(d2.taxes[0].rates, null);
  assert.equal(parseTollData(null), null);
  assert.equal(parseTollData({ taxes: [{ id: 'x' }] }).taxes.length, 0);
});

test('R-Pass « à vérifier » : avant le 1er janvier 2027, « annoncé à partir du », information sans montant', () => {
  const dep = new Date(2026, 10, 25, 9, 0);
  const r = tollRules(alsace, { vehicle: truck, tolls: ok(real), departure: dep });
  const line = r.lines.find((l) => /R-Pass/.test(l.text));
  assert.ok(line, 'R-Pass non signalé sur la M35');
  assert.equal(line.level, 'info');
  assert.match(line.text, /^Taxe possible : /);
  assert.match(line.text, /annoncée à partir du 1er janvier 2027/);
  assert.match(line.text, /périmètre officiel non lu, à vérifier/);
  assert.match(line.text, /Aucun montant connu/);
  assert.match(line.text, /La signalisation fait foi\.$/);
  assert.doesNotMatch(line.text, /€|centimes|c\/km/);
  assert.doesNotMatch(line.text, /s'applique|obligatoire|interdit/);
  assert.equal(r.short.length, 0, 'jamais d\'alerte pour un statut « à vérifier »');
  assert.ok(line.url);
});

test('R-Pass « à vérifier » : passage après le 1er janvier 2027, toujours « annoncé », jamais affirmé', () => {
  const r = tollRules(alsace, { vehicle: truck, tolls: ok(real), departure: new Date(2027, 0, 4, 9, 0) });
  const line = r.lines.find((l) => /R-Pass/.test(l.text));
  assert.match(line.text, /annoncée depuis le 1er janvier 2027/);
  assert.equal(line.level, 'info');
  assert.equal(r.short.length, 0);
});

test('date de passage : 31/12/2026 23 h → à partir du ; 1/01/2027 0 h 10 → en vigueur (taxe confirmée)', () => {
  const data = parseTollData(sample);
  const before = tollRules(alsace, { vehicle: truck, tolls: ok(data), departure: new Date(2026, 11, 31, 23, 0) });
  assert.equal(before.lines[0].level, 'info');
  assert.match(before.lines[0].text, /^Taxe de test à partir du 1er janvier 2027/);
  assert.match(before.lines[0].text, /Euro VI : taux de test/);
  assert.match(before.lines[0].text, /Source : Délibération de test, lue le 21\/11\/2026/);
  const after = tollRules(alsace, { vehicle: truck, tolls: ok(data), departure: new Date(2027, 0, 1, 0, 10) });
  assert.equal(after.lines[0].level, 'warn');
  assert.match(after.lines[0].text, /en vigueur depuis le 1er janvier 2027/);
  assert.deepEqual(after.short, ['Taxe de test']);
  // Heure de passage recalée par les pauses : départ le 31/12 à 23 h, pause de 2 h avant la M35.
  const late = tollRules(alsace, { vehicle: truck, tolls: ok(data), departure: new Date(2026, 11, 31, 23, 0), elapsed: (t) => t + 7200 });
  assert.equal(late.lines[0].level, 'warn');
});

test('écocontribution Grand Est « à vérifier » sur l\'A31, pas en Alsace', () => {
  const dep = new Date(2026, 10, 25, 9, 0);
  const r = tollRules(metz, { vehicle: truck, tolls: ok(real), departure: dep });
  const line = r.lines.find((l) => /Grand Est/.test(l.text));
  assert.ok(line, 'écocontribution non signalée sur l\'A31');
  assert.equal(line.level, 'info');
  assert.match(line.text, /annoncée à partir du 2 avril 2027/);
  assert.match(line.text, /à vérifier/);
  assert.ok(!r.lines.some((l) => /R-Pass/.test(l.text)));
  const a = tollRules(alsace, { vehicle: truck, tolls: ok(real), departure: dep });
  assert.ok(!a.lines.some((l) => /Grand Est/.test(l.text)));
});

test('PTAC de 3,5 t ou moins : rien ; profil sans PTAC : signalé', () => {
  assert.equal(tollRules(alsace, { vehicle: { weight: 3.5 }, tolls: ok(real) }).lines.length, 0);
  assert.ok(tollRules(alsace, { vehicle: {}, tolls: ok(real) }).lines.length > 0);
});

test('hors périmètre (Allemagne, Autriche) : rien', () => {
  const r = tollRules(munich, { vehicle: truck, tolls: ok(real) });
  assert.equal(r.lines.length, 0);
  assert.equal(tollsAlongRoute(munich, { data: real }).length, 0);
});

test('countryinfo absent : cadre seul, « Pays traversés non lus : à vérifier »', () => {
  const r = tollRules({ ...alsace, countries: null }, { vehicle: truck, tolls: ok(real), departure: new Date(2026, 10, 25) });
  const line = r.lines.find((l) => /R-Pass/.test(l.text));
  assert.match(line.text, /Pays traversés non lus : à vérifier/);
});

test('fichier absent : « indisponibles (données non chargées) » en France, rien à l\'étranger ; chargement : rien', () => {
  const failed = { status: 'failed', data: null };
  assert.deepEqual(tollRules(alsace, { vehicle: truck, tolls: failed }).lines.map((l) => l.text), [TOLLS.UNAVAILABLE_TEXT]);
  assert.equal(tollRules(munich, { vehicle: truck, tolls: failed }).lines.length, 0);
  assert.equal(tollRules(alsace, { vehicle: truck, tolls: { status: 'loading', data: null } }).lines.length, 0);
  assert.equal(tollRules(alsace, { vehicle: truck, tolls: null }).lines.length, 0);
});

test('routeRules : lignes dans les notes, rien dans le résumé pour un statut « à vérifier »', () => {
  const r = routeRules(alsace, { vehicle: truck, departure: new Date(2026, 10, 25, 9, 0), tolls: ok(real) });
  assert.ok(r.lines.some((l) => /R-Pass/.test(l.text) && l.level === 'info'));
  assert.ok(!r.short.some((s) => /R-Pass/.test(s)));
  assert.equal(r.tolls.passages.length, 1);
});

test('dates longues', () => {
  assert.equal(longDate('2027-01-01'), '1er janvier 2027');
  assert.equal(longDate('2027-04-02'), '2 avril 2027');
});
