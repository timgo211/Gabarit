// Phase 5e : poids en trafic international (directive 96/53/CE, 40 t sauf transport combiné), poids total maximal
// national et hauteur maximale des fiches pays. Fixture ors-directions-fr-ch-it.json (France → Suisse → Italie) et
// ors-directions-nav.json (sans countryinfo).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { weightRules, WEIGHTS } from '../src/lib/weights.js';
import { parseCountryData, countryRules, COUNTRY_RULES } from '../src/lib/country-rules.js';
import { routeRules } from '../src/lib/route-rules.js';
import { normalizeVehicle, defaultVehicle } from '../src/lib/vehicle.js';

const raw = (code) => JSON.parse(readFileSync(new URL(`../data/pays/${code}.json`, import.meta.url), 'utf8'));
const loaded = () => new Map(COUNTRY_RULES.FILES.map((c) => [c, { status: 'ok', data: parseCountryData(raw(c)) }]));
const intl = () => parseDirections(fixture('ors-directions-fr-ch-it.json'));
const semi = (patch = {}) => ({ name: 'Semi', weight: 44, height: 4, critair: '1', banStatus: 'concerned', combined: false, ...patch });
const dep = new Date(2026, 10, 18, 8, 0); // mercredi 8 h

const franceOnly = () => {
  const r = intl();
  return { ...r, countries: [{ from: 0, to: r.coordinates.length - 1, code: 'FR' }] };
};

test('44 t, trajet international : alerte avant le départ, PTAC rappelé, signalisation, sans voix', () => {
  const w = weightRules(intl(), { vehicle: semi() });
  assert.equal(w.international, true);
  assert.equal(w.lines.length, 1);
  const [l] = w.lines;
  assert.equal(l.level, 'warn');
  assert.match(l.text, /^Votre profil indique 44 t \(PTAC, pas le poids réel\) : en international, poids réel limité à 40 t sauf transport combiné/);
  assert.match(l.text, /vérifiez votre poids réel/);
  assert.match(l.text, /vers km 4\./);
  assert.ok(l.text.endsWith('La signalisation fait foi.'));
  assert.deepEqual(w.short, ['International : 40 t']);
  assert.equal(l.voice, undefined);
  // Dans les règles du trajet, avec les alertes.
  const rules = routeRules(intl(), { vehicle: semi(), departure: dep, countries: loaded() });
  assert.ok(rules.lines.some((x) => x.level === 'warn' && x.text === l.text));
  assert.ok(rules.short.includes('International : 40 t'));
});

test('40 t ou moins : rien ; trajet en France seulement : rien', () => {
  assert.deepEqual(weightRules(intl(), { vehicle: semi({ weight: 40 }) }).lines, []);
  assert.deepEqual(weightRules(intl(), { vehicle: semi({ weight: 19 }) }).lines, []);
  const fr = weightRules(franceOnly(), { vehicle: semi() });
  assert.equal(fr.international, false);
  assert.deepEqual(fr.lines, []);
  assert.deepEqual(weightRules(intl(), { vehicle: { name: 'x' } }).lines, []);
});

test('transport combiné : 44 t = info (tracteur 3 essieux / 2 essieux), 46 t = alerte à 44 t', () => {
  const ok = weightRules(intl(), { vehicle: semi({ combined: true }) });
  assert.equal(ok.lines[0].level, 'info');
  assert.match(ok.lines[0].text, /44 t seulement avec un tracteur à 3 essieux et 42 t avec un tracteur à 2 essieux/);
  assert.match(ok.lines[0].text, /seul le poids réel compte\. La signalisation fait foi\.$/);
  assert.deepEqual(ok.short, []);
  const heavy = weightRules(intl(), { vehicle: semi({ combined: true, weight: 46 }) });
  assert.equal(heavy.lines[0].level, 'warn');
  assert.match(heavy.lines[0].text, /^Votre profil indique 46 t .* limité à 44 t même en transport combiné/);
  assert.deepEqual(heavy.short, [`International : ${WEIGHTS.INTERMODAL_T} t`]);
});

test('countryinfo absent : « à vérifier », jamais une alerte sûre', () => {
  const r = parseDirections(fixture('ors-directions-nav.json'));
  const w = weightRules(r, { vehicle: semi() });
  assert.equal(w.international, null);
  assert.equal(w.lines[0].level, 'info');
  assert.match(w.lines[0].text, /à vérifier/);
  assert.ok(w.lines[0].text.endsWith('La signalisation fait foi.'));
  assert.deepEqual(w.short, []);
});

test('profil : case « Transport combiné » (formulaire, export), anciens profils = non', () => {
  assert.equal(normalizeVehicle({ name: 'a', combined: 'on' }).combined, true);
  assert.equal(normalizeVehicle({ name: 'a', combined: true }).combined, true);
  assert.equal(normalizeVehicle({ name: 'a' }).combined, false);
  assert.equal(normalizeVehicle({ name: 'a', combined: 'oui' }).combined, false);
  assert.equal(defaultVehicle().combined, false);
});

test('fiches pays : poids national et hauteur avec source ; BE et LU « à vérifier » sans valeur', () => {
  for (const code of ['DE', 'CH', 'IT', 'ES']) {
    const d = parseCountryData(raw(code));
    for (const k of ['weight', 'height']) {
      assert.ok(d.limits[k].max > 0, `${code} ${k}`);
      assert.ok(d.sources[d.limits[k].source]?.url, `${code} ${k} source`);
      assert.equal(d.sources[d.limits[k].source].kind, 'national');
      assert.equal(d.limits[k].verified, '2026-11-21');
    }
  }
  assert.equal(parseCountryData(raw('ES')).limits.weight.max, 44);
  assert.match(parseCountryData(raw('ES')).limits.weight.text, /23\/10\/2025 \(citernes : depuis le 23\/01\/2026\)/);
  assert.equal(parseCountryData(raw('CH')).limits.weight.max, 40);
  assert.equal(parseCountryData(raw('CH')).limits.weight.combinedMax, 44);
  for (const code of ['BE', 'LU']) {
    const d = parseCountryData(raw(code));
    assert.equal(d.limits.weight.max, null);
    assert.equal(d.limits.height.max, null);
    assert.match(d.limits.weight.text, /à vérifier/);
  }
});

const section = (card) => card.items.filter((i) => i.section === 'Poids et hauteur');

test('fiche Suisse et Italie : 44 t au-delà de 40 t en Suisse, 4,10 m au-delà de 4 m, signalisation', () => {
  const c = countryRules(intl(), { vehicle: semi({ height: 4.1 }), departure: dep, countries: loaded() });
  const [ch, it] = c.cards;
  assert.equal(ch.code, 'CH');
  const chItems = section(ch);
  assert.equal(chItems.length, 2);
  assert.ok(chItems.every((i) => i.confirmed));
  assert.equal(chItems[0].level, 'warn');
  assert.match(chItems[0].text, /Votre profil indique 44 t : au-delà du maximum national \(40 t\)/);
  assert.match(chItems[1].text, /Votre profil indique 4,10 m : au-delà de la hauteur maximale \(4,00 m\)/);
  assert.equal(ch.footer, 'La signalisation fait foi.');
  // Italie : 44 t permis en national, hauteur dépassée.
  const itItems = section(it);
  assert.equal(itItems[0].level, 'info');
  assert.equal(itItems[1].level, 'warn');
  // Hauteur dépassée : ligne d'alerte et résumé court, jamais dite.
  assert.ok(c.lines.some((l) => l.level === 'warn' && /^Suisse : hauteur maximale 4,00 m, votre profil indique 4,10 m/.test(l.text) && l.text.endsWith('La signalisation fait foi.')));
  assert.ok(c.short.includes('Hauteur max Suisse'));
  assert.ok(!c.short.includes('Interdiction PL Suisse')); // mercredi 8 h : aucune interdiction, la hauteur seule
  assert.ok(!ch.voice.some((v) => /hauteur|tonnes/.test(v)));
  // Transport combiné : 44 t admis en Suisse ; 4 m : rien.
  const comb = countryRules(intl(), { vehicle: semi({ combined: true }), departure: dep, countries: loaded() });
  assert.ok(section(comb.cards[0]).every((i) => i.level === 'info'));
  assert.ok(!comb.short.some((s) => /Hauteur/.test(s)));
});

test('fiche Belgique sans source : « à vérifier », jamais d\'alerte de hauteur', () => {
  const r = intl();
  const be = { ...r, countries: [{ from: 0, to: 10, code: 'FR' }, { from: 10, to: r.coordinates.length - 1, code: 'BE' }] };
  const c = countryRules(be, { vehicle: semi({ height: 4.5 }), departure: dep, countries: loaded() });
  const items = section(c.cards[0]);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => !i.confirmed && i.level === 'info' && /à vérifier/.test(i.text)));
  assert.ok(!c.short.some((s) => /Hauteur/.test(s)));
});
