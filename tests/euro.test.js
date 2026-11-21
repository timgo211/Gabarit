// Phase 5g : normes Euro. Tunnels du Mont-Blanc (arrêté n° 2020-0825 : Euro 0 à 4 interdits) et du Fréjus (arrêté du
// 7 juillet 2017 : Euro 0 à 2 ; Euro 3 et 4 confirmés par l'exploitant), classe non précisée (les deux cas), EEV,
// PTAC ≤ 3,5 t, tracé à côté du tube, « à vérifier » jamais présenté comme interdit, fiches pays, rien dans le
// guidage. Fixtures ors-directions-mont-blanc.json (Le Fayet → tunnel → Courmayeur) et ors-directions-frejus.json
// (Modane → tunnel → Bardonecchia), écrites d'après la doc ORS (countryinfo FR 70 / IT 97), tubes de KNOWN_TUNNELS.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, runFixes } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import {
  EURO, EURO_EEV, TUNNEL_RULES, euroRules, euroTunnelsAlongRoute, tunnelVerdict, classesText, countryEuroText,
} from '../src/lib/euro.js';
import { routeRules } from '../src/lib/route-rules.js';
import { parseCountryData, countryCard, COUNTRY_RULES } from '../src/lib/country-rules.js';
import { normalizeVehicle, validateVehicle, defaultVehicle, EURO_VALUES } from '../src/lib/vehicle.js';
import { startNavigation, updateNavigation } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';

const mb = () => parseDirections(fixture('ors-directions-mont-blanc.json'));
const fr = () => parseDirections(fixture('ors-directions-frejus.json'));
const semi = (euroClass = '', patch = {}) => ({ name: 'Semi', weight: 44, height: 4, critair: '2', banStatus: 'concerned', euroClass, ...patch });
const raw = (code) => JSON.parse(readFileSync(new URL(`../data/pays/${code}.json`, import.meta.url), 'utf8'));
const FOOT = 'La signalisation fait foi.';

test('tubes du Mont-Blanc et du Fréjus repérés sur leur tracé, un passage chacun', () => {
  const a = euroTunnelsAlongRoute(mb());
  assert.equal(a.length, 1);
  assert.equal(a[0].id, 'known:montblanc');
  assert.ok(a[0].exit - a[0].enter > 10000, 'tunnel de 11,6 km');
  const b = euroTunnelsAlongRoute(fr());
  assert.deepEqual(b.map((p) => p.id), ['known:frejus']);
});

test('Mont-Blanc : Euro 0 à 4 interdits (alerte, fiche), Euro 5 / EEV / 6 admis, chaque texte finit par la signalisation', () => {
  for (const c of ['0', '1', '2', '3', '4']) {
    const r = euroRules(mb(), { vehicle: semi(c) });
    assert.equal(r.passages[0].verdict, 'banned', c);
    const warn = r.lines.filter((l) => l.level === 'warn');
    assert.equal(warn.length, 1, c);
    assert.match(warn[0].text, new RegExp(`^Tunnel du Mont-Blanc interdit à votre véhicule \\(Euro ${c}\\), vers km 13 : PL de marchandises de plus de 3,5 t Euro 0 à 4 interdits depuis le 1er juillet 2020 \\(arrêté préfectoral n° 2020-0825 du 18 juin 2020\\)`));
    assert.match(warn[0].text, /avant le 1er octobre 2006/);
    assert.match(warn[0].text, /lu le 21\/11\/2026/);
    assert.equal(warn[0].url, TUNNEL_RULES[0].source.url);
    assert.deepEqual(r.short, [`Mont-Blanc interdit (Euro ${c})`]);
  }
  for (const c of ['5', 'EEV', '6']) {
    const r = euroRules(mb(), { vehicle: semi(c) });
    assert.equal(r.passages[0].verdict, 'allowed', c);
    assert.ok(r.lines.every((l) => l.level === 'info'), c);
    assert.deepEqual(r.short, [], c);
    assert.match(r.lines[0].text, /est admise/);
  }
  assert.match(euroRules(mb(), { vehicle: semi('EEV') }).lines[0].text, /EEV n'est pas dans la liste des classes interdites/);
  for (const c of EURO_VALUES) for (const l of euroRules(mb(), { vehicle: semi(c) }).lines) assert.ok(l.text.endsWith(FOOT), l.text);
});

test('classe non précisée : les deux cas affichés, fiche « classe Euro ? »', () => {
  const r = euroRules(mb(), { vehicle: semi('') });
  assert.equal(r.passages[0].verdict, 'unknown');
  const [warn, info] = r.lines;
  assert.equal(warn.level, 'warn');
  assert.match(warn.text, /^Tunnel du Mont-Blanc, vers km 13 : PL de marchandises de plus de 3,5 t Euro 0 à 4 interdits/);
  assert.match(warn.text, /Classe Euro non précisée dans le profil : vérifiez-la\./);
  assert.equal(info.level, 'info');
  assert.match(info.text, /^Tunnel du Mont-Blanc : Euro 5, EEV et Euro 6 admis/);
  assert.deepEqual(r.short, ['Mont-Blanc : Euro 0 à 4 interdits, classe Euro ?']);
  // Ancien profil (sans champ) : traité comme non précisé.
  const old = normalizeVehicle({ name: 'Ancien', height: 4, width: 2.55, length: 16.5, weight: 44, maxSpeed: 90, critair: '2' });
  assert.equal(old.euroClass, '');
  assert.deepEqual(euroRules(mb(), { vehicle: old }).short, r.short);
});

test('Fréjus : Euro 0 à 2 par l\'arrêté, Euro 3 et 4 confirmés par l\'exploitant (nom et date), visibles sur la fiche', () => {
  const official = euroRules(fr(), { vehicle: semi('2') });
  assert.equal(official.passages[0].verdict, 'banned');
  assert.match(official.lines[0].text, /Euro 0 à 2 interdits \(arrêté du 7 juillet 2017/);
  assert.match(official.lines[0].text, /avant le 1er octobre 2001/);
  for (const c of ['3', '4']) {
    const r = euroRules(fr(), { vehicle: semi(c) });
    assert.equal(r.passages[0].verdict, 'operator');
    const [l] = r.lines;
    assert.equal(l.level, 'warn');
    assert.match(l.text, /Euro 3 et 4 interdits \(selon l'exploitant\)/);
    assert.match(l.text, /Confirmé par l'exploitant : SFTRF \(exploitant français du tunnel du Fréjus\), page « Classification tunnel », lu le 21\/11\/2026 ; arrêté préfectoral non retrouvé\./);
    assert.ok(l.text.endsWith(FOOT));
    assert.deepEqual(r.short, [`Fréjus interdit (Euro ${c}, exploitant)`]);
  }
  const none = euroRules(fr(), { vehicle: semi('') });
  assert.equal(none.lines.filter((l) => l.level === 'warn').length, 2);
  assert.deepEqual(none.short, ['Fréjus : Euro 0 à 4 interdits, classe Euro ?']);
  const ok = euroRules(fr(), { vehicle: semi('6') });
  assert.match(ok.lines[0].text, /votre classe \(Euro 6\) est admise \(Euro 0 à 2, Euro 3 et 4 selon l'exploitant interdits/);
});

test('règle « à vérifier » : jamais présentée comme une interdiction, ligne sur la fiche', () => {
  const rules = TUNNEL_RULES.map((r) => (r.id === 'frejus-3-4' ? { ...r, status: 'check', verified: null, since: '1er juillet 2020', ref: 'texte officiel non lu' } : r));
  const r = euroRules(fr(), { vehicle: semi('3'), rules });
  assert.equal(tunnelVerdict('known:frejus', '3', rules), 'check');
  assert.ok(r.lines.every((l) => l.level === 'info'));
  assert.ok(!r.lines.some((l) => /interdit à votre véhicule|est admise/.test(l.text)));
  assert.match(r.lines[0].text, /: à vérifier\. Votre profil : Euro 3\./);
  assert.deepEqual(r.short, ['Fréjus Euro 3 et 4 : à vérifier']);
  const unknown = euroRules(fr(), { vehicle: semi(''), rules });
  assert.match(unknown.lines.find((l) => /admis/.test(l.text)).text, /Euro 5, EEV et Euro 6 admis \(EEV n'est pas dans la liste des classes interdites\) ; Euro 3 et 4 : à vérifier/);
});

test('PTAC de 3,5 t ou moins : rien ; tracé à côté du tube (plus de 35 m) : rien', () => {
  assert.deepEqual(euroRules(mb(), { vehicle: semi('3', { weight: 3.5 }) }), { passages: [], lines: [], short: [] });
  const shifted = mb();
  shifted.coordinates = shifted.coordinates.map(([x, y]) => [x + 0.001, y + 0.001]); // ≈ 110 m au nord-est
  assert.deepEqual(euroRules(shifted, { vehicle: semi('3') }).lines, []);
  assert.deepEqual(euroRules(parseDirections(fixture('ors-directions-fr-ch-it.json')), { vehicle: semi('3') }).lines, []);
});

test('chaque règle a sa source et sa date de lecture ; tableau EEV sourcé', () => {
  for (const r of TUNNEL_RULES) {
    assert.ok(r.source?.name && /^https:\/\//.test(r.source.url), r.id);
    if (r.status !== 'check') assert.match(r.verified, /^\d{4}-\d{2}-\d{2}$/, r.id);
  }
  assert.ok(EURO_EEV.every((e) => e.rule && e.eev && e.source));
  assert.equal(classesText(['0', '1', '2', '3', '4']), 'Euro 0 à 4');
  assert.equal(classesText(['3', '4']), 'Euro 3 et 4');
  assert.equal(EURO.MIN_PTAC_T, 3.5);
});

test('profil : champ Classe Euro, valeur inconnue refusée à la validation et oubliée à la lecture', () => {
  assert.equal(defaultVehicle().euroClass, '');
  const v = normalizeVehicle({ ...defaultVehicle(), euroClass: 'EEV' });
  assert.equal(v.euroClass, 'EEV');
  assert.equal(normalizeVehicle({ ...defaultVehicle(), euroClass: '7' }).euroClass, '');
  assert.equal(validateVehicle({ ...v, euroClass: '7' }).errors.euroClass, 'Classe Euro inconnue.');
  assert.equal(validateVehicle(v).valid, true);
});

test('fiche d\'itinéraire : alerte Euro avec les autres, avant les informations, sans voix', () => {
  const rules = routeRules(mb(), { vehicle: semi('3'), departure: new Date(2026, 10, 18, 10) });
  const i = rules.lines.findIndex((l) => /^Tunnel du Mont-Blanc interdit à votre véhicule/.test(l.text));
  assert.ok(i >= 0);
  assert.equal(rules.lines[i].level, 'warn');
  assert.ok(rules.short.includes('Mont-Blanc interdit (Euro 3)'));
  assert.equal(rules.euro.passages[0].verdict, 'banned');
  assert.ok(rules.lines.every((l) => l.voice === undefined));
});

test('fiches pays : rubrique « Normes Euro », catégorie de la classe, source nommée, « à vérifier » sinon', () => {
  const ch = parseCountryData(raw('CH'));
  const de = parseCountryData(raw('DE'));
  const at = parseCountryData(raw('AT'));
  const it = parseCountryData(raw('IT'));
  const seg = (code, name) => ({ code, name, enter: 0, exit: 50000, enterTime: new Date(2026, 10, 18, 10), exitTime: new Date(2026, 10, 18, 11) });
  const euroItems = (data, v) => countryCard(data, seg(data.code, data.name), { vehicle: v }).items.filter((x) => x.section === 'Normes Euro');

  const [rplp] = euroItems(ch, semi('6'));
  assert.ok(rplp.confirmed);
  assert.equal(rplp.source.kind, 'national');
  assert.match(rplp.source.name, /ORPL, RS 641\.811/);
  assert.match(rplp.text, /Votre profil \(Euro 6\) : catégorie de redevance 3 \(2,39 centimes par tonne et par km\)\.$/);
  assert.match(euroItems(ch, semi('EEV'))[0].text, /Votre profil \(EEV\) : catégorie de redevance 1 \(3,26 centimes par tonne et par km\), comme Euro V\.$/);
  assert.match(euroItems(ch, semi(''))[0].text, /Classe Euro non précisée dans le profil : selon votre classe\.$/);

  const [maut, green, green6] = euroItems(de, semi('4'));
  assert.match(maut.text, /Votre profil \(Euro 4\) : catégorie C\.$/);
  assert.match(green.text, /Votre profil \(Euro 4\) : groupe 4 \(vignette verte\)\.$/);
  assert.equal(green6.confirmed, false);
  assert.match(green6.text, /à vérifier/);
  assert.match(euroItems(de, semi('6'))[1].text, /Votre profil \(Euro 6\) : à vérifier\.$/);

  for (const data of [at, it]) {
    const items = euroItems(data, semi('5'));
    assert.ok(items.length >= 1);
    assert.ok(items.every((x) => !x.confirmed && /à vérifier/.test(x.text)), data.code);
  }
  assert.equal(countryEuroText({ text: 'Sans catégorie.' }, semi('3')), 'Sans catégorie.');
  assert.ok(COUNTRY_RULES.FILES.includes('AT'));
});

test('guidage avec des positions comme le vrai GPS dans le Mont-Blanc (Euro 3) : rien d\'Euro dit ni affiché', () => {
  const route = mb();
  const t0 = new Date(2026, 10, 18, 10).getTime();
  const s0 = startNavigation(route, { now: t0, rules: { vehicle: semi('3'), voice: true } });
  const sim = createSimulator(route.coordinates, { speedKmh: 70 });
  const fixes = Array.from({ length: 1500 }, (_, i) => sim.next(t0 + i * 1000));
  const { events, views } = runFixes(updateNavigation, s0, fixes);
  assert.ok(!events.some((e) => /Euro|Mont-Blanc interdit/.test(e.text ?? '')));
  assert.ok(views.every((v) => !/Euro [0-6]|classe Euro/.test(JSON.stringify(v))));
});
