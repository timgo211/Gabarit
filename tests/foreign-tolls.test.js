// Phase 5h : péage au km de l'Autriche (GO-Maut, tarifs ASFINAG 2026 lus le 23/11/2026) et champ « Essieux » du
// profil. Contrôle de cohérence de la grille (chaque total = infrastructure + air et bruit + CO₂, classes croissantes),
// taux du profil (non précisé : les deux cas), estimation sur les km à péage (tollways × countryinfo), tronçons à
// tarif propre (A 12, A 13…) : rien d'estimé. Allemagne : aucun montant. Fixture ors-directions-muenchen-innsbruck.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { parseDirections, parseTollRanges } from '../src/lib/ors-response.js';
import {
  FOREIGN_TOLLS, AXLE_AMOUNTS, axleCategories, atRows, atRate, tolledMetersIn, crossesSpecial, foreignTollRules,
} from '../src/lib/foreign-tolls.js';
import { normalizeVehicle, defaultVehicle, AXLE_VALUES, validateVehicle } from '../src/lib/vehicle.js';
import { exportData, importData } from '../src/lib/store.js';
import { routeRules } from '../src/lib/route-rules.js';

const A = FOREIGN_TOLLS.AT;
const close = (a, b) => Math.abs(a - b) < 1e-9;
const semi = (patch = {}) => ({ ...defaultVehicle(), ...patch });

test('grille ASFINAG 2026 : chaque total = infrastructure + air et bruit + CO₂ (même PDF)', () => {
  const row = { 'VI-co2-4': ['VI', 4], 'VI-co2-3': ['VI', 3], 'VI-co2-2': ['VI', 2], 'VI-co2-1': ['VI', 1], 'V-co2-1': ['V', 1], 'IV-co2-1': ['IV', 1], '0-III-co2-1': ['0-III', 1] };
  for (const [k, [euro, co2]] of Object.entries(row)) {
    for (let c = 0; c < 3; c += 1) {
      const sum = A.parts.infrastructure[c] + A.parts.air[euro][c] + A.parts.co2[co2][c];
      assert.ok(close(Math.round(sum * 1e4) / 1e4, A.total[k][c]), `${k} cat. ${c + 2} : ${sum} ≠ ${A.total[k][c]}`);
    }
  }
});

test('grille : plus d\'essieux = plus cher, classe Euro plus ancienne = plus cher, CO₂ 1 la plus chère des Euro VI', () => {
  for (const r of Object.values(A.total)) assert.ok(r[0] < r[1] && r[1] < r[2]);
  const order = ['VI-co2-1', 'V-co2-1', 'IV-co2-1', '0-III-co2-1'];
  for (let i = 1; i < order.length; i += 1) for (let c = 0; c < 3; c += 1) assert.ok(A.total[order[i]][c] > A.total[order[i - 1]][c]);
  for (const k of ['VI-co2-2', 'VI-co2-3', 'VI-co2-4']) for (let c = 0; c < 3; c += 1) assert.ok(A.total[k][c] < A.total['VI-co2-1'][c]);
});

test('profil : essieux et classe Euro → catégories et lignes ; non précisé → les deux cas', () => {
  assert.deepEqual(axleCategories('2'), [0]);
  assert.deepEqual(axleCategories('3'), [1]);
  assert.deepEqual(axleCategories('4'), [2]);
  assert.deepEqual(axleCategories('5+'), [2]);
  assert.deepEqual(axleCategories(''), [0, 1, 2]);
  assert.deepEqual(atRows('6'), ['VI-co2-4', 'VI-co2-3', 'VI-co2-2', 'VI-co2-1']);
  assert.deepEqual(atRows('EEV'), ['V-co2-1']);
  assert.deepEqual(atRows('2'), ['0-III-co2-1']);
  assert.equal(atRows('').length, 7);
  assert.deepEqual(atRate({ axles: '5+', euroClass: '6' }), { min: 0.5091, max: 0.5724 });
  assert.deepEqual(atRate({ axles: '2', euroClass: '4' }), { min: 0.3114, max: 0.3114 });
  assert.deepEqual(atRate({ axles: '', euroClass: '' }), { min: 0.2486, max: 0.6654 });
});

test('champ « Essieux » : non précisé par défaut, anciens profils et valeurs inconnues → non précisé, exporté', () => {
  assert.equal(AXLE_AMOUNTS, true, 'un montant codé en dépend : champ montré');
  assert.equal(defaultVehicle().axles, '');
  assert.deepEqual(AXLE_VALUES, ['', '2', '3', '4', '5+']);
  assert.equal(normalizeVehicle({ name: 'x' }).axles, '');
  assert.equal(normalizeVehicle({ name: 'x', axles: '7' }).axles, '');
  assert.equal(normalizeVehicle({ name: 'x', axles: '5+' }).axles, '5+');
  assert.equal(validateVehicle(normalizeVehicle({ ...defaultVehicle(), axles: '3' })).valid, true);
  const v = semi({ axles: '4' });
  const back = importData(exportData({ vehicles: [v], activeVehicleId: v.id, settings: {}, trips: [] }));
  assert.equal(back.vehicles[0].axles, '4');
});

test('tronçons à péage : extra tollways lu en indices ; illisible → null', () => {
  assert.deepEqual(parseTollRanges({ tollways: { values: [[0, 10, 0], [10, 20, 1]] } }), [{ from: 10, to: 20 }]);
  assert.equal(parseTollRanges({}), null);
  assert.equal(parseTollRanges({ tollways: { values: [[5, 2, 1]] } }), null);
});

test('Munich → Innsbruck : A 12 (tarif propre) traversée → taux affiché, aucune estimation, jamais une alerte', () => {
  const route = parseDirections(fixture('ors-directions-muenchen-innsbruck.json'));
  assert.equal(crossesSpecial(route), true);
  const r = foreignTollRules(route, { vehicle: semi({ euroClass: '6', axles: '5+' }) });
  assert.equal(r.lines.length, 1);
  const l = r.lines[0];
  assert.equal(l.level, 'info');
  assert.match(l.text, /^GO-Maut \(Autriche\) : péage au km des plus de 3,5 t/);
  assert.match(l.text, /de 0,51 à 0,57 €\/km HT pour votre profil \(4 essieux et plus, Euro VI, classe CO₂ non saisie/);
  assert.match(l.text, /Tronçon à tarif propre sur le trajet : estimation non calculée\./);
  assert.match(l.text, /Montants à vérifier\. La signalisation fait foi\.$/);
  assert.ok(!/\d+ € HT pour/.test(l.text));
  const all = routeRules(route, { vehicle: semi({ euroClass: '6', axles: '5+' }) });
  assert.ok(all.lines.some((x) => x.text === l.text && x.level === 'info'));
  assert.ok(!all.short.some((t) => /GO-Maut|péage/i.test(t)), 'rien sur la fiche courte');
});

test('trajet autrichien à péage sans tronçon propre : estimation « environ … à vérifier, pas une facture »', () => {
  const json = fixture('ors-directions-muenchen-innsbruck.json');
  const p = json.features[0].properties;
  p.extras.tollways = { values: [[0, 36, 0], [36, 67, 1], [67, 68, 0]] };
  for (const s of p.segments[0].steps) { s.name = s.name.replace(/A 12/g, 'Inntal'); s.instruction = (s.instruction ?? '').replace(/A 12/g, 'Inntal'); }
  const route = parseDirections(json);
  assert.equal(crossesSpecial(route), false);
  const m = tolledMetersIn(route, 'AT');
  assert.ok(m > 10000, `${m} m`);
  const r = foreignTollRules(route, { vehicle: semi({ euroClass: '5', axles: '3' }) });
  const km = Math.round(m / 1000);
  const eur = Math.round((0.4086 * m) / 1000);
  assert.match(r.lines[0].text, new RegExp(`0,41 €/km HT pour votre profil \\(3 essieux, Euro V\\)\\. Estimation : environ ${eur} € HT pour ${km} km à péage en Autriche \\(à vérifier, pas une facture\\)\\.`));
  const both = foreignTollRules(route, { vehicle: semi({ euroClass: '', axles: '' }) });
  assert.match(both.lines[0].text, /de 0,25 à 0,67 €\/km HT pour votre profil \(essieux non précisés \(2, 3, 4 et plus\), classe Euro non précisée\)\. Estimation : environ \d+ à \d+ € HT/);
});

test('PTAC ≤ 3,5 t ou trajet sans Autriche : rien ; Allemagne : aucun montant', () => {
  const route = parseDirections(fixture('ors-directions-muenchen-innsbruck.json'));
  assert.equal(foreignTollRules(route, { vehicle: semi({ weight: 3.5 }) }).lines.length, 0);
  const fr = parseDirections(fixture('ors-directions-mont-blanc.json'));
  assert.equal(foreignTollRules(fr, { vehicle: semi() }).lines.length, 0);
  assert.equal(FOREIGN_TOLLS.DE, undefined, 'grille allemande non codée (validité 2026 non lue)');
});
