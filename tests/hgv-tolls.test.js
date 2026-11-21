process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDirections } from '../src/lib/ors-response.js';
import { TOLLS, parseTollData, tollsAlongRoute, tollRules, longDate, gridText } from '../src/lib/hgv-tolls.js';
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
      bbox: [6.84, 47.42, 8.24, 49.08], roads: ['A35'], rates: [{ text: 'Euro VI : taux de test' }], url: 'https://example.invalid/' },
  ],
};

test('données réelles : lisibles, chaque montant a une source et une date de lecture', () => {
  for (const t of real.taxes) {
    if (t.status !== 'check') assert.ok(t.source && t.verified, `${t.id} : statut ${t.status} sans source datée`);
  }
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
  // « annoncée » : jamais de montant, même avec une source.
  const d3 = parseTollData({ ...sample, taxes: [{ ...sample.taxes[0], status: 'announced' }] });
  assert.equal(d3.taxes[0].status, 'announced');
  assert.equal(d3.taxes[0].rates, null);
  assert.equal(parseTollData(null), null);
  assert.equal(parseTollData({ taxes: [{ id: 'x' }] }).taxes.length, 0);
});

test('R-Pass annoncé : avant le 1er janvier 2027, « prévue à partir du », information sans montant, source datée', () => {
  const dep = new Date(2026, 10, 25, 9, 0);
  const r = tollRules(alsace, { vehicle: truck, tolls: ok(real), departure: dep });
  const line = r.lines.find((l) => /R-Pass/.test(l.text));
  assert.ok(line, 'R-Pass non signalé sur l\'A35');
  assert.equal(line.level, 'info');
  assert.match(line.text, /^R-Pass \(taxe PL de la Collectivité européenne d'Alsace\) prévue à partir du 1er janvier 2027, de km 0 à km \d+ \(A36, A35\)\./);
  assert.match(line.text, /délibération du Conseil d'Alsace n° CD-2025-4-7-1 du 20 octobre 2025/i);
  assert.match(line.text, /Recours en cours devant le tribunal administratif de Strasbourg \(effet suspensif non établi\)/);
  assert.match(line.text, /Tarif annoncé, poids du profil 19 t, Euro VI \(classe C \(PTRA de 18 à 32 t\)\) : 11,5 centimes par km \(dépliant officiel V02 du R-Pass \(grille tarifaire\), lu le 21\/11\/2026\)/);
  assert.match(line.text, /Aucun total calculé pour le trajet\./);
  assert.match(line.text, /lue le 21\/11\/2026/);
  assert.match(line.text, /La signalisation fait foi\.$/);
  assert.doesNotMatch(line.text, /€/);
  assert.doesNotMatch(line.text, /s'applique|obligatoire|interdit|en vigueur/);
  assert.equal(r.short.length, 0, 'jamais d\'alerte pour une taxe seulement annoncée');
  assert.equal(line.linkText, 'Site officiel');
  assert.equal(line.url, 'https://www.r-pass.eu/fr/network');
});

test('grille R-Pass : classe Euro, poids, limites de classe, non précisé = fourchette', () => {
  const tax = real.taxes.find((t) => t.id === 'r-pass');
  const g = (vehicle) => gridText(tax.grid, vehicle, real.sources);
  assert.match(g({ weight: 44, euroClass: '6' }), /44 t, Euro VI \(classe D \(PTRA de plus de 32 t\)\) : 14,6 centimes par km/);
  assert.match(g({ weight: 44, euroClass: '0' }), /Euro 0 .* : 34,5 centimes par km/);
  assert.match(g({ weight: 7.5, euroClass: '5' }), /classe A .* : 8,8 centimes par km/);
  assert.match(g({ weight: 12, euroClass: '6' }), /classe B .* : 8,8 centimes par km/);
  assert.match(g({ weight: 32, euroClass: '6' }), /classe C .* : 11,5 centimes par km/);
  // 18 t : « 12-18T » et « 18-32T », les deux classes.
  assert.match(g({ weight: 18, euroClass: '6' }), /classe B \(PTRA de 12 à 18 t\) ou classe C \(PTRA de 18 à 32 t\), limite de classe à vérifier\) : 8,8 ou 11,5 centimes par km/);
  assert.match(g({ weight: 44, euroClass: '' }), /44 t \(classe D .*\), classe Euro non précisée : de 13,8 à 34,5 centimes par km/);
  assert.match(g({ weight: 44, euroClass: 'EEV' }), /EEV absent de la grille, à vérifier : de 13,8 à 34,5/);
  assert.match(g({}), /poids non précisé dans le profil : de 7,1 à 34,5 centimes par km selon le poids et la classe Euro/);
  for (const v of [{ weight: 44, euroClass: '6' }, {}]) assert.match(g(v), /Aucun total calculé pour le trajet\.$/);
});

test('grille sans source datée : écartée', () => {
  const t = JSON.parse(readFileSync(new URL('../data/taxes-pl.json', import.meta.url), 'utf8'));
  t.taxes[0].grid.verified = null;
  assert.equal(parseTollData(t).taxes[0].grid, null);
  t.taxes[0].grid.verified = '2026-11-21';
  t.taxes[0].status = 'check';
  assert.equal(parseTollData(t).taxes[0].grid, null);
});

test('R-Pass : l\'A35 traversant l\'Eurométropole (M35) n\'est pas comptée', () => {
  const [p] = tollsAlongRoute(alsace, { data: real, departure: new Date(2026, 10, 25) });
  const m35 = alsace.coordinates.findIndex((c) => c[0] === 7.68 && c[1] === 48.5);
  assert.ok(m35 > 0);
  const total = 102800;
  assert.ok(p.exit < 93000 && p.exit > 90000, `fin du passage à ${Math.round(p.exit)} m (la M35 commence vers km 93 sur ${total / 1000})`);
  assert.deepEqual(p.roads, ['A36', 'A35']);
});

test('R-Pass annoncé : passage après le 1er janvier 2027, « prévue depuis », jamais affirmé', () => {
  const r = tollRules(alsace, { vehicle: truck, tolls: ok(real), departure: new Date(2027, 0, 4, 9, 0) });
  const line = r.lines.find((l) => /R-Pass/.test(l.text));
  assert.match(line.text, /prévue depuis le 1er janvier 2027/);
  assert.equal(line.level, 'info');
  assert.equal(r.short.length, 0);
});

test('taxe « à vérifier » (aucune source lue) : « Taxe possible », périmètre non lu, aucun montant', () => {
  const data = parseTollData({ ...sample, taxes: [{ ...sample.taxes[0], status: 'check', source: null, verified: null, note: 'Recours en cours.' }] });
  const r = tollRules(alsace, { vehicle: truck, tolls: ok(data), departure: new Date(2026, 10, 25, 9, 0) });
  assert.equal(r.lines[0].level, 'info');
  assert.match(r.lines[0].text, /^Taxe possible : Taxe de test, annoncée à partir du 1er janvier 2027, de km \d+ à km \d+ \(A35\) : périmètre officiel non lu, à vérifier\. Recours en cours\. Aucun montant connu\. La signalisation fait foi\.$/);
  assert.equal(r.short.length, 0);
  const after = tollRules(alsace, { vehicle: truck, tolls: ok(data), departure: new Date(2027, 0, 4) });
  assert.match(after.lines[0].text, /annoncée depuis le 1er janvier 2027/);
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

test('écocontribution Grand Est annoncée sur l\'A31 (réseau officiel), pas en Alsace', () => {
  const dep = new Date(2026, 10, 25, 9, 0);
  const r = tollRules(metz, { vehicle: truck, tolls: ok(real), departure: dep });
  const line = r.lines.find((l) => /Grand Est/.test(l.text));
  assert.ok(line, 'écocontribution non signalée sur l\'A31');
  assert.equal(line.level, 'info');
  assert.match(line.text, /^Écocontribution poids lourds \(ECPL\) de la Région Grand Est prévue à partir du 2 avril 2027, de km \d+ à km \d+ \(A31\)\./);
  assert.match(line.text, /A30, A31 \(de la frontière luxembourgeoise au sud de Toul\), A33, A313, RN4, RN44, RN431 et RN52/);
  assert.match(line.text, /classe d'émissions de CO2 \(absente du profil\)/);
  assert.match(line.text, /Aucun montant calculé\./);
  assert.doesNotMatch(line.text, /€|centimes|ctme/);
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

test('A36 : rien vers Belfort (Besançon → Belfort), comptée seulement dans le Haut-Rhin (Belfort → Mulhouse)', () => {
  const dep = new Date(2026, 10, 25, 9, 0);
  const bes = routeOf('ors-directions-besancon-belfort.json');
  assert.equal(tollsAlongRoute(bes, { data: real, departure: dep }).length, 0);
  assert.equal(tollRules(bes, { vehicle: truck, tolls: ok(real), departure: dep }).lines.length, 0, 'aucune ligne R-Pass hors du réseau');
  const bm = routeOf('ors-directions-belfort-mulhouse.json');
  const [p, ...rest] = tollsAlongRoute(bm, { data: real, departure: dep });
  assert.equal(rest.length, 0);
  // Le passage commence à 7,05° E (Haut-Rhin), pas à Belfort (6,86° E) : environ 15 km après le départ.
  assert.ok(p.enter > 12000, `entrée à ${Math.round(p.enter)} m`);
  const line = tollRules(bm, { vehicle: truck, tolls: ok(real), departure: dep }).lines[0];
  assert.match(line.text, /A36 comptée seulement dans le Haut-Rhin \(jamais vers Belfort\), limite de la partie concédée à vérifier/);
  assert.match(line.text, /annoncé|prévue à partir du 1er janvier 2027/);
});

test('cadre propre à une route : illisible → ignoré, cadre général gardé', () => {
  const t = JSON.parse(readFileSync(new URL('../data/taxes-pl.json', import.meta.url), 'utf8'));
  t.taxes[0].roadBoxes = { A36: [7, 'x'] };
  assert.deepEqual(parseTollData(t).taxes[0].roadBoxes, {});
});
